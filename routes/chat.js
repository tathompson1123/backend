const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const Anthropic = require('@anthropic-ai/sdk');
const { authenticateToken } = require('../config/middleware');
const { sendBookingEmails } = require('../utils/bookingEmail');
const { getBusinessDateTime } = require('../utils/zipToTimezone');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Start a new conversation
router.post('/start', async (req, res) => {
  try {
    const { userId, source } = req.body;

    const result = await pool.query(
      `INSERT INTO chat_conversations (user_id, source, created_at, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [userId, source || 'website']
    );

    res.json({ conversationId: result.rows[0].id });
  } catch (error) {
    console.error('Error starting conversation:', error.message);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// Helper function to create booking from chat
async function createBookingFromChat(userId, bookingData) {
  try {
    const { serviceId, bookingDate, startTime, customerName, customerEmail } = bookingData;
    // Truncate phone to 50 chars and strip non-phone characters
    const customerPhone = (bookingData.customerPhone || '').replace(/[^\d+\-() .ext]/gi, '').substring(0, 50);

    // Validate business hours
    const bookingDateObj = new Date(bookingDate + 'T12:00:00');
    const bookingDayOfWeek = bookingDateObj.getDay();
    const hoursCheck = await pool.query(
      'SELECT is_open, open_time, close_time FROM business_hours WHERE user_id = $1 AND day_of_week = $2',
      [userId, bookingDayOfWeek]
    );
    if (hoursCheck.rows.length === 0 || !hoursCheck.rows[0].is_open) {
      return { success: false, error: 'we are closed on that day' };
    }
    const bizHours = hoursCheck.rows[0];
    if (startTime < bizHours.open_time || startTime >= bizHours.close_time) {
      return { success: false, error: 'that time is outside our business hours' };
    }

    // Get service details
    const serviceResult = await pool.query(
      'SELECT duration_hours, price, name FROM services WHERE id = $1 AND user_id = $2',
      [serviceId, userId]
    );

    if (serviceResult.rows.length === 0) {
      throw new Error('Service not found');
    }

    const service = serviceResult.rows[0];
    
    // Calculate end time
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + (service.duration_hours * 60);
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    // Find available employee
    const availableEmpResult = await pool.query(
      `SELECT e.id, e.name
       FROM employees e
       LEFT JOIN service_employees se ON e.id = se.employee_id
       WHERE e.user_id = $1 
       AND e.active = true
       AND (se.service_id = $2 OR NOT EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id))
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.employee_id = e.id
         AND b.booking_date = $3
         AND b.status NOT IN ('cancelled', 'no_show')
         AND (
           (b.start_time <= $4 AND b.end_time > $4) OR
           (b.start_time < $5 AND b.end_time >= $5) OR
           (b.start_time >= $4 AND b.end_time <= $5)
         )
       )
       LIMIT 1`,
      [userId, serviceId, bookingDate, startTime, endTime]
    );

    if (availableEmpResult.rows.length === 0) {
      return { success: false, error: 'No employees available for this time slot' };
    }

    const employeeId = availableEmpResult.rows[0].id;
    const employeeName = availableEmpResult.rows[0].name;

    // Generate booking number
    const bookingNumberResult = await pool.query('SELECT generate_booking_number() as number');
    const bookingNumber = bookingNumberResult.rows[0].number;

    // Create or get customer
    let customerResult = await pool.query(
      'SELECT id FROM customers WHERE user_id = $1 AND (email = $2 OR phone = $3)',
      [userId, customerEmail, customerPhone]
    );

    let customerId;
    if (customerResult.rows.length === 0) {
      customerResult = await pool.query(
        `INSERT INTO customers (user_id, name, email, phone, total_jobs, lifetime_value, created_at)
         VALUES ($1, $2, $3, $4, 0, 0, CURRENT_TIMESTAMP)
         RETURNING id`,
        [userId, customerName, customerEmail, customerPhone]
      );
      customerId = customerResult.rows[0].id;
      console.log(`✅ Chat booking: created NEW customer ${customerId} (${customerName}, ${customerEmail})`);
    } else {
      customerId = customerResult.rows[0].id;
      // Update name, phone, email on existing customer
      await pool.query(
        `UPDATE customers SET name = $1, phone = COALESCE(NULLIF($2, ''), phone),
         email = COALESCE(NULLIF($3, ''), email), updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [customerName, customerPhone, customerEmail, customerId]
      );
      console.log(`✅ Chat booking: found & updated EXISTING customer ${customerId}`);
    }

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO bookings (
        user_id, customer_id, booking_number, booking_date, start_time, end_time,
        subtotal, total_amount, customer_name, customer_email, 
        customer_phone, status, employee_id, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        userId, customerId, bookingNumber, bookingDate, startTime, endTime,
        service.price, service.price, customerName, customerEmail,
        customerPhone, 'confirmed', employeeId, 'ai_chat_agent'
      ]
    );

    const booking = bookingResult.rows[0];

    // Create booking items
    await pool.query(
      `INSERT INTO booking_items (
        booking_id, service_id, service_name, service_duration, 
        service_price, quantity, subtotal
      )
      VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [booking.id, serviceId, service.name, service.duration_hours, service.price, service.price]
    );

    // Update customer with service info
    await pool.query(
      `UPDATE customers SET last_service = $1, last_service_date = $2,
       total_jobs = COALESCE(total_jobs, 0) + 1,
       lifetime_value = COALESCE(lifetime_value, 0) + COALESCE($3, 0),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [service.name, bookingDate, service.price || 0, customerId]
    );

    console.log(`✅ Chat booking created: #${bookingNumber} customer=${customerId} employee=${employeeId}`);

    // Send booking confirmation emails (non-blocking)
    sendBookingEmails({
      userId,
      bookingNumber,
      customerName,
      customerEmail,
      customerPhone,
      serviceName: service.name,
      bookingDate,
      startTime,
      endTime,
      price: service.price,
    }).then(() => {
      console.log(`📧 Chat booking email sent successfully for ${bookingNumber}`);
    }).catch(err => console.error('📧 Chat booking email FAILED:', err.message, err.response?.body));

    return {
      success: true,
      booking,
      employeeName,
      serviceName: service.name,
      bookingNumber
    };

  } catch (error) {
    console.error('❌ Error creating booking from chat:', error.message, error.stack);
    return { success: false, error: error.message };
  }
}

