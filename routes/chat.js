const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const Anthropic = require('@anthropic-ai/sdk');
const { authenticateToken } = require('../config/middleware');
const { sendBookingEmails } = require('../utils/bookingEmail');
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function formatSlotTime(slot) {
  const [h, m] = slot.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Returns up to 3 upcoming dates (within 14 days) that have at least one open slot
async function getAvailableDaysNearDate(userId, serviceId, bookingDate, durationHours) {
  const available = [];
  const base = new Date(bookingDate + 'T12:00:00');
  for (let offset = 1; offset <= 14 && available.length < 3; offset++) {
    const d = new Date(base);
    d.setDate(base.getDate() + offset);
    const dateStr = d.toISOString().slice(0, 10);
    const slots = await getAvailableSlotsForDate(userId, serviceId, dateStr, durationHours);
    if (slots.length > 0) {
      const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      available.push({ date: dateStr, label, slots });
    }
  }
  return available;
}

// Returns an array of "HH:MM" strings that are open for a given date/service
async function getAvailableSlotsForDate(userId, serviceId, bookingDate, durationHours) {
  const dateObj = new Date(bookingDate + 'T12:00:00');
  const dayOfWeek = dateObj.getDay();

  const hoursRow = await pool.query(
    'SELECT open_time, close_time, is_open FROM business_hours WHERE user_id = $1 AND day_of_week = $2',
    [userId, dayOfWeek]
  );
  if (!hoursRow.rows[0]?.is_open) return [];

  const { open_time, close_time } = hoursRow.rows[0];
  const [closeH, closeM] = close_time.split(':').map(Number);
  const closeMinutes = closeH * 60 + closeM;
  const durationMinutes = Math.ceil(durationHours * 60);

  // Use configured time slots if available, otherwise generate hourly from business hours
  let candidateSlots = [];
  const configuredSlots = await pool.query(
    'SELECT slot_time FROM booking_time_slots WHERE user_id = $1 AND active = true ORDER BY slot_time',
    [userId]
  );

  if (configuredSlots.rows.length > 0) {
    candidateSlots = configuredSlots.rows
      .map(r => r.slot_time.slice(0, 5))
      .filter(t => t >= open_time && t < close_time);
  } else {
    const [openH, openM] = open_time.split(':').map(Number);
    for (let h = openH; h < closeH; h++) {
      candidateSlots.push(`${String(h).padStart(2, '0')}:${String(openM).padStart(2, '0')}`);
    }
  }

  // Drop slots where the service wouldn't finish before closing
  candidateSlots = candidateSlots.filter(t => {
    const [h, m] = t.split(':').map(Number);
    return (h * 60 + m + durationMinutes) <= closeMinutes;
  });

  // If no employees configured, all candidate slots are available
  const empCount = parseInt(
    (await pool.query('SELECT COUNT(*) AS count FROM employees WHERE user_id = $1 AND active = true', [userId])).rows[0].count
  );
  if (empCount === 0) return candidateSlots;

  // Check each slot for employee availability
  const available = [];
  for (const slot of candidateSlots) {
    const [h, m] = slot.split(':').map(Number);
    const endMin = h * 60 + m + durationMinutes;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    const emp = await pool.query(
      `SELECT e.id FROM employees e
       LEFT JOIN service_employees se ON e.id = se.employee_id
       WHERE e.user_id = $1 AND e.active = true
       AND (se.service_id = $2 OR NOT EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id))
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.employee_id = e.id AND b.booking_date = $3
         AND b.status NOT IN ('cancelled', 'no_show')
         AND (
           (b.start_time <= $4 AND b.end_time > $4) OR
           (b.start_time < $5 AND b.end_time >= $5) OR
           (b.start_time >= $4 AND b.end_time <= $5)
         )
       )
       LIMIT 1`,
      [userId, serviceId, bookingDate, slot, endTime]
    );
    if (emp.rows.length > 0) available.push(slot);
  }
  return available;
}

async function sendAttentionEmail({ userId, customerName, customerPhone, conversationId }) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    const userResult = await pool.query(
      'SELECT business_name, email FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows[0]?.email) return;
    const { business_name: businessName, email: ownerEmail } = userResult.rows[0];

    await sgMail.send({
      to: ownerEmail,
      from: { name: 'SORCE Chat Alerts', email: 'noreply@sorceintegrations.com' },
      subject: `Action needed: ${customerName} wants a call back`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
          <div style="background:#dc2626;padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:1.4rem;">Customer Needs Attention</h1>
          </div>
          <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
            <p style="font-size:1rem;margin-top:0;">
              A customer on your website chat asked to be called back or had a question your chat agent couldn't fully answer.
              Reach out to them as soon as possible.
            </p>
            <table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:15px;">
              <tr>
                <td style="padding:10px 12px;background:#f8f9fa;font-weight:600;width:35%;">Name</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;">${customerName}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Phone</td>
                <td style="padding:10px 12px;">${customerPhone}</td>
              </tr>
            </table>
            <p style="color:#6b7280;font-size:0.85rem;margin:0;">
              Business: ${businessName || 'Your business'} &nbsp;|&nbsp; Conversation #${conversationId}
            </p>
          </div>
        </div>`,
    });
    console.log(`📧 Attention email sent for user ${userId} — customer: ${customerName}`);
  } catch (err) {
    console.error('📧 Attention email error:', err.message);
  }
}
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
async function createBookingFromChat(userId, bookingData, { skipConfirmationEmail = false } = {}) {
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

    // Get service details, tax rate, and business address in parallel
    const [serviceResult, taxResult] = await Promise.all([
      pool.query(
        'SELECT duration_hours, price, name, location_type, custom_address FROM services WHERE id = $1 AND user_id = $2',
        [serviceId, userId]
      ),
      pool.query(
        `SELECT u.default_tax_rate,
                NULLIF(TRIM(CONCAT_WS(', ', NULLIF(bi.address,''), NULLIF(bi.city,''), NULLIF(bi.state,''))), '') AS business_address
         FROM users u
         LEFT JOIN business_information bi ON bi.user_id = u.id
         WHERE u.id = $1`,
        [userId]
      ),
    ]);

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

    // Find available employee — if no employees are configured at all, allow the booking
    // to go through unassigned (owner assigns staff later in the dashboard)
    const empCountResult = await pool.query(
      'SELECT COUNT(*) AS count FROM employees WHERE user_id = $1 AND active = true',
      [userId]
    );
    const hasEmployees = parseInt(empCountResult.rows[0].count) > 0;

    let employeeId = null;
    let employeeName = 'our team';

    if (hasEmployees) {
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
        const openSlots = await getAvailableSlotsForDate(userId, serviceId, bookingDate, service.duration_hours);
        const nearbyDays = openSlots.length === 0
          ? await getAvailableDaysNearDate(userId, serviceId, bookingDate, service.duration_hours)
          : [];
        return { success: false, error: 'slot_taken', availableSlots: openSlots, nearbyDays };
      }

      employeeId = availableEmpResult.rows[0].id;
      employeeName = availableEmpResult.rows[0].name;
    }

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

    // Create booking with tax calculation
    const servicePrice = parseFloat(service.price) || 0;
    const taxRate = parseFloat(taxResult.rows[0]?.default_tax_rate) || 0;
    const taxAmount = Math.round(servicePrice * taxRate * 100) / 100;
    const totalAmount = Math.round((servicePrice + taxAmount) * 100) / 100;

    // Determine location for the booking
    const locationType = service.location_type || 'business_address';
    const businessAddress = taxResult.rows[0]?.business_address || null;
    const locationDisplay = locationType === 'custom_address'
      ? (service.custom_address || businessAddress)
      : locationType === 'customer_address'
        ? (bookingData.customerAddress || null)
        : businessAddress;

    const bookingResult = await pool.query(
      `INSERT INTO bookings (
        user_id, customer_id, booking_number, booking_date, start_time, end_time,
        subtotal, tax_rate, tax_amount, total_amount, customer_name, customer_email,
        customer_phone, status, employee_id, source, customer_address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        userId, customerId, bookingNumber, bookingDate, startTime, endTime,
        servicePrice, taxRate, taxAmount, totalAmount, customerName, customerEmail,
        customerPhone, 'confirmed', employeeId, 'ai_chat_agent', locationDisplay
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
      [booking.id, serviceId, service.name, service.duration_hours, servicePrice, servicePrice]
    );

    // Update customer with service info
    await pool.query(
      `UPDATE customers SET last_service = $1, last_service_date = $2,
       total_jobs = COALESCE(total_jobs, 0) + 1,
       lifetime_value = COALESCE(lifetime_value, 0) + COALESCE($3, 0),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [service.name, bookingDate, servicePrice, customerId]
    );

    console.log(`✅ Chat booking created: #${bookingNumber} customer=${customerId} employee=${employeeId}`);

    // Send booking confirmation emails (non-blocking) — never let email failure kill the booking result
    if (!skipConfirmationEmail) {
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
        subtotal: servicePrice,
        taxRate,
        taxAmount,
        total: totalAmount,
        location: locationDisplay,
      }).then(() => {
        console.log(`📧 Chat booking email sent successfully for ${bookingNumber}`);
      }).catch(err => console.error('📧 Chat booking email FAILED:', err.message, err.response?.body));
    }

    return {
      success: true,
      booking,
      bookingId: booking.id,
      employeeName,
      serviceName: service.name,
      bookingNumber
    };

  } catch (error) {
    console.error('❌ Error creating booking from chat:', error.message, error.stack);
    return { success: false, error: 'internal_error' };
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
${agentConfig.learnedInstructions ? `\nLearned improvements (apply these):\n${agentConfig.learnedInstructions}\n` : ''}

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

RESCHEDULING — if the customer already booked and then asks to change their date or time:
- Confirm the new date/time with them, then send a new BOOKING_REQUEST with ALL 6 fields updated (reuse their name/email/phone from earlier in the conversation)
- Do NOT say "let me get this booked" as if it's new — acknowledge the change: "Got it, switching you to [new date]!"
- The system will automatically cancel their previous booking when the new one goes through

OBJECTION HANDLING:
- When a customer expresses hesitation about price, timing, or need, acknowledge their concern first
- Use social proof: mention satisfaction rates and experience
- If price is the objection, highlight the value and long-term savings
${agentConfig.objectionServices ? `- You may offer these complimentary add-ons to close hesitant customers: ${agentConfig.objectionServices}` : '- If appropriate, offer to include a small bonus service to sweeten the deal'}
${agentConfig.objectionNotes ? `- Additional objection handling notes: ${agentConfig.objectionNotes}` : ''}
- Never be pushy — be understanding and helpful while gently addressing concerns
- If they still decline, NEVER just say goodbye. Always ask for their phone number first: "No worries at all! Can I grab your number so we can reach out if anything changes?" Then once you have it, emit ATTENTION_REQUEST.

Lead capture strategy: ${agentConfig.captureStrategy === 'early' ? 'Ask for contact info within the first 2-3 messages' : agentConfig.captureStrategy === 'booking' ? 'Only ask for contact info when booking' : 'Ask naturally when relevant'}

REPEATED BOOKING FAILURES — ESCALATE AFTER 3 FAILED ATTEMPTS:
- If the same booking error appears 3 or more times in a row (any time slot rejected), stop asking for different times. The issue is likely a calendar conflict that a human needs to resolve.
- Instead say something like: "It looks like our online calendar is having trouble locking in a time right now. Let me have our manager call you to get this sorted out. What's the best number to reach you?"
- Then collect their name and phone number and emit ATTENTION_REQUEST.

EXIT INTENT — CAPTURE BEFORE THEY LEAVE:
- If a customer signals they're about to disengage (e.g., "I'll call you", "I'll call shortly", "I'll just give you guys a call", "I'll reach out", "I'll call later", "I'll stop by", "never mind", "forget it", "I'll figure it out"), do NOT say goodbye. Instead say something like: "Of course! What's your name and best number so our manager can reach out to you directly?"
- If you encounter a question you genuinely cannot answer (pricing edge cases, very specific availability, complex situations), do NOT tell them to call us. Instead say: "Great question — let me have our manager follow up with you directly. What's your name and best phone number?"
- NEVER give out the business phone number and tell them to call. Always flip it: ask for THEIR number so we call THEM.
- Once you have their name AND phone number in either of these situations, respond with:
ATTENTION_REQUEST|customerName|customerPhone
followed immediately on the next line by a friendly closing message like: "Perfect, [name]! Our manager will be reaching out to you shortly."
- Only send ATTENTION_REQUEST once per conversation. Do not send it if a BOOKING_REQUEST was already completed.
- Don't mention "ATTENTION_REQUEST" to the customer — it's internal.

IMPORTANT RULES:
- Only ask for ONE piece of information per message
- Don't skip stages - follow the order
- Use natural, conversational language — write like a real human texting, not a formatted document
- NEVER use markdown formatting. No asterisks for bold (**word**), no dashes for bullet points (- item), no underscores, no hashtags. Use plain sentences with commas, periods, exclamation marks, and question marks only.
- NEVER parrot back or repeat what the customer just said. Don't restate their words, situation, or feelings back to them — it sounds robotic. Instead, respond naturally and move the conversation forward. For example, if they say "a mouse got in my car and I'm grossed out", do NOT say "Having a mouse in your car would definitely make anyone feel grossed out." Just acknowledge briefly ("Oh no, we can definitely help with that!") and move to your recommendation.
- Convert dates to YYYY-MM-DD format. Today is ${bizDateTime.fullDate} (${bizDateTime.isoDate}), current time is ${bizDateTime.currentTime}.
- UPCOMING DATES — use this exact table, do not calculate on your own:
${(function() {
  const tz = bizDateTime.timezone;
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const lines = [];
  const now = new Date();
  for (let i = 0; i <= 14; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const iso = d.toLocaleDateString('en-CA', { timeZone: tz });
    const weekday = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' });
    const label = d.toLocaleDateString('en-US', { timeZone: tz, month: 'long', day: 'numeric' });
    lines.push(`  ${weekday}, ${label} = ${iso}`);
  }
  return lines.join('\n');
})()}
- When a customer says "Thursday" or "next Friday", look up the exact date in the table above. NEVER guess or calculate — only use the dates listed.
- If a customer gives both a day name AND a date number that don't match, gently correct them using the table above.
- CRITICAL: The YYYY-MM-DD in BOOKING_REQUEST must exactly match an entry from the table above for the day you verbally confirmed.
- Convert times to 24-hour format (2pm = 14:00, 9am = 09:00)
- Only send BOOKING_REQUEST when you have ALL 6 pieces of information
- For customerName in BOOKING_REQUEST, use ONLY the name the customer explicitly stated (e.g., if they said "I'm Kathy" or "My name is Kathy", use "Kathy"). NEVER use random words from the conversation as the name. If unclear, ask them to confirm their name before booking.
- Don't mention "BOOKING_REQUEST" to the customer - it's internal
- If they're just asking questions, answer them and don't force the booking flow
- NEVER end a conversation without collecting the customer's phone number. Before any closing message (goodbye, thanks for chatting, etc.) — if you don't already have their phone number from earlier in the conversation — ask for it: "Before you go, what's the best number to reach you?" Then emit ATTENTION_REQUEST once you have their name and number.

REAL-TIME AVAILABILITY:
- You have access to a check_availability tool that queries the live booking calendar.
- Use it whenever a customer asks what times are available, or before confirming a specific date/time.
- Always offer specific open slots from the tool result — never ask the customer to guess.
- If a date has no open slots, immediately check nearby dates and offer those instead.`;

    // Tool definition for real-time availability checking
    const tools = [
      {
        name: 'check_availability',
        description: 'Check available booking time slots for a specific service on a specific date. Use this when a customer asks about availability or wants to book a specific date/time.',
        input_schema: {
          type: 'object',
          properties: {
            service_id: {
              type: 'number',
              description: 'The ID of the service to check availability for'
            },
            date: {
              type: 'string',
              description: 'The date to check in YYYY-MM-DD format'
            }
          },
          required: ['service_id', 'date']
        }
      }
    ];

    // Agentic loop — handles tool use before producing a final text reply
    let loopMessages = historyResult.rows.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    let reply = '';
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (iterations++ < MAX_ITERATIONS) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages: loopMessages
      });

      if (response.stop_reason === 'tool_use') {
        // Append assistant message with tool_use blocks
        loopMessages = [...loopMessages, { role: 'assistant', content: response.content }];

        // Execute each tool call
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          let toolOutput;
          if (block.name === 'check_availability') {
            const { service_id, date } = block.input;
            const service = servicesResult.rows.find(s => s.id === service_id);
            if (!service) {
              toolOutput = { error: 'Service not found' };
            } else {
              const slots = await getAvailableSlotsForDate(userId, service_id, date, service.duration_hours);
              if (slots.length === 0) {
                toolOutput = { available: false, message: 'No open slots on this date' };
              } else {
                toolOutput = { available: true, slots: slots.map(formatSlotTime) };
              }
            }
          } else {
            toolOutput = { error: 'Unknown tool' };
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(toolOutput)
          });
        }

        loopMessages = [...loopMessages, { role: 'user', content: toolResults }];
      } else {
        // Final text response
        reply = response.content.find(b => b.type === 'text')?.text || '';
        break;
      }
    }

    // Check if AI wants to create a booking
    const bookingMatch = reply.match(/BOOKING_REQUEST\|(\d+)\|([\d-]+)\|([\d:]+)\|([^|]+)\|([^|]+)\|([^|]+)/);

    if (bookingMatch) {
      const [_, serviceId, bookingDate, startTime, customerName, customerEmail, rawPhone] = bookingMatch;
      const customerPhone = rawPhone.replace(/[^\d+\-().]/g, '').trim();
      console.log(`🤖 Chat BOOKING_REQUEST: service=${serviceId} date=${bookingDate} time=${startTime} name=${customerName} email=${customerEmail} phone=${customerPhone}`);

      // Cancel any existing booking from this conversation (reschedule case)
      const prevAssistantMsgs = await pool.query(
        `SELECT content FROM chat_messages
         WHERE conversation_id = $1 AND role = 'assistant'
         ORDER BY created_at DESC`,
        [conversationId]
      );
      for (const { content } of prevAssistantMsgs.rows) {
        const prevNumMatch = content.match(/Booking #(\S+)/);
        if (prevNumMatch) {
          const prevNum = prevNumMatch[1];
          const cancelled = await pool.query(
            `UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
             WHERE booking_number = $1 AND user_id = $2 AND status = 'confirmed'
             RETURNING id`,
            [prevNum, userId]
          );
          if (cancelled.rowCount > 0) {
            console.log(`🔄 Chat reschedule: cancelled booking #${prevNum} → new date ${bookingDate}`);
          }
          break;
        }
      }

      // Create the booking
      const bookingResult = await createBookingFromChat(userId, {
        serviceId: parseInt(serviceId),
        bookingDate,
        startTime,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim()
      }, { skipConfirmationEmail: !!(agentConfig.requireCardOnFile && customerEmail.trim()) });

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

        // Card on file required?
        if (agentConfig.requireCardOnFile && customerEmail.trim()) {
          // Hold booking as pending_card
          await pool.query(
            `UPDATE bookings SET card_on_file_status = 'pending', status = 'pending', updated_at = NOW()
             WHERE id = $1`,
            [bookingResult.bookingId]
          );

          // Generate secure token
          const tokenResult = await pool.query(
            `INSERT INTO card_on_file_tokens (booking_id, user_id, customer_email, customer_name)
             VALUES ($1, $2, $3, $4) RETURNING token`,
            [bookingResult.bookingId, userId, customerEmail.trim(), customerName.trim()]
          );
          const cardToken = tokenResult.rows[0].token;
          const frontendUrl = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
          const cardLink = `${frontendUrl}/card-on-file/${cardToken}`;

          // Send card-on-file email (non-blocking)
          if (process.env.SENDGRID_API_KEY) {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            const ownerResult = await pool.query('SELECT business_name, email FROM users WHERE id = $1', [userId]);
            const owner = ownerResult.rows[0] || {};
            sgMail.send({
              to: customerEmail.trim(),
              from: { name: owner.business_name || 'Your Service Provider', email: 'noreply@sorceintegrations.com' },
              replyTo: owner.email ? { email: owner.email } : undefined,
              subject: `One last step to confirm your appointment — ${owner.business_name || 'Us'}`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
                  <div style="background:#1d4ed8;padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
                    <h1 style="color:#fff;margin:0;font-size:1.5rem;">Almost Confirmed!</h1>
                  </div>
                  <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                    <p style="font-size:1rem;margin-top:0;">Hi ${customerName.trim()},</p>
                    <p>Your appointment with <strong>${owner.business_name || 'us'}</strong> on ${formattedDate} at ${formattedTime} is almost confirmed!</p>
                    <p>We just need a card on file to complete your booking. <strong>We will not charge your card</strong> — it is only kept on file in case of a no-show per our cancellation policy.</p>
                    <div style="text-align:center;margin:2rem 0;">
                      <a href="${cardLink}" style="background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:1rem;font-weight:600;">
                        Securely Save Card on File
                      </a>
                    </div>
                    <p style="color:#6b7280;font-size:0.85rem;">This link expires in 48 hours.</p>
                    <p style="color:#6b7280;font-size:0.85rem;margin:0;">${owner.business_name || ''}</p>
                  </div>
                </div>`,
            }).catch(e => console.error('Card on file email error:', e.message));
          }

          // Notify business owner that the card link was sent (non-blocking)
          if (process.env.SENDGRID_API_KEY && owner.email) {
            const sgMail2 = require('@sendgrid/mail');
            sgMail2.setApiKey(process.env.SENDGRID_API_KEY);
            sgMail2.send({
              to: owner.email,
              from: { name: 'SORCE Notifications', email: 'noreply@sorceintegrations.com' },
              subject: `Card on file link sent to ${customerName.trim()}`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
                  <div style="background:#d97706;padding:1.5rem 2rem;border-radius:8px 8px 0 0;">
                    <h2 style="color:#fff;margin:0;font-size:1.25rem;">Card on File Link Sent</h2>
                  </div>
                  <div style="padding:1.5rem 2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                    <p style="margin-top:0;">Your chat agent sent a secure card-on-file link to <strong>${customerName.trim()}</strong> (${customerEmail.trim()}) for their ${formattedDate} at ${formattedTime} appointment.</p>
                    <p style="color:#6b7280;font-size:0.9rem;">The booking will be automatically confirmed once they save their card. The link expires in 48 hours.</p>
                  </div>
                </div>`,
            }).catch(e => console.error('Owner card link notification error:', e.message));
          }

          reply = `Almost done, ${customerName}! I just sent a secure link to ${customerEmail.trim()} to save a card on file for our cancellation policy. We won't charge it — it's just required to hold your spot. Once that's done, your booking for ${formattedDate} at ${formattedTime} will be fully confirmed!`;
        } else {
          // Full confirmation — no card required
          reply = `Perfect! You're all set, ${customerName}! 🎉\n\n` +
                  `📅 ${formattedDate} at ${formattedTime}\n` +
                  `🔧 ${bookingResult.serviceName}\n` +
                  `👤 ${bookingResult.employeeName} will take great care of you\n` +
                  `📋 Booking #${bookingResult.bookingNumber}\n\n` +
                  `I've sent a confirmation to ${customerEmail}. Looking forward to seeing you!`;
        }

        // If they were previously a lead, update status to booked
        await pool.query(
          `UPDATE leads SET status = 'booked', updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND email = $2 AND status != 'booked'`,
          [userId, customerEmail]
        );
      } else {
        reply = reply.replace(/BOOKING_REQUEST\|[^\n]+\n?/, '');
        if (bookingResult.error === 'slot_taken') {
          if (bookingResult.availableSlots && bookingResult.availableSlots.length > 0) {
            const slotList = bookingResult.availableSlots.map(formatSlotTime).join(', ');
            reply = `That time is already taken. Here are the open times for that day: ${slotList}. Which one works for you?`;
          } else if (bookingResult.nearbyDays && bookingResult.nearbyDays.length > 0) {
            const dayLines = bookingResult.nearbyDays
              .map(d => `${d.label}: ${d.slots.slice(0, 3).map(formatSlotTime).join(', ')}`)
              .join(' | ');
            reply = `We're fully booked that day. Here are the next available days: ${dayLines}. Which works for you?`;
          } else {
            reply = `Unfortunately we're fully booked for the next couple weeks. Please call us directly to arrange a time.`;
          }
        } else if (bookingResult.error === 'internal_error') {
          reply = `Sorry, something went wrong on our end while booking that time. Would you like to try a different time?`;
        } else {
          reply = `I'm sorry, but ${bookingResult.error}. Would you like to try a different time?`;
        }
      }
    }

    // Check if AI captured a customer who needs a callback
    const attentionMatch = reply.match(/ATTENTION_REQUEST\|([^|\n]+)\|([^\n]+)/);
    if (attentionMatch && !bookingMatch) {
      const attentionName = attentionMatch[1].trim();
      const attentionPhone = attentionMatch[2].trim();
      console.log(`📞 ATTENTION_REQUEST: name=${attentionName} phone=${attentionPhone}`);

      // Remove the internal tag from the reply
      reply = reply.replace(/ATTENTION_REQUEST\|[^\n]+\n?/, '').trim();

      // Save lead — track whether it already existed as needs_callback to avoid duplicate emails
      const leadCheck = await pool.query(
        'SELECT id, status FROM leads WHERE user_id = $1 AND phone = $2',
        [userId, attentionPhone]
      );
      const alreadyNeedsCallback = leadCheck.rows.length > 0 && leadCheck.rows[0].status === 'needs_callback';
      if (leadCheck.rows.length === 0) {
        await pool.query(
          `INSERT INTO leads (user_id, name, phone, source, status, created_at)
           VALUES ($1, $2, $3, 'ai_chat_agent', 'needs_callback', CURRENT_TIMESTAMP)`,
          [userId, attentionName, attentionPhone]
        );
      } else {
        await pool.query(
          `UPDATE leads SET name = $1, status = 'needs_callback', updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $2 AND phone = $3`,
          [attentionName, userId, attentionPhone]
        );
      }

      // Email the business owner — only if this is a fresh needs_callback, not a repeat trigger
      if (!alreadyNeedsCallback) {
        sendAttentionEmail({ userId, customerName: attentionName, customerPhone: attentionPhone, conversationId });
      }
    }

    // Guard: if reply ended up empty after stripping internal tags, provide a fallback
    reply = reply.trim();
    if (!reply) {
      reply = "Got it! Is there anything else I can help you with?";
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
        
        const possibleName = nameResult.rows.find(r => {
          const lc = r.content.toLowerCase();
          return lc.includes('my name is') || lc.includes("i'm ") || lc.includes("i am ") ||
                 lc.includes('this is ') || /\b(name|called)\s+(is\s+)?\w/i.test(r.content);
        });

        let name = 'Website Visitor';
        if (possibleName) {
          const nameMatch = possibleName.content.match(/(?:my name is|i(?:'m| am)|this is|name is|called)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
          if (nameMatch) {
            // Capitalize first letter of each word
            name = nameMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase());
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
        } else if (name !== 'Website Visitor') {
          // Update name if we now have a real name (replacing a placeholder)
          await pool.query(
            `UPDATE leads SET name = $1 WHERE id = $2 AND name = 'Website Visitor'`,
            [name, leadExists.rows[0].id]
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
