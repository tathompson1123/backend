const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendBookingEmails } = require('../utils/bookingEmail');
const { getTimezoneForBusiness } = require('../utils/zipToTimezone');
const { getSquareClient, findOrCreateSquareCustomer, saveCardOnFile } = require('../utils/squareCardOnFile');

// All routes are public (no auth). businessId = user_id.

// GET /api/public/services?businessId=...
router.get('/services', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    // Get all active services with category info
    const result = await pool.query(
      `SELECT s.id, s.name, s.description, s.price, s.duration_hours, s.image_url, s.buffer_minutes, s.is_addon, s.sort_order, s.category_id
       FROM services s WHERE s.user_id = $1 AND s.active = true ORDER BY s.sort_order ASC NULLS LAST, s.name`,
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

    // Get the business's sales tax rate
    const taxResult = await pool.query(
      'SELECT default_tax_rate FROM users WHERE id = $1',
      [businessId]
    );
    const taxRate = parseFloat(taxResult.rows[0]?.default_tax_rate || 0);

    // Get variants for all services
    const variantResult = await pool.query(
      `SELECT sv.* FROM service_variants sv
       JOIN services s ON s.id = sv.service_id
       WHERE s.user_id = $1 ORDER BY sv.service_id, sv.sort_order, sv.id`,
      [businessId]
    );
    const variantMap = {};
    for (const v of variantResult.rows) {
      if (!variantMap[v.service_id]) variantMap[v.service_id] = [];
      variantMap[v.service_id].push(v);
    }

    // Attach variants to each service
    const servicesWithVariants = result.rows.map(s => ({
      ...s,
      variants: variantMap[s.id] || []
    }));

    // Group services by category
    const categories = catResult.rows.map(cat => ({
      ...cat,
      services: servicesWithVariants.filter(s => s.category_id === cat.id && !s.is_addon)
    }));
    const uncategorized = servicesWithVariants.filter(s => !s.category_id && !s.is_addon);

    res.json({
      services: servicesWithVariants,
      categories,
      uncategorized,
      addonMap,
      taxRate
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

    const [configResult, paymentResult] = await Promise.all([
      pool.query('SELECT config FROM booking_widget_configs WHERE user_id = $1', [businessId]),
      pool.query(
        "SELECT processor, stripe_account_id, square_location_id FROM payment_connections WHERE user_id = $1 AND is_active = true ORDER BY is_primary DESC LIMIT 1",
        [businessId]
      )
    ]);

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

    const savedConfig = configResult.rows.length > 0 ? configResult.rows[0].config : {};
    const pRow = paymentResult.rows[0];
    const processor = pRow?.processor || null;

    const config = {
      ...defaultConfig,
      ...savedConfig,
      paymentConnected: !!pRow,
      paymentProcessor: processor,
      // Stripe
      stripePublicKey: processor === 'stripe' ? (process.env.STRIPE_PUBLIC_KEY || null) : null,
      stripeAccountId: processor === 'stripe' ? (pRow?.stripe_account_id || null) : null,
      // Square
      squareAppId: processor === 'square' ? (process.env.SQUARE_APPLICATION_ID || null) : null,
      squareLocationId: processor === 'square' ? (pRow?.square_location_id || null) : null,
      squareEnvironment: process.env.SQUARE_ENVIRONMENT || 'production',
      // Clover
      cloverPublicKey: processor === 'clover' ? (process.env.CLOVER_PUBLIC_KEY || null) : null,
      cloverMerchantId: processor === 'clover' ? (process.env.CLOVER_MERCHANT_ID || null) : null,
      cloverEnvironment: process.env.CLOVER_ENVIRONMENT || 'production',
    };

    res.json({ config });
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

    const taxResult = await pool.query(
      'SELECT default_tax_rate FROM users WHERE id = $1',
      [businessId]
    );

    const website = result.rows[0] || {};
    const info = bizInfo.rows[0] || {};
    const taxRate = parseFloat(taxResult.rows[0]?.default_tax_rate || 0);
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
        tax_rate: taxRate,
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
    const { businessId, serviceIds, date, variantId } = req.query;
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
          'SELECT id, duration_hours, buffer_minutes FROM services WHERE id = ANY($1) AND user_id = $2',
          [ids.map(Number), businessId]
        );
        // If a variantId is provided, look up its duration and override the main service's duration
        let variantDurationMinutes = null;
        if (variantId) {
          const vResult = await pool.query(
            'SELECT duration_hours, service_id FROM service_variants WHERE id = $1',
            [Number(variantId)]
          );
          if (vResult.rows.length > 0 && vResult.rows[0].duration_hours) {
            variantDurationMinutes = Math.round(parseFloat(vResult.rows[0].duration_hours) * 60);
          }
        }
        durationMinutes = serviceResult.rows.reduce((sum, s) => {
          // For the main service (first ID), use variant duration if available
          const isMainService = variantId && s.id === ids.map(Number)[0];
          const mins = isMainService && variantDurationMinutes !== null
            ? variantDurationMinutes
            : Math.round((s.duration_hours || 1) * 60);
          return sum + mins;
        }, 0);
        bufferMinutes = serviceResult.rows.reduce(
          (max, s) => Math.max(max, s.buffer_minutes || 0), 0
        );
      }
    }

    // Total block = service duration + buffer (buffer prevents back-to-back bookings)
    const totalBlock = durationMinutes + bufferMinutes;

    // Day name for work_days check (0=Sunday, 1=Monday, ...)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[dayOfWeek];

    // Get employees who can perform the selected service AND are scheduled to work today
    // - Employees with no service assignments can do any service
    // - Employees with assignments can only do their assigned services
    // - work_days must include today; work_hours must be present
    let employees = [];
    try {
      const ids = serviceIds ? serviceIds.split(',').filter(Boolean).map(Number) : [];
      let empResult;
      if (ids.length > 0) {
        empResult = await pool.query(
          `SELECT DISTINCT e.id, e.work_hours, e.work_days FROM employees e
           WHERE e.user_id = $1 AND e.active = true
           AND (
             NOT EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id)
             OR EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id AND service_id = ANY($2))
           )`,
          [businessId, ids]
        );
      } else {
        empResult = await pool.query(
          'SELECT DISTINCT e.id, e.work_hours, e.work_days FROM employees e WHERE e.user_id = $1 AND e.active = true',
          [businessId]
        );
      }
      // Filter to employees scheduled to work on this day
      employees = empResult.rows.filter(e => {
        const workDays = e.work_days || {};
        return workDays[dayName] !== false; // default true if not set
      });
    } catch (e) { /* no employees table or no employees */ }

    // If no employees, treat business as 1 slot capacity (no per-employee hour checking)
    const noEmployees = employees.length === 0;

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

    // Check for fixed booking time slots
    const fixedSlotsResult = await pool.query(
      'SELECT slot_time FROM booking_time_slots WHERE user_id = $1 AND active = true ORDER BY slot_time',
      [businessId]
    );
    const fixedSlotMinutes = fixedSlotsResult.rows.map(r => {
      const [h, m] = r.slot_time.slice(0, 5).split(':').map(Number);
      return h * 60 + m;
    });

    // Generate available slots — fixed list if configured, else every 30 minutes
    const slots = [];
    const [openH, openM] = hours.open_time.split(':').map(Number);
    const [closeH, closeM] = hours.close_time.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    const minutesToCheck = fixedSlotMinutes.length > 0
      ? fixedSlotMinutes.filter(m => m >= openMinutes && m + durationMinutes <= closeMinutes)
      : (() => { const arr = []; for (let m = openMinutes; m + durationMinutes <= closeMinutes; m += 30) arr.push(m); return arr; })();

    for (const m of minutesToCheck) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const slotStart = `${hh}:${mm}`;
      const slotEndM = m + durationMinutes;
      const slotEnd = `${String(Math.floor(slotEndM / 60)).padStart(2, '0')}:${String(slotEndM % 60).padStart(2, '0')}`;
      // The full block including buffer for conflict checking
      const slotBlockEndM = m + totalBlock;
      const slotBlockEnd = `${String(Math.floor(slotBlockEndM / 60)).padStart(2, '0')}:${String(slotBlockEndM % 60).padStart(2, '0')}`;

      if (noEmployees) {
        // No employee records — single-provider mode: check global conflicts with buffer
        const isConflict = existingBookings.some(b => {
          const bStart = b.start_time.slice(0, 5);
          const bEndM = timeToMinutes(b.end_time.slice(0, 5)) + (b.booking_buffer || 0);
          const bBlockEnd = minutesToTime(bEndM);
          return slotStart < bBlockEnd && slotBlockEnd > bStart;
        });
        if (!isConflict) {
          const h12 = ((Math.floor(m / 60) % 12) || 12);
          const ampm = Math.floor(m / 60) < 12 ? 'AM' : 'PM';
          slots.push({ time: slotStart, endTime: slotEnd, displayTime: `${h12}:${mm} ${ampm}` });
        }
      } else {
        // Multi-employee: count employees available at this slot
        // An employee is available if:
        //   1. Their work hours cover the entire slot (start + duration)
        //   2. They don't have a conflicting booking
        let availableCount = 0;
        for (const emp of employees) {
          // Check work hours
          const wh = emp.work_hours || { startTime: '00:00', endTime: '23:59' };
          const empStartM = timeToMinutes(wh.startTime || '00:00');
          const empEndM = timeToMinutes(wh.endTime || '23:59');
          // Slot must start at or after employee start AND end at or before employee end
          if (m < empStartM || slotEndM > empEndM) continue;

          // Check if employee has a conflicting booking
          const hasConflict = existingBookings.some(b => {
            // Only check bookings assigned to this employee OR unassigned bookings
            if (b.assigned_employee_id && b.assigned_employee_id !== emp.id) return false;
            const bStart = b.start_time.slice(0, 5);
            const bEndM = timeToMinutes(b.end_time.slice(0, 5)) + (b.booking_buffer || 0);
            const bBlockEnd = minutesToTime(bEndM);
            return slotStart < bBlockEnd && slotBlockEnd > bStart;
          });
          if (!hasConflict) availableCount++;
        }

        if (availableCount > 0) {
          const h12 = ((Math.floor(m / 60) % 12) || 12);
          const ampm = Math.floor(m / 60) < 12 ? 'AM' : 'PM';
          slots.push({ time: slotStart, endTime: slotEnd, displayTime: `${h12}:${mm} ${ampm}`, available: availableCount });
        }
      }
    }

    // Filter out past time slots when booking date is today (business-local timezone)
    try {
      const bizLocResult = await pool.query(
        'SELECT state, zip_code FROM business_information WHERE user_id = $1',
        [businessId]
      );
      const { state, zip_code } = bizLocResult.rows[0] || {};
      const bizTz = getTimezoneForBusiness(state, zip_code);
      const now = new Date();
      const bizToday = now.toLocaleDateString('en-CA', { timeZone: bizTz }); // YYYY-MM-DD

      if (date === bizToday) {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: bizTz, hour: 'numeric', minute: 'numeric', hour12: false
        }).formatToParts(now);
        const nowH = parseInt(parts.find(p => p.type === 'hour').value);
        const nowM = parseInt(parts.find(p => p.type === 'minute').value);
        const cutoff = nowH * 60 + nowM + 30; // 30-min booking lead time
        slots.splice(0, slots.length, ...slots.filter(s => {
          const [sh, sm] = s.time.split(':').map(Number);
          return (sh * 60 + sm) >= cutoff;
        }));
      }
    } catch (e) {
      // Non-critical — skip filter on error rather than breaking availability
      console.warn('Past-slot filter error:', e.message);
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
      businessId, serviceId, variantId, additionalServiceIds = [],
      bookingDate, startTime, customerInfo, customerNotes,
      assignmentType, employeeId, groupId, paymentMode, cardToken
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

    // Resolve variant price/duration for the main service
    let variantRow = null;
    if (variantId) {
      const vRes = await pool.query('SELECT * FROM service_variants WHERE id = $1', [Number(variantId)]);
      if (vRes.rows.length > 0) variantRow = vRes.rows[0];
    }

    const totalPrice = servicesResult.rows.reduce((sum, s) => {
      if (s.id === Number(serviceId) && variantRow) return sum + parseFloat(variantRow.price || 0);
      return sum + parseFloat(s.price || 0);
    }, 0);

    // Apply sales tax from user's default rate
    const bizTaxResult = await pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [businessId]);
    const bizTaxRate = parseFloat(bizTaxResult.rows[0]?.default_tax_rate || 0);
    const bizTaxAmount = Math.round(totalPrice * bizTaxRate * 100) / 100;
    const totalWithTax = totalPrice + bizTaxAmount;
    const totalDurationMinutes = servicesResult.rows.reduce((sum, s) => {
      if (s.id === Number(serviceId) && variantRow && variantRow.duration_hours) {
        return sum + Math.round(parseFloat(variantRow.duration_hours) * 60);
      }
      return sum + Math.round((s.duration_hours || 1) * 60);
    }, 0);

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

    // Inline card-on-file: save card BEFORE creating the booking so we can fail cleanly
    const isCardOnFile = paymentMode === 'card_on_file';
    let cofSavedCard = null;
    if (isCardOnFile && cardToken) {
      try {
        const pcResult = await pool.query(
          "SELECT processor, stripe_account_id, square_location_id, clover_merchant_id, clover_access_token FROM payment_connections WHERE user_id=$1 AND is_active=true ORDER BY is_primary DESC LIMIT 1",
          [businessId]
        );
        const pc = pcResult.rows[0];
        if (!pc) throw new Error('No payment processor connected');

        if (pc.processor === 'square') {
          const { client: sqClient } = await getSquareClient(businessId);
          const sqCustId = await findOrCreateSquareCustomer(sqClient, customerInfo);
          const { cardId, cardBrand, lastFour } = await saveCardOnFile(sqClient, { sourceId: cardToken, squareCustomerId: sqCustId });
          cofSavedCard = { processor: 'square', processorCustomerId: sqCustId, processorCardId: cardId, cardBrand, lastFour };

        } else if (pc.processor === 'stripe') {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const custQ = await pool.query('SELECT stripe_customer_id FROM customers WHERE id=$1', [customerId]);
          let stripeCustId = custQ.rows[0]?.stripe_customer_id;
          if (!stripeCustId) {
            const sc = await stripe.customers.create(
              { email: customerInfo.email, name: customerInfo.name },
              { stripeAccount: pc.stripe_account_id }
            );
            stripeCustId = sc.id;
          }
          await stripe.paymentMethods.attach(cardToken, { customer: stripeCustId }, { stripeAccount: pc.stripe_account_id });
          await stripe.customers.update(stripeCustId, { invoice_settings: { default_payment_method: cardToken } }, { stripeAccount: pc.stripe_account_id });
          cofSavedCard = { processor: 'stripe', processorCustomerId: stripeCustId, processorCardId: cardToken, cardBrand: null, lastFour: null };

        } else if (pc.processor === 'clover') {
          const cloverBase = process.env.CLOVER_ENVIRONMENT === 'production' ? 'https://api.clover.com' : 'https://sandbox.dev.clover.com';
          const custQ = await pool.query('SELECT clover_customer_id FROM customers WHERE id=$1', [customerId]);
          let cloverCustId = custQ.rows[0]?.clover_customer_id;
          if (!cloverCustId) {
            const nameParts = (customerInfo.name || '').trim().split(/\s+/);
            const cres = await fetch(`${cloverBase}/v3/merchants/${pc.clover_merchant_id}/customers`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${pc.clover_access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' ') || '', emailAddresses: customerInfo.email ? [{ emailAddress: customerInfo.email }] : [] })
            });
            const cdata = await cres.json();
            cloverCustId = cdata.id;
          }
          const kres = await fetch(`${cloverBase}/v3/merchants/${pc.clover_merchant_id}/customers/${cloverCustId}/cards`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${pc.clover_access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: cardToken })
          });
          const kdata = await kres.json();
          cofSavedCard = { processor: 'clover', processorCustomerId: cloverCustId, processorCardId: kdata.id, cardBrand: kdata.cardType || null, lastFour: kdata.last4 || null };
        }
      } catch (cardErr) {
        console.error('Inline card save error:', cardErr.message);
        return res.status(400).json({ error: 'Could not save card: ' + (cardErr.message || 'Card declined') });
      }
    }

    // Global capacity check: prevent overbooking regardless of employee assignment
    // Handles race conditions and unassigned-employee bookings consuming capacity slots
    try {
      const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM bookings
         WHERE user_id = $1 AND booking_date = $2 AND status != 'cancelled'
         AND start_time < $3 AND end_time > $4`,
        [businessId, bookingDate, endTime, startTime]
      );
      const existingCount = parseInt(countResult.rows[0].cnt);
      const eligibleCountResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM employees e
         WHERE e.user_id = $1 AND e.active = true
         AND (
           NOT EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id)
           OR EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id AND service_id = $2)
         )`,
        [businessId, Number(serviceId)]
      );
      const eligibleCount = parseInt(eligibleCountResult.rows[0].cnt) || 0;
      const slotCapacity = Math.max(eligibleCount, 1);
      if (existingCount >= slotCapacity) {
        return res.status(409).json({ error: 'This time slot is no longer available. Please choose a different time.' });
      }
    } catch (e) { /* employees table may not exist — skip check */ }

    // Auto-assign a free employee who can perform the service
    // Priority: employees with specific service assignment > unassigned (can-do-all) employees
    let assignedEmployeeId = assignmentType === 'employee' ? employeeId : null;
    if (!assignedEmployeeId) {
      try {
        // Get all active employees who can do this service (same logic as availability)
        const eligibleResult = await pool.query(
          `SELECT e.id FROM employees e
           WHERE e.user_id = $1 AND e.active = true
           AND (
             NOT EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id)
             OR EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id AND service_id = $2)
           )
           ORDER BY
             EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id AND service_id = $2) DESC,
             e.id ASC`,
          [businessId, Number(serviceId)]
        );
        // Find first employee with no conflict at this time slot
        const endM = timeToMinutes(endTime);
        for (const row of eligibleResult.rows) {
          const conflict = await pool.query(
            `SELECT 1 FROM bookings
             WHERE user_id = $1 AND employee_id = $2 AND booking_date = $3 AND status != 'cancelled'
             AND start_time < $4 AND end_time > $5
             LIMIT 1`,
            [businessId, row.id, bookingDate, endTime, startTime]
          );
          if (conflict.rows.length === 0) {
            assignedEmployeeId = row.id;
            break;
          }
        }
      } catch (e) { /* employees table may not exist — leave unassigned */ }
    }

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO bookings (user_id, customer_id, booking_number, booking_date, start_time, end_time,
        customer_name, customer_email, customer_phone, customer_notes,
        employee_id, subtotal, total_amount, tax_rate, tax_amount, status, card_on_file_status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'website')
       RETURNING id, booking_number`,
      [
        businessId, customerId, bookingNumber, bookingDate, startTime, endTime,
        customerInfo.name, customerInfo.email, customerInfo.phone || '',
        customerNotes || '',
        assignedEmployeeId,
        totalPrice, totalWithTax, bizTaxRate, bizTaxAmount,
        (isCardOnFile && !cofSavedCard) ? 'pending' : 'confirmed',
        cofSavedCard ? 'saved' : (isCardOnFile ? 'pending' : null),
      ]
    );

    // Create booking items for each service
    for (const service of servicesResult.rows) {
      const isMain = service.id === Number(serviceId);
      const svcPrice = isMain && variantRow ? parseFloat(variantRow.price || 0) : parseFloat(service.price || 0);
      const svcDuration = isMain && variantRow && variantRow.duration_hours
        ? parseFloat(variantRow.duration_hours)
        : (service.duration_hours || 1);
      const vId = isMain && variantRow ? variantRow.id : null;
      const vName = isMain && variantRow ? variantRow.name : null;
      await pool.query(
        'INSERT INTO booking_items (booking_id, service_id, service_name, service_price, service_duration, quantity, subtotal, variant_id, variant_name) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)',
        [bookingResult.rows[0].id, service.id, service.name, svcPrice, svcDuration, svcPrice, vId, vName]
      );
    }

    // Card on file: update customer record and send emails (inline), or email link (fallback)
    if (isCardOnFile) {
      if (cofSavedCard) {
        // Inline save succeeded — update customer card details
        if (cofSavedCard.processor === 'square') {
          await pool.query(
            `UPDATE customers SET square_customer_id=$1, square_card_id=$2, card_processor='square', card_brand=$3, card_last_four=$4 WHERE id=$5`,
            [cofSavedCard.processorCustomerId, cofSavedCard.processorCardId, cofSavedCard.cardBrand, cofSavedCard.lastFour, customerId]
          );
        } else if (cofSavedCard.processor === 'stripe') {
          await pool.query(
            `UPDATE customers SET stripe_customer_id=$1, stripe_payment_method_id=$2, card_processor='stripe' WHERE id=$3`,
            [cofSavedCard.processorCustomerId, cofSavedCard.processorCardId, customerId]
          );
        } else if (cofSavedCard.processor === 'clover') {
          await pool.query(
            `UPDATE customers SET clover_customer_id=$1, clover_card_id=$2, card_processor='clover', card_brand=$3, card_last_four=$4 WHERE id=$5`,
            [cofSavedCard.processorCustomerId, cofSavedCard.processorCardId, cofSavedCard.cardBrand, cofSavedCard.lastFour, customerId]
          );
        }
        // Notify owner that card was saved inline
        if (process.env.SENDGRID_API_KEY) {
          const sgMail = require('@sendgrid/mail');
          sgMail.setApiKey(process.env.SENDGRID_API_KEY);
          const ownerResult = await pool.query('SELECT business_name, email FROM users WHERE id=$1', [businessId]);
          const owner = ownerResult.rows[0] || {};
          if (owner.email) {
            const dateStr = new Date(bookingDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            const [hh, mm] = startTime.split(':').map(Number);
            const timeStr = `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
            sgMail.send({
              to: owner.email,
              from: { name: 'SORCE Notifications', email: 'noreply@sorceintegrations.com' },
              subject: `Card saved on file — ${customerInfo.name} is confirmed`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
                <div style="background:#059669;padding:1.5rem 2rem;border-radius:8px 8px 0 0;">
                  <h2 style="color:#fff;margin:0;font-size:1.25rem;">&#10003; Card on File Saved</h2>
                </div>
                <div style="padding:1.5rem 2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                  <p style="margin-top:0;"><strong>${customerInfo.name}</strong> saved a card on file during booking and their appointment is now confirmed.</p>
                  <p><strong>Booking #${bookingNumber}</strong> — ${dateStr} at ${timeStr}</p>
                </div>
              </div>`,
            }).catch(e => console.error('Owner card saved notification error:', e.message));
          }
        }
      } else if (customerInfo.email) {
        // Fallback: no inline token — send email link
        const tokenResult = await pool.query(
          `INSERT INTO card_on_file_tokens (booking_id, user_id, customer_email, customer_name)
           VALUES ($1, $2, $3, $4) RETURNING token`,
          [bookingResult.rows[0].id, businessId, customerInfo.email, customerInfo.name]
        );
        const cofLinkToken = tokenResult.rows[0].token;
        const frontendUrl = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
        const cardLink = `${frontendUrl}/card-on-file/${cofLinkToken}`;

        if (process.env.SENDGRID_API_KEY) {
          const sgMail = require('@sendgrid/mail');
          sgMail.setApiKey(process.env.SENDGRID_API_KEY);
          const ownerResult = await pool.query('SELECT business_name, email FROM users WHERE id=$1', [businessId]);
          const owner = ownerResult.rows[0] || {};
          const dateStr = new Date(bookingDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          const [hh, mm] = startTime.split(':').map(Number);
          const timeStr = `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
          sgMail.send({
            to: customerInfo.email,
            from: { name: owner.business_name || 'Your Service Provider', email: 'noreply@sorceintegrations.com' },
            replyTo: owner.email ? { email: owner.email } : undefined,
            subject: `One last step to confirm your appointment — ${owner.business_name || 'Us'}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
              <div style="background:#1d4ed8;padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
                <h1 style="color:#fff;margin:0;font-size:1.5rem;">Almost Confirmed!</h1>
              </div>
              <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                <p style="font-size:1rem;margin-top:0;">Hi ${customerInfo.name},</p>
                <p>Your appointment with <strong>${owner.business_name || 'us'}</strong> on ${dateStr} at ${timeStr} is almost confirmed!</p>
                <p>We just need a card on file to complete your booking. <strong>We will not charge your card</strong> — it is only kept on file per our cancellation policy.</p>
                <div style="text-align:center;margin:2rem 0;">
                  <a href="${cardLink}" style="background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:1rem;font-weight:600;">Securely Save Card on File</a>
                </div>
                <p style="color:#6b7280;font-size:0.85rem;">This link expires in 48 hours.</p>
              </div>
            </div>`,
          }).catch(e => console.error('Card on file email error:', e.message));
          if (owner.email) {
            sgMail.send({
              to: owner.email,
              from: { name: 'SORCE Notifications', email: 'noreply@sorceintegrations.com' },
              subject: `Card on file link sent to ${customerInfo.name}`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
                <div style="background:#d97706;padding:1.5rem 2rem;border-radius:8px 8px 0 0;">
                  <h2 style="color:#fff;margin:0;font-size:1.25rem;">Card on File Link Sent</h2>
                </div>
                <div style="padding:1.5rem 2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                  <p style="margin-top:0;">A secure card-on-file link was sent to <strong>${customerInfo.name}</strong> (${customerInfo.email}) for their ${dateStr} at ${timeStr} appointment.</p>
                  <p style="color:#6b7280;font-size:0.9rem;">Booking #${bookingNumber} will be confirmed once they save their card. The link expires in 48 hours.</p>
                </div>
              </div>`,
            }).catch(e => console.error('Owner card link notification error:', e.message));
          }
        }
      }
    }

    // Also create a lead record
    await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, service, source, status, sms_consent)
       VALUES ($1, $2, $3, $4, $5, 'website', 'booked', true)
       ON CONFLICT DO NOTHING`,
      [businessId, customerInfo.name, customerInfo.email, customerInfo.phone || '', servicesResult.rows[0].name]
    );

    console.log(`📅 Public booking created: ${bookingNumber} for user ${businessId}`);

    // Send booking confirmation emails (non-blocking) — skip for card_on_file email-link (not yet confirmed)
    if (!isCardOnFile || cofSavedCard) {
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
    }

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

// ── Card on file (Square) ─────────────────────────────────────────────────────

// GET /api/public/card-on-file/:token
// Returns page data needed to render the card form
router.get('/card-on-file/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const result = await pool.query(
      `SELECT t.*, b.booking_number, b.booking_date, b.start_time, b.card_on_file_status,
              bi.service_name, u.business_name
       FROM card_on_file_tokens t
       JOIN bookings b ON b.id = t.booking_id
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.token = $1 AND t.expires_at > NOW()
       LIMIT 1`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'This link has expired or is invalid.' });
    }
    const row = result.rows[0];
    if (row.used_at) {
      return res.status(410).json({ error: 'Card already saved — you are all set!' });
    }
    if (row.card_on_file_status === 'saved') {
      return res.status(410).json({ error: 'Card already saved — you are all set!' });
    }
    res.json({
      squareAppId: process.env.SQUARE_APPLICATION_ID,
      squareEnvironment: process.env.SQUARE_ENVIRONMENT || 'production',
      businessName: row.business_name,
      customerName: row.customer_name,
      serviceName: row.service_name,
      bookingDate: row.booking_date,
      bookingNumber: row.booking_number,
    });
  } catch (err) {
    console.error('Card on file token lookup error:', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/public/card-on-file/:token/save
// Called by the frontend after Square SDK tokenizes the card
router.post('/card-on-file/:token/save', async (req, res) => {
  try {
    const { token } = req.params;
    const { sourceId } = req.body;
    if (!sourceId) return res.status(400).json({ error: 'sourceId required' });

    const result = await pool.query(
      `SELECT t.*, b.customer_id, b.customer_name, b.customer_email, b.customer_phone
       FROM card_on_file_tokens t
       JOIN bookings b ON b.id = t.booking_id
       WHERE t.token = $1 AND t.expires_at > NOW() AND t.used_at IS NULL`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'This link has expired or already been used.' });
    }
    const row = result.rows[0];

    // Get Square client for this business
    const { client, locationId } = await getSquareClient(row.user_id);

    // Find or create Square Customer
    const squareCustomerId = await findOrCreateSquareCustomer(client, {
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
    });

    // Save the card
    const { cardId, cardBrand, lastFour } = await saveCardOnFile(client, {
      sourceId,
      squareCustomerId,
      locationId,
    });

    // Persist to DB
    if (row.customer_id) {
      await pool.query(
        `UPDATE customers SET square_customer_id = $1, square_card_id = $2,
         square_card_brand = $3, square_card_last_four = $4, updated_at = NOW()
         WHERE id = $5`,
        [squareCustomerId, cardId, cardBrand, lastFour, row.customer_id]
      );
    }

    await pool.query(
      `UPDATE bookings SET card_on_file_status = 'saved', status = 'confirmed', updated_at = NOW()
       WHERE id = $1`,
      [row.booking_id]
    );

    await pool.query(
      `UPDATE card_on_file_tokens SET used_at = NOW() WHERE token = $1`,
      [token]
    );

    // Notify business owner that the customer saved their card (non-blocking)
    if (process.env.SENDGRID_API_KEY) {
      pool.query('SELECT email, business_name FROM users WHERE id = $1', [row.user_id]).then(ownerRes => {
        const owner = ownerRes.rows[0];
        if (!owner || !owner.email) return;
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        const dateStr = row.booking_date
          ? new Date(row.booking_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          : '';
        sgMail.send({
          to: owner.email,
          from: { name: 'SORCE Notifications', email: 'noreply@sorceintegrations.com' },
          subject: `Card saved — ${row.customer_name}'s booking is confirmed`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
              <div style="background:#16a34a;padding:1.5rem 2rem;border-radius:8px 8px 0 0;">
                <h2 style="color:#fff;margin:0;font-size:1.25rem;">Card on File Saved ✓</h2>
              </div>
              <div style="padding:1.5rem 2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                <p style="margin-top:0;"><strong>${row.customer_name}</strong> has saved a ${cardBrand} card ending in ${lastFour} for their booking${dateStr ? ` on ${dateStr}` : ''}.</p>
                <p style="color:#16a34a;font-weight:600;">Their booking (#${row.booking_number}) is now confirmed.</p>
                <p style="color:#6b7280;font-size:0.9rem;">You can view the booking details in your SORCE dashboard.</p>
              </div>
            </div>`,
        }).catch(e => console.error('Owner card saved notification error:', e.message));
      }).catch(() => {});
    }

    console.log(`✅ Card on file saved for booking ${row.booking_id}: ${cardBrand} ****${lastFour}`);
    res.json({ success: true, cardBrand, lastFour });
  } catch (err) {
    console.error('Card on file save error:', err.message);
    res.status(500).json({ error: 'Failed to save card. Please try again.' });
  }
});

module.exports = router;