// Send a message
router.post('/message', async (req, res) => {
  try {
    const { userId, conversationId, message } = req.body;

    // Save user message
    await pool.query(
      `INSERT INTO chat_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'user', $2, CURRENT_TIMESTAMP)`,
      [conversationId, message]
    );

    // Get conversation history
    const historyResult = await pool.query(
      `SELECT role, content FROM chat_messages 
       WHERE conversation_id = $1 
       ORDER BY created_at ASC`,
      [conversationId]
    );

    // Get user's business info
    const userInfoResult = await pool.query(
      `SELECT u.business_name, u.phone, u.email,
              bi.address, bi.city, bi.state, bi.zip_code
       FROM users u
       LEFT JOIN business_information bi ON u.id = bi.user_id
       WHERE u.id = $1`,
      [userId]
    );

    const userInfo = userInfoResult.rows[0] || {};

    // Get agent config for personality/objection handling
    const agentConfigResult = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );
    const agentConfig = agentConfigResult.rows[0]?.config || {};

    // Get services with IDs
    const servicesResult = await pool.query(
      'SELECT id, name, description, price, duration_hours FROM services WHERE user_id = $1 AND active = true',
      [userId]
    );

    // Get business hours
    const hoursResult = await pool.query(
      'SELECT day_of_week, open_time, close_time, is_open FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
      [userId]
    );

    const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const businessHours = hoursResult.rows
      .filter(h => h.is_open)
      .map(h => `${daysMap[h.day_of_week]}: ${h.open_time} - ${h.close_time}`)
      .join('\n');

    // Get timezone-aware date from business location
    const bizDateTime = getBusinessDateTime(userInfo.state, userInfo.zip_code);

    const systemPrompt = `You are ${agentConfig.agentName || 'Kurt'}, a ${agentConfig.personality || 'friendly'} assistant for ${userInfo.business_name || 'our business'} helping customers book services.

Response style: Be ${agentConfig.responseLength || 'concise'} in your responses.
${agentConfig.customInstructions ? `\nSpecial instructions: ${agentConfig.customInstructions}` : ''}

Available services:
${servicesResult.rows.map(s => `- ${s.name} (ID: ${s.id}): $${s.price} - ${s.description} (${s.duration_hours} hours)`).join('\n')}

Business Hours:
${businessHours || 'Monday-Friday: 9:00 AM - 5:00 PM'}

Contact: ${userInfo.phone || 'N/A'}
Email: ${userInfo.email || 'N/A'}
Address: ${[userInfo.address, userInfo.city, userInfo.state, userInfo.zip_code].filter(Boolean).join(', ') || 'N/A'}

CONVERSATION FLOW - Follow these stages in order:

STAGE 1 - IDENTIFY THE PROBLEM:
- Ask what they're looking to get done
- Listen to their needs and pain points
- Be conversational and ${agentConfig.personality || 'friendly'}

STAGE 2 - RECOMMEND SERVICES:
- Based on their problem, suggest 1-3 relevant services from the list above
- Explain briefly why each service fits their needs
- Mention the price and duration for each
- Ask which service interests them most

STAGE 3 - GATHER BOOKING DETAILS (only after they choose a service):
Ask ONE question at a time in this order:
1. First, ask: "What day works best for you?" (accept formats like "tomorrow", "Monday", "Jan 30", etc.)
2. Then ask: "What time would you prefer?" (accept formats like "2pm", "14:00", "afternoon")
3. Then ask: "Can I get your name?"
4. Then ask: "What's the best email to send your confirmation?"
5. Finally ask: "And your phone number?"

STAGE 4 - CONFIRM AND BOOK:
Once you have ALL information (service, date, time, name, email, phone), respond with:
BOOKING_REQUEST|serviceId|YYYY-MM-DD|HH:MM|customerName|customerEmail|customerPhone

OBJECTION HANDLING:
- When a customer expresses hesitation about price, timing, or need, acknowledge their concern first
- Use social proof: mention satisfaction rates and experience
- If price is the objection, highlight the value and long-term savings
${agentConfig.objectionServices ? `- You may offer these complimentary add-ons to close hesitant customers: ${agentConfig.objectionServices}` : '- If appropriate, offer to include a small bonus service to sweeten the deal'}
${agentConfig.objectionNotes ? `- Additional objection handling notes: ${agentConfig.objectionNotes}` : ''}
- Never be pushy — be understanding and helpful while gently addressing concerns
- If they still decline, leave the door open: "No problem at all! We're here whenever you're ready."

Lead capture strategy: ${agentConfig.captureStrategy === 'early' ? 'Ask for contact info within the first 2-3 messages' : agentConfig.captureStrategy === 'booking' ? 'Only ask for contact info when booking' : 'Ask naturally when relevant'}

IMPORTANT RULES:
- Only ask for ONE piece of information per message
- Don't skip stages - follow the order
- Use natural, conversational language — write like a real human texting, not a formatted document
- NEVER use markdown formatting. No asterisks for bold (**word**), no dashes for bullet points (- item), no underscores, no hashtags. Use plain sentences with commas, periods, exclamation marks, and question marks only.
- NEVER parrot back or repeat what the customer just said. Don't restate their words, situation, or feelings back to them — it sounds robotic. Instead, respond naturally and move the conversation forward. For example, if they say "a mouse got in my car and I'm grossed out", do NOT say "Having a mouse in your car would definitely make anyone feel grossed out." Just acknowledge briefly ("Oh no, we can definitely help with that!") and move to your recommendation.
- Convert dates to YYYY-MM-DD format. Today is ${bizDateTime.fullDate} (${bizDateTime.isoDate}), current time is ${bizDateTime.currentTime}. Use this to calculate relative dates like "Tuesday", "tomorrow", "next week", etc. Make sure the day of the week matches correctly.
- Convert times to 24-hour format (2pm = 14:00, 9am = 09:00)
- Only send BOOKING_REQUEST when you have ALL 6 pieces of information
- For customerName in BOOKING_REQUEST, use ONLY the name the customer explicitly stated (e.g., if they said "I'm Kathy" or "My name is Kathy", use "Kathy"). NEVER use random words from the conversation as the name. If unclear, ask them to confirm their name before booking.
- Don't mention "BOOKING_REQUEST" to the customer - it's internal
- If they're just asking questions, answer them and don't force the booking flow`;

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: historyResult.rows.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    });

    let reply = response.content[0].text;

    // Check if AI wants to create a booking
    const bookingMatch = reply.match(/BOOKING_REQUEST\|(\d+)\|([\d-]+)\|([\d:]+)\|([^|]+)\|([^|]+)\|([^|]+)/);

    if (bookingMatch) {
      const [_, serviceId, bookingDate, startTime, customerName, customerEmail, customerPhone] = bookingMatch;
      console.log(`🤖 Chat BOOKING_REQUEST: service=${serviceId} date=${bookingDate} time=${startTime} name=${customerName} email=${customerEmail} phone=${customerPhone}`);

      // Create the booking
      const bookingResult = await createBookingFromChat(userId, {
        serviceId: parseInt(serviceId),
        bookingDate,
        startTime,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim()
      });

      console.log(`🤖 Chat booking result: success=${bookingResult.success}${bookingResult.error ? ' error=' + bookingResult.error : ''}`);

      if (bookingResult.success) {
        // Remove the BOOKING_REQUEST line from reply
        reply = reply.replace(/BOOKING_REQUEST\|[^\n]+\n?/, '');
        
        // Format the date nicely
        const dateObj = new Date(bookingDate + 'T00:00:00');
        const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        
        // Format the time nicely (convert 14:00 to 2:00 PM)
        const [hours, mins] = startTime.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        const formattedTime = `${displayHour}:${mins} ${ampm}`;
        
        // Add confirmation message
        reply = `Perfect! You're all set, ${customerName}! 🎉\n\n` +
                `📅 ${formattedDate} at ${formattedTime}\n` +
                `🔧 ${bookingResult.serviceName}\n` +
                `👤 ${bookingResult.employeeName} will take great care of you\n` +
                `📋 Booking #${bookingResult.bookingNumber}\n\n` +
                `I've sent a confirmation to ${customerEmail}. Looking forward to seeing you!`;
        
        // If they were previously a lead, update status to booked
        await pool.query(
          `UPDATE leads SET status = 'booked', updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND email = $2 AND status != 'booked'`,
          [userId, customerEmail]
        );
      } else {
        reply = reply.replace(/BOOKING_REQUEST\|[^\n]+\n?/, '');
        reply = `I'm sorry, but ${bookingResult.error}. Would you like to try a different time?`;
      }
    }

    // Save assistant response (cleaned)
    await pool.query(
      `INSERT INTO chat_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'assistant', $2, CURRENT_TIMESTAMP)`,
      [conversationId, reply]
    );

    // Extract lead info if present (only if no booking was made yet)
    if (!bookingMatch) {
      const emailMatch = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      const phoneMatch = message.match(/\b\d{10}\b|\b\(\d{3}\)\s*\d{3}-\d{4}\b/);
      
      if (emailMatch || phoneMatch) {
        // Extract name from conversation
        const nameResult = await pool.query(
          `SELECT content FROM chat_messages 
           WHERE conversation_id = $1 AND role = 'user' 
           ORDER BY created_at ASC`,
          [conversationId]
        );
        
        const possibleName = nameResult.rows.find(r => 
          r.content.toLowerCase().includes('my name is') ||
          r.content.toLowerCase().includes("i'm ") ||
          r.content.toLowerCase().match(/\b(name|called)\s+(is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
        );

        let name = 'Website Visitor';
        if (possibleName) {
          const nameMatch = possibleName.content.match(/(?:my name is|i'm|this is|name is|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
          if (nameMatch) {
            name = nameMatch[1];
          }
        }

        // Check if lead already exists
        const leadExists = await pool.query(
          'SELECT id FROM leads WHERE user_id = $1 AND (email = $2 OR phone = $3)',
          [userId, emailMatch?.[0], phoneMatch?.[0]]
        );

        if (leadExists.rows.length === 0) {
          // Create lead
          await pool.query(
            `INSERT INTO leads (user_id, name, email, phone, source, status, created_at)
             VALUES ($1, $2, $3, $4, 'ai_chat_agent', 'new', CURRENT_TIMESTAMP)`,
            [userId, name, emailMatch?.[0], phoneMatch?.[0]]
          );
        }
      }
    }

    res.json({ reply });
  } catch (error) {
    console.error('Error processing message:', error.message);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// List all conversations for the authenticated user (dashboard)
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const conversations = await pool.query(
      `SELECT cc.id, cc.source, cc.created_at, cc.updated_at,
              (SELECT COUNT(*) FROM chat_messages cm WHERE cm.conversation_id = cc.id) AS message_count,
              (SELECT cm.content FROM chat_messages cm WHERE cm.conversation_id = cc.id AND cm.role = 'user' ORDER BY cm.created_at ASC LIMIT 1) AS first_message,
              CASE
                WHEN EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = cc.id AND cm.role = 'assistant' AND (cm.content ILIKE '%booking #%' OR cm.content ILIKE '%you''re all set%')) THEN 'booked'
                WHEN (SELECT COUNT(*) FROM chat_messages cm WHERE cm.conversation_id = cc.id AND cm.role = 'user') <= 1 THEN 'no_response'
                ELSE 'no_booking'
              END AS outcome
       FROM chat_conversations cc
       WHERE cc.user_id = $1
         AND (SELECT COUNT(*) FROM chat_messages cm WHERE cm.conversation_id = cc.id AND cm.role = 'user') > 0
       ORDER BY cc.updated_at DESC`,
      [userId]
    );
    res.json({ conversations: conversations.rows });
  } catch (error) {
    console.error('Error fetching conversations:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages for a specific conversation (dashboard)
router.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    // Verify conversation belongs to this user
    const conv = await pool.query(
      'SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    if (conv.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const messages = await pool.query(
      `SELECT role, content, created_at
       FROM chat_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ messages: messages.rows });
  } catch (error) {
    console.error('Error fetching messages:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

module.exports = router;
