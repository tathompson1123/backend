const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendBookingEmails } = require('../utils/bookingEmail');

// All routes are public (no auth). businessId = user_id.

// GET /api/public/services?businessId=...
router.get('/services', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    const result = await pool.query(
      'SELECT id, name, description, price, duration_hours FROM services WHERE user_id = $1 AND active = true ORDER BY name',
      [businessId]
    );
    res.json({ services: result.rows });
  } catch (error) {
    console.error('Public services error:', error.message);
    res.status(500).json({ error: 'Failed to load services' });
  }
});

// GET /api/public/employees?businessId=...
router.get('/employees', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    const result = await pool.query(
      "SELECT id, name, color FROM employees WHERE user_id = $1 AND active = true ORDER BY name",
      [businessId]
    );
    res.json({ employees: result.rows });
  } catch (error) {
    console.error('Public employees error:', error.message);
    res.status(500).json({ error: 'Failed to load employees' });
  }
});

// GET /api/public/groups?businessId=...
router.get('/groups', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    // Check if employee_groups table exists
    try {
      const result = await pool.query(
        'SELECT id, name, employee_ids FROM employee_groups WHERE user_id = $1 ORDER BY name',
        [businessId]
      );
      res.json({ groups: result.rows });
    } catch {
      // Table may not exist yet
      res.json({ groups: [] });
    }
  } catch (error) {
    console.error('Public groups error:', error.message);
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

// GET /api/public/business-hours?businessId=...
router.get('/business-hours', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    const result = await pool.query(
      'SELECT day_of_week, is_open, open_time, close_time FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
      [businessId]
    );
    res.json({ businessHours: result.rows });
  } catch (error) {
    console.error('Public business hours error:', error.message);
    res.status(500).json({ error: 'Failed to load business hours' });
  }
});

// GET /api/public/business-info?businessId=...
router.get('/business-info', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    const result = await pool.query(
      'SELECT business_name, business_type FROM websites WHERE user_id = $1',
      [businessId]
    );

    // Also check business_information table
    const bizInfo = await pool.query(
      'SELECT business_name, phone, address, city, state FROM business_information WHERE user_id = $1',
      [businessId]
    );

    const website = result.rows[0] || {};
    const info = bizInfo.rows[0] || {};

    res.json({
      business: {
        business_name: info.business_name || website.business_name || 'Business',
        business_type: website.business_type || '',
        phone: info.phone || '',
        address: info.address || '',
        city: info.city || '',
        state: info.state || '',
      }
    });
  } catch (error) {
    console.error('Public business info error:', error.message);
    res.status(500).json({ error: 'Failed to load business info' });
  }
});

