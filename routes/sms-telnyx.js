// ============================================
// Telnyx SMS webhook (test route — Twilio untouched)
// Mount: POST /api/sms-telnyx/webhook
//
// In Telnyx portal → Messaging → Messaging Profiles → Inbound:
//   Webhook URL: https://YOUR-RAILWAY-DOMAIN/api/sms-telnyx/webhook
//   Webhook API version: API v2
// ============================================

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendSMSTelnyx } = require('../utils/telnyx');
const { sendPushToOwner } = require('../utils/pushNotifications');

// Telnyx sends JSON (not url-encoded like Twilio)
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const event = req.body?.data;

    // Telnyx sends various event types — only handle inbound messages
    if (!event || event.event_type !== 'message.received') {
      return res.status(200).json({ received: true });
    }

    const payload = event.payload;
    const fromNumber = payload?.from?.phone_number;
    const toNumber   = payload?.to?.[0]?.phone_number;
    const body       = payload?.text || '';
    const messageId  = payload?.id || '';

    console.log(`📨 Telnyx SMS: ${fromNumber} → ${toNumber}: "${body}"`);

    // Find user by their Telnyx phone number
    const userResult = await pool.query(
      'SELECT id, business_name, telnyx_phone_number FROM users WHERE telnyx_phone_number = $1',
      [toNumber]
    );

    if (userResult.rows.length === 0) {
      console.log(`⚠️ Telnyx: no user found for ${toNumber}`);
      return res.status(200).json({ received: true });
    }

    const user = userResult.rows[0];

    // Find or create lead
    let leadResult = await pool.query(
      'SELECT id, name, email FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [fromNumber, user.id]
    );

    let leadId;
    if (leadResult.rows.length === 0) {
      const newLead = await pool.query(
        `INSERT INTO leads (user_id, name, phone, source, status, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         RETURNING id, name, email`,
        [user.id, fromNumber, fromNumber, 'sms_inbound', 'new']
      );
      leadId = newLead.rows[0].id;
      leadResult = newLead;
      console.log(`📝 Telnyx: new lead ${leadId} from ${fromNumber}`);
    } else {
      leadId = leadResult.rows[0].id;
    }

    // Store incoming message (reusing existing sms_messages table)
    await pool.query(
      `INSERT INTO sms_messages
       (lead_id, user_id, direction, from_number, message, twilio_message_sid, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [leadId, user.id, 'incoming', fromNumber, body, messageId]
    );

    await pool.query(
      `UPDATE leads SET status = 'replied', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [leadId]
    );

    // Push notification to owner
    const leadName = leadResult.rows[0]?.name || fromNumber;
    sendPushToOwner(user.id, 'New Message', `${leadName}: ${body.slice(0, 100)}`, { leadId, screen: 'AdminLeads' }).catch(() => {});

    // Check if AI agent enabled
    const configResult = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [user.id, 'lead_form']
    );

    const agentEnabled = configResult.rows[0]?.config?.enabled !== false;

    if (agentEnabled) {
      const aiResponse = await generateAIResponse(user.id, leadId, leadResult.rows[0], body);

      if (aiResponse) {
        const baseDelay  = 30000 + Math.random() * 60000;
        const typingDelay = aiResponse.length * (50 + Math.random() * 30);
        const totalDelay  = baseDelay + typingDelay;

        console.log(`⏰ Telnyx AI will respond in ${Math.round(totalDelay / 1000)}s`);

        setTimeout(async () => {
          try {
            await sendSMSTelnyx(fromNumber, aiResponse, toNumber);

            await pool.query(
              `INSERT INTO sms_messages
               (lead_id, user_id, direction, to_number, message, created_at)
               VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
              [leadId, user.id, 'outgoing', fromNumber, aiResponse]
            );

            console.log(`🤖 Telnyx AI replied to ${fromNumber} after ${Math.round(totalDelay / 1000)}s`);
          } catch (err) {
            console.error('Telnyx: delayed AI send failed:', err.message);
          }
        }, totalDelay);
      }
    }

    // Telnyx doesn't need a special response body — just 200
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Telnyx webhook error:', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Simple outbound send — useful for manual testing
// POST /api/sms-telnyx/send  { to, message }
router.post('/send', express.json(), async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });

    const result = await sendSMSTelnyx(to, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI response generator (same logic as Twilio route) ──────────────
async function generateAIResponse(userId, leadId, lead, userMessage) {
  try {
    const [historyResult, servicesResult, hoursResult] = await Promise.all([
      pool.query(
        `SELECT direction, message FROM sms_messages
         WHERE lead_id = $1 ORDER BY created_at ASC LIMIT 10`,
        [leadId]
      ),
      pool.query(
        `SELECT name, price, duration_hours, description
         FROM services WHERE user_id = $1 AND active = true`,
        [userId]
      ),
      pool.query(
        `SELECT day_of_week, is_open, open_time, close_time
         FROM business_hours WHERE user_id = $1 ORDER BY day_of_week`,
        [userId]
      ),
    ]);

    const services = servicesResult.rows.map(s =>
      `${s.name} - $${s.price} - ${s.duration_hours}hrs${s.description ? ': ' + s.description : ''}`
    ).join('\n') || 'General services';

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const businessHours = hoursResult.rows
      .filter(h => h.is_open)
      .map(h => `${days[h.day_of_week]}: ${h.open_time}-${h.close_time}`)
      .join(', ') || 'Contact us for hours';

    const conversationHistory = historyResult.rows.map(msg => ({
      role: msg.direction === 'incoming' ? 'user' : 'assistant',
      content: msg.message,
    }));

    const systemPrompt = `You are a friendly service business AI assistant responding to customer SMS. Goal: Qualify leads, answer questions, schedule appointments. Style: Brief, conversational, SMS-friendly (under 160 chars when possible). Sound like a real human texting. NEVER use markdown formatting, asterisks, dashes for lists, or bold text. Use plain sentences with commas, periods, exclamations, and question marks only. Services:\n${services}\nHours:\n${businessHours}\nLead: ${lead.name || 'Customer'} | ${lead.email || 'No email'}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: systemPrompt,
        messages: [...conversationHistory, { role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();
    return data.content?.[0]?.text || null;
  } catch (error) {
    console.error('Telnyx AI error:', error.message);
    return null;
  }
}

module.exports = router;
