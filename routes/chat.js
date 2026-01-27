const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const Anthropic = require('@anthropic-ai/sdk');

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
    console.error('Error starting conversation:', error);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// Helper function to extract booking intent from conversation
function extractBookingInfo(messages) {
  const allMessages = messages.map(m => m.content).join(' ').toLowerCase();
  
  // Check for booking intent
  const bookingKeywords = ['book', 'schedule', 'appointment', 'reserve', 'set up'];
  const hasBookingIntent = bookingKeywords.some(kw => allMessages.includes(kw));
  
  if (!hasBookingIntent) return null;
  
  // Extract date (basic patterns)
  const datePatterns = [
    /(?:on|for)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /(?:on|for)\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/,
    /(tomorrow|today|next week)/i
  ];
  
  let dateMatch = null;
  for (const pattern of datePatterns) {
    dateMatch = allMessages.match(pattern);
    if (dateMatch) break;
  }
  
  // Extract time (basic patterns)
  const timeMatch = allMessages.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/);
  
  return {
    hasIntent: true,
    date: dateMatch ? dateMatch[1] : null,
    time: timeMatch ? timeMatch[1] : null
  };
}

// Helper function to create booking from chat
async function createBookingFromChat(userId, bookingData) {
  try {
    const { serviceId, serviceName, bookingDate, startTime, customerName, customerEmail, customerPhone } = bookingData;
    
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
        `INSERT INTO customers (user_id, name, email, phone, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id`,
        [userId, customerName, customerEmail, customerPhone]
      );
      customerId = customerResult.rows[0].id;
    } else {
      customerId = customerResult.rows[0].id;
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

    return {
      success: true,
      booking,
      employeeName,
      serviceName: service.name,
      bookingNumber
    };

  } catch (error) {
    console.error('Error creating booking from chat:', error);
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
              bi.address, bi.city, bi.state
       FROM users u
       LEFT JOIN business_information bi ON u.id = bi.user_id
       WHERE u.id = $1`,
      [userId]
    );

    const userInfo = userInfoResult.rows[0] || {};

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

    const systemPrompt = `You are ${userInfo.business_name || 'a helpful'} assistant. 
Your job is to help website visitors by:
1. Answering questions about services and pricing
2. Capturing lead information (name, email, phone)
3. Booking appointments when requested

Available services:
${servicesResult.rows.map(s => `- ${s.name} (ID: ${s.id}): $${s.price} - ${s.description} (${s.duration_hours} hours)`).join('\n')}

Business Hours:
${businessHours || 'Monday-Friday: 9:00 AM - 5:00 PM'}

Contact: ${userInfo.phone || 'N/A'}
Email: ${userInfo.email || 'N/A'}

IMPORTANT INSTRUCTIONS:
- Be friendly, professional, and helpful
- When someone wants to book, ask for: service name, preferred date, preferred time, name, email, and phone
- Once you have ALL booking details, respond with a special formatted message:
  BOOKING_REQUEST|serviceId|YYYY-MM-DD|HH:MM|customerName|customerEmail|customerPhone
  Example: BOOKING_REQUEST|5|2025-01-30|14:00|John Smith|john@email.com|5551234567
- Use 24-hour time format (14:00 not 2:00 PM)
- For dates, use YYYY-MM-DD format
- When you capture a lead (email or phone), acknowledge it naturally
- Don't mention the BOOKING_REQUEST format to the customer - it's internal`;

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
      
      // Create the booking
      const bookingResult = await createBookingFromChat(userId, {
        serviceId: parseInt(serviceId),
        bookingDate,
        startTime,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim()
      });

      if (bookingResult.success) {
        // Remove the BOOKING_REQUEST line from reply
        reply = reply.replace(/BOOKING_REQUEST\|[^\n]+\n?/, '');
        
        // Add confirmation message
        reply += `\n\n✅ Perfect! I've booked your appointment:\n` +
                 `📅 ${bookingDate} at ${startTime}\n` +
                 `🔧 ${bookingResult.serviceName}\n` +
                 `👤 with ${bookingResult.employeeName}\n` +
                 `📋 Booking #${bookingResult.bookingNumber}\n\n` +
                 `You'll receive a confirmation email at ${customerEmail}. See you then!`;
        
        // Also create a lead if we haven't already
        const leadExists = await pool.query(
          'SELECT id FROM leads WHERE user_id = $1 AND email = $2',
          [userId, customerEmail]
        );
        
        if (leadExists.rows.length === 0) {
          await pool.query(
            `INSERT INTO leads (user_id, name, email, phone, source, status, created_at)
             VALUES ($1, $2, $3, $4, 'ai_chat_agent', 'booked', CURRENT_TIMESTAMP)`,
            [userId, customerName, customerEmail, customerPhone]
          );
        }
      } else {
        reply = reply.replace(/BOOKING_REQUEST\|[^\n]+\n?/, '');
        reply += `\n\n❌ I'm sorry, but ${bookingResult.error}. Would you like to try a different time?`;
      }
    }

    // Save assistant response (cleaned)
    await pool.query(
      `INSERT INTO chat_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'assistant', $2, CURRENT_TIMESTAMP)`,
      [conversationId, reply]
    );

    // Extract lead info if present (basic detection) - only if no booking was made
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
          r.content.toLowerCase().includes('this is ')
        );

        const name = possibleName ? 
          possibleName.content.match(/(?:my name is|i'm|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)?.[1] :
          'Website Visitor';

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
    console.error('Error processing message:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

module.exports = router;
