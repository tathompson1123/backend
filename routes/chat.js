const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const Anthropic = require('@anthropic-ai/sdk');
const { authenticateToken } = require('../config/middleware');
const { sendBookingEmails } = require('../utils/bookingEmail');
const { sendPushToOwner } = require('../utils/pushNotifications');
const { logClaudeUsage } = require('../utils/claudeUsage');
const { isUnlimitedAccount } = require('../utils/unlimitedAccounts');
const sgMail = require('@sendgrid/mail');
const { TRANSACTIONAL_EMAIL } = require('../utils/emailFrom');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function formatSlotTime(slot) {
  const [h, m] = slot.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Walk the model's reply for "Weekday Month Day" / "Weekday (Month Day)" / "Weekday the Nth"
// patterns whose weekday name doesn't match the actual date in the given timezone.
// When mismatched, replace the wrong weekday with the correct one — the AI sometimes
// hallucinates day names even when the date table in the prompt is right.
function fixWeekdayMismatches(text, timezone) {
  if (!text) return text;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  // Match: optional "(", weekday, optional ")", optional connector, Month, day with optional ordinal suffix
  const pattern = /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b(\s*\(?[,\s]*|[\s,(-]+)(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{1,2})(?:st|nd|rd|th)?/gi;
  // Use the current year in the business timezone
  const yearStr = new Date().toLocaleDateString('en-US', { timeZone: timezone || 'UTC', year: 'numeric' });
  const year = parseInt(yearStr, 10);
  return text.replace(pattern, (match, claimedDay, sep, monthName, dayStr) => {
    const monthIdx = MONTHS[monthName.toLowerCase().replace(/\.$/, '')];
    if (monthIdx == null) return match;
    const day = parseInt(dayStr, 10);
    if (!Number.isFinite(day) || day < 1 || day > 31) return match;
    // Compute the actual weekday for this date in the business timezone
    const probe = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0));
    const actualWeekday = probe.toLocaleDateString('en-US', { timeZone: timezone || 'UTC', weekday: 'long' });
    if (!WEEKDAYS.includes(actualWeekday)) return match;
    if (actualWeekday.toLowerCase() === claimedDay.toLowerCase()) return match;
    // Preserve the original separator/punctuation between weekday and date
    return match.replace(new RegExp(`^${claimedDay}`, 'i'), actualWeekday);
  });
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
    const openHHMM = open_time.slice(0, 5);
    const closeHHMM = close_time.slice(0, 5);
    candidateSlots = configuredSlots.rows
      .map(r => r.slot_time.slice(0, 5))
      .filter(t => t >= openHHMM && t < closeHHMM);
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

  // Only consider employees scheduled to work this day, within their work hours.
  const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dayOfWeek];
  const toMin = (t) => { const [hh, mm] = String(t).split(':').map(Number); return (hh || 0) * 60 + (mm || 0); };
  const worksSlot = (emp, startMinAbs, endMinAbs) => {
    const workDays = emp.work_days || {};
    if (workDays[dayName] === false) return false;
    const wh = emp.work_hours || {};
    return startMinAbs >= toMin(wh.startTime || '00:00') && endMinAbs <= toMin(wh.endTime || '23:59');
  };

  // Check each slot for employee availability
  const available = [];
  for (const slot of candidateSlots) {
    const [h, m] = slot.split(':').map(Number);
    const startMinAbs = h * 60 + m;
    const endMin = startMinAbs + durationMinutes;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    const emp = await pool.query(
      `SELECT e.id, e.work_hours, e.work_days FROM employees e
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
       )`,
      [userId, serviceId, bookingDate, slot, endTime]
    );
    if (emp.rows.some(e => worksSlot(e, startMinAbs, endMin))) available.push(slot);
  }
  return available;
}

const { escapeHtml } = require('../utils/escapeHtml');
const { plainEmail } = require('../utils/emailLayout');

