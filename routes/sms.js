const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendSMS } = require('../utils/twilio');
const { sendPushToOwner } = require('../utils/pushNotifications');
const twilio = require('twilio');

// Auto-heal Twilio webhook URL for a phone number (non-blocking, fire-and-forget)
function selfHealWebhook(phoneSid, phoneNumber) {
  if (!phoneSid || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;
  setImmediate(async () => {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
      const expectedUrl = `${baseUrl}/api/sms/webhook`;
      const numberInfo = await client.incomingPhoneNumbers(phoneSid).fetch();
      if (numberInfo.smsUrl !== expectedUrl) {
        await client.incomingPhoneNumbers(phoneSid).update({
          smsUrl: expectedUrl,
          smsMethod: 'POST'
        });
        console.log(`🔧 Auto-repaired webhook for ${phoneNumber}: "${numberInfo.smsUrl}" → "${expectedUrl}"`);
      }
    } catch (err) {
      console.error('Webhook self-heal error:', err.message);
    }
  });
}

// Twilio webhook for incoming SMS
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { From, To, Body, MessageSid } = req.body;

    console.log(`📨 SMS: ${From} → ${To}: "${Body}"`);

    // Deduplication: Twilio may retry webhooks — skip if already processed
    if (MessageSid) {
      const dupCheck = await pool.query(
        'SELECT id FROM sms_messages WHERE twilio_message_sid = $1 LIMIT 1',
        [MessageSid]
      );
      if (dupCheck.rows.length > 0) {
        console.log(`⚠️ Duplicate webhook for ${MessageSid} — skipping`);
        return res.status(200).send('<Response></Response>');
      }
    }

    // Find user by their Twilio phone number
    const userResult = await pool.query(
      'SELECT id, business_name, twilio_phone_sid FROM users WHERE twilio_phone_number = $1',
      [To]
    );

    let user;
    if (userResult.rows.length === 0) {
      console.log(`⚠️ No user found for ${To}`);
      return res.status(200).send('<Response></Response>');
    } else if (userResult.rows.length === 1) {
      user = userResult.rows[0];
    } else {
      // Shared trial number — multiple users have this number
      // Route by finding which user owns a lead with this From number
      const leadLookup = await pool.query(
        `SELECT user_id FROM leads WHERE phone = $1 AND user_id = ANY($2)
         ORDER BY created_at DESC LIMIT 1`,
        [From, userResult.rows.map(r => r.id)]
      );
      if (leadLookup.rows.length > 0) {
        user = userResult.rows.find(r => r.id === leadLookup.rows[0].user_id);
      } else {
        // No existing lead — assign to first matching user
        user = userResult.rows[0];
      }
    }

    // Self-heal webhook URL in background (no-op if already correct)
    selfHealWebhook(user.twilio_phone_sid, To);

    // Find or create lead
    let leadResult = await pool.query(
      'SELECT id, name, email FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [From, user.id]
    );

    let leadId;
    if (leadResult.rows.length === 0) {
      const newLead = await pool.query(
        `INSERT INTO leads (user_id, name, phone, source, status, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         RETURNING id, name, email`,
        [user.id, From, From, 'sms_inbound', 'new']
      );
      leadId = newLead.rows[0].id;
      leadResult = newLead;
      console.log(`📝 New lead ${leadId} from ${From}`);
    } else {
      leadId = leadResult.rows[0].id;
    }

    // Store incoming message
    await pool.query(
      `INSERT INTO sms_messages
       (lead_id, user_id, direction, from_number, to_number, message, twilio_message_sid, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [leadId, user.id, 'incoming', From, To, Body, MessageSid]
    );

    await pool.query(
      `UPDATE leads SET status = 'replied', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [leadId]
    );

    // Push notification to owner
    const leadName = leadResult.rows[0]?.name || From;
    sendPushToOwner(user.id, 'New Message', `${leadName}: ${Body.slice(0, 100)}`, { leadId, screen: 'AdminLeads' }).catch(() => {});

    // Check if AI enabled
    const configResult = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [user.id, 'lead_form']
    );

    const agentEnabled = configResult.rows[0]?.config?.enabled !== false;

    if (agentEnabled) {
      // Generate AI response first to calculate typing delay
      const aiResponse = await generateAIResponse(user.id, leadId, leadResult.rows[0], Body);

      if (aiResponse) {
        // Calculate human-like delay
        // Base delay: 30-90 seconds (reading and thinking time)
        const baseDelay = 30000 + Math.random() * 60000; // 30-90 seconds

        // Typing delay: 50-80ms per character (simulates 40-60 WPM typing)
        const typingDelay = aiResponse.length * (50 + Math.random() * 30);

        const totalDelay = baseDelay + typingDelay;

        console.log(`⏰ AI will respond in ${Math.round(totalDelay / 1000)} seconds (reading: ${Math.round(baseDelay / 1000)}s + typing: ${Math.round(typingDelay / 1000)}s)`);

        // Schedule the response
        setTimeout(async () => {
          try {
            await sendSMS(From, aiResponse, user.id);

            await pool.query(
              `INSERT INTO sms_messages
               (lead_id, user_id, direction, to_number, message, created_at)
               VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
              [leadId, user.id, 'outgoing', From, aiResponse]
            );

            console.log(`🤖 AI replied to ${From} after ${Math.round(totalDelay / 1000)}s delay`);
          } catch (error) {
            console.error('Error sending delayed AI response:', error.message);
          }
        }, totalDelay);
      }
    }

    // Always respond to Twilio immediately so it doesn't retry
    res.status(200).send('<Response></Response>');
  } catch (error) {
    console.error('SMS webhook error:', error.message);
    res.status(500).send('<Response></Response>');
  }
});

// Generate AI Response
async function generateAIResponse(userId, leadId, lead, userMessage) {
  try {
    const historyResult = await pool.query(
      `SELECT direction, message FROM sms_messages
       WHERE lead_id = $1 ORDER BY created_at ASC LIMIT 10`,
      [leadId]
    );

    const servicesResult = await pool.query(
      `SELECT name, price, duration_hours, description
       FROM services WHERE user_id = $1 AND active = true`,
      [userId]
    );

    const services = servicesResult.rows.map(s =>
      `${s.name} - $${s.price} - ${s.duration_hours}hrs${s.description ? ': ' + s.description : ''}`
    ).join('\n') || 'General services';

    const hoursResult = await pool.query(
      `SELECT day_of_week, is_open, open_time, close_time
       FROM business_hours WHERE user_id = $1 ORDER BY day_of_week`,
      [userId]
    );

    const businessHours = hoursResult.rows
      .filter(h => h.is_open)
      .map(h => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `${days[h.day_of_week]}: ${h.open_time}-${h.close_time}`;
      })
      .join(', ') || 'Contact us for hours';

    const conversationHistory = historyResult.rows.map(msg => ({
      role: msg.direction === 'incoming' ? 'user' : 'assistant',
      content: msg.message
    }));

    const systemPrompt = `You are a friendly service business AI assistant responding to customer SMS.

Goal: Qualify leads, answer questions, schedule appointments.
Style: Brief, conversational, SMS-friendly (under 160 chars when possible). Sound like a real human texting — casual, warm, and natural.

NEVER use markdown formatting. No asterisks, no dashes for bullet points, no bold text, no lists. Use plain sentences with commas, periods, exclamations, and question marks only.

Services:
${services}

Hours:
${businessHours}

Lead: ${lead.name || 'Customer'} | ${lead.email || 'No email'}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: systemPrompt,
        messages: [
          ...conversationHistory,
          { role: 'user', content: userMessage }
        ]
      })
    });

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('AI error:', error.message);
    return null;
  }
}

