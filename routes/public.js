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

    // Get all active services with category info
    const result = await pool.query(
      `SELECT s.id, s.name, s.description, s.price, s.duration_hours, s.image_url, s.buffer_minutes, s.is_addon, s.sort_order, s.category_id
       FROM services s WHERE s.user_id = $1 AND s.active = true ORDER BY s.sort_order, s.name`,
      [businessId]
    );

    // Get categories
    const catResult = await pool.query(
      'SELECT id, name, description, image_url, sort_order FROM service_categories WHERE user_id = $1 AND active = true ORDER BY sort_order, name',
      [businessId]
    );

    // Get addon relationships
    const addonResult = await pool.query(
      `SELECT sa.main_service_id, sa.addon_service_id, sa.sort_order
       FROM service_addons sa
       JOIN services s ON s.id = sa.main_service_id
       WHERE s.user_id = $1 ORDER BY sa.sort_order`,
      [businessId]
    );

    // Build addon map: { mainServiceId: [addonServiceId, ...] }
    const addonMap = {};
    for (const row of addonResult.rows) {
      if (!addonMap[row.main_service_id]) addonMap[row.main_service_id] = [];
      addonMap[row.main_service_id].push(row.addon_service_id);
    }

    // Group services by category
    const categories = catResult.rows.map(cat => ({
      ...cat,
      services: result.rows.filter(s => s.category_id === cat.id && !s.is_addon)
    }));
    const uncategorized = result.rows.filter(s => !s.category_id && !s.is_addon);

    res.json({
      services: result.rows, // flat list for backward compatibility
      categories,
      uncategorized,
      addonMap
    });
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

// GET /api/public/services/:serviceId/addons?businessId=...
router.get('/services/:serviceId/addons', async (req, res) => {
  try {
    const { businessId } = req.query;
    const { serviceId } = req.params;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });
    const result = await pool.query(
      `SELECT s.id, s.name, s.description, s.price, s.duration_hours, s.image_url
       FROM service_addons sa JOIN services s ON s.id = sa.addon_service_id
       WHERE sa.main_service_id = $1 AND s.user_id = $2 AND s.active = true
       ORDER BY sa.sort_order, s.name`,
      [serviceId, businessId]
    );
    res.json({ addons: result.rows });
  } catch (error) {
    console.error('Public addons error:', error.message);
    res.status(500).json({ error: 'Failed to load addons' });
  }
});

// GET /api/public/booking-widget-config?businessId=...
router.get('/booking-widget-config', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });
    const result = await pool.query('SELECT config FROM booking_widget_configs WHERE user_id = $1', [businessId]);
    const defaultConfig = {
      steps: {
        categories: { title: 'Our Services', subtitle: 'Choose a category' },
        services: { title: 'Select a Service', subtitle: '' },
        addons: { title: 'Enhance Your Service', subtitle: 'Popular add-ons for this service' },
        datetime: { title: 'Choose Date & Time', subtitle: '' },
        contact: { title: 'Your Information', subtitle: '' },
        payment: { title: 'Confirm & Pay', subtitle: '' },
        confirmation: { title: 'Booking Confirmed!', subtitle: '' }
      },
      requirePayment: false, depositPercent: null, showPrices: true, showDurations: true, accentColor: null
    };
    res.json({ config: result.rows.length > 0 ? { ...defaultConfig, ...result.rows[0].config } : defaultConfig });
  } catch (error) {
    console.error('Public widget config error:', error.message);
    res.json({ config: {} });
  }
});

