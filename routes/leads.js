const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requirePlan } = require('../config/middleware');
const { sendSMS } = require('../utils/twilio');
const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ============================================
// GET - Fetch all leads
// ============================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT * FROM leads
       WHERE user_id = $1 AND status != 'booked'
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ 
      success: true,
      leads: result.rows 
    });
  } catch (error) {
    console.error('Error fetching leads:', error.message);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

async function triggerLeadFormAgent(userId, lead) {
  try {
    // ONLY trigger for leads from website contact forms
    if (lead.source !== 'lead_form') {
      console.log(`⏭️ Skipping lead form agent - lead source is "${lead.source}", not "lead_form"`);
      return;
    }

    // Get agent config
    const agentConfig = await pool.query(
      'SELECT config, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    const agentCfg = agentConfig.rows[0]?.config;
    // SMS fires only when explicitly deployed. Backward-compat: treat enabled=true
    // with no 'deployed' field as deployed (existing agents before this flag existed).
    const smsAgentLive = agentCfg?.deployed === true || (agentCfg?.enabled === true && !('deployed' in (agentCfg || {})));
    if (agentConfig.rows.length === 0 || !smsAgentLive) {
      console.log('Lead form agent not deployed for user', userId);
      return;
    }
    const config = agentCfg;

    const smsTemplate = agentConfig.rows[0].sms_template;

    // Schedule SMS in DB — picked up by cron job every 30s
    if (config.smsEnabled && lead.phone && lead.sms_consent && smsTemplate) {
      const delaySeconds = 45 + Math.floor(Math.random() * 30); // 45-75 seconds

      await pool.query(
        `UPDATE leads
           SET status = 'sms_pending',
               sms_scheduled_at = NOW() + ($1 * INTERVAL '1 second')
         WHERE id = $2`,
        [delaySeconds, lead.id]
      );

      console.log(`⏰ SMS scheduled for lead ${lead.id} in ${delaySeconds}s (cron will send)`);
    } else if (config.smsEnabled && lead.phone && !lead.sms_consent) {
      console.log(`⚠️ Lead form agent: SMS NOT sent to ${lead.phone} - no SMS consent`);
    }
    console.log(`✅ Lead form agent scheduled for lead ${lead.id} (source: ${lead.source})`);
  } catch (error) {
    console.error('Error in triggerLeadFormAgent:', error.message);
  }
}

router.options('/public/:userId', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

// ============================================
// GET - Public business info for lead magnet pages (no auth)
// ============================================
router.get('/public/:userId/info', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT business_name, business_type FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { business_name, business_type } = result.rows[0];
    res.json({
      businessName: business_name || '',
      businessType: business_type || '',
    });
  } catch (error) {
    console.error('Error fetching public business info:', error.message);
    res.status(500).json({ error: 'Failed to fetch business info' });
  }
});

router.post('/public/:userId', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  
  try {
    const { userId } = req.params;
    const { name, email, phone, service, message, sms_consent, source } = req.body;

    console.log('📝 Public lead submission:', { userId, name, email, phone, sms_consent, source });

    // CRITICAL: SMS consent MUST be true
    if (sms_consent !== true) {
      console.error('❌ SMS consent not provided');
      return res.status(400).json({ error: 'SMS consent is required' });
    }

    // Validate required fields
    if (!name || !email || !phone) {
      console.error('❌ Missing required fields');
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    const result = await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, status, source, service, message, sms_consent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, name, email, phone, 'new', 'lead_form', service, message, true]
    );

    const newLead = result.rows[0];
    console.log(`✅ Public lead created: ${name} for user ${userId} (SMS consent: true)`);

    // Trigger Lead Form Agent
    triggerLeadFormAgent(userId, newLead).catch(err =>
      console.error('Error triggering lead form agent:', err.message)
    );

    // Notify business owner (non-blocking)
    if (process.env.SENDGRID_API_KEY) {
      pool.query('SELECT email, business_name FROM users WHERE id = $1', [userId])
        .then(ownerRes => {
          const owner = ownerRes.rows[0];
          if (!owner?.email) return;
          return sgMail.send({
            to: owner.email,
            from: { name: 'SORCE', email: 'noreply@sorceintegrations.com' },
            subject: `New lead: ${name}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
                <div style="background:#1d4ed8;padding:1.5rem 2rem;border-radius:8px 8px 0 0;">
                  <h1 style="color:#fff;margin:0;font-size:1.25rem;">New Lead Submitted</h1>
                </div>
                <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                  <p style="margin-top:0;">A new lead just came in from your website${owner.business_name ? ` for <strong>${owner.business_name}</strong>` : ''}.</p>
                  <table style="width:100%;border-collapse:collapse;margin:1rem 0;">
                    <tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;width:120px;border-radius:4px 0 0 0;">Name</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${name}</td></tr>
                    <tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${phone}</td></tr>
                    <tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${email || '—'}</td></tr>
                    ${service ? `<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;">Service</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${service}</td></tr>` : ''}
                    ${message ? `<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;vertical-align:top;">Message</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${message}</td></tr>` : ''}
                  </table>
                  <p style="color:#6b7280;font-size:0.85rem;margin:0;">Submitted via lead form on your website.</p>
                </div>
              </div>`,
          });
        })
        .catch(err => console.error('Error sending lead notification email:', err.message));
    }

    res.json({
      success: true,
      message: 'Thank you! We\'ll be in touch soon.'
    });
  } catch (error) {
    console.error('Error creating public lead:', error.message);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});


// ============================================
// POST - Create new lead
// ============================================
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, phone, status, source, notes, service, message } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, status, source, notes, service, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, name, email, phone, status || 'new', source || 'manual', notes, service, message]
    );

    const newLead = result.rows[0];
    console.log(`✅ Lead created: ${name}`);

    // Trigger Lead Form Agent if source is 'lead_form'
    if (source === 'lead_form') {
      // Don't await - let it run in background
      triggerLeadFormAgent(userId, newLead).catch(err => 
        console.error('Error triggering lead form agent:', err.message)
      );
    }

    res.json({
      success: true,
      lead: newLead
    });
  } catch (error) {
    console.error('Error creating lead:', error.message);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// POST - Bulk import leads from CSV
router.post('/bulk-import', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { leads } = req.body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads array is required' });
    }

    if (leads.length > 5000) {
      return res.status(400).json({ error: 'Maximum 5000 leads per import' });
    }

    // Load existing lead emails, phones, and names for dedup
    const existingResult = await pool.query(
      `SELECT LOWER(TRIM(email)) AS email,
              LOWER(TRIM(name))  AS name,
              regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') AS phone
       FROM leads WHERE user_id = $1`,
      [userId]
    );
    const normPhone10 = p => p ? p.replace(/\D/g, '').slice(-10) : null;
    const existingEmails = new Set(existingResult.rows.map(r => r.email).filter(Boolean));
    const existingPhones = new Set(existingResult.rows.map(r => normPhone10(r.phone)).filter(Boolean));
    const existingNames  = new Set(existingResult.rows.map(r => r.name).filter(Boolean));
    const seenEmails = new Set();
    const seenPhones = new Set();
    const seenNames  = new Set();

    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const l of leads) {
        if (!l.name || !l.name.trim()) { errorCount++; continue; }
        const normEmail = l.email ? l.email.toLowerCase().trim() : null;
        const normPhone = normPhone10(l.phone);
        const normName  = l.name.toLowerCase().trim();

        // Dedup priority: email → phone → name
        if (normEmail) {
          if (existingEmails.has(normEmail) || seenEmails.has(normEmail)) { duplicateCount++; continue; }
        } else if (normPhone) {
          if (existingPhones.has(normPhone) || seenPhones.has(normPhone)) { duplicateCount++; continue; }
        } else {
          if (existingNames.has(normName) || seenNames.has(normName)) { duplicateCount++; continue; }
        }

        if (normEmail) seenEmails.add(normEmail);
        else if (normPhone) seenPhones.add(normPhone);
        else seenNames.add(normName);

        try {
          await client.query(
            `INSERT INTO leads (user_id, name, email, phone, status, source, notes, service, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
            [userId, l.name.trim(), normEmail || null, l.phone || null,
             l.status || 'new', l.source || 'manual', l.notes || null, l.service || null]
          );
          if (normEmail) existingEmails.add(normEmail);
          else if (normPhone) existingPhones.add(normPhone);
          else existingNames.add(normName);
          successCount++;
        } catch { errorCount++; }
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ success: true, successCount, duplicateCount, errorCount });
  } catch (error) {
    console.error('Error bulk importing leads:', error.message);
    res.status(500).json({ error: 'Failed to import leads' });
  }
});

// ============================================
// GET - List leads with SMS conversations
// ============================================
router.get('/sms-conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT
        l.id, l.name, l.phone, l.email, l.status, l.source, l.service, l.message, l.notes, l.created_at,
        COUNT(s.id)::int AS message_count,
        MAX(s.created_at) AS last_message_at,
        (SELECT s2.message FROM sms_messages s2 WHERE s2.lead_id = l.id ORDER BY s2.created_at DESC LIMIT 1) AS last_message,
        (SELECT s2.direction FROM sms_messages s2 WHERE s2.lead_id = l.id ORDER BY s2.created_at DESC LIMIT 1) AS last_direction
       FROM leads l
       JOIN sms_messages s ON s.lead_id = l.id
       WHERE l.user_id = $1
       GROUP BY l.id, l.name, l.phone, l.email, l.status, l.source, l.service, l.message, l.notes, l.created_at
       ORDER BY MAX(s.created_at) DESC`,
      [userId]
    );

    res.json({ success: true, leads: result.rows });
  } catch (error) {
    console.error('Error fetching SMS conversations:', error.message);
    res.status(500).json({ error: 'Failed to fetch SMS conversations' });
  }
});

const ALLOWED_LEAD_FIELDS = new Set([
  'name', 'email', 'phone', 'service', 'message', 'status',
  'notes', 'source', 'assigned_to', 'appointment_date', 'service_type',
  'follow_up_date', 'sms_consent'
]);

// ============================================
// PATCH - Update lead
// ============================================
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const updates = req.body;

    const invalidFields = Object.keys(updates).filter(f => !ALLOWED_LEAD_FIELDS.has(f));
    if (invalidFields.length > 0) {
      return res.status(400).json({ error: `Invalid field(s): ${invalidFields.join(', ')}` });
    }

    // Sanitize: empty strings become null so date/numeric columns don't fail
    const sanitized = {};
    for (const [k, v] of Object.entries(updates)) {
      sanitized[k] = (v === '') ? null : v;
    }

    const fields = Object.keys(sanitized);
    const values = Object.values(sanitized);
    const setClause = fields.map((field, idx) => `${field} = $${idx + 2}`).join(', ');

    const result = await pool.query(
      `UPDATE leads
       SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $${fields.length + 2}
       RETURNING *`,
      [id, ...values, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({
      success: true,
      lead: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating lead:', error.message);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// ============================================
// DELETE - Delete lead
// ============================================
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM leads WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    console.log(`✅ Lead deleted: ${result.rows[0].name}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting lead:', error.message);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ============================================
// POST - Send manual SMS to lead (Twilio)
// ============================================
router.post('/:leadId/send-sms', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const { leadId } = req.params;
    const { message } = req.body;
    const userId = req.user.userId;
    
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }
    
    const leadResult = await pool.query(
      'SELECT phone, name FROM leads WHERE id = $1 AND user_id = $2',
      [leadId, userId]
    );
    
    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    const lead = leadResult.rows[0];
    
    if (!lead.phone) {
      return res.status(400).json({ error: 'Lead has no phone number' });
    }
    
    // Get user's Twilio phone number
    const userResult = await pool.query(
      'SELECT twilio_phone_number FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userResult.rows[0]?.twilio_phone_number) {
      return res.status(400).json({ error: 'No phone number provisioned. Please set up Twilio first.' });
    }
    
    // Send via Twilio — sendSMS(to, message, userId) looks up the from number internally
    const smsResult = await sendSMS(lead.phone, message, userId);
    
    // Store outgoing message
    await pool.query(
      `INSERT INTO sms_messages 
       (lead_id, user_id, direction, to_number, message, twilio_message_sid, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [leadId, userId, 'outgoing', lead.phone, message, smsResult.messageSid]
    );
    
    await pool.query(
      `UPDATE leads SET status = 'contacted_sms', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [leadId]
    );
    
    console.log(`✅ SMS sent via Twilio to lead ${leadId}`);
    res.json({ success: true, messageId: smsResult.messageSid });
    
  } catch (error) {
    console.error('Error sending SMS:', error.message);
    res.status(500).json({ error: 'Failed to send SMS', details: error.message });
  }
});
// ============================================
// GET - Get SMS conversation for a lead
// ============================================
router.get('/:leadId/sms-conversation', authenticateToken, async (req, res) => {
  try {
    const { leadId } = req.params;
    const userId = req.user.userId;
    
    // Verify lead belongs to user
    const leadResult = await pool.query(
      'SELECT id FROM leads WHERE id = $1 AND user_id = $2',
      [leadId, userId]
    );
    
    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    // Get SMS messages
    const messagesResult = await pool.query(
      `SELECT direction, to_number, from_number, message, created_at 
       FROM sms_messages 
       WHERE lead_id = $1 
       ORDER BY created_at ASC`,
      [leadId]
    );
    
    res.json({ messages: messagesResult.rows });
  } catch (error) {
    console.error('Error fetching SMS conversation:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// ============================================
// GET - Get chat conversation for a lead (ai_chat_agent source)
// ============================================
router.get('/:leadId/chat-conversation', authenticateToken, async (req, res) => {
  try {
    const { leadId } = req.params;
    const userId = req.user.userId;

    const leadResult = await pool.query(
      'SELECT id, conversation_id, phone, email, created_at FROM leads WHERE id = $1 AND user_id = $2',
      [leadId, userId]
    );

    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = leadResult.rows[0];
    let convId = lead.conversation_id;

    // If no direct link, try to find a matching conversation by time proximity + phone/email
    if (!convId) {
      // Strategy 1: match conversation where a message contains the lead's phone or email
      if (lead.phone || lead.email) {
        const patterns = [];
        const params = [userId];
        if (lead.phone) { params.push(`%${lead.phone.replace(/\D/g, '').slice(-10)}%`); patterns.push(`m.content ILIKE $${params.length}`); }
        if (lead.email) { params.push(`%${lead.email}%`); patterns.push(`m.content ILIKE $${params.length}`); }

        const matchResult = await pool.query(
          `SELECT DISTINCT cc.id FROM chat_conversations cc
           JOIN chat_messages m ON m.conversation_id = cc.id
           WHERE cc.user_id = $1 AND (${patterns.join(' OR ')})
           ORDER BY cc.id DESC LIMIT 1`,
          params
        );
        if (matchResult.rows.length > 0) convId = matchResult.rows[0].id;
      }

      // Strategy 2: closest conversation by time (within 4 hours of lead creation)
      if (!convId && lead.created_at) {
        const timeResult = await pool.query(
          `SELECT id FROM chat_conversations
           WHERE user_id = $1
             AND created_at BETWEEN $2::timestamptz - INTERVAL '4 hours' AND $2::timestamptz + INTERVAL '4 hours'
           ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamptz))) ASC
           LIMIT 1`,
          [userId, lead.created_at]
        );
        if (timeResult.rows.length > 0) convId = timeResult.rows[0].id;
      }

      // Backfill for next time
      if (convId) {
        pool.query('UPDATE leads SET conversation_id = $1 WHERE id = $2', [convId, lead.id]).catch(() => {});
      }
    }

    if (!convId) {
      return res.json({ messages: [], note: 'No matching conversation found' });
    }

    const messagesResult = await pool.query(
      'SELECT role, content, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [convId]
    );

    res.json({ messages: messagesResult.rows, conversation_id: convId });
  } catch (error) {
    console.error('Error fetching lead chat conversation:', error.message);
    res.status(500).json({ error: 'Failed to fetch chat conversation' });
  }
});

// ============================================
// POST - Generate AI response for lead
// ============================================
router.post('/generate-response', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { leadName, serviceInterest, leadMessage, preferredContact } = req.body;

    if (!leadName) {
      return res.status(400).json({ error: 'Lead name required' });
    }

    // Get business info
    const businessResult = await pool.query(
      'SELECT business_name FROM users WHERE id = $1',
      [userId]
    );

    const businessName = businessResult.rows[0]?.business_name || 'our business';

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are a friendly customer service representative for ${businessName}.

A potential customer named ${leadName} has contacted us with interest in: ${serviceInterest || 'our services'}.

${leadMessage ? `Their message: "${leadMessage}"` : ''}

They prefer ${preferredContact === 'sms' ? 'text messages' : 'email'} communication.

Write a warm, personalized response that sounds like a real human wrote it. Thanks them for their interest, acknowledges what they're looking for, asks 1-2 natural questions to understand their needs, and encourages them to continue the conversation. Keep it ${preferredContact === 'sms' ? 'very short for SMS (under 160 characters)' : 'brief and conversational for email, 2-3 short sentences'}.

NEVER use markdown formatting. No asterisks, no dashes for lists, no bold text, no bullet points. Write in plain sentences using commas, periods, exclamation marks, and question marks like a real person would text.

Return ONLY the message text, no quotes or formatting.`
        }]
      })
    });

    const data = await response.json();
    const aiResponse = data.content[0].text.trim();

    console.log(`✅ Generated AI response for lead ${leadName}`);

    res.json({
      success: true,
      response: aiResponse
    });

  } catch (error) {
    console.error('Error generating AI response:', error.message);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

// ============================================
// POST - Convert lead to customer
// ============================================
router.post('/:id/convert', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Get lead info
    const leadResult = await pool.query(
      'SELECT * FROM leads WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = leadResult.rows[0];

    // Check if customer already exists
    const existingCustomer = await pool.query(
      'SELECT id FROM customers WHERE user_id = $1 AND email = $2',
      [userId, lead.email]
    );

    let customer;

    if (existingCustomer.rows.length > 0) {
      // Get existing customer data
      const existingResult = await pool.query(
        'SELECT * FROM customers WHERE id = $1',
        [existingCustomer.rows[0].id]
      );
      customer = existingResult.rows[0];
    } else {
      // Create new customer
      const customerResult = await pool.query(
        `INSERT INTO customers (user_id, name, email, phone, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         RETURNING *`,
        [userId, lead.name, lead.email, lead.phone, lead.message]
      );
      customer = customerResult.rows[0];
    }

    // Update lead status
    await pool.query(
      `UPDATE leads
       SET status = 'converted', customer_id = $1
       WHERE id = $2`,
      [customer.id, id]
    );

    console.log(`✅ Lead ${id} converted to customer ${customer.id}`);

    res.json({
      success: true,
      customer,
      customerId: customer.id,
      message: 'Lead converted to customer'
    });

  } catch (error) {
    console.error('Error converting lead:', error.message);
    res.status(500).json({ error: 'Failed to convert lead' });
  }
});

module.exports = router;
module.exports.triggerLeadFormAgent = triggerLeadFormAgent;
