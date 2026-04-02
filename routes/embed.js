const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { sendBookingEmails } = require('../utils/bookingEmail');

// ─── Helper: Look up user by site key ───────────────────
async function getUserBySiteKey(siteKey) {
  const result = await pool.query('SELECT id, business_name FROM users WHERE site_key = $1', [siteKey]);
  return result.rows[0] || null;
}

// ═══════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS — No auth, identified by site key
// ═══════════════════════════════════════════════════════════

// GET /api/embed/config/:siteKey — Widget config for the embed script
router.get('/config/:siteKey', async (req, res) => {
  try {
    const user = await getUserBySiteKey(req.params.siteKey);
    if (!user) return res.status(404).json({ error: 'Invalid site key' });

    // Get embed config
    const configResult = await pool.query(
      'SELECT * FROM embed_configs WHERE user_id = $1',
      [user.id]
    );
    const config = configResult.rows[0];
    if (!config) return res.json({ enabled: false });

    const response = {
      enabled: true,
      chatEnabled: config.chat_enabled,
      bookingEnabled: config.booking_enabled,
      bookingStyle: config.booking_style,
      leadFormEnabled: config.lead_form_enabled,
      leadFormTitle: config.lead_form_title,
      leadFormFields: config.lead_form_fields,
      bookingButtonText: config.booking_button_text,
      submitButtonText: config.submit_button_text || 'Submit',
      formRules: config.form_rules || [],
      themeColor: config.theme_color,
      position: config.position,
      userId: user.id,
      businessName: user.business_name || ''
    };

    // If chat enabled, include agent config
    if (config.chat_enabled) {
      const agentResult = await pool.query(
        "SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = 'website_chat'",
        [user.id]
      );
      const agentConfig = agentResult.rows[0]?.config || {};
      response.chat = {
        agentName: agentConfig.agentName || 'Assistant',
        greetingMessage: agentConfig.greetingMessage || 'Hi! How can I help you today?',
        autoOpenDelay: agentConfig.autoOpenDelay || 14
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Embed config error:', error.message);
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// GET /api/embed/services/:siteKey — Public service list for booking form
router.get('/services/:siteKey', async (req, res) => {
  try {
    const user = await getUserBySiteKey(req.params.siteKey);
    if (!user) return res.status(404).json({ error: 'Invalid site key' });

    const result = await pool.query(
      'SELECT id, name, description, price, duration_hours FROM services WHERE user_id = $1 AND active = true ORDER BY name',
      [user.id]
    );

    res.json({ services: result.rows });
  } catch (error) {
    console.error('Embed services error:', error.message);
    res.status(500).json({ error: 'Failed to load services' });
  }
});

// GET /api/embed/availability/:siteKey — Available time slots
router.get('/availability/:siteKey', async (req, res) => {
  try {
    const user = await getUserBySiteKey(req.params.siteKey);
    if (!user) return res.status(404).json({ error: 'Invalid site key' });

    const { date, serviceId } = req.query;
    if (!date) return res.status(400).json({ error: 'Date is required' });

    // Get the day of week (0=Sunday)
    const dateObj = new Date(date + 'T12:00:00');
    const dayOfWeek = dateObj.getDay();

    // Get business hours for this day
    const hoursResult = await pool.query(
      'SELECT is_open, open_time, close_time FROM business_hours WHERE user_id = $1 AND day_of_week = $2',
      [user.id, dayOfWeek]
    );

    if (hoursResult.rows.length === 0 || !hoursResult.rows[0].is_open) {
      return res.json({ slots: [], closed: true });
    }

    const hours = hoursResult.rows[0];

    // Get service duration (default 1 hour)
    let durationMinutes = 60;
    if (serviceId) {
      const serviceResult = await pool.query(
        'SELECT duration_hours FROM services WHERE id = $1 AND user_id = $2',
        [serviceId, user.id]
      );
      if (serviceResult.rows[0]) {
        durationMinutes = Math.round((serviceResult.rows[0].duration_hours || 1) * 60);
      }
    }

    // Get existing bookings for this date
    const bookingsResult = await pool.query(
      "SELECT start_time, end_time FROM bookings WHERE user_id = $1 AND booking_date = $2 AND status != 'cancelled'",
      [user.id, date]
    );
    const bookedSlots = bookingsResult.rows;

    // Generate available slots (every 30 min from open to close)
    const slots = [];
    const [openH, openM] = hours.open_time.split(':').map(Number);
    const [closeH, closeM] = hours.close_time.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    for (let m = openMinutes; m + durationMinutes <= closeMinutes; m += 30) {
      const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const slotEndM = m + durationMinutes;
      const slotEnd = `${String(Math.floor(slotEndM / 60)).padStart(2, '0')}:${String(slotEndM % 60).padStart(2, '0')}`;

      // Check if slot conflicts with existing bookings
      const isConflict = bookedSlots.some(b => {
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time.slice(0, 5);
        return slotStart < bEnd && slotEnd > bStart;
      });

      if (!isConflict) {
        slots.push({ time: slotStart, endTime: slotEnd });
      }
    }

    res.json({ slots, closed: false });
  } catch (error) {
    console.error('Embed availability error:', error.message);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// POST /api/embed/book/:siteKey — Create booking from embed widget
router.post('/book/:siteKey', async (req, res) => {
  try {
    const user = await getUserBySiteKey(req.params.siteKey);
    if (!user) return res.status(404).json({ error: 'Invalid site key' });

    const { serviceId, date, startTime, customerName, customerEmail, customerPhone, notes } = req.body;

    if (!serviceId || !date || !startTime || !customerName || !customerEmail) {
      return res.status(400).json({ error: 'Missing required fields (service, date, time, name, email)' });
    }

    // Get service info
    const serviceResult = await pool.query(
      'SELECT id, name, price, duration_hours FROM services WHERE id = $1 AND user_id = $2 AND active = true',
      [serviceId, user.id]
    );
    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const service = serviceResult.rows[0];

    // Validate business hours for the booking date
    const bookingDateObj = new Date(date + 'T12:00:00');
    const bookingDayOfWeek = bookingDateObj.getDay();
    const hoursCheck = await pool.query(
      'SELECT is_open, open_time, close_time FROM business_hours WHERE user_id = $1 AND day_of_week = $2',
      [user.id, bookingDayOfWeek]
    );
    if (hoursCheck.rows.length === 0 || !hoursCheck.rows[0].is_open) {
      return res.status(400).json({ error: 'We are closed on that day. Please choose a different date.' });
    }
    const bizHours = hoursCheck.rows[0];
    if (startTime < bizHours.open_time || startTime >= bizHours.close_time) {
      return res.status(400).json({ error: 'The selected time is outside our business hours. Please choose a different time.' });
    }

    // Create or update customer
    let customerId;
    const existingCustomer = await pool.query(
      'SELECT id FROM customers WHERE user_id = $1 AND email = $2',
      [user.id, customerEmail]
    );

    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
      await pool.query(
        'UPDATE customers SET name = $1, phone = COALESCE(NULLIF($2, \'\'), phone) WHERE id = $3',
        [customerName, customerPhone || '', customerId]
      );
    } else {
      const newCustomer = await pool.query(
        'INSERT INTO customers (user_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING id',
        [user.id, customerName, customerEmail, customerPhone || '']
      );
      customerId = newCustomer.rows[0].id;
    }

    // Calculate end time
    const durationMinutes = Math.round((service.duration_hours || 1) * 60);
    const [startH, startM] = startTime.split(':').map(Number);
    const endTotalMinutes = startH * 60 + startM + durationMinutes;
    const endTime = `${String(Math.floor(endTotalMinutes / 60)).padStart(2, '0')}:${String(endTotalMinutes % 60).padStart(2, '0')}`;

    // Generate booking number
    const bookingNumber = 'BK-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 3).toUpperCase();

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO bookings (user_id, customer_id, booking_number, booking_date, start_time, end_time,
        customer_name, customer_email, customer_phone, customer_notes, subtotal, total_amount, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed', 'embed')
       RETURNING id, booking_number`,
      [user.id, customerId, bookingNumber, date, startTime, endTime,
       customerName, customerEmail, customerPhone || '', notes || '',
       service.price || 0, service.price || 0]
    );

    // Create booking item
    await pool.query(
      `INSERT INTO booking_items (booking_id, service_id, service_name, price, quantity)
       VALUES ($1, $2, $3, $4, 1)`,
      [bookingResult.rows[0].id, service.id, service.name, service.price || 0]
    );

    // Also create a lead
    await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, service, source, status, sms_consent)
       VALUES ($1, $2, $3, $4, $5, 'embed', 'booked', true)
       ON CONFLICT DO NOTHING`,
      [user.id, customerName, customerEmail, customerPhone || '', service.name]
    );

    console.log(`📅 Embed booking created: ${bookingNumber} for user ${user.id}`);

    // Send booking confirmation emails (non-blocking)
    sendBookingEmails({
      userId: user.id,
      bookingNumber,
      customerName,
      customerEmail,
      customerPhone: customerPhone || '',
      serviceName: service.name,
      bookingDate: date,
      startTime,
      endTime,
      price: service.price,
      notes: notes || '',
    }).then(() => {
      console.log(`📧 Embed booking email sent for ${bookingNumber}`);
    }).catch(err => console.error(`📧 Embed booking email FAILED for ${bookingNumber}:`, err.message, err.response?.body));

    res.json({
      success: true,
      bookingNumber: bookingResult.rows[0].booking_number,
      message: 'Booking confirmed! You\'ll receive a confirmation shortly.'
    });
  } catch (error) {
    console.error('Embed booking error:', error.message);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// ═══════════════════════════════════════════════════════════
// AUTHENTICATED ENDPOINTS — Dashboard settings
// ═══════════════════════════════════════════════════════════

// GET /api/embed/site-key — Get user's site key
router.get('/site-key', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT site_key FROM users WHERE id = $1', [req.user.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    let siteKey = result.rows[0].site_key;

    // Generate if missing
    if (!siteKey) {
      const updateResult = await pool.query(
        'UPDATE users SET site_key = gen_random_uuid() WHERE id = $1 RETURNING site_key',
        [req.user.userId]
      );
      siteKey = updateResult.rows[0].site_key;
    }

    res.json({ siteKey });
  } catch (error) {
    console.error('Error fetching site key:', error.message);
    res.status(500).json({ error: 'Failed to get site key' });
  }
});

// GET /api/embed/settings — Get embed config
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM embed_configs WHERE user_id = $1',
      [req.user.userId]
    );

    res.json({ settings: result.rows[0] || null });
  } catch (error) {
    console.error('Error fetching embed settings:', error.message);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// PUT /api/embed/settings — Save embed config
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const {
      chatEnabled, bookingEnabled, bookingStyle, leadFormEnabled,
      leadFormTitle, leadFormFields, bookingButtonText, submitButtonText,
      formRules, themeColor, position
    } = req.body;

    const result = await pool.query(
      `INSERT INTO embed_configs (user_id, chat_enabled, booking_enabled, booking_style, lead_form_enabled,
        lead_form_title, lead_form_fields, booking_button_text, submit_button_text, form_rules, theme_color, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id) DO UPDATE SET
        chat_enabled = $2, booking_enabled = $3, booking_style = $4, lead_form_enabled = $5,
        lead_form_title = $6, lead_form_fields = $7, booking_button_text = $8,
        submit_button_text = $9, form_rules = $10, theme_color = $11, position = $12, updated_at = NOW()
       RETURNING *`,
      [
        req.user.userId,
        chatEnabled ?? false,
        bookingEnabled ?? false,
        bookingStyle || 'chat',
        leadFormEnabled ?? false,
        leadFormTitle || 'Get a Free Quote',
        JSON.stringify(leadFormFields || ['name', 'email', 'phone', 'message']),
        bookingButtonText || 'Book Online',
        submitButtonText || 'Submit',
        JSON.stringify(formRules || []),
        themeColor || '#d97706',
        position || 'bottom-right'
      ]
    );

    res.json({ success: true, settings: result.rows[0] });
  } catch (error) {
    console.error('Error saving embed settings:', error.message);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
