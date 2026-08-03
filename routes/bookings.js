const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { sendPushToEmployee, sendPushToOwner } = require('../utils/pushNotifications');
const { sendBookingEmails } = require('../utils/bookingEmail');
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const { normalizeServiceList, resolveBookingServices } = require('../utils/bookingServices');
const { getTimezoneForBusiness } = require('../utils/zipToTimezone');

// Resolve the business's IANA timezone from their saved location (state + zip).
// Used so the dashboard can render booking timestamps (created_at) in the owner's
// local time instead of UTC. Falls back to Eastern when location is missing.
async function businessTimezone(userId) {
  try {
    const r = await pool.query('SELECT state, zip_code FROM business_information WHERE user_id = $1', [userId]);
    const { state, zip_code } = r.rows[0] || {};
    return getTimezoneForBusiness(state, zip_code);
  } catch (e) {
    console.error('businessTimezone lookup failed:', e.message);
    return 'America/New_York';
  }
}

// Helper: Update customer from booking
async function updateCustomerFromBooking(booking, userId) {
  try {
    let customer = await pool.query(
      'SELECT * FROM customers WHERE user_id = $1 AND (email = $2 OR phone = $3)',
      [userId, booking.customer_email, booking.customer_phone]
    );

    if (customer.rows.length === 0) {
      await pool.query(
        `INSERT INTO customers (user_id, name, email, phone, last_service, last_service_date, total_jobs, lifetime_value, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, CURRENT_TIMESTAMP)`,
        [
          userId,
          booking.customer_name,
          booking.customer_email,
          booking.customer_phone,
          booking.items?.[0]?.service_name || 'Service',
          booking.booking_date,
          booking.total_amount
        ]
      );
      console.log(`✅ New customer created: ${booking.customer_name}`);
    } else {
      const customerId = customer.rows[0].id;
      const newTotalJobs = (customer.rows[0].total_jobs || 0) + 1;
      const newLifetimeValue = parseFloat(customer.rows[0].lifetime_value || 0) + parseFloat(booking.total_amount || 0);

      await pool.query(
        `UPDATE customers 
         SET last_service = $1, 
             last_service_date = $2, 
             total_jobs = $3, 
             lifetime_value = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [
          booking.items?.[0]?.service_name || 'Service',
          booking.booking_date,
          newTotalJobs,
          newLifetimeValue,
          customerId
        ]
      );
      console.log(`✅ Customer updated: ${booking.customer_name}`);
    }
  } catch (error) {
    console.error('Error updating customer from booking:', error.message);
  }
}

// GET - Fetch all bookings
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate, status } = req.query;

    // LEFT JOIN + json_agg with a FILTER so bookings with zero items get [] (not [null]).
    // ORDER BY inside json_agg keeps mains (is_addon=false) ahead of add-ons in the array.
    let query = `
      SELECT b.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', bi.id,
              'service_id', bi.service_id,
              'service_name', bi.service_name,
              'duration', bi.service_duration,
              'price', bi.service_price,
              'quantity', bi.quantity,
              'is_addon', COALESCE(bi.is_addon, false)
            ) ORDER BY COALESCE(bi.is_addon, false), bi.id
          ) FILTER (WHERE bi.id IS NOT NULL),
          '[]'::json
        ) as items
      FROM bookings b
      LEFT JOIN booking_items bi ON b.id = bi.booking_id
      WHERE b.user_id = $1
    `;

    const params = [userId];
    let paramCount = 1;

    if (startDate) {
      paramCount++;
      query += ` AND b.booking_date >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      query += ` AND b.booking_date <= $${paramCount}`;
      params.push(endDate);
    }

    if (status) {
      paramCount++;
      query += ` AND b.status = $${paramCount}`;
      params.push(status);
    }

    query += ` GROUP BY b.id ORDER BY b.booking_date, b.start_time`;

    const result = await pool.query(query, params);
    const timezone = await businessTimezone(userId);
    res.json({ bookings: result.rows, timezone });
  } catch (error) {
    console.error('Error fetching bookings:', error.message);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// POST - Create new booking
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      serviceId, bookingDate, startTime, customerInfo, customerNotes,
      employeeId, groupId, referralSource,
      price: priceOverride,
      // New shape: mainServices/additionalServices may be [{id, price?}] or [id].
      // Legacy shape (serviceId + price + additionalServiceIds) still works below.
      mainServices, additionalServices, additionalServiceIds,
    } = req.body;

    // Build the unified main/addon lists. Legacy single-service payloads collapse to
    // mains = [{ id: serviceId, price: priceOverride }] so the rest of the flow is the same.
    const mains = normalizeServiceList(
      Array.isArray(mainServices) && mainServices.length > 0
        ? mainServices
        : (serviceId ? [{ id: serviceId, price: priceOverride }] : [])
    );
    const addons = normalizeServiceList(
      Array.isArray(additionalServices) && additionalServices.length > 0
        ? additionalServices
        : (Array.isArray(additionalServiceIds) ? additionalServiceIds : [])
    );

    if (mains.length === 0 || !bookingDate || !startTime || !customerInfo) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const resolved = await resolveBookingServices({ userId, mains, addons });
    const resolvedMains = resolved.filter(s => !s.is_addon);
    if (resolvedMains.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    // Primary service (first main) drives notification copy + auto-assignment.
    const primaryService = resolvedMains[0];

    // Fetch user's sales tax rate
    const taxResult = await pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [userId]);
    const taxRate = parseFloat(taxResult.rows[0]?.default_tax_rate || 0);

    const subtotal = resolved.reduce((sum, s) => sum + s.price, 0);
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const totalWithTax = subtotal + taxAmount;

    // End time spans the sum of all service durations (mains + add-ons), matching the
    // "Total Duration" the form shows the user — otherwise multi-service bookings would
    // wrongly leave the employee marked free for the back half of the appointment.
    const totalDurationHours = resolved.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + Math.round(totalDurationHours * 60);
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    let assignedEmployeeId = employeeId;

    if (!assignedEmployeeId) {
      const availableEmpResult = await pool.query(
        `SELECT e.id
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
        [userId, primaryService.id, bookingDate, startTime, endTime]
      );

      if (availableEmpResult.rows.length === 0) {
        return res.status(409).json({ error: 'No employees available for this time slot' });
      }

      assignedEmployeeId = availableEmpResult.rows[0].id;
    }

    const bookingNumberResult = await pool.query('SELECT generate_booking_number() as number');
    const bookingNumber = bookingNumberResult.rows[0].number;

    const customerResult = await pool.query(
      `INSERT INTO customers (user_id, name, email, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, customerInfo.name, customerInfo.email, customerInfo.phone]
    );
    const customerIdToUse = customerResult.rows[0].id;

    const bookingResult = await pool.query(
      `INSERT INTO bookings (
        user_id, customer_id, booking_number, booking_date, start_time, end_time,
        subtotal, total_amount, customer_name, customer_email,
        customer_phone, customer_notes, status, employee_id, group_id,
        source, referral_source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        userId, customerIdToUse, bookingNumber, bookingDate, startTime, endTime,
        subtotal, totalWithTax, customerInfo.name, customerInfo.email,
        customerInfo.phone, customerNotes || null, 'confirmed', assignedEmployeeId, groupId || null,
        'manual', (referralSource && String(referralSource).trim()) || null
      ]
    );

    const booking = bookingResult.rows[0];

    for (const svc of resolved) {
      await pool.query(
        `INSERT INTO booking_items (
          booking_id, service_id, service_name, service_duration,
          service_price, quantity, subtotal, is_addon
        )
        VALUES ($1, $2, $3, $4, $5, 1, $6, $7)`,
        [booking.id, svc.id, svc.name, svc.duration_hours, svc.price, svc.price, svc.is_addon]
      );
    }

    await updateCustomerFromBooking(booking, userId);

    const empResult = await pool.query('SELECT name FROM employees WHERE id = $1', [assignedEmployeeId]);

    // Notification copy: lead with the primary service, append "+ N more" only if
    // there are extra lines so single-service bookings read the same as before.
    const extraCount = resolved.length - 1;
    const serviceLabel = extraCount > 0
      ? `${primaryService.name} + ${extraCount} more`
      : primaryService.name;

    // Send booking confirmation emails (non-blocking)
    sendBookingEmails({
      userId,
      bookingNumber,
      customerName: customerInfo.name,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone,
      serviceName: serviceLabel,
      bookingDate,
      startTime,
      endTime,
      price: subtotal,
      subtotal,
      taxRate,
      taxAmount,
      total: totalWithTax,
      notes: customerNotes,
    }).catch(() => {});

    // Send push notification to assigned employee
    if (assignedEmployeeId) {
      sendPushToEmployee(assignedEmployeeId, 'New Booking Assigned',
        `${customerInfo.name} - ${serviceLabel} on ${bookingDate} at ${startTime}`,
        { bookingId: booking.id, type: 'new_booking' }
      ).catch(err => console.error('Push notification error:', err.message));
    }

    // Notify owner/admin
    sendPushToOwner(userId, 'New Booking',
      `${customerInfo.name} — ${serviceLabel} on ${bookingDate} at ${startTime}`,
      { bookingId: booking.id, type: 'new_booking' }
    ).catch(() => {});

    // Mark any matching chat conversation and lead as booked (non-blocking)
    if (customerInfo.email || customerInfo.phone) {
      pool.query(
        `UPDATE chat_conversations SET outcome = 'booked', updated_at = NOW()
         WHERE user_id = $1
           AND outcome != 'booked'
           AND id IN (
             SELECT conversation_id FROM leads
             WHERE user_id = $1
               AND conversation_id IS NOT NULL
               AND ($2::text IS NULL OR email = $2)
               AND ($3::text IS NULL OR phone = $3)
           )`,
        [userId, customerInfo.email || null, customerInfo.phone || null]
      ).catch(() => {});

      pool.query(
        `UPDATE leads SET status = 'booked', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
           AND conversation_id IS NOT NULL
           AND status != 'booked'
           AND ($2::text IS NULL OR email = $2)
           AND ($3::text IS NULL OR phone = $3)`,
        [userId, customerInfo.email || null, customerInfo.phone || null]
      ).catch(() => {});
    }

    res.json({
      success: true,
      booking,
      assignedEmployee: empResult.rows[0].name,
      message: 'Booking confirmed!'
    });
      
  } catch (error) {
    console.error('Error creating booking:', error.message);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PUT - Update booking
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const {
      serviceId, additionalServiceIds, bookingDate, startTime, customerInfo,
      notes, employeeId, groupId, status, sendEmail,
      price: priceOverride,
      mainServices, additionalServices,
    } = req.body;

    // Same shape as POST /create: prefer new arrays, fall back to legacy fields.
    const mains = normalizeServiceList(
      Array.isArray(mainServices) && mainServices.length > 0
        ? mainServices
        : (serviceId ? [{ id: serviceId, price: priceOverride }] : [])
    );
    const addons = normalizeServiceList(
      Array.isArray(additionalServices) && additionalServices.length > 0
        ? additionalServices
        : (Array.isArray(additionalServiceIds) ? additionalServiceIds : [])
    );

    const resolved = await resolveBookingServices({ userId: null, mains, addons });
    const resolvedMains = resolved.filter(s => !s.is_addon);
    if (resolvedMains.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const primaryService = resolvedMains[0];

    const taxResult = await pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [userId]);
    const taxRate = parseFloat(taxResult.rows[0]?.default_tax_rate || 0);

    const subtotal = resolved.reduce((sum, s) => sum + s.price, 0);
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const totalAmount = subtotal + taxAmount;

    // end_time spans the sum of all service durations (mains + add-ons) — see POST /create.
    const totalDurationHours = resolved.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + Math.round(totalDurationHours * 60);
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    const bookingResult = await pool.query(
      `UPDATE bookings
       SET booking_date = $1,
           start_time = $2,
           end_time = $3,
           customer_name = $4,
           customer_email = $5,
           customer_phone = $6,
           customer_address = $7,
           customer_notes = $8,
           employee_id = $9,
           group_id = $10,
           status = $11,
           subtotal = $12,
           tax_amount = $13,
           total_amount = $14,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $15 AND user_id = $16
       RETURNING *`,
      [
        bookingDate,
        startTime,
        endTime,
        customerInfo?.name,
        customerInfo?.email,
        customerInfo?.phone,
        customerInfo?.address,
        notes,
        employeeId,
        groupId || null,
        status || 'confirmed',
        subtotal,
        taxAmount,
        totalAmount,
        id,
        userId
      ]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    if (booking.customer_id && customerInfo) {
      await pool.query(
        `UPDATE customers
         SET name = $1, email = $2, phone = $3
         WHERE id = $4`,
        [customerInfo.name, customerInfo.email, customerInfo.phone, booking.customer_id]
      );
    }

    // Replace all booking_items: delete then re-insert mains + add-ons.
    await pool.query('DELETE FROM booking_items WHERE booking_id = $1', [id]);

    for (const svc of resolved) {
      await pool.query(
        `INSERT INTO booking_items (booking_id, service_id, service_name, service_duration, service_price, quantity, subtotal, is_addon)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7)`,
        [id, svc.id, svc.name, svc.duration_hours, svc.price, svc.price, svc.is_addon]
      );
    }

    if (sendEmail && booking.customer_email) {
      const extraCount = resolved.length - 1;
      const serviceLabel = extraCount > 0
        ? `${primaryService.name} + ${extraCount} more`
        : primaryService.name;
      sendBookingEmails({
        userId,
        bookingNumber: booking.booking_number,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
        serviceName: serviceLabel,
        bookingDate,
        startTime,
        endTime,
        subtotal: parseFloat(booking.subtotal),
        taxRate: parseFloat(booking.tax_rate),
        taxAmount: parseFloat(booking.tax_amount),
        total: parseFloat(booking.total_amount),
        notes,
        type: 'updated',
      }).catch(() => {});
    }

    res.json({
      success: true,
      booking: bookingResult.rows[0],
      message: 'Booking updated successfully'
    });

  } catch (error) {
    console.error('Error updating booking:', error.message);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// PUT - Mark booking as completed
router.put('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE bookings
       SET status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];
    await updateCustomerFromBooking(booking, userId);

    // Create review request if auto-send is enabled and customer has contact info
    try {
      const reviewConfig = await pool.query(
        'SELECT * FROM review_configs WHERE user_id = $1',
        [userId]
      );

      const config = reviewConfig.rows[0];
      // Only fire if the user has explicitly configured review requests with booking_completed trigger
      const autoSend = config?.auto_send_enabled;
      const trigger = config?.send_trigger;

      // Only create review here if trigger is explicitly 'booking_completed' (the other trigger uses its own cron)
      if (config && autoSend && trigger === 'booking_completed' && (booking.customer_email || booking.customer_phone)) {
        // Calculate scheduled send time (SMS goes out based on send_delay hours, default 2)
        const delayHours = config ? (config.send_delay ?? 2) : 2;
        const scheduledTime = new Date(Date.now() + delayHours * 60 * 60 * 1000);


        // Check if review request already exists for this customer recently
        const existing = await pool.query(
          'SELECT id FROM review_requests WHERE user_id = $1 AND customer_id = $2 AND created_at > NOW() - INTERVAL \'24 hours\'',
          [userId, booking.customer_id]
        );

        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO review_requests (user_id, customer_id, status, scheduled_send_time, created_at)
             VALUES ($1, $2, 'pending', $3, NOW())`,
            [userId, booking.customer_id, scheduledTime]
          );
          console.log(`✅ Review request created for booking ${id}`);
        }
      }
    } catch (reviewErr) {
      console.warn('⚠️ Could not create review request:', reviewErr.message);
      // Don't fail the completion just because review request failed
    }

    res.json({
      success: true,
      booking,
      message: 'Booking completed'
    });
  } catch (error) {
    console.error('Error completing booking:', error.message);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

// PUT - Update booking notes
router.put('/:id/notes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(
      `UPDATE bookings 
       SET job_notes = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [notes, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ 
      success: true,
      booking: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating booking notes:', error.message);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

// PUT - Set/override budgeted hours for a job. Owner-side mirror of the app's
// /api/employee/admin/budgeted-hours endpoint. Sending null/empty hours clears the
// override so efficiency reporting falls back to the service-duration default.
router.put('/:id/budgeted-hours', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { hours } = req.body || {};

    let value = null;
    if (hours !== null && hours !== undefined && hours !== '') {
      value = parseFloat(hours);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({ error: 'Enter a valid number of hours' });
      }
    }

    const result = await pool.query(
      `UPDATE bookings SET budgeted_hours = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING id, budgeted_hours`,
      [value, id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    res.json({ success: true, budgeted_hours: result.rows[0].budgeted_hours });
  } catch (error) {
    console.error('Error updating budgeted hours:', error.message);
    res.status(500).json({ error: 'Failed to update budgeted hours' });
  }
});

// PATCH - Update booking status only
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['pending', 'confirmed', 'confirmed_card_on_file', 'completed', 'cancelled', 'no_show'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const result = await pool.query(
      `UPDATE bookings SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3 RETURNING *`,
      [status, id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    // Cancel any pending review requests for this customer when booking is cancelled or no-show
    if (status === 'cancelled' || status === 'no_show') {
      const booking = result.rows[0];
      if (booking.customer_id) {
        const cancelled = await pool.query(
          `UPDATE review_requests
           SET status = 'cancelled'
           WHERE user_id = $1 AND customer_id = $2
             AND status = 'pending' AND sms_sent = false
           RETURNING id`,
          [userId, booking.customer_id]
        );
        if (cancelled.rows.length > 0) {
          console.log(`🚫 Cancelled ${cancelled.rows.length} review request(s) for booking ${id} (status: ${status})`);
        }
      }
    }

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('Error updating booking status:', error.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE - Delete a booking
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Null out FK references before deleting
    await pool.query('DELETE FROM booking_items WHERE booking_id = $1', [id]);
    await pool.query('UPDATE sms_messages SET booking_id = NULL WHERE booking_id = $1', [id]);

    const result = await pool.query(
      'DELETE FROM bookings WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    console.log(`✅ Booking deleted: #${result.rows[0].booking_number}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting booking:', error.message);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// POST /:id/send-card-link — generate a secure card-on-file link and email it to the customer
router.post('/:id/send-card-link', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const bookingResult = await pool.query(
      `SELECT b.*, bi.service_name, u.business_name, u.email AS owner_email
       FROM bookings b
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1 AND b.user_id = $2`,
      [id, userId]
    );
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    const booking = bookingResult.rows[0];

    if (!booking.customer_email) {
      return res.status(400).json({ error: 'Customer has no email address on file' });
    }

    // Create token
    const tokenResult = await pool.query(
      `INSERT INTO card_on_file_tokens (booking_id, user_id, customer_email, customer_name)
       VALUES ($1, $2, $3, $4)
       RETURNING token`,
      [id, userId, booking.customer_email, booking.customer_name]
    );
    const token = tokenResult.rows[0].token;

    // Mark booking as pending card
    await pool.query(
      `UPDATE bookings SET card_on_file_status = 'pending', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
    const cardLink = `${frontendUrl}/card-on-file/${token}`;

    // Send email
    if (process.env.SENDGRID_API_KEY && booking.customer_email) {
      const rawDateCust = String(booking.booking_date || '');
      const datePartCust = rawDateCust.includes('T') ? rawDateCust.split('T')[0] : rawDateCust;
      const parsedDateCust = datePartCust ? new Date(datePartCust + 'T12:00:00') : null;
      const dateStr = parsedDateCust && !isNaN(parsedDateCust)
        ? parsedDateCust.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : '';
      await sgMail.send({
        to: booking.customer_email,
        from: { name: booking.business_name || 'Your Service Provider', email: 'help@sorceintegrations.com' },
        replyTo: booking.owner_email ? { email: booking.owner_email } : undefined,
        subject: `One last step to confirm your appointment — ${booking.business_name || 'Us'}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#1d4ed8;padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
              <h1 style="color:#fff;margin:0;font-size:1.5rem;">Almost Confirmed!</h1>
            </div>
            <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
              <p style="font-size:1rem;margin-top:0;">Hi ${booking.customer_name},</p>
              <p>Your appointment with <strong>${booking.business_name || 'us'}</strong>${dateStr ? ` on ${dateStr}` : ''} is almost confirmed!</p>
              <p>We just need a card on file to complete your booking. <strong>We will not charge your card</strong> — it is only kept on file in case of a no-show per our cancellation policy.</p>
              <div style="text-align:center;margin:2rem 0;">
                <a href="${cardLink}" style="background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:1rem;font-weight:600;">
                  Securely Save Card on File
                </a>
              </div>
              <p style="color:#6b7280;font-size:0.85rem;">This link expires in 48 hours. If you have any questions, please contact us directly.</p>
              <p style="color:#6b7280;font-size:0.85rem;margin:0;">${booking.business_name || ''}</p>
            </div>
          </div>`,
      });
    }

    // Notify business owner that the link was sent
    if (process.env.SENDGRID_API_KEY && booking.owner_email) {
      const rawDate = String(booking.booking_date || '');
      const datePart = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
      const parsedDate = datePart ? new Date(datePart + 'T12:00:00') : null;
      const dateStr = parsedDate && !isNaN(parsedDate)
        ? parsedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : '';
      const serviceLine = booking.service_name ? ` for <strong>${booking.service_name}</strong>` : '';
      sgMail.send({
        to: booking.owner_email,
        from: { name: 'SORCE Notifications', email: 'help@sorceintegrations.com' },
        subject: `Card on file link sent to ${booking.customer_name}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#d97706;padding:1.5rem 2rem;border-radius:8px 8px 0 0;">
              <h2 style="color:#fff;margin:0;font-size:1.25rem;">Card on File Link Sent</h2>
            </div>
            <div style="padding:1.5rem 2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
              <p style="margin-top:0;">A secure card-on-file link has been sent to <strong>${booking.customer_name}</strong> (${booking.customer_email})${dateStr ? ` for their ${dateStr} appointment` : ''}.</p>
              <p style="color:#6b7280;font-size:0.9rem;">Booking #${booking.booking_number}${serviceLine} will be automatically confirmed once they save their card. The link expires in 48 hours.</p>
            </div>
          </div>`,
      }).catch(e => console.error('Owner card link notification error:', e.message));
    }

    console.log(`📧 Card on file link sent for booking #${booking.booking_number} to ${booking.customer_email}`);
    res.json({ success: true, message: 'Card link sent to customer email' });
  } catch (error) {
    console.error('Error sending card link:', error.message);
    res.status(500).json({ error: 'Failed to send card link' });
  }
});

module.exports = router;