async function sendAttentionEmail({ userId, customerName, customerPhone, conversationId }) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    const userResult = await pool.query(
      'SELECT business_name, email FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows[0]?.email) return;
    const { business_name: businessName, email: ownerEmail } = userResult.rows[0];

    // Pull the full chat transcript so the owner can see the conversation
    const msgsResult = await pool.query(
      `SELECT role, content, created_at FROM chat_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC, id ASC`,
      [conversationId]
    );

    const transcriptHtml = msgsResult.rows.length === 0
      ? '<p style="color:#9ca3af;font-style:italic;margin:0;">No messages in this conversation.</p>'
      : msgsResult.rows.map(m => {
          const isCustomer = m.role === 'user';
          const label = isCustomer ? (customerName || 'Customer') : 'Chat Agent';
          // Strip any internal protocol tokens before showing to owner
          const cleanContent = String(m.content || '')
            .replace(/BOOKING_REQUEST\|[^\n]+\n?/g, '')
            .replace(/ATTENTION_REQUEST\|[^\n]+\n?/g, '')
            .trim();
          if (!cleanContent) return '';
          // Speaker name in bold instead of a tinted bubble per message — same information,
          // a fraction of the markup. See utils/emailLayout for why that matters.
          return `<p style="margin:0 0 8px;"><strong>${escapeHtml(label)}:</strong> `
            + `<span style="white-space:pre-wrap;">${escapeHtml(cleanContent)}</span></p>`;
        }).join('');

    await sgMail.send({
      to: ownerEmail,
      from: { name: 'SORCE Chat Alerts', email: TRANSACTIONAL_EMAIL },
      subject: `Action needed: ${customerName} wants a call back`,
      html: plainEmail({
        paragraphs: [
          "A customer on your website chat asked to be called back, or had a question your chat agent couldn't fully answer. Reach out to them as soon as possible.",
        ],
        details: [
          { label: 'Name', value: escapeHtml(customerName) },
          { label: 'Phone', value: escapeHtml(customerPhone) },
        ],
        after: [
          transcriptHtml ? `<strong>Conversation transcript</strong>${transcriptHtml}` : '',
        ],
        signature: `${escapeHtml(businessName || 'Your business')} &middot; conversation #${conversationId}`,
      }),
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
    const { serviceId, additionalServiceIds = [], bookingDate, startTime, customerName, customerEmail } = bookingData;
    const allServiceIds = [parseInt(serviceId), ...additionalServiceIds.map(id => parseInt(id))].filter(Boolean);
    // Truncate phone to 50 chars and strip non-phone characters
    const rawPhoneInput = bookingData.customerPhone || '';
    const phoneDigitsOnly = rawPhoneInput.replace(/\D/g, '');
    const normalizedPhone = phoneDigitsOnly.startsWith('1') && phoneDigitsOnly.length === 11
      ? phoneDigitsOnly.slice(1)
      : phoneDigitsOnly.slice(0, 10);
    const customerPhone = normalizedPhone.length >= 7 ? normalizedPhone : rawPhoneInput.replace(/[^\d+\-() .ext]/gi, '').substring(0, 20);

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
    const openHHMM = bizHours.open_time.slice(0, 5);
    const closeHHMM = bizHours.close_time.slice(0, 5);
    if (startTime < openHHMM || startTime >= closeHHMM) {
      return { success: false, error: 'that time is outside our business hours' };
    }

    // Get service details, tax rate, and business address in parallel
    const [serviceResult, taxResult] = await Promise.all([
      pool.query(
        'SELECT id, duration_hours, price, name, location_type, custom_address FROM services WHERE id = ANY($1) AND user_id = $2',
        [allServiceIds, userId]
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

    // Primary service drives timing and location
    const service = serviceResult.rows.find(s => s.id === parseInt(serviceId)) || serviceResult.rows[0];
    const allServices = serviceResult.rows;

    // Duration = sum of all selected services
    const totalDurationHours = allServices.reduce((sum, s) => sum + parseFloat(s.duration_hours || 1), 0);

    // Calculate end time based on combined duration
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + (totalDurationHours * 60);
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    // An employee can take this booking only if scheduled to work that day AND their work
    // hours cover the whole service window — mirrors the public booking widget.
    const bookingDayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][bookingDayOfWeek];
    const timeToMin = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const empWorksSlot = (emp) => {
      const workDays = emp.work_days || {};
      if (workDays[bookingDayName] === false) return false;
      const wh = emp.work_hours || {};
      return startMinutes >= timeToMin(wh.startTime || '00:00') && endMinutes <= timeToMin(wh.endTime || '23:59');
    };

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
        `SELECT e.id, e.name, e.work_hours, e.work_days
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
         ORDER BY e.id ASC`,
        [userId, serviceId, bookingDate, startTime, endTime]
      );

      // Only assign someone actually scheduled to work this day/time.
      const workingEmp = availableEmpResult.rows.find(empWorksSlot);
      if (!workingEmp) {
        const openSlots = await getAvailableSlotsForDate(userId, serviceId, bookingDate, service.duration_hours);
        const nearbyDays = openSlots.length === 0
          ? await getAvailableDaysNearDate(userId, serviceId, bookingDate, service.duration_hours)
          : [];
        return { success: false, error: 'slot_taken', availableSlots: openSlots, nearbyDays };
      }

      employeeId = workingEmp.id;
      employeeName = workingEmp.name;
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

    // Create booking with tax calculation (sum of all selected services)
    const servicePrice = allServices.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
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

    // Create booking items — one row per selected service
    for (const svc of allServices) {
      const svcPrice = parseFloat(svc.price) || 0;
      await pool.query(
        `INSERT INTO booking_items (
          booking_id, service_id, service_name, service_duration,
          service_price, quantity, subtotal
        )
        VALUES ($1, $2, $3, $4, $5, 1, $6)`,
        [booking.id, svc.id, svc.name, svc.duration_hours, svcPrice, svcPrice]
      );
    }

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

    const serviceNames = allServices.map(s => s.name).join(' + ');

    // Push notification to owner/admin
    sendPushToOwner(userId, 'New Booking via Chat Agent',
      `${customerName} — ${serviceNames} on ${bookingDate} at ${startTime}`,
      { bookingId: booking.id, type: 'new_booking' }
    ).catch(() => {});

    // Send booking emails — always notify the owner; skip customer confirmation if card-on-file pending
    sendBookingEmails({
      userId,
      bookingNumber,
      customerName,
      customerEmail,
      customerPhone,
      serviceName: serviceNames,
      bookingDate,
      startTime,
      endTime,
      subtotal: servicePrice,
      taxRate,
      taxAmount,
      total: totalAmount,
      location: locationDisplay,
      skipCustomerEmail: skipConfirmationEmail, // skip customer email if card-on-file pending
    }).then(() => {
      console.log(`📧 Chat booking email sent successfully for ${bookingNumber}`);
    }).catch(err => console.error('📧 Chat booking email FAILED:', err.message, err.response?.body));

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

    // Check monthly AI chat cost limit by plan
    const CHAT_COST_LIMITS = { pro: 6.00, expert: 6.00 };
    const planRow = await pool.query(
      'SELECT plan, ai_chat_unlimited, email, business_name, chat_limit_notified_at FROM users WHERE id = $1',
      [userId]
    );
    const ownerRow = planRow.rows[0] || {};
    const userPlan = ownerRow.plan;
    const unlimited = ownerRow.ai_chat_unlimited === true || isUnlimitedAccount(ownerRow.email);
    const costLimit = unlimited ? null : CHAT_COST_LIMITS[userPlan];
    if (costLimit != null) {
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const costRow = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM claude_usage WHERE user_id = $1 AND created_at >= $2`,
        [userId, monthStart]
      );
      if (parseFloat(costRow.rows[0].total) >= costLimit) {
        // Notify the business owner once per month that they've hit the cap
        const notifiedAt = ownerRow.chat_limit_notified_at ? new Date(ownerRow.chat_limit_notified_at) : null;
        if (ownerRow.email && process.env.SENDGRID_API_KEY && (!notifiedAt || notifiedAt < monthStart)) {
          const upgradeUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?view=billing`;
          sgMail.send({
            to: ownerRow.email,
            from: { name: 'SORCE', email: TRANSACTIONAL_EMAIL },
            subject: "You've hit your monthly AI chat limit",
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                <h2 style="color:#1f2937;">Your AI chat is paused</h2>
                <p style="color:#4b5563;font-size:15px;">Hi${ownerRow.business_name ? ' ' + ownerRow.business_name : ''},</p>
                <p style="color:#4b5563;font-size:15px;">Your website's AI chat assistant has reached its monthly usage limit on your current ${userPlan || ''} plan. To keep it answering visitor questions for the rest of the month, upgrade your plan.</p>
                <p style="margin:24px 0;">
                  <a href="${upgradeUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Upgrade your plan</a>
                </p>
                <p style="color:#6b7280;font-size:13px;">Usage resets at the start of each month. Questions? Reply to this email or reach us at <a href="mailto:help@sorceintegrations.com">help@sorceintegrations.com</a>.</p>
                <p style="color:#9ca3af;font-size:13px;margin-top:32px;">— The SORCE Team</p>
              </div>`,
          }).catch(e => console.error('Chat limit email error:', e.message));
          pool.query(
            `UPDATE users SET chat_limit_notified_at = NOW() WHERE id = $1`,
            [userId]
          ).catch(e => console.error('chat_limit_notified_at update error:', e.message));
        }
        // silent: true tells new widgets to render nothing; reply is a graceful
        // fallback for old widgets still baked into already-deployed sites.
        return res.json({
          silent: true,
          limitReached: true,
          reply: "Thanks for reaching out — please contact us directly and we'll get right back to you.",
        });
      }
    }

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
3. Then ask: "Can I get your name?" — SKIP if the customer already gave their name earlier in this conversation
4. Then ask: "What's the best email to send your confirmation?" — SKIP if already provided
5. Finally ask: "And your phone number?" — SKIP if already provided

CRITICAL: Scan the entire conversation history before asking for name, email, or phone. If the customer gave any of this information at any point earlier — even if it was before they chose a service — do NOT ask for it again. Use what they already told you.

STAGE 4 - CONFIRM AND BOOK:
Once you have ALL information (service, date, time, name, email, phone), respond with:
BOOKING_REQUEST|serviceId1,serviceId2|YYYY-MM-DD|HH:MM|customerName|customerEmail|customerPhone

- If the customer chose multiple services, include ALL their service IDs separated by commas in the first field (e.g., 12,47). If only one service, just use its ID (e.g., 12).
- customerPhone must be ONLY the digits the customer gave you for their phone number — nothing else. Example: 3606230128. Never include dates, booking numbers, or other digits.

RESCHEDULING — if the customer already booked and then asks to change their date or time:
- Confirm the new date/time with them, then send a new BOOKING_REQUEST with ALL 6 fields updated (reuse their name/email/phone from earlier in the conversation)
- Do NOT say "let me get this booked" as if it's new — acknowledge the change: "Got it, switching you to [new date]!"
- The system will automatically cancel their previous booking when the new one goes through

NEVER RE-EMIT BOOKING_REQUEST UNLESS THE CUSTOMER IS EXPLICITLY ASKING TO CHANGE DATE/TIME:
- After a successful booking, the customer may say "thank you", "great", "see you then", "have a good day", etc. These are NOT requests to re-book or reschedule. Just respond conversationally — DO NOT emit BOOKING_REQUEST again.
- Only emit a new BOOKING_REQUEST when the customer explicitly states a new date or time they want to switch to.

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
- UPCOMING DATES — this is the ONLY source of truth for dates. Do NOT use your training data or internal calendar. Do NOT calculate. Only use what is listed here:
${(function() {
  const tz = bizDateTime.timezone;
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
- When a customer says "Thursday" or "next Friday" or "next week", find the matching row in the table above by weekday name. NEVER guess a date number — always read it from the table.
- CRITICAL: If you say "Thursday the 24th", verify BOTH that Thursday and 24 appear on the SAME ROW in the table. If they don't match, you have made an error.
- When describing a range like "next week Monday through Friday", read all five day names AND date numbers directly from the table. Do not assume which number goes with which day.
- If a customer gives both a day name AND a date number that don't match the table, gently correct them using the table above.
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
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages: loopMessages
      });
      logClaudeUsage(userId, 'claude-sonnet-4-6', response.usage, 'chat');

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
    // Supports comma-separated service IDs: BOOKING_REQUEST|12,47|date|time|name|email|phone
    const bookingMatch = reply.match(/BOOKING_REQUEST\|([\d,]+)\|([\d-]+)\|([\d:]+)\|([^|]+)\|([^|]+)\|([^|]+)/);

    if (bookingMatch) {
      const [_, serviceIdsRaw, bookingDate, startTime, customerName, customerEmail, rawPhone] = bookingMatch;
      const serviceIds = serviceIdsRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
      const serviceId = serviceIds[0];
      const additionalServiceIds = serviceIds.slice(1);
      // Extract first valid 10-digit US phone number from whatever the AI provided
      const digitsOnly = rawPhone.replace(/\D/g, '');
      const phoneDigits = digitsOnly.startsWith('1') && digitsOnly.length === 11 ? digitsOnly.slice(1) : digitsOnly.slice(0, 10);
      const customerPhone = phoneDigits.length >= 7 ? phoneDigits : rawPhone.trim().substring(0, 20);
      console.log(`🤖 Chat BOOKING_REQUEST: services=${serviceIdsRaw} date=${bookingDate} time=${startTime} name=${customerName} email=${customerEmail} phone=${customerPhone}`);

      // Reschedule case — if this conversation already produced a booking, check the
      // existing booking before creating a new one.
      const convoRow = await pool.query(
        `SELECT last_booking_id FROM chat_conversations WHERE id = $1`,
        [conversationId]
      );
      const lastBookingId = convoRow.rows[0]?.last_booking_id || null;
      let existingBookingForConv = null;
      if (lastBookingId) {
        const existing = await pool.query(
          `SELECT id, booking_number, booking_date, start_time, status
           FROM bookings WHERE id = $1 AND user_id = $2`,
          [lastBookingId, userId]
        );
        existingBookingForConv = existing.rows[0] || null;
      }
      let skipBookingCreation = false;
      if (existingBookingForConv) {
        const existingDateIso = existingBookingForConv.booking_date instanceof Date
          ? existingBookingForConv.booking_date.toISOString().slice(0, 10)
          : String(existingBookingForConv.booking_date).slice(0, 10);
        const existingStart = String(existingBookingForConv.start_time).slice(0, 5);
        const sameSlot = existingDateIso === bookingDate && existingStart === startTime;
        const cancellable = !['cancelled', 'completed', 'no_show'].includes(existingBookingForConv.status);
        if (sameSlot && cancellable) {
          // The model re-emitted BOOKING_REQUEST for the slot the customer is already
          // holding. Skip the re-book and produce a context-aware reply.
          console.log(`🔁 Chat: skipping duplicate BOOKING_REQUEST — booking #${existingBookingForConv.booking_number} already holds ${existingDateIso} ${existingStart}`);
          reply = reply.replace(/BOOKING_REQUEST\|[^\n]+\n?/, '').trim();
          if (!reply) {
            const dateObj = new Date(bookingDate + 'T00:00:00');
            const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const [h, mm] = startTime.split(':');
            const hourN = parseInt(h);
            const ampm = hourN >= 12 ? 'PM' : 'AM';
            const dispH = hourN > 12 ? hourN - 12 : hourN === 0 ? 12 : hourN;
            reply = `You're already booked for ${formattedDate} at ${dispH}:${mm} ${ampm}. Did you want to change something about it?`;
          }
          skipBookingCreation = true;
        } else if (cancellable) {
          const cancelled = await pool.query(
            `UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status NOT IN ('cancelled', 'completed', 'no_show')
             RETURNING id`,
            [existingBookingForConv.id]
          );
          if (cancelled.rowCount > 0) {
            console.log(`🔄 Chat reschedule: cancelled booking #${existingBookingForConv.booking_number} → new ${bookingDate} ${startTime}`);
          }
        }
      }
      if (skipBookingCreation) {
        // Fall through to assistant-save / response below without creating a new booking.
      } else {

      // Create the booking
      const bookingResult = await createBookingFromChat(userId, {
        serviceId,
        additionalServiceIds,
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

          // Look up owner once — used for both customer email and owner notification below
          let owner = {};
          if (process.env.SENDGRID_API_KEY) {
            const ownerResult = await pool.query('SELECT business_name, email FROM users WHERE id = $1', [userId]);
            owner = ownerResult.rows[0] || {};
          }

          // Send card-on-file email (non-blocking)
          if (process.env.SENDGRID_API_KEY) {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            sgMail.send({
              to: customerEmail.trim(),
              from: { name: owner.business_name || 'Your Service Provider', email: TRANSACTIONAL_EMAIL },
              replyTo: owner.email ? { email: owner.email } : undefined,
              subject: `One last step to confirm your appointment — ${owner.business_name || 'Us'}`,
              // This one asks a customer for card details, so it has to read like the
              // business wrote it rather than like a template. The banner and the big
              // coloured button were working against that as well as against the filter:
              // a payment request that looks mass-produced is the shape people are told to
              // distrust.
              html: plainEmail({
                greeting: `Hi ${escapeHtml(customerName.trim())},`,
                paragraphs: [
                  `Your appointment with <strong>${escapeHtml(owner.business_name || 'us')}</strong> on ${escapeHtml(formattedDate)} at ${escapeHtml(formattedTime)} is almost confirmed.`,
                  'We just need a card on file to complete the booking. <strong>We will not charge it</strong> — it is only held in case of a no-show, per our cancellation policy.',
                ],
                action: { label: 'Securely save a card on file', url: cardLink },
                after: ['That link expires in 48 hours.'],
                signature: escapeHtml(owner.business_name || ''),
              }),
            }).catch(e => console.error('Card on file email error:', e.message));
          }

          // Notify business owner that the card link was sent (non-blocking)
          if (process.env.SENDGRID_API_KEY && owner.email) {
            const sgMail2 = require('@sendgrid/mail');
            sgMail2.setApiKey(process.env.SENDGRID_API_KEY);
            sgMail2.send({
              to: owner.email,
              from: { name: 'SORCE Notifications', email: TRANSACTIONAL_EMAIL },
              subject: `Card on file link sent to ${customerName.trim()}`,
              // Customer name and email were interpolated raw here.
              html: plainEmail({
                paragraphs: [
                  `Your chat agent sent a secure card-on-file link to <strong>${escapeHtml(customerName.trim())}</strong> (${escapeHtml(customerEmail.trim())}) for their ${escapeHtml(formattedDate)} at ${escapeHtml(formattedTime)} appointment.`,
                  'The booking confirms automatically once they save a card. The link expires in 48 hours.',
                ],
              }),
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

        // Mark conversation as booked, store customer name + the booking we just made
        // so any follow-up BOOKING_REQUEST is treated as a reschedule of THIS booking.
        await pool.query(
          `UPDATE chat_conversations SET outcome = 'booked', customer_name = $2, last_booking_id = $3 WHERE id = $1`,
          [conversationId, customerName, bookingResult.bookingId]
        );

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
      } // end else (skipBookingCreation false)
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
          `INSERT INTO leads (user_id, name, phone, source, status, conversation_id, created_at)
           VALUES ($1, $2, $3, 'ai_chat_agent', 'needs_callback', $4, CURRENT_TIMESTAMP)`,
          [userId, attentionName, attentionPhone, conversationId]
        );
      } else {
        await pool.query(
          `UPDATE leads SET name = $1, status = 'needs_callback', conversation_id = $2, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $3 AND phone = $4`,
          [attentionName, conversationId, userId, attentionPhone]
        );
      }

      // Mark conversation as callback, store customer name
      await pool.query(
        `UPDATE chat_conversations SET outcome = 'callback', customer_name = $2 WHERE id = $1`,
        [conversationId, attentionName]
      );

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

    // Correct any weekday/date mismatches the model produced (e.g. "Thursday May 8th"
    // when May 8 is actually a Friday) before saving and sending to the customer.
    reply = fixWeekdayMismatches(reply, bizDateTime.timezone);

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
          // Create lead with conversation_id
          await pool.query(
            `INSERT INTO leads (user_id, name, email, phone, source, status, conversation_id, created_at)
             VALUES ($1, $2, $3, $4, 'ai_chat_agent', 'new', $5, CURRENT_TIMESTAMP)`,
            [userId, name, emailMatch?.[0], phoneMatch?.[0], conversationId]
          );
        } else {
          // Update with conversation_id and name if improved
          await pool.query(
            `UPDATE leads SET conversation_id = $1${name !== 'Website Visitor' ? ', name = $3' : ''} WHERE id = $2${name !== 'Website Visitor' ? '' : ''}`,
            name !== 'Website Visitor'
              ? [conversationId, leadExists.rows[0].id, name]
              : [conversationId, leadExists.rows[0].id]
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
      `SELECT cc.id, cc.source,
              to_char(cc.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              to_char(cc.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at,
              (SELECT COUNT(*) FROM chat_messages cm WHERE cm.conversation_id = cc.id) AS message_count,
              (SELECT cm.content FROM chat_messages cm WHERE cm.conversation_id = cc.id AND cm.role = 'user' ORDER BY cm.created_at ASC LIMIT 1) AS first_message,
              COALESCE(cc.outcome,
                CASE
                  WHEN EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = cc.id AND cm.role = 'assistant' AND (cm.content ILIKE '%booking #%' OR cm.content ILIKE '%you''re all set%')) THEN 'booked'
                  WHEN (SELECT COUNT(*) FROM chat_messages cm WHERE cm.conversation_id = cc.id AND cm.role = 'user') <= 1 THEN 'no_response'
                  ELSE 'no_booking'
                END
              ) AS outcome,
              COALESCE(cc.customer_name,
                (SELECT l.name FROM leads l WHERE l.conversation_id = cc.id AND l.user_id = cc.user_id ORDER BY l.created_at DESC LIMIT 1)
              ) AS lead_name,
              (SELECT l.email FROM leads l WHERE l.conversation_id = cc.id AND l.user_id = cc.user_id ORDER BY l.created_at DESC LIMIT 1) AS lead_email,
              (SELECT l.status FROM leads l WHERE l.conversation_id = cc.id AND l.user_id = cc.user_id ORDER BY l.created_at DESC LIMIT 1) AS lead_status
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

// Update conversation outcome / customer name (dashboard)
router.patch('/conversations/:id/outcome', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { outcome, customer_name } = req.body;

    const valid = ['booked', 'callback', 'no_booking', 'no_response'];
    if (outcome && !valid.includes(outcome)) {
      return res.status(400).json({ error: 'Invalid outcome' });
    }

    // Verify ownership
    const conv = await pool.query(
      'SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (conv.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });

    const updates = [];
    const values = [];
    if (outcome) { updates.push(`outcome = $${values.length + 1}`); values.push(outcome); }
    if (customer_name !== undefined) { updates.push(`customer_name = $${values.length + 1}`); values.push(customer_name || null); }
    updates.push(`updated_at = NOW()`);
    values.push(id);

    await pool.query(
      `UPDATE chat_conversations SET ${updates.join(', ')} WHERE id = $${values.length}`,
      values
    );

    // If marking as callback, also update the linked lead status
    if (outcome === 'callback') {
      await pool.query(
        `UPDATE leads SET status = 'needs_callback', updated_at = NOW()
         WHERE conversation_id = $1 AND user_id = $2`,
        [id, userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating conversation outcome:', error.message);
    res.status(500).json({ error: 'Failed to update' });
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
      `SELECT role, content, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
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