// GET /api/public/availability?businessId=...&serviceIds=...&date=...
router.get('/availability', async (req, res) => {
  try {
    const { businessId, serviceIds, date } = req.query;
    if (!businessId || !date) return res.status(400).json({ error: 'businessId and date required' });

    const dateObj = new Date(date + 'T12:00:00');
    const dayOfWeek = dateObj.getDay();

    // Get business hours for this day
    const hoursResult = await pool.query(
      'SELECT is_open, open_time, close_time FROM business_hours WHERE user_id = $1 AND day_of_week = $2',
      [businessId, dayOfWeek]
    );

    if (hoursResult.rows.length === 0 || !hoursResult.rows[0].is_open) {
      return res.json({ slots: [], closed: true });
    }

    const hours = hoursResult.rows[0];

    // Calculate total duration from all selected services
    let durationMinutes = 60;
    if (serviceIds) {
      const ids = serviceIds.split(',').filter(Boolean);
      if (ids.length > 0) {
        const serviceResult = await pool.query(
          'SELECT duration_hours FROM services WHERE id = ANY($1) AND user_id = $2',
          [ids.map(Number), businessId]
        );
        durationMinutes = serviceResult.rows.reduce(
          (sum, s) => sum + Math.round((s.duration_hours || 1) * 60), 0
        );
      }
    }

    // Get existing bookings for this date
    const bookingsResult = await pool.query(
      "SELECT start_time, end_time FROM bookings WHERE user_id = $1 AND booking_date = $2 AND status != 'cancelled'",
      [businessId, date]
    );
    const bookedSlots = bookingsResult.rows;

    // Generate available 30-min slots
    const slots = [];
    const [openH, openM] = hours.open_time.split(':').map(Number);
    const [closeH, closeM] = hours.close_time.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    for (let m = openMinutes; m + durationMinutes <= closeMinutes; m += 30) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const slotStart = `${hh}:${mm}`;
      const slotEndM = m + durationMinutes;
      const slotEnd = `${String(Math.floor(slotEndM / 60)).padStart(2, '0')}:${String(slotEndM % 60).padStart(2, '0')}`;

      // Check conflicts
      const isConflict = bookedSlots.some(b => {
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time.slice(0, 5);
        return slotStart < bEnd && slotEnd > bStart;
      });

      if (!isConflict) {
        // Format display time (12-hour)
        const h12 = ((Math.floor(m / 60) % 12) || 12);
        const ampm = Math.floor(m / 60) < 12 ? 'AM' : 'PM';
        slots.push({ time: slotStart, endTime: slotEnd, displayTime: `${h12}:${mm} ${ampm}` });
      }
    }

    res.json({ slots, closed: false });
  } catch (error) {
    console.error('Public availability error:', error.message);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// POST /api/public/bookings/create
router.post('/bookings/create', async (req, res) => {
  try {
    const {
      businessId, serviceId, additionalServiceIds = [],
      bookingDate, startTime, customerInfo, customerNotes,
      assignmentType, employeeId, groupId
    } = req.body;

    if (!businessId || !serviceId || !bookingDate || !startTime || !customerInfo?.name || !customerInfo?.email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get all selected services
    const allServiceIds = [serviceId, ...additionalServiceIds].filter(Boolean);
    const servicesResult = await pool.query(
      'SELECT id, name, price, duration_hours FROM services WHERE id = ANY($1) AND user_id = $2 AND active = true',
      [allServiceIds.map(Number), businessId]
    );

    if (servicesResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const totalPrice = servicesResult.rows.reduce((sum, s) => sum + parseFloat(s.price || 0), 0);
    const totalDurationMinutes = servicesResult.rows.reduce(
      (sum, s) => sum + Math.round((s.duration_hours || 1) * 60), 0
    );

    // Calculate end time
    const [startH, startM] = startTime.split(':').map(Number);
    const endTotalMinutes = startH * 60 + startM + totalDurationMinutes;
    const endTime = `${String(Math.floor(endTotalMinutes / 60)).padStart(2, '0')}:${String(endTotalMinutes % 60).padStart(2, '0')}`;

    // Create or update customer
    let customerId;
    const existingCustomer = await pool.query(
      'SELECT id FROM customers WHERE user_id = $1 AND email = $2',
      [businessId, customerInfo.email]
    );

    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
      await pool.query(
        "UPDATE customers SET name = $1, phone = COALESCE(NULLIF($2, ''), phone) WHERE id = $3",
        [customerInfo.name, customerInfo.phone || '', customerId]
      );
    } else {
      const newCustomer = await pool.query(
        'INSERT INTO customers (user_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING id',
        [businessId, customerInfo.name, customerInfo.email, customerInfo.phone || '']
      );
      customerId = newCustomer.rows[0].id;
    }

    // Generate booking number
    const bookingNumber = 'BK-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 3).toUpperCase();

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO bookings (user_id, customer_id, booking_number, booking_date, start_time, end_time,
        customer_name, customer_email, customer_phone, customer_notes,
        assigned_employee_id, subtotal, total_amount, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'confirmed', 'website')
       RETURNING id, booking_number`,
      [
        businessId, customerId, bookingNumber, bookingDate, startTime, endTime,
        customerInfo.name, customerInfo.email, customerInfo.phone || '',
        customerNotes || '',
        assignmentType === 'employee' ? employeeId : null,
        totalPrice, totalPrice
      ]
    );

    // Create booking items for each service
    for (const service of servicesResult.rows) {
      await pool.query(
        'INSERT INTO booking_items (booking_id, service_id, service_name, price, quantity) VALUES ($1, $2, $3, $4, 1)',
        [bookingResult.rows[0].id, service.id, service.name, service.price || 0]
      );
    }

    // Also create a lead record
    await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, service, source, status, sms_consent)
       VALUES ($1, $2, $3, $4, $5, 'website_booking', 'booked', true)
       ON CONFLICT DO NOTHING`,
      [businessId, customerInfo.name, customerInfo.email, customerInfo.phone || '', servicesResult.rows[0].name]
    );

    console.log(`📅 Public booking created: ${bookingNumber} for user ${businessId}`);

    // Send booking confirmation emails (non-blocking)
    sendBookingEmails({
      userId: businessId,
      bookingNumber,
      customerName: customerInfo.name,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone || '',
      serviceName: servicesResult.rows.map(s => s.name).join(', '),
      bookingDate,
      startTime,
      endTime,
      price: totalPrice,
      notes: customerNotes || '',
    }).catch(() => {});

    res.json({
      success: true,
      bookingNumber: bookingResult.rows[0].booking_number,
      message: "Booking confirmed! You'll receive a confirmation shortly."
    });
  } catch (error) {
    console.error('Public booking create error:', error.message);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

module.exports = router;
