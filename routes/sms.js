const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendSMS } = require('../utils/twilio');

// Twilio webhook for incoming SMS
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { From, To, Body, MessageSid } = req.body;

    console.log(`📨 SMS: ${From} → ${To}: "${Body}"`);

    // Find user by their Twilio phone number
    const userResult = await pool.query(
      'SELECT id, business_name FROM users WHERE twilio_phone_number = $1',
      [To]
    );

    if (userResult.rows.length === 0) {
      console.log(`⚠️ No user found for ${To}`);
      return res.status(200).send('<Response></Response>');
    }

    const user = userResult.rows[0];

    // Find or create lead
    let leadResult = await pool.query(
      'SELECT id, name, email FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [From, user.id]
    );

    let leadId;
    if (leadResult.rows.length === 0) {
      const newLead = await pool.query(
        `INSERT INTO leads (user_id, phone, source, status, created_at) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
         RETURNING id, name, email`,
        [user.id, From, 'sms_inbound', 'new']
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
       (lead_id, user_id, direction, from_number, message, twilio_message_sid, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [leadId, user.id, 'incoming', From, Body, MessageSid]
    );

    await pool.query(
      `UPDATE leads SET status = 'replied', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [leadId]
    );

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
Style: Brief, conversational, SMS-friendly (under 160 chars when possible). Sound human and casual.

Services:
${services}

Hours:
${businessHours}

Lead: ${lead.name || 'Customer'} | ${lead.email || 'No email'}

Keep it casual and brief. Don't be overly formal.`;

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

module.exports = router;
