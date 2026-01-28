const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { verifyWebhookSignature, sendSMS } = require('../utils/sendblue');

// ============================================
// POST - SendBlue Incoming SMS Webhook
// ============================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify webhook signature (important for security)
    const signature = req.headers['x-sendblue-signature'];
    const rawBody = req.body.toString();
    
    if (!verifyWebhookSignature(signature, rawBody)) {
      console.error('❌ Invalid SendBlue webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const webhook = JSON.parse(rawBody);
    
    console.log('📱 Incoming SendBlue webhook:', webhook.type);
    
    // Handle different webhook types
    switch (webhook.type) {
      case 'message.received':
        await handleIncomingSMS(webhook.data);
        break;
        
      case 'message.sent':
        await handleMessageSent(webhook.data);
        break;
        
      case 'message.failed':
        await handleMessageFailed(webhook.data);
        break;
        
      default:
        console.log('Unknown webhook type:', webhook.type);
    }
    
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('Error handling SendBlue webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ============================================
// Handle Incoming SMS
// ============================================
async function handleIncomingSMS(data) {
  const { from_number, content, message_handle, media_url } = data;
  
  console.log(`📨 Incoming SMS from ${from_number}: "${content}"`);
  
  // Find lead by phone number
  const leadResult = await pool.query(
    `SELECT id, user_id, name, email 
     FROM leads 
     WHERE phone = $1 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [from_number]
  );
  
  if (leadResult.rows.length === 0) {
    console.log(`⚠️ No lead found for phone: ${from_number}`);
    // Optionally create a new lead here
    return;
  }
  
  const lead = leadResult.rows[0];
  
  // Store incoming message
  await pool.query(
    `INSERT INTO sms_messages 
     (lead_id, user_id, direction, from_number, message, media_url, sendblue_message_id, created_at) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
    [lead.id, lead.user_id, 'incoming', from_number, content, media_url, message_handle]
  );
  
  // Update lead status
  await pool.query(
    `UPDATE leads 
     SET status = 'replied', last_contact_at = CURRENT_TIMESTAMP 
     WHERE id = $1`,
    [lead.id]
  );
  
  // Check if AI agent is enabled
  const configResult = await pool.query(
    'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
    [lead.user_id, 'lead_form']
  );
  
  const agentEnabled = configResult.rows[0]?.config?.enabled !== false;
  
  if (!agentEnabled) {
    console.log('🤖 Lead form agent disabled, no AI response');
    return;
  }
  
  // Generate AI response
  const aiResponse = await generateAIResponse(lead, content);
  
  if (aiResponse) {
    // Send AI reply via SendBlue
    const smsResult = await sendSMS(from_number, aiResponse);
    
    // Store outgoing message
    await pool.query(
      `INSERT INTO sms_messages 
       (lead_id, user_id, direction, to_number, message, sendblue_message_id, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [lead.id, lead.user_id, 'outgoing', from_number, aiResponse, smsResult.message_handle]
    );
    
    console.log(`🤖 AI response sent to ${from_number}`);
  }
}

// ============================================
// Handle Message Sent Confirmation
// ============================================
async function handleMessageSent(data) {
  const { message_handle } = data;
  
  await pool.query(
    `UPDATE sms_messages 
     SET status = 'sent', updated_at = CURRENT_TIMESTAMP 
     WHERE sendblue_message_id = $1`,
    [message_handle]
  );
  
  console.log(`✅ Message ${message_handle} confirmed sent`);
}

// ============================================
// Handle Message Failed
// ============================================
async function handleMessageFailed(data) {
  const { message_handle, error } = data;
  
  await pool.query(
    `UPDATE sms_messages 
     SET status = 'failed', error = $2, updated_at = CURRENT_TIMESTAMP 
     WHERE sendblue_message_id = $1`,
    [message_handle, error]
  );
  
  console.error(`❌ Message ${message_handle} failed: ${error}`);
}

// ============================================
// Generate AI Response
// ============================================
async function generateAIResponse(lead, userMessage) {
  try {
    // Get conversation history
    const historyResult = await pool.query(
      `SELECT direction, message 
       FROM sms_messages 
       WHERE lead_id = $1 
       ORDER BY created_at ASC 
       LIMIT 10`,
      [lead.id]
    );
    
    // Get business services
    const servicesResult = await pool.query(
      `SELECT name, price, duration_hours, description 
       FROM services 
       WHERE user_id = $1 AND active = true`,
      [lead.user_id]
    );
    
    const services = servicesResult.rows.map(s => 
      `${s.name} - $${s.price} - ${s.duration_hours}hrs${s.description ? ': ' + s.description : ''}`
    ).join('\n');
    
    // Get business hours
    const hoursResult = await pool.query(
      `SELECT day_of_week, is_open, open_time, close_time 
       FROM business_hours 
       WHERE user_id = $1 
       ORDER BY day_of_week`,
      [lead.user_id]
    );
    
    const businessHours = hoursResult.rows
      .filter(h => h.is_open)
      .map(h => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `${days[h.day_of_week]}: ${h.open_time}-${h.close_time}`;
      })
      .join(', ');
    
    // Build conversation history
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

When customer is ready to book, respond with:
BOOKING: {service: "service name", date: "YYYY-MM-DD", time: "HH:MM"}

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
    let aiReply = data.content[0].text;
    
    // Check for booking intent
    if (aiReply.includes('BOOKING:')) {
      const match = aiReply.match(/BOOKING:\s*({.*?})/);
      if (match) {
        try {
          const booking = JSON.parse(match[1]);
          // Create booking logic here...
          console.log('📅 Booking intent detected:', booking);
          aiReply = aiReply.replace(/BOOKING:.*?\n?/g, '').trim();
        } catch (e) {
          console.error('Error parsing booking:', e);
        }
      }
    }
    
    return aiReply;
    
  } catch (error) {
    console.error('Error generating AI response:', error);
    return null;
  }
}

module.exports = router;
