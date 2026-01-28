const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendSMS } = require('../utils/twilio');

// Twilio webhook for incoming SMS
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { From, To, Body, MessageSid } = req.body;

    console.log(`📨 Incoming SMS from ${From} to ${To}: "${Body}"`);

    // Find user by their Twilio phone number
    const userResult = await pool.query(
      'SELECT id, business_name FROM users WHERE twilio_phone_number = $1',
      [To]
    );

    if (userResult.rows.length === 0) {
      console.log(`⚠️ No user found for phone: ${To}`);
      return res.status(200).send('<Response></Response>');
    }

    const user = userResult.rows[0];

    // Find or create lead
    let lead = await pool.query(
      'SELECT id, name, email FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [From, user.id]
    );

    let leadId;
    if (lead.rows.length === 0) {
      const newLead = await pool.query(
        `INSERT INTO leads (user_id, phone, source, status, created_at) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
         RETURNING id, name, email`,
        [user.id, From, 'sms_lead', 'new']
      );
      lead = newLead;
      leadId = newLead.rows[0].id;
      console.log(`📝 Created new lead ${leadId} for ${From}`);
    } else {
      leadId = lead.rows[0].id;
    }

    // Store incoming message
    await pool.query(
      `INSERT INTO sms_messages 
       (lead_id, user_id, direction, from_number, message, twilio_message_sid, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [leadId, user.id, 'incoming', From, Body, MessageSid]
    );

    // Update lead status
    await pool.query(
      `UPDATE leads SET status = 'replied', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [leadId]
    );

    // Check if AI agent is enabled
    const configResult = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [user.id, 'lead_form']
    );

    const agentEnabled = configResult.rows[0]?.config?.enabled !== false;

    if (!agentEnabled) {
      console.log('🤖 Lead form agent disabled, no AI response');
      return res.status(200).send('<Response></Response>');
    }

    // Generate AI response
    const aiResponse = await generateAIResponse(user.id, leadId, lead.rows[0], Body);

    if (aiResponse) {
      // Send AI reply via Twilio
      await sendSMS(From, To, aiResponse);

      // Store outgoing message
      await pool.query(
        `INSERT INTO sms_messages 
         (lead_id, user_id, direction, to_number, message, created_at) 
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [leadId, user.id, 'outgoing', From, aiResponse]
      );

      console.log(`🤖 AI response sent to ${From}`);
    }

    res.status(200).send('<Response></Response>');
  } catch (error) {
    console.error('SMS webhook error:', error);
    res.status(500).send('<Response></Response>');
  }
});

// Generate AI Response (same as before)
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
    ).join('\n');

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
      .join(', ');

    const conversationHistory = historyResult.rows.map(msg => ({
      role: msg.direction === 'incoming' ? 'user' : 'assistant',
      content: msg.message
    }));

    const systemPrompt = `You are a friendly service business AI assistant responding to customer SMS messages.

Your goal is to:
1. Qualify the lead by understanding their needs
2. Answer questions about services and pricing
3. Schedule appointments when they're ready
4. Keep responses SHORT (SMS-length, under 160 characters when possible)
5. Sound natural and conversational

Available services:
${services}

Business hours:
${businessHours}

Lead info:
Name: ${lead.name || 'Customer'}
Email: ${lead.email || 'Not provided'}

Keep it casual and brief. This is SMS, not email.`;

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
    console.error('Error generating AI response:', error);
    return null;
  }
}

module.exports = router;
