const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
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
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ 
      success: true,
      leads: result.rows 
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
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
      'SELECT config, email_template, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (agentConfig.rows.length === 0 || !agentConfig.rows[0].config?.enabled) {
      console.log('Lead form agent not enabled for user', userId);
      return;
    }

    const config = agentConfig.rows[0].config;
    const emailTemplate = agentConfig.rows[0].email_template;
    const smsTemplate = agentConfig.rows[0].sms_template;

    // Send email if enabled and email exists
    if (config.emailEnabled && lead.email && emailTemplate) {
      try {
        const personalizedEmail = emailTemplate
          .replace(/\{\{name\}\}/g, lead.name || 'there')
          .replace(/\{\{email\}\}/g, lead.email)
          .replace(/\{\{phone\}\}/g, lead.phone || 'N/A')
          .replace(/\{\{service\}\}/g, lead.service || 'our services')
          .replace(/\{\{message\}\}/g, lead.message || '');

        await sgMail.send({
          to: lead.email,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: 'Thanks for reaching out!',
          text: personalizedEmail,
          html: personalizedEmail.replace(/\n/g, '<br>')
        });

        await pool.query(
          `UPDATE leads SET status = 'contacted_email', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [lead.id]
        );

        console.log(`✅ Lead form agent: Email sent to ${lead.email}`);
      } catch (error) {
        console.error('Error sending email:', error);
      }
    }

    // Send SMS if enabled, phone exists, AND user gave SMS consent
    if (config.smsEnabled && lead.phone && lead.sms_consent && smsTemplate) {
      try {
        const personalizedSms = smsTemplate
          .replace(/\{\{name\}\}/g, lead.name || 'there')
          .replace(/\{\{email\}\}/g, lead.email || '')
          .replace(/\{\{phone\}\}/g, lead.phone)
          .replace(/\{\{service\}\}/g, lead.service || 'our services')
          .replace(/\{\{message\}\}/g, lead.message || '');

        // SendBlue is already set up - just use it
        const smsResult = await sendSMS(lead.phone, personalizedSms);

        // Store the message
        await pool.query(
          `INSERT INTO sms_messages 
           (lead_id, user_id, direction, to_number, message, sendblue_message_id, created_at) 
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [lead.id, userId, 'outgoing', lead.phone, personalizedSms, smsResult.message_handle]
        );

        await pool.query(
          `UPDATE leads SET status = 'contacted_sms', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [lead.id]
        );

        console.log(`✅ Lead form agent: SMS sent to ${lead.phone} via SendBlue`);
      } catch (error) {
        console.error('Error sending SMS via SendBlue:', error);
      }
    } else if (config.smsEnabled && lead.phone && !lead.sms_consent) {
      console.log(`⚠️ Lead form agent: SMS NOT sent to ${lead.phone} - no SMS consent`);
    }

    console.log(`✅ Lead form agent completed for lead ${lead.id} (source: ${lead.source})`);
  } catch (error) {
    console.error('Error in triggerLeadFormAgent:', error);
  }
}

router.options('/public/:userId', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
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
      console.error('Error triggering lead form agent:', err)
    );

    res.json({
      success: true,
      message: 'Thank you! We\'ll be in touch soon.'
    });
  } catch (error) {
    console.error('Error creating public lead:', error);
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
        console.error('Error triggering lead form agent:', err)
      );
    }

    res.json({
      success: true,
      lead: newLead
    });
  } catch (error) {
    console.error('Error creating lead:', error);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// ============================================
// PATCH - Update lead
// ============================================
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const updates = req.body;

    const fields = Object.keys(updates);
    const values = Object.values(updates);
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
    console.error('Error updating lead:', error);
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
    console.error('Error deleting lead:', error);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ============================================
// POST - Send manual SMS to lead (SendBlue)
// ============================================
// Around line 250 - Update send-sms endpoint
router.post('/:leadId/send-sms', authenticateToken, async (req, res) => {
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
    
    const fromNumber = userResult.rows[0].twilio_phone_number;
    
    // Send via Twilio
    const smsResult = await sendSMS(lead.phone, fromNumber, message);
    
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
    console.error('Error sending SMS:', error);
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
    console.error('Error fetching SMS conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
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

Write a warm, professional, personalized response that:
1. Thanks them for their interest
2. Acknowledges their specific service interest
3. Asks 1-2 relevant questions to better understand their needs
4. Encourages them to book or continue the conversation
5. Keeps it conversational and friendly (not corporate)
6. Is appropriate for ${preferredContact === 'sms' ? 'SMS (keep under 160 characters)' : 'email (2-3 short paragraphs)'}

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
    console.error('Error generating AI response:', error);
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

    let customerId;

    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
    } else {
      // Create new customer
      const customerResult = await pool.query(
        `INSERT INTO customers (user_id, name, email, phone, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         RETURNING id`,
        [userId, lead.name, lead.email, lead.phone, lead.message]
      );
      customerId = customerResult.rows[0].id;
    }

    // Update lead status
    await pool.query(
      `UPDATE leads 
       SET status = 'converted', customer_id = $1
       WHERE id = $2`,
      [customerId, id]
    );

    console.log(`✅ Lead ${id} converted to customer ${customerId}`);

    res.json({
      success: true,
      customerId,
      message: 'Lead converted to customer'
    });

  } catch (error) {
    console.error('Error converting lead:', error);
    res.status(500).json({ error: 'Failed to convert lead' });
  }
});

module.exports = router;