// GET /api/public/business-info?businessId=...
router.get('/business-info', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    const result = await pool.query(
      'SELECT business_name, business_type, custom_domain, vercel_url FROM websites WHERE user_id = $1',
      [businessId]
    );

    // Also check business_information table
    const bizInfo = await pool.query(
      'SELECT phone, address, city, state FROM business_information WHERE user_id = $1',
      [businessId]
    );

    const website = result.rows[0] || {};
    const info = bizInfo.rows[0] || {};
    const websiteUrl = website.custom_domain
      ? `https://${website.custom_domain.replace(/^https?:?\/?\/?\/?/i, '')}`
      : website.vercel_url
        ? (website.vercel_url.startsWith('http') ? website.vercel_url : `https://${website.vercel_url}`)
        : null;

    res.json({
      business: {
        business_name: website.business_name || 'Business',
        business_type: website.business_type || '',
        phone: info.phone || '',
        address: info.address || '',
        city: info.city || '',
        state: info.state || '',
        website_url: websiteUrl,
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

    // Calculate total duration + max buffer from all selected services
    let durationMinutes = 60;
    let bufferMinutes = 0;
    if (serviceIds) {
      const ids = serviceIds.split(',').filter(Boolean);
      if (ids.length > 0) {
        const serviceResult = await pool.query(
          'SELECT duration_hours, buffer_minutes FROM services WHERE id = ANY($1) AND user_id = $2',
          [ids.map(Number), businessId]
        );
        durationMinutes = serviceResult.rows.reduce(
          (sum, s) => sum + Math.round((s.duration_hours || 1) * 60), 0
        );
        // Use the max buffer from all selected services
        bufferMinutes = serviceResult.rows.reduce(
          (max, s) => Math.max(max, s.buffer_minutes || 0), 0
        );
      }
    }

    // Total block = service duration + buffer (buffer prevents back-to-back bookings)
    const totalBlock = durationMinutes + bufferMinutes;

    // Get employees who can perform these services (if service_employees table exists)
    let employees = [];
    try {
      const empResult = await pool.query(
        'SELECT DISTINCT e.id FROM employees e WHERE e.user_id = $1 AND e.active = true',
        [businessId]
      );
      employees = empResult.rows.map(e => e.id);
    } catch (e) { /* no employees table or no employees */ }

    // If no employees, treat business as 1 slot capacity
    const capacity = Math.max(employees.length, 1);

    // Get existing bookings for this date, including which employee and service buffer
    const bookingsResult = await pool.query(
      `SELECT b.start_time, b.end_time, b.employee_id as assigned_employee_id,
              COALESCE(MAX(s.buffer_minutes), 0) as booking_buffer
       FROM bookings b
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       LEFT JOIN services s ON s.id = bi.service_id
       WHERE b.user_id = $1 AND b.booking_date = $2 AND b.status != 'cancelled'
       GROUP BY b.id, b.start_time, b.end_time, b.employee_id`,
      [businessId, date]
    );
    const existingBookings = bookingsResult.rows;

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
      // The full block including buffer for conflict checking
      const slotBlockEndM = m + totalBlock;
      const slotBlockEnd = `${String(Math.floor(slotBlockEndM / 60)).padStart(2, '0')}:${String(slotBlockEndM % 60).padStart(2, '0')}`;

      if (capacity <= 1) {
        // Single-provider: check global conflicts with buffer
        const isConflict = existingBookings.some(b => {
          const bStart = b.start_time.slice(0, 5);
          const bEndM = timeToMinutes(b.end_time.slice(0, 5)) + (b.booking_buffer || 0);
          const bBlockEnd = minutesToTime(bEndM);
          // New slot's block must not overlap with existing booking's block
          return slotStart < bBlockEnd && slotBlockEnd > bStart;
        });
        if (!isConflict) {
          const h12 = ((Math.floor(m / 60) % 12) || 12);
          const ampm = Math.floor(m / 60) < 12 ? 'AM' : 'PM';
          slots.push({ time: slotStart, endTime: slotEnd, displayTime: `${h12}:${mm} ${ampm}` });
        }
      } else {
        // Multi-employee: count how many employees are free for this slot
        let freeCount = 0;
        for (const empId of employees) {
          const empBookings = existingBookings.filter(b => b.assigned_employee_id === empId);
          const hasConflict = empBookings.some(b => {
            const bStart = b.start_time.slice(0, 5);
            const bEndM = timeToMinutes(b.end_time.slice(0, 5)) + (b.booking_buffer || 0);
            const bBlockEnd = minutesToTime(bEndM);
            return slotStart < bBlockEnd && slotBlockEnd > bStart;
          });
          if (!hasConflict) freeCount++;
        }
        // Also count unassigned bookings against total capacity
        const unassignedConflicts = existingBookings.filter(b => !b.assigned_employee_id).some(b => {
          const bStart = b.start_time.slice(0, 5);
          const bEndM = timeToMinutes(b.end_time.slice(0, 5)) + (b.booking_buffer || 0);
          const bBlockEnd = minutesToTime(bEndM);
          return slotStart < bBlockEnd && slotBlockEnd > bStart;
        });
        if (unassignedConflicts) freeCount = Math.max(freeCount - 1, 0);

        if (freeCount > 0) {
          const h12 = ((Math.floor(m / 60) % 12) || 12);
          const ampm = Math.floor(m / 60) < 12 ? 'AM' : 'PM';
          slots.push({ time: slotStart, endTime: slotEnd, displayTime: `${h12}:${mm} ${ampm}`, available: freeCount });
        }
      }
    }

    res.json({ slots, closed: false });
  } catch (error) {
    console.error('Public availability error:', error.message);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minutesToTime(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

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

    // Validate business hours for the booking date
    const bookingDateObj = new Date(bookingDate + 'T12:00:00');
    const bookingDayOfWeek = bookingDateObj.getDay();
    const hoursCheck = await pool.query(
      'SELECT is_open, open_time, close_time FROM business_hours WHERE user_id = $1 AND day_of_week = $2',
      [businessId, bookingDayOfWeek]
    );
    if (hoursCheck.rows.length === 0 || !hoursCheck.rows[0].is_open) {
      return res.status(400).json({ error: 'We are closed on that day. Please choose a different date.' });
    }
    const bizHours = hoursCheck.rows[0];
    if (startTime < bizHours.open_time || startTime >= bizHours.close_time) {
      return res.status(400).json({ error: 'The selected time is outside our business hours. Please choose a different time.' });
    }

    // Calculate end time
    const [startH, startM] = startTime.split(':').map(Number);
    const endTotalMinutes = startH * 60 + startM + totalDurationMinutes;
    const endTime = `${String(Math.floor(endTotalMinutes / 60)).padStart(2, '0')}:${String(endTotalMinutes % 60).padStart(2, '0')}`;

    // Create or update customer
    const serviceName = servicesResult.rows.map(s => s.name).join(', ');
    let customerId;
    const existingCustomer = await pool.query(
      'SELECT id FROM customers WHERE user_id = $1 AND email = $2',
      [businessId, customerInfo.email]
    );

    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
      await pool.query(
        `UPDATE customers SET name = $1, phone = COALESCE(NULLIF($2, ''), phone),
         last_service = $3, last_service_date = $4 WHERE id = $5`,
        [customerInfo.name, customerInfo.phone || '', serviceName, bookingDate, customerId]
      );
    } else {
      const newCustomer = await pool.query(
        `INSERT INTO customers (user_id, name, email, phone, last_service, last_service_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [businessId, customerInfo.name, customerInfo.email, customerInfo.phone || '', serviceName, bookingDate]
      );
      customerId = newCustomer.rows[0].id;
    }

    // Generate booking number
    const bookingNumber = 'BK-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 3).toUpperCase();

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO bookings (user_id, customer_id, booking_number, booking_date, start_time, end_time,
        customer_name, customer_email, customer_phone, customer_notes,
        employee_id, subtotal, total_amount, status, source)
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
      const svcPrice = parseFloat(service.price || 0);
      const svcDuration = service.duration_hours || 1;
      await pool.query(
        'INSERT INTO booking_items (booking_id, service_id, service_name, service_price, service_duration, quantity, subtotal) VALUES ($1, $2, $3, $4, $5, 1, $6)',
        [bookingResult.rows[0].id, service.id, service.name, svcPrice, svcDuration, svcPrice]
      );
    }

    // Also create a lead record
    await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, service, source, status, sms_consent)
       VALUES ($1, $2, $3, $4, $5, 'website', 'booked', true)
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

// POST /api/public/bookings/payment-setup
router.post('/bookings/payment-setup', async (req, res) => {
  try {
    const { businessId, amount, customerEmail } = req.body;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    // Check if business has Stripe connected
    const connResult = await pool.query(
      "SELECT stripe_account_id FROM payment_connections WHERE user_id = $1 AND processor = 'stripe' AND is_active = true",
      [businessId]
    );
    if (connResult.rows.length === 0) {
      return res.status(400).json({ error: 'No payment processor connected' });
    }

    const stripeAccountId = connResult.rows[0].stripe_account_id;
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    if (amount && amount > 0) {
      // Payment Intent for deposit
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'usd',
        metadata: { businessId, customerEmail: customerEmail || '' },
      }, { stripeAccount: stripeAccountId });
      res.json({ clientSecret: paymentIntent.client_secret, type: 'payment' });
    } else {
      // Setup Intent for card-on-file
      const setupIntent = await stripe.setupIntents.create({
        payment_method_types: ['card'],
        metadata: { businessId, customerEmail: customerEmail || '' },
      }, { stripeAccount: stripeAccountId });
      res.json({ clientSecret: setupIntent.client_secret, type: 'setup' });
    }
  } catch (error) {
    console.error('Payment setup error:', error.message);
    res.status(500).json({ error: 'Failed to set up payment' });
  }
});

module.exports = router;
