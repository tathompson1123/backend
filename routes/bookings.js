const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { sendPushToEmployee } = require('../utils/pushNotifications');
const { sendBookingEmails } = require('../utils/bookingEmail');

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
      const newLifetimeValue = (customer.rows[0].lifetime_value || 0) + parseFloat(booking.total_amount || 0);

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

    let query = `
      SELECT b.*, 
        json_agg(
          json_build_object(
            'service_name', bi.service_name,
            'duration', bi.service_duration,
            'price', bi.service_price,
            'quantity', bi.quantity
          )
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
    res.json({ bookings: result.rows });
  } catch (error) {
    console.error('Error fetching bookings:', error.message);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// POST - Create new booking
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { serviceId, bookingDate, startTime, customerInfo, customerNotes, employeeId, groupId } = req.body;

    if (!serviceId || !bookingDate || !startTime || !customerInfo) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const serviceResult = await pool.query(
      'SELECT duration_hours, price, name FROM services WHERE id = $1 AND user_id = $2',
      [serviceId, userId]
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = serviceResult.rows[0];
    
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + (service.duration_hours * 60);
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
        [userId, serviceId, bookingDate, startTime, endTime]
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
        customer_phone, customer_notes, status, employee_id, group_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        userId, customerIdToUse, bookingNumber, bookingDate, startTime, endTime,
        service.price, service.price, customerInfo.name, customerInfo.email,
        customerInfo.phone, customerNotes || null, 'confirmed', assignedEmployeeId, groupId || null
      ]
    );

    const booking = bookingResult.rows[0];

    await pool.query(
      `INSERT INTO booking_items (
        booking_id, service_id, service_name, service_duration, 
        service_price, quantity, subtotal
      )
      VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [booking.id, serviceId, service.name, service.duration_hours, service.price, service.price]
    );

    await updateCustomerFromBooking(booking, userId);

    const empResult = await pool.query('SELECT name FROM employees WHERE id = $1', [assignedEmployeeId]);

    // Send booking confirmation emails (non-blocking)
    sendBookingEmails({
      userId,
      bookingNumber,
      customerName: customerInfo.name,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone,
      serviceName: service.name,
      bookingDate,
      startTime,
      endTime,
      price: service.price,
      notes: customerNotes,
    }).catch(() => {});

    // Send push notification to assigned employee
    if (assignedEmployeeId) {
      sendPushToEmployee(assignedEmployeeId, 'New Booking Assigned',
        `${customerInfo.name} - ${service.name} on ${bookingDate} at ${startTime}`,
        { bookingId: booking.id, type: 'new_booking' }
      ).catch(err => console.error('Push notification error:', err.message));
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
    const { serviceId, bookingDate, startTime, customerInfo, notes, employeeId, groupId, status } = req.body;

    const serviceResult = await pool.query(
      'SELECT duration_hours, price, name FROM services WHERE id = $1',
      [serviceId]
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = serviceResult.rows[0];
    
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + (service.duration_hours * 60);
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
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 AND user_id = $13
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

    await pool.query(
      `UPDATE booking_items
       SET service_id = $1,
           service_name = $2,
           service_duration = $3,
           service_price = $4,
           subtotal = $5
       WHERE booking_id = $6`,
      [serviceId, service.name, service.duration_hours, service.price, service.price, id]
    );

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
      const autoSend = config ? config.auto_send_enabled : true;

      if (autoSend && (booking.customer_email || booking.customer_phone)) {
        // Get service name from booking items
        const itemsResult = await pool.query(
          'SELECT service_name FROM booking_items WHERE booking_id = $1 LIMIT 1',
          [id]
        );
        const serviceName = itemsResult.rows[0]?.service_name || 'Service';

        // Calculate scheduled send time (SMS goes out first based on send_delay hours, default 2)
        const delayHours = 2; // SMS always goes 2 hours after completion
        const scheduledTime = new Date(Date.now() + delayHours * 60 * 60 * 1000);

        // Generate incentive code if incentives are enabled
        const incentiveEnabled = config ? config.incentive_enabled : false;
        const incentiveCode = incentiveEnabled
          ? `REV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
          : null;

        // Check if review request already exists for this booking
        const existing = await pool.query(
          'SELECT id FROM review_requests WHERE user_id = $1 AND customer_email = $2 AND service_name = $3 AND created_at > NOW() - INTERVAL \'24 hours\'',
          [userId, booking.customer_email || '', serviceName]
        );

        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO review_requests (user_id, customer_name, customer_email, customer_phone, service_name, status, scheduled_send_time, incentive_code, created_at)
             VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW())`,
            [userId, booking.customer_name, booking.customer_email, booking.customer_phone, serviceName, scheduledTime, incentiveCode]
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

module.exports = router;