// GET /api/sms/webhook-status — check Twilio webhook config for the authenticated user's number
router.get('/webhook-status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    const { EFFECTIVE_JWT_SECRET } = require('../config/middleware');
    const decoded = jwt.verify(authHeader.replace('Bearer ', ''), EFFECTIVE_JWT_SECRET);
    const userId = decoded.userId;

    const userResult = await pool.query(
      'SELECT twilio_phone_number, twilio_phone_sid FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows[0]?.twilio_phone_sid) {
      return res.json({ hasNumber: false, message: 'No Twilio number provisioned' });
    }

    const { twilio_phone_number, twilio_phone_sid } = userResult.rows[0];
    const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
    const expectedUrl = `${baseUrl}/api/sms/webhook`;

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const numberInfo = await client.incomingPhoneNumbers(twilio_phone_sid).fetch();

    const isCorrect = numberInfo.smsUrl === expectedUrl;

    res.json({
      hasNumber: true,
      phoneNumber: twilio_phone_number,
      currentWebhookUrl: numberInfo.smsUrl,
      expectedWebhookUrl: expectedUrl,
      isCorrect,
      status: isCorrect ? '✅ Webhook correctly configured' : '❌ Webhook URL mismatch — replies not being received'
    });
  } catch (err) {
    console.error('Webhook status check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/fix-webhook — force-repair the Twilio webhook URL for the authenticated user
router.post('/fix-webhook', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    const { EFFECTIVE_JWT_SECRET } = require('../config/middleware');
    const decoded = jwt.verify(authHeader.replace('Bearer ', ''), EFFECTIVE_JWT_SECRET);
    const userId = decoded.userId;

    const userResult = await pool.query(
      'SELECT twilio_phone_number, twilio_phone_sid FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows[0]?.twilio_phone_sid) {
      return res.status(400).json({ error: 'No Twilio number provisioned' });
    }

    const { twilio_phone_number, twilio_phone_sid } = userResult.rows[0];
    const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
    const expectedUrl = `${baseUrl}/api/sms/webhook`;

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.incomingPhoneNumbers(twilio_phone_sid).update({
      smsUrl: expectedUrl,
      smsMethod: 'POST'
    });

    console.log(`🔧 Manually repaired webhook for user ${userId} (${twilio_phone_number}) → ${expectedUrl}`);
    res.json({ success: true, phoneNumber: twilio_phone_number, webhookUrl: expectedUrl });
  } catch (err) {
    console.error('Fix webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
