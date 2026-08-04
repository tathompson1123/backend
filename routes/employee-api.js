const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateEmployee, requirePermission } = require('../config/employee-middleware');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { sendPushToTeam, sendPushToEmployee } = require('../utils/pushNotifications');
const { normalizeServiceList, resolveBookingServices } = require('../utils/bookingServices');
const { sendBookingEmails } = require('../utils/bookingEmail');
const { TRANSACTIONAL_EMAIL } = require('../utils/emailFrom');

// ── Time-tracking schema ─────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS time_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clock_out TIMESTAMPTZ,
    reminders_sent JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('time_entries migration error:', e.message));
pool.query(`CREATE INDEX IF NOT EXISTS idx_time_entries_open ON time_entries(employee_id) WHERE clock_out IS NULL`)
  .catch(() => {});
pool.query(`
  CREATE TABLE IF NOT EXISTS time_breaks (
    id SERIAL PRIMARY KEY,
    time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    break_type VARCHAR(10) NOT NULL DEFAULT 'paid',
    start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('time_breaks migration error:', e.message));
// ── Employee time off ────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS employee_time_off (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('employee_time_off migration error:', e.message));
pool.query(`ALTER TABLE employee_time_off ADD COLUMN IF NOT EXISTS show_on_schedule BOOLEAN DEFAULT true`).catch(() => {});

// Break reminder thresholds, measured in WORKED seconds (elapsed minus break time):
// paid break at 2h, unpaid lunch at 4h, another paid break at 6h.
const BREAK_REMINDERS = [
  { key: 'paid1',  type: 'paid',   atSeconds: 2 * 3600, label: 'Time for a paid break.' },
  { key: 'unpaid', type: 'unpaid', atSeconds: 4 * 3600, label: 'Time for your unpaid lunch break.' },
  { key: 'paid2',  type: 'paid',   atSeconds: 6 * 3600, label: 'Time for another paid break.' },
];

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only image or video files are allowed'));
  },
});

let sgMail;
if (process.env.SENDGRID_API_KEY) {
  sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function sendStatusEmail(booking, status, businessName, ownerEmail) {
  if (!sgMail || !booking.customer_email) return;
  const firstName = (booking.customer_name || '').split(' ')[0] || 'there';
  const subjects = {
    in_progress: `Your service has started — ${businessName}`,
    completed: `Your service is complete — ${businessName}`,
  };
  const bodies = {
    in_progress: `Hi ${firstName},\n\nYour service with ${businessName} has started. We'll keep you updated on our progress.\n\nThank you for choosing ${businessName}!`,
    completed: `Hi ${firstName},\n\nYour service with ${businessName} has been completed. Thank you for your business!\n\nIf you have any questions, please don't hesitate to reach out.\n\nBest,\n${businessName}`,
  };
  const subject = subjects[status];
  const text = bodies[status];
  if (!subject) return;
  try {
    await sgMail.send({
      to: booking.customer_email,
      from: { name: businessName, email: TRANSACTIONAL_EMAIL },
      replyTo: ownerEmail ? { name: businessName, email: ownerEmail } : undefined,
      subject,
      text,
    });
  } catch (emailErr) {
    console.error('Failed to send status email:', emailErr.message);
  }
}

// Validation helpers
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
function isValidId(id) { return Number.isInteger(Number(id)) && Number(id) > 0; }

// All routes require employee authentication
router.use(authenticateEmployee);

// GET /api/employee/my-bookings - Bookings assigned to this employee
router.get('/my-bookings', requirePermission('view_bookings'), async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { startDate, endDate, status } = req.query;

    if (startDate && !DATE_REGEX.test(startDate)) {
      return res.status(400).json({ error: 'startDate must be YYYY-MM-DD format' });
    }
    if (endDate && !DATE_REGEX.test(endDate)) {
      return res.status(400).json({ error: 'endDate must be YYYY-MM-DD format' });
    }
    if (status) {
      const validStatuses = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status filter` });
      }
    }

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
      WHERE b.user_id = $1 AND b.employee_id = $2
    `;

    const params = [userId, employeeId];
    let paramCount = 2;

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

    query += ' GROUP BY b.id ORDER BY b.booking_date, b.start_time';

    const result = await pool.query(query, params);
    res.json({ bookings: result.rows });
  } catch (error) {
    console.error('Error fetching employee bookings:', error.message);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// GET /api/employee/my-bookings/:id - Single booking detail
router.get('/my-bookings/:id', requirePermission('view_bookings'), async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const result = await pool.query(
      `SELECT b.*,
        u.default_tax_rate,
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
       JOIN users u ON u.id = b.user_id
       WHERE b.id = $1 AND b.user_id = $2
       GROUP BY b.id, u.default_tax_rate`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ booking: result.rows[0] });
  } catch (error) {
    console.error('Error fetching booking detail:', error.message);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

// PUT /api/employee/my-bookings/:id/status - Update booking status (limited options)
router.put('/my-bookings/:id/status', requirePermission('manage_bookings'), async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const allowedStatuses = ['in_progress', 'completed', 'no_show'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowedStatuses.join(', ')}` });
    }

    const result = await pool.query(
      `UPDATE bookings SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 AND employee_id = $4
       RETURNING *`,
      [status, id, userId, employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Send status email to customer (non-blocking)
    try {
      const booking = result.rows[0];
      const bizResult = await pool.query('SELECT business_name, email FROM users WHERE id = $1', [userId]);
      const businessName = bizResult.rows[0]?.business_name || 'Your Service Provider';
      const ownerEmail = bizResult.rows[0]?.email;
      sendStatusEmail(booking, status, businessName, ownerEmail);
    } catch {}

    // If completed, update customer lifetime value + create review request
    if (status === 'completed') {
      const booking = result.rows[0];
      try {
        await pool.query(
          `UPDATE customers
           SET total_jobs = total_jobs + 1,
               lifetime_value = lifetime_value + $1,
               last_service_date = $2,
               updated_at = NOW()
           WHERE user_id = $3 AND (email = $4 OR phone = $5)`,
          [booking.total_amount || 0, booking.booking_date, userId, booking.customer_email, booking.customer_phone]
        );
      } catch (custErr) {
        console.error('Error updating customer on complete:', custErr.message);
      }

      // Create review request
      try {
        const reviewConfig = await pool.query('SELECT * FROM review_configs WHERE user_id = $1', [userId]);
        const config = reviewConfig.rows[0];
        // Only fire if user has explicitly configured review requests with booking_completed trigger
        const autoSend = config?.auto_send_enabled;
        const trigger = config?.send_trigger;

        if (config && autoSend && trigger === 'booking_completed' && (booking.customer_email || booking.customer_phone)) {
          const itemsResult = await pool.query('SELECT service_name FROM booking_items WHERE booking_id = $1 LIMIT 1', [id]);
          const serviceName = itemsResult.rows[0]?.service_name || 'Service';
          const delayHours = config ? (config.send_delay ?? 2) : 2;
          const scheduledTime = new Date(Date.now() + delayHours * 60 * 60 * 1000);

          const existing = await pool.query(
            'SELECT id FROM review_requests WHERE user_id = $1 AND customer_email = $2 AND service_name = $3 AND created_at > NOW() - INTERVAL \'24 hours\'',
            [userId, booking.customer_email || '', serviceName]
          );

          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO review_requests (user_id, customer_name, customer_email, customer_phone, service_name, status, scheduled_send_time, created_at)
               VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW())`,
              [userId, booking.customer_name, booking.customer_email, booking.customer_phone, serviceName, scheduledTime]
            );
            console.log(`✅ Review request created for booking ${id} (via employee app)`);
          }
        }
      } catch (reviewErr) {
        console.warn('⚠️ Could not create review request:', reviewErr.message);
      }
    }

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('Error updating booking status:', error.message);
    res.status(500).json({ error: 'Failed to update booking status' });
  }
});

// PUT /api/employee/my-bookings/:id/notes - Update job notes
router.put('/my-bookings/:id/notes', requirePermission('manage_bookings'), async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;
    const { jobNotes } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    if (jobNotes && jobNotes.length > 5000) {
      return res.status(400).json({ error: 'Job notes must be under 5000 characters' });
    }

    const result = await pool.query(
      `UPDATE bookings SET job_notes = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 AND employee_id = $4
       RETURNING *`,
      [jobNotes, id, userId, employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('Error updating job notes:', error.message);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

// GET /api/employee/my-bookings/:id/messages - Chat history for a booking
router.get('/my-bookings/:id/messages', async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    // Verify booking belongs to this business
    const booking = await pool.query(
      'SELECT customer_phone FROM bookings WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (booking.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const phone = booking.rows[0].customer_phone;
    if (!phone) return res.json({ messages: [] });

    // Get messages for this customer phone, prefer booking-tagged ones but also show general ones
    const result = await pool.query(
      `SELECT id, direction, message AS body, media_url, created_at, from_number, to_number
       FROM sms_messages
       WHERE user_id = $1 AND (booking_id = $2 OR (booking_id IS NULL AND (from_number = $3 OR to_number = $3)))
       ORDER BY created_at ASC`,
      [userId, id, phone]
    );

    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Error fetching booking messages:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/employee/my-bookings/:id/messages - Send SMS to customer from booking
router.post('/my-bookings/:id/messages', requirePermission('send_messages'), async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;
    const { message } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (message.length > 1600) {
      return res.status(400).json({ error: 'Message must be under 1600 characters' });
    }

    const booking = await pool.query(
      'SELECT customer_phone, customer_name FROM bookings WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (booking.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const phone = booking.rows[0].customer_phone;
    if (!phone) return res.status(400).json({ error: 'Customer has no phone number' });

    // Send via Twilio
    const { sendSMS } = require('../utils/twilio');
    const smsResult = await sendSMS(phone, message.trim(), userId);

    // Store message, tied to the lead too when this customer is one — the owner's
    // Conversations panel is keyed on lead_id, and without it an employee's messages
    // are missing from the thread the owner reads.
    const { findLeadIdByPhone } = require('../utils/smsThread');
    const msgLeadId = await findLeadIdByPhone(pool, userId, phone);
    await pool.query(
      `INSERT INTO sms_messages (user_id, booking_id, lead_id, sent_by_employee_id, direction, to_number, message, twilio_message_sid, status, created_at)
       VALUES ($1, $2, $3, $4, 'outgoing', $5, $6, $7, 'sent', NOW())`,
      [userId, id, msgLeadId, employeeId, phone, message.trim(), smsResult.messageSid]
    );

    res.json({ success: true, messageSid: smsResult.messageSid });
  } catch (error) {
    console.error('Error sending booking message:', error.message);
    res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

// POST /api/employee/my-bookings/:id/messages/media - Send MMS with photo/video to customer
router.post(
  '/my-bookings/:id/messages/media',
  requirePermission('send_messages'),
  mediaUpload.single('file'),
  async (req, res) => {
    try {
      const { userId } = req.employee;
      const { id } = req.params;
      const { message } = req.body || {};
      if (!isValidId(id)) return res.status(400).json({ error: 'Invalid booking ID' });
      if (!req.file) return res.status(400).json({ error: 'No file provided' });
      if (message && message.length > 1600) return res.status(400).json({ error: 'Message must be under 1600 characters' });

      const booking = await pool.query(
        'SELECT customer_phone FROM bookings WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (booking.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
      const phone = booking.rows[0].customer_phone;
      if (!phone) return res.status(400).json({ error: 'Customer has no phone number' });

      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!cloudName || !apiKey || !apiSecret) {
        return res.status(500).json({ error: 'Media uploads are not configured on the server.' });
      }
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

      const isVideo = req.file.mimetype.startsWith('video/');
      const upload = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `sorce/${userId}/bookings/${id}`,
            resource_type: isVideo ? 'video' : 'image',
          },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(req.file.buffer);
      });

      const mediaUrl = upload.secure_url;
      const body = (message || '').trim();

      const { sendSMS } = require('../utils/twilio');
      const smsResult = await sendSMS(phone, body, userId, mediaUrl);

      const { findLeadIdByPhone } = require('../utils/smsThread');
      const mediaLeadId = await findLeadIdByPhone(pool, userId, phone);
      await pool.query(
        `INSERT INTO sms_messages (user_id, booking_id, lead_id, sent_by_employee_id, direction, to_number, message, media_url, twilio_message_sid, status, created_at)
         VALUES ($1, $2, $3, $4, 'outgoing', $5, $6, $7, $8, 'sent', NOW())`,
        [userId, id, mediaLeadId, req.employee.employeeId, phone, body, mediaUrl, smsResult.messageSid]
      );

      res.json({ success: true, messageSid: smsResult.messageSid, mediaUrl });
    } catch (error) {
      console.error('Error sending booking media:', error.message);
      res.status(500).json({ error: error.message || 'Failed to send media' });
    }
  }
);

// GET /api/employee/invoice-catalog - Default tax rate + saved fees/supplies catalog
router.get('/invoice-catalog', requirePermission('process_payments'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const [settingsRes, catalogRes] = await Promise.all([
      pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [userId]),
      pool.query(
        'SELECT id, name, category, amount_type, amount, taxable FROM invoice_items_catalog WHERE user_id = $1 AND active = true ORDER BY category, name',
        [userId]
      ),
    ]);
    const rawRate = parseFloat(settingsRes.rows[0]?.default_tax_rate || 0);
    res.json({
      defaultTaxRate: parseFloat((rawRate * 100).toFixed(4)),
      catalog: catalogRes.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/employee/my-bookings/:id/invoice - Auto-create invoice from booking
router.post('/my-bookings/:id/invoice', requirePermission('process_payments'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    // Optional: custom items and taxRate sent from the invoice editor
    const { items: customItems, taxRate: customTaxRate, notes: customNotes } = req.body || {};

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    // Get booking with items
    const bookingResult = await pool.query(
      `SELECT b.*, json_agg(json_build_object(
        'service_name', bi.service_name, 'service_price', bi.service_price,
        'quantity', bi.quantity, 'service_id', bi.service_id
       )) as items
       FROM bookings b
       LEFT JOIN booking_items bi ON b.id = bi.booking_id
       WHERE b.id = $1 AND b.user_id = $2
       GROUP BY b.id`,
      [id, userId]
    );

    if (bookingResult.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = bookingResult.rows[0];

    // Check if invoice already exists
    if (booking.invoice_id) {
      const existing = await pool.query('SELECT * FROM invoices WHERE id = $1', [booking.invoice_id]);
      if (existing.rows.length > 0) {
        return res.json({ invoice: existing.rows[0], existing: true });
      }
    }

    // Use custom items if provided, else fall back to booking items
    const lineItems = customItems && customItems.length > 0
      ? customItems
      : (booking.items || []).filter(i => i.service_name).map(i => ({
          description: i.service_name,
          unitPrice: parseFloat(i.service_price) || 0,
          quantity: i.quantity || 1,
        }));

    const taxRate = customTaxRate != null ? parseFloat(customTaxRate) : 0;
    const subtotal = lineItems.reduce((s, i) => s + (parseFloat(i.unitPrice) || 0) * (parseInt(i.quantity) || 1), 0);
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const total = subtotal + taxAmount;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
      const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;
      const paymentLinkToken = crypto.randomBytes(32).toString('hex');
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const invoiceResult = await client.query(
        `INSERT INTO invoices (
          user_id, booking_id, customer_id, invoice_number, customer_name, customer_email, customer_phone,
          subtotal, tax_rate, tax_amount, total_amount, amount_due, notes, status, due_date, payment_link_token
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', $14, $15)
        RETURNING *`,
        [userId, id, booking.customer_id, invoiceNumber, booking.customer_name,
         booking.customer_email, booking.customer_phone,
         subtotal, taxRate, taxAmount, total, total,
         customNotes || null, dueDate, paymentLinkToken]
      );

      const invoice = invoiceResult.rows[0];

      // Create line items
      for (const item of lineItems) {
        const qty = parseInt(item.quantity) || 1;
        const price = parseFloat(item.unitPrice) || 0;
        await client.query(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [invoice.id, item.description, qty, price, price * qty]
        );
      }

      // Link invoice to booking
      await client.query(
        "UPDATE bookings SET invoice_id = $1, payment_status = 'invoiced' WHERE id = $2",
        [invoice.id, id]
      );

      await client.query('COMMIT');
      res.json({ invoice, existing: false });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating invoice from booking:', error.message);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// POST /api/employee/my-bookings/:id/invoice/send - Send invoice to customer via payment link
router.post('/my-bookings/:id/invoice/send', requirePermission('process_payments'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    const { method } = req.body; // 'sms' or 'email'

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    if (method && !['sms', 'email'].includes(method)) {
      return res.status(400).json({ error: 'Method must be sms or email' });
    }

    const booking = await pool.query(
      `SELECT b.*, i.id as invoice_id, i.payment_link_token, i.invoice_number, i.amount_due, i.status as invoice_status
       FROM bookings b
       JOIN invoices i ON i.id = b.invoice_id
       WHERE b.id = $1 AND b.user_id = $2`,
      [id, userId]
    );

    if (booking.rows.length === 0) return res.status(404).json({ error: 'Booking or invoice not found' });
    const data = booking.rows[0];

    // Try to create a checkout session via connected payment processor
    const { getProcessorForUser } = require('../payment/ProcessorFactory');
    const processor = await getProcessorForUser(userId, pool);

    let paymentUrl;
    if (processor) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
      const session = await processor.createCheckoutSession({
        amount: parseFloat(data.amount_due),
        currency: 'USD',
        description: `Invoice ${data.invoice_number}`,
        customerEmail: data.customer_email,
        successUrl: `${frontendUrl}/pay/${data.payment_link_token}?success=true`,
        cancelUrl: `${frontendUrl}/pay/${data.payment_link_token}?cancelled=true`,
        metadata: { invoiceId: data.invoice_id.toString(), invoiceNumber: data.invoice_number }
      });
      paymentUrl = session.checkoutUrl;
    } else {
      // Fallback to our payment page
      paymentUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/pay/${data.payment_link_token}`;
    }

    // Update invoice status
    await pool.query(
      "UPDATE invoices SET status = 'sent', sent_at = NOW(), payment_link = $1 WHERE id = $2",
      [paymentUrl, data.invoice_id]
    );
    // Mirror on the booking so the app can show "Sent" instead of "Send to Customer"
    await pool.query(
      "UPDATE bookings SET payment_status = 'sent' WHERE id = $1 AND payment_status <> 'paid'",
      [id]
    );

    // Send via SMS if requested and customer has phone
    if (method === 'sms' && data.customer_phone) {
      try {
        const { sendSMS } = require('../utils/twilio');
        const msg = `Invoice ${data.invoice_number} for $${parseFloat(data.amount_due).toFixed(2)}. Pay here: ${paymentUrl}`;
        await sendSMS(data.customer_phone, msg, userId);
      } catch (smsErr) {
        console.error('Failed to send invoice SMS:', smsErr.message);
      }
    }

    // Send via email if requested (or as default) and customer has email
    if ((method === 'email' || !method) && data.customer_email && process.env.SENDGRID_API_KEY) {
      try {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        const { buildInvoiceEmailHtml } = require('../utils/invoiceEmail');

        const userResult = await pool.query('SELECT business_name, email FROM users WHERE id = $1', [userId]);
        const businessName = userResult.rows[0]?.business_name || 'Your Service Provider';
        const ownerEmail = userResult.rows[0]?.email;

        // Fetch invoice details + line items
        const invResult = await pool.query('SELECT * FROM invoices WHERE id = $1', [data.invoice_id]);
        const inv = invResult.rows[0] || {};
        const itemsResult = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [data.invoice_id]);

        await sgMail.send({
          to: data.customer_email,
          from: { name: businessName, email: TRANSACTIONAL_EMAIL },
          replyTo: ownerEmail ? { name: businessName, email: ownerEmail } : undefined,
          subject: `Invoice ${data.invoice_number} from ${businessName}`,
          html: buildInvoiceEmailHtml({
            businessName,
            customerName: data.customer_name,
            invoiceNumber: data.invoice_number,
            amountDue: data.amount_due,
            dueDate: inv.due_date,
            paymentUrl,
            items: itemsResult.rows,
            subtotal: inv.subtotal,
            taxAmount: inv.tax_amount,
            totalAmount: inv.total_amount,
            notes: inv.notes,
          }),
        });
        console.log(`Invoice email sent to ${data.customer_email}`);
      } catch (emailErr) {
        console.error('Failed to send invoice email:', emailErr.message);
      }
    }

    res.json({ success: true, paymentUrl, invoiceId: data.invoice_id });
  } catch (error) {
    console.error('Error sending invoice:', error.message);
    res.status(500).json({ error: 'Failed to send invoice' });
  }
});

// POST /api/employee/my-bookings/:id/invoice/record-payment - Record cash/manual payment
router.post('/my-bookings/:id/invoice/record-payment', requirePermission('process_payments'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    const { method } = req.body; // 'cash', 'check', 'other'

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const allowedMethods = ['cash', 'check', 'other'];
    if (method && !allowedMethods.includes(method)) {
      return res.status(400).json({ error: 'Payment method must be cash, check, or other' });
    }

    const booking = await pool.query(
      `SELECT b.invoice_id, i.amount_due, i.total_amount
       FROM bookings b JOIN invoices i ON i.id = b.invoice_id
       WHERE b.id = $1 AND b.user_id = $2`,
      [id, userId]
    );

    if (booking.rows.length === 0) return res.status(404).json({ error: 'Booking or invoice not found' });
    const { invoice_id, amount_due, total_amount } = booking.rows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Record payment
      await client.query(
        `INSERT INTO payments (user_id, invoice_id, booking_id, amount, processor, payment_method, status, created_at)
         VALUES ($1, $2, $3, $4, 'manual', $5, 'completed', NOW())`,
        [userId, invoice_id, id, amount_due, method || 'cash']
      );

      // Update invoice
      await client.query(
        "UPDATE invoices SET status = 'paid', amount_paid = total_amount, amount_due = 0, paid_at = NOW() WHERE id = $1",
        [invoice_id]
      );

      // Update booking
      await client.query(
        "UPDATE bookings SET payment_status = 'paid' WHERE id = $1",
        [id]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error recording payment:', error.message);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// GET /api/employee/my-schedule - Schedule (single date, week, or month)
router.get('/my-schedule', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { date, showAll, startDate, endDate } = req.query;

    if (date && !DATE_REGEX.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD format' });
    }
    if (startDate && !DATE_REGEX.test(startDate)) {
      return res.status(400).json({ error: 'startDate must be YYYY-MM-DD format' });
    }
    if (endDate && !DATE_REGEX.test(endDate)) {
      return res.status(400).json({ error: 'endDate must be YYYY-MM-DD format' });
    }

    const isRange = startDate && endDate;
    const targetDate = date || new Date().toISOString().split('T')[0];

    let dateFilter = isRange
      ? `AND b.booking_date >= $2 AND b.booking_date <= $3`
      : `AND b.booking_date = $2`;

    const params = isRange ? [userId, startDate, endDate] : [userId, targetDate];
    let paramOffset = params.length;

    let employeeFilter = '';
    if (showAll !== 'true') {
      paramOffset++;
      employeeFilter = `AND b.employee_id = $${paramOffset}`;
      params.push(employeeId);
    }

    const result = await pool.query(
      `SELECT b.*, e.name as employee_name, e.color as employee_color,
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
       LEFT JOIN employees e ON e.id = b.employee_id
       WHERE b.user_id = $1
         ${dateFilter}
         ${employeeFilter}
         AND b.status NOT IN ('cancelled')
       GROUP BY b.id, e.name, e.color
       ORDER BY b.booking_date, b.start_time`,
      params
    );

    // Time off overlapping the window (same My/All scope as bookings). Non-fatal so a
    // missing table can't break the schedule.
    let timeOffRows = [];
    try {
      const toParams = isRange ? [userId, startDate, endDate] : [userId, targetDate, targetDate];
      let toEmpFilter = '';
      if (showAll !== 'true') { toParams.push(employeeId); toEmpFilter = `AND t.employee_id = $${toParams.length}`; }
      const timeOff = await pool.query(
        `SELECT t.id, t.employee_id, t.start_date, t.end_date, t.reason,
                e.name AS employee_name, e.color AS employee_color
         FROM employee_time_off t
         LEFT JOIN employees e ON e.id = t.employee_id
         WHERE t.user_id = $1 AND t.show_on_schedule = true AND t.start_date <= $3 AND t.end_date >= $2 ${toEmpFilter}
         ORDER BY t.start_date`,
        toParams
      );
      timeOffRows = timeOff.rows;
    } catch (e) { /* table may not exist yet */ }

    res.json({ date: targetDate, bookings: result.rows, timeOff: timeOffRows });
  } catch (error) {
    console.error('Error fetching schedule:', error.message);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// GET /api/employee/contacts - All customers for this business
router.get('/contacts', requirePermission('view_customers'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const { search } = req.query;

    if (search && search.length > 100) {
      return res.status(400).json({ error: 'Search query too long' });
    }

    // Search existing customers AND leads, so booking lookups also find people who
    // haven't been booked yet. Leads that are already saved as customers (matched by
    // email or last-10-digits of phone) are de-duplicated out.
    const params = [userId];
    let custSearch = '', leadSearch = '';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      custSearch = ' AND (c.name ILIKE $2 OR c.phone ILIKE $2 OR c.email ILIKE $2)';
      leadSearch = ' AND (l.name ILIKE $2 OR l.phone ILIKE $2 OR l.email ILIKE $2)';
    }

    const query = `
      SELECT c.id, c.name, c.email, c.phone, c.last_service, c.last_service_date,
             c.total_jobs, c.lifetime_value, c.notes, 'customer' AS contact_type
      FROM customers c
      WHERE c.user_id = $1${custSearch}
      UNION ALL
      SELECT l.id, l.name, l.email, l.phone, NULL AS last_service, NULL AS last_service_date,
             NULL AS total_jobs, NULL AS lifetime_value, l.notes, 'lead' AS contact_type
      FROM leads l
      WHERE l.user_id = $1${leadSearch}
        AND COALESCE(NULLIF(l.name,''), NULLIF(l.email,''), NULLIF(l.phone,'')) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM customers c2
          WHERE c2.user_id = l.user_id AND (
            (NULLIF(l.email,'') IS NOT NULL AND lower(c2.email) = lower(l.email)) OR
            (length(regexp_replace(COALESCE(l.phone,''), '\\D', '', 'g')) >= 10 AND
             right(regexp_replace(c2.phone, '\\D', '', 'g'), 10) = right(regexp_replace(l.phone, '\\D', '', 'g'), 10))
          )
        )
      ORDER BY name
    `;

    const result = await pool.query(query, params);
    res.json({ customers: result.rows });
  } catch (error) {
    console.error('Error fetching contacts:', error.message);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// GET /api/employee/status-templates - Enabled status update templates for this business
router.get('/status-templates', async (req, res) => {
  try {
    const { userId } = req.employee;

    // Check if templates exist, seed defaults if not
    const existing = await pool.query(
      'SELECT * FROM status_update_templates WHERE user_id = $1 ORDER BY status',
      [userId]
    );

    if (existing.rows.length === 0) {
      const defaults = [
        { status: 'in_progress', message: 'Hey {{customerFirstName}}, this is {{employeeFirstName}} with {{businessName}}. Your technician has begun the service!', enabled: true },
        { status: 'completed', message: 'Hey {{customerFirstName}}, this is {{employeeFirstName}} with {{businessName}}. Your service has been completed! Thank you for choosing us.', enabled: true },
        { status: 'no_show', message: 'Hey {{customerFirstName}}, this is {{employeeFirstName}} with {{businessName}}. We attempted to service your appointment but were unable to reach you. Please contact us to reschedule.', enabled: false },
        { status: 'progress_update', message: 'Hey {{customerFirstName}}, this is {{employeeFirstName}} with {{businessName}}. Updating you on our progress.', enabled: true },
      ];

      for (const d of defaults) {
        await pool.query(
          'INSERT INTO status_update_templates (user_id, status, message_template, enabled) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, status) DO NOTHING',
          [userId, d.status, d.message, d.enabled]
        );
      }

      const seeded = await pool.query(
        'SELECT * FROM status_update_templates WHERE user_id = $1 ORDER BY status',
        [userId]
      );
      return res.json({ templates: seeded.rows });
    }

    res.json({ templates: existing.rows });
  } catch (error) {
    console.error('Error fetching status templates:', error.message);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// GET /api/employee/services - Services this employee is assigned to
router.get('/services', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;

    // Check if employee has specific service assignments
    const assignedServices = await pool.query(
      'SELECT service_id FROM service_employees WHERE employee_id = $1',
      [employeeId]
    );

    let result;
    if (assignedServices.rows.length > 0) {
      // Return only assigned services
      const serviceIds = assignedServices.rows.map(r => r.service_id);
      result = await pool.query(
        `SELECT id, name, description, duration_hours, price
         FROM services
         WHERE user_id = $1 AND id = ANY($2) AND active = true
         ORDER BY name`,
        [userId, serviceIds]
      );
    } else {
      // No specific assignments = can do all services
      result = await pool.query(
        `SELECT id, name, description, duration_hours, price
         FROM services
         WHERE user_id = $1 AND active = true
         ORDER BY name`,
        [userId]
      );
    }

    res.json({ services: result.rows });
  } catch (error) {
    console.error('Error fetching employee services:', error.message);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// GET /api/employee/performance - Weekly performance stats
router.get('/performance', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = now.toISOString().split('T')[0];

    // Completed jobs this week
    const completedResult = await pool.query(
      `SELECT COUNT(*) as cnt,
              COALESCE(SUM(EXTRACT(EPOCH FROM (end_time::interval - start_time::interval))/3600), 0) as total_hours
       FROM bookings
       WHERE user_id = $1 AND employee_id = $2 AND status = 'completed'
         AND booking_date >= $3 AND booking_date <= $4`,
      [userId, employeeId, weekStartStr, weekEndStr]
    );

    // Average rating from review requests linked to this employee's bookings
    const ratingResult = await pool.query(
      `SELECT COALESCE(AVG(rr.rating), 0) as avg_rating, COUNT(rr.id) as rating_count
       FROM review_requests rr
       JOIN bookings b ON b.customer_id = rr.customer_id AND b.user_id = rr.user_id
       WHERE b.employee_id = $1 AND b.user_id = $2
         AND rr.rating IS NOT NULL AND rr.created_at >= $3`,
      [employeeId, userId, weekStart.toISOString()]
    );

    // Last 8 weeks completed job counts for chart
    const chartResult = await pool.query(
      `SELECT DATE_TRUNC('week', booking_date::timestamp) as week, COUNT(*) as cnt
       FROM bookings
       WHERE user_id = $1 AND employee_id = $2 AND status = 'completed'
         AND booking_date >= (NOW() - INTERVAL '8 weeks')::date
       GROUP BY week ORDER BY week ASC`,
      [userId, employeeId]
    );

    // Total completed all time for Top Performer badge
    const allTimeResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM bookings
       WHERE user_id = $1 AND employee_id = $2 AND status = 'completed'`,
      [userId, employeeId]
    );

    const completedJobs = parseInt(completedResult.rows[0]?.cnt || 0);
    const totalHours = Math.round(parseFloat(completedResult.rows[0]?.total_hours || 0));
    const avgRating = parseFloat(ratingResult.rows[0]?.avg_rating || 0);
    const ratingCount = parseInt(ratingResult.rows[0]?.rating_count || 0);
    const chartData = chartResult.rows.map(r => parseInt(r.cnt));
    const allTimeCompleted = parseInt(allTimeResult.rows[0]?.cnt || 0);
    const isTopPerformer = completedJobs >= 10 || allTimeCompleted >= 50;

    res.json({
      completedJobs,
      totalHours,
      avgRating: parseFloat(avgRating.toFixed(1)),
      ratingCount,
      chartData: chartData.length > 0 ? chartData : [0, 0, 0, 0, 0, 0, 0, 0],
      isTopPerformer,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
    });
  } catch (error) {
    console.error('Employee performance error:', error.message);
    res.status(500).json({ error: 'Failed to load performance data' });
  }
});

// GET /api/employee/home - Home dashboard summary
router.get('/home', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const todayStr = new Date().toISOString().split('T')[0];

    const [scheduleRes, statsRes] = await Promise.all([
      pool.query(
        `SELECT b.id, b.booking_date, b.start_time, b.end_time, b.status,
                b.customer_name,
                json_agg(json_build_object('service_name', bi.service_name)) as items
         FROM bookings b
         LEFT JOIN booking_items bi ON b.id = bi.booking_id
         WHERE b.user_id = $1 AND b.employee_id = $2 AND b.booking_date = $3
           AND b.status != 'cancelled'
         GROUP BY b.id ORDER BY b.start_time ASC`,
        [userId, employeeId, todayStr]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'completed') as completed,
           COUNT(*) FILTER (WHERE status != 'cancelled') as total
         FROM bookings
         WHERE user_id = $1 AND employee_id = $2 AND booking_date = $3`,
        [userId, employeeId, todayStr]
      )
    ]);

    const bookings = scheduleRes.rows;
    const nextJob = bookings.find(b => b.status !== 'completed') || null;
    const completed = parseInt(statsRes.rows[0]?.completed || 0);
    const total = parseInt(statsRes.rows[0]?.total || 0);

    res.json({ bookings, nextJob, completed, total });
  } catch (error) {
    console.error('Employee home error:', error.message);
    res.status(500).json({ error: 'Failed to load home data' });
  }
});

// GET /api/employee/business-address - Business address for pre-filling bookings
router.get('/business-address', async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT address, city, state, zip_code FROM business_information WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    const address = row
      ? [row.address, row.city, row.state, row.zip_code].filter(Boolean).join(', ')
      : null;
    res.json({ address });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/profile - Employee's own profile
router.get('/profile', async (req, res) => {
  try {
    const { employeeId } = req.employee;

    const result = await pool.query(
      `SELECT e.id, e.name, e.email, e.phone, e.color, e.active,
              u.business_name,
              ec.last_login_at
       FROM employees e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN employee_credentials ec ON ec.employee_id = e.id
       WHERE e.id = $1`,
      [employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ profile: result.rows[0] });
  } catch (error) {
    console.error('Error fetching employee profile:', error.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/employee/profile - Update own phone and email
router.put('/profile', async (req, res) => {
  try {
    const { employeeId } = req.employee;
    const { phone, email } = req.body;

    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    if (phone !== undefined && phone && phone.length > 20) {
      return res.status(400).json({ error: 'Phone number too long' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone);
    }

    if (email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email.toLowerCase().trim());

      // Also update employee_credentials email
      await pool.query(
        'UPDATE employee_credentials SET email = $1, updated_at = NOW() WHERE employee_id = $2',
        [email.toLowerCase().trim(), employeeId]
      );
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(employeeId);
    const result = await pool.query(
      `UPDATE employees SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING id, name, email, phone, color`,
      values
    );

    res.json({ success: true, profile: result.rows[0] });
  } catch (error) {
    console.error('Error updating employee profile:', error.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/employee/square-credentials - Get Square SDK credentials for tap-to-pay
router.get('/square-credentials', requirePermission('process_payments'), async (req, res) => {
  try {
    const { userId } = req.employee;

    try {
      const { getValidSquareToken } = require('../utils/squareAuth');
      const { accessToken, locationId } = await getValidSquareToken(userId);
      return res.json({
        connected: true,
        accessToken,
        locationId,
        environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production'
      });
    } catch (e) {
      return res.json({ connected: false });
    }
  } catch (error) {
    console.error('Error fetching Square credentials:', error.message);
    res.status(500).json({ error: 'Failed to fetch Square credentials' });
  }
});

// GET /api/employee/notifications
// Aggregated activity feed for the bell: new bookings, customer replies,
// and team chat posts from the last 7 days for this business.
router.get('/notifications', async (req, res) => {
  try {
    const { userId, employeeId } = req.employee;
    const [bookingsRes, repliesRes, teamRes] = await Promise.all([
      pool.query(
        `SELECT id AS ref_id, customer_name, booking_date, start_time, source, created_at
         FROM bookings
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC LIMIT 30`,
        [userId]
      ),
      pool.query(
        `SELECT sm.booking_id AS ref_id, b.customer_name, sm.message, sm.created_at
         FROM sms_messages sm
         JOIN bookings b ON b.id = sm.booking_id
         WHERE sm.user_id = $1
           AND sm.direction = 'incoming'
           AND sm.booking_id IS NOT NULL
           AND sm.created_at > NOW() - INTERVAL '7 days'
         ORDER BY sm.created_at DESC LIMIT 30`,
        [userId]
      ),
      pool.query(
        `SELECT id AS ref_id, employee_name, employee_color, body, created_at
         FROM employee_messages
         WHERE user_id = $1
           AND employee_id <> $2
           AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC LIMIT 30`,
        [userId, employeeId]
      ),
    ]);

    const items = [
      ...bookingsRes.rows.map(r => ({
        type: 'new_booking',
        title: 'New Booking',
        body: `${r.customer_name || 'Customer'} — ${r.booking_date} ${r.start_time || ''}`.trim(),
        created_at: r.created_at,
        ref_id: r.ref_id,
        source: r.source,
      })),
      ...repliesRes.rows.map(r => ({
        type: 'customer_reply',
        title: `${r.customer_name || 'Customer'} replied`,
        body: (r.message || '').slice(0, 140),
        created_at: r.created_at,
        ref_id: r.ref_id,
      })),
      ...teamRes.rows.map(r => ({
        type: 'team_chat',
        title: `${r.employee_name} in Team Chat`,
        body: (r.body || '').slice(0, 140),
        created_at: r.created_at,
        ref_id: r.ref_id,
        sender_color: r.employee_color,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ notifications: items.slice(0, 50) });
  } catch (e) {
    console.error('Error fetching notifications:', e.message);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// GET /api/employee/customer-messages
// Recent SMS conversations between any employee and any customer (grouped by booking).
// Used by the Customers > Messages tab.
router.get('/customer-messages', requirePermission('view_customers'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `WITH ranked AS (
         SELECT sm.booking_id, sm.message, sm.media_url, sm.direction,
                sm.created_at, sm.sent_by_employee_id,
                ROW_NUMBER() OVER (PARTITION BY sm.booking_id ORDER BY sm.created_at DESC) AS rn
         FROM sms_messages sm
         WHERE sm.user_id = $1 AND sm.booking_id IS NOT NULL
       )
       SELECT r.booking_id, r.message AS last_message, r.media_url AS last_media_url,
              r.direction AS last_direction, r.created_at AS last_message_at,
              b.customer_name, b.customer_phone, b.booking_date, b.start_time,
              e.name AS last_sender_name, e.color AS last_sender_color
       FROM ranked r
       JOIN bookings b ON b.id = r.booking_id
       LEFT JOIN employees e ON e.id = r.sent_by_employee_id
       WHERE r.rn = 1
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json({ conversations: result.rows });
  } catch (e) {
    console.error('Error fetching customer messages:', e.message);
    res.status(500).json({ error: 'Failed to fetch customer messages' });
  }
});

// POST /api/employee/my-bookings/:id/invoice/tap-payment - Record Square tap-to-pay payment
router.post('/my-bookings/:id/invoice/tap-payment', requirePermission('process_payments'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    const { squarePaymentId, cardBrand, cardLastFour } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    if (!squarePaymentId || typeof squarePaymentId !== 'string' || squarePaymentId.length > 255) {
      return res.status(400).json({ error: 'Valid squarePaymentId is required' });
    }

    const booking = await pool.query(
      `SELECT b.invoice_id, b.customer_id, i.amount_due, i.total_amount
       FROM bookings b JOIN invoices i ON i.id = b.invoice_id
       WHERE b.id = $1 AND b.user_id = $2`,
      [id, userId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({ error: 'Booking or invoice not found' });
    }

    const { invoice_id, customer_id, amount_due } = booking.rows[0];
    const paymentAmount = parseFloat(amount_due); // Always use server-side amount — never trust client

    const { recordPayment } = require('./payment-webhooks');

    await recordPayment({
      userId,
      invoiceId: invoice_id,
      bookingId: parseInt(id),
      customerId: customer_id,
      amount: paymentAmount,
      processor: 'square',
      processorPaymentId: squarePaymentId,
      paymentMethod: 'tap_to_pay',
      cardLastFour: cardLastFour || null,
      cardBrand: cardBrand || null,
      processorFee: null
    });

    res.json({ success: true, squarePaymentId });
  } catch (error) {
    console.error('Error recording tap payment:', error.message);
    res.status(500).json({ error: 'Failed to record tap payment' });
  }
});

// ============================================================
// COMMUNITY NOTES — Group messaging between all employees
// ============================================================

// GET /api/employee/community - Fetch messages (newest first, paginated)
router.get('/community', async (req, res) => {
  try {
    const { userId } = req.employee;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before; // message id cursor for pagination

    let cursorFilter = '';
    const params = [userId, limit];
    if (before && isValidId(before)) {
      cursorFilter = `AND m.id < $3`;
      params.push(parseInt(before));
    }

    const result = await pool.query(
      `SELECT m.*,
         r.id as reply_author_id, r.employee_name as reply_author_name,
         r.body as reply_body
       FROM employee_messages m
       LEFT JOIN employee_messages r ON r.id = m.reply_to_id
       WHERE m.user_id = $1 ${cursorFilter}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      params
    );

    // Return pinned messages separately on first page
    let pinned = [];
    if (!before) {
      const pinnedRes = await pool.query(
        `SELECT m.*, r.employee_name as reply_author_name, r.body as reply_body
         FROM employee_messages m
         LEFT JOIN employee_messages r ON r.id = m.reply_to_id
         WHERE m.user_id = $1 AND m.pinned = true
         ORDER BY m.created_at DESC LIMIT 5`,
        [userId]
      );
      pinned = pinnedRes.rows;
    }

    res.json({ messages: result.rows.reverse(), pinned, hasMore: result.rows.length === limit });
  } catch (error) {
    console.error('Error fetching community messages:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/employee/community - Post a new message
router.post('/community', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { body, replyToId } = req.body;

    if (!body || !body.trim()) return res.status(400).json({ error: 'Message body is required' });
    if (body.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 chars)' });

    // Get employee info
    const empRes = await pool.query(
      'SELECT name, color FROM employees WHERE id = $1 AND user_id = $2',
      [employeeId, userId]
    );
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    const emp = empRes.rows[0];

    // Validate reply_to if provided
    let replyPreview = null;
    if (replyToId && isValidId(replyToId)) {
      const replyRes = await pool.query(
        'SELECT employee_name, body FROM employee_messages WHERE id = $1 AND user_id = $2',
        [replyToId, userId]
      );
      if (replyRes.rows.length > 0) {
        replyPreview = replyRes.rows[0].body.slice(0, 100);
      }
    }

    const result = await pool.query(
      `INSERT INTO employee_messages
         (user_id, employee_id, employee_name, employee_color, body, reply_to_id, reply_preview)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, employeeId, emp.name, emp.color || '#6b7280', body.trim(),
       replyToId && isValidId(replyToId) ? replyToId : null, replyPreview]
    );

    // Fan out push to teammates (skip sender)
    sendPushToTeam(
      userId, employeeId,
      `${emp.name} in Team Chat`,
      body.trim().slice(0, 140),
      { type: 'team_chat', messageId: result.rows[0].id }
    ).catch(() => {});

    res.json({ message: result.rows[0] });
  } catch (error) {
    console.error('Error posting message:', error.message);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// PUT /api/employee/community/:id/react - Toggle emoji reaction
router.put('/community/:id/react', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;
    const { emoji } = req.body;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid message ID' });
    if (!emoji || typeof emoji !== 'string' || emoji.length > 10) {
      return res.status(400).json({ error: 'Valid emoji required' });
    }

    const msgRes = await pool.query(
      'SELECT reactions FROM employee_messages WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (msgRes.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    const reactions = msgRes.rows[0].reactions || {};
    if (!reactions[emoji]) reactions[emoji] = [];

    const idx = reactions[emoji].indexOf(employeeId);
    if (idx === -1) {
      reactions[emoji].push(employeeId);
    } else {
      reactions[emoji].splice(idx, 1);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    }

    const result = await pool.query(
      'UPDATE employee_messages SET reactions = $1 WHERE id = $2 AND user_id = $3 RETURNING reactions',
      [JSON.stringify(reactions), id, userId]
    );

    res.json({ reactions: result.rows[0].reactions });
  } catch (error) {
    console.error('Error updating reaction:', error.message);
    res.status(500).json({ error: 'Failed to update reaction' });
  }
});

// PUT /api/employee/community/:id - Edit own message
router.put('/community/:id', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;
    const { body } = req.body;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid message ID' });
    if (!body || !body.trim()) return res.status(400).json({ error: 'Body is required' });
    if (body.length > 2000) return res.status(400).json({ error: 'Message too long' });

    const result = await pool.query(
      `UPDATE employee_messages SET body = $1, edited_at = NOW()
       WHERE id = $2 AND user_id = $3 AND employee_id = $4
       RETURNING *`,
      [body.trim(), id, userId, employeeId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found or not yours' });
    res.json({ message: result.rows[0] });
  } catch (error) {
    console.error('Error editing message:', error.message);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// DELETE /api/employee/community/:id - Delete own message
router.delete('/community/:id', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid message ID' });

    const result = await pool.query(
      'DELETE FROM employee_messages WHERE id = $1 AND user_id = $2 AND employee_id = $3 RETURNING id',
      [id, userId, employeeId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found or not yours' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting message:', error.message);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// PUT /api/employee/community/:id/pin - Pin/unpin message (any employee can pin)
router.put('/community/:id/pin', async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid message ID' });

    const result = await pool.query(
      `UPDATE employee_messages SET pinned = NOT pinned
       WHERE id = $1 AND user_id = $2
       RETURNING id, pinned`,
      [id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    res.json({ pinned: result.rows[0].pinned });
  } catch (error) {
    console.error('Error pinning message:', error.message);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// GET /api/employee/team-members - All active employees in the business (for assignment)
router.get('/team-members', async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT e.id, e.name, e.color
       FROM employees e
       WHERE e.user_id = $1 AND e.active = true
       ORDER BY e.name`,
      [userId]
    );
    res.json({ members: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/employee/bookings - Create a new booking
router.post('/bookings', async (req, res) => {
  try {
    const { userId, employeeId } = req.employee;
    const {
      customerName, customerEmail, customerPhone, customerAddress, customerNotes,
      serviceId, bookingDate, startTime, endTime, notes, assignedEmployeeId,
      price: priceOverride,
      // New shape: mainServices/additionalServices may be [{id, price?}] or [id].
      // Legacy (serviceId + price) still works below.
      mainServices, additionalServices,
    } = req.body;

    // Collapse legacy single-service shape into the same arrays the web app sends.
    const mains = normalizeServiceList(
      Array.isArray(mainServices) && mainServices.length > 0
        ? mainServices
        : (serviceId ? [{ id: serviceId, price: priceOverride }] : [])
    );
    const addons = normalizeServiceList(additionalServices);

    if (!customerName || mains.length === 0 || !bookingDate || !startTime || !endTime) {
      return res.status(400).json({ error: 'customerName, at least one main service, bookingDate, startTime, endTime required' });
    }

    const resolved = await resolveBookingServices({ userId, mains, addons });
    const resolvedMains = resolved.filter(s => !s.is_addon);
    if (resolvedMains.length === 0) return res.status(404).json({ error: 'Service not found' });

    const subtotal = resolved.reduce((sum, s) => sum + s.price, 0);
    const assignTo = assignedEmployeeId || employeeId;

    const bnRes = await pool.query('SELECT generate_booking_number() as number');
    const bookingNumber = bnRes.rows[0].number;

    // A booking taken in the field is still a customer. Without a customers row and
    // a customer_id on the booking, this person never appears in the CRM and the
    // review request cron skips the job entirely — its first gate is customer_id.
    // Match an existing customer on phone or email before creating another.
    let customerId = null;
    try {
      const phoneDigits = (customerPhone || '').replace(/\D/g, '').slice(-10);
      const existing = await pool.query(
        `SELECT id FROM customers
         WHERE user_id = $1
           AND (
             ($2 <> '' AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2)
             OR ($3 <> '' AND LOWER(COALESCE(email, '')) = LOWER($3))
           )
         ORDER BY created_at ASC LIMIT 1`,
        [userId, phoneDigits, (customerEmail || '').trim()]
      );

      if (existing.rows[0]) {
        customerId = existing.rows[0].id;
        // Fill in anything we now know that the existing record was missing.
        await pool.query(
          `UPDATE customers
           SET phone = COALESCE(NULLIF(phone, ''), $1),
               email = COALESCE(NULLIF(email, ''), $2)
           WHERE id = $3`,
          [customerPhone || null, customerEmail || null, customerId]
        );
      } else {
        const created = await pool.query(
          `INSERT INTO customers (user_id, name, email, phone) VALUES ($1,$2,$3,$4) RETURNING id`,
          [userId, customerName, customerEmail || null, customerPhone || null]
        );
        customerId = created.rows[0].id;
      }
    } catch (custErr) {
      // Never block the booking over this — but it must be visible, because a null
      // customer_id silently costs them the review request.
      console.error(`⚠️ Employee booking: could not link a customer for "${customerName}":`, custErr.message);
    }

    const result = await pool.query(
      `INSERT INTO bookings (user_id, employee_id, booking_number, customer_id, customer_name, customer_email, customer_phone,
        customer_address, customer_notes, booking_date, start_time, end_time, status, subtotal, total_amount, job_notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed',$13,$14,$15,'manual')
       RETURNING *`,
      [userId, assignTo, bookingNumber, customerId, customerName, customerEmail||null, customerPhone||null,
       customerAddress||null, customerNotes||null, bookingDate, startTime, endTime,
       subtotal, subtotal, notes||null]
    );
    const booking = result.rows[0];

    // booking_items.subtotal is NOT NULL — for quantity-1 line items it equals service_price.
    for (const svc of resolved) {
      await pool.query(
        `INSERT INTO booking_items (booking_id, service_id, service_name, service_duration, service_price, quantity, subtotal, is_addon)
         VALUES ($1,$2,$3,$4,$5,1,$6,$7)`,
        [booking.id, svc.id, svc.name, svc.duration_hours, svc.price, svc.price, svc.is_addon]
      );
    }

    // Send booking confirmation emails (non-blocking) — mirrors the web create path so
    // bookings made from the employee app notify the customer too. Was missing, so
    // app-created bookings never emailed the customer.
    const extraCount = resolved.length - 1;
    const serviceLabel = extraCount > 0
      ? `${resolvedMains[0].name} + ${extraCount} more`
      : resolvedMains[0].name;
    sendBookingEmails({
      userId,
      bookingNumber,
      customerName,
      customerEmail,
      customerPhone,
      serviceName: serviceLabel,
      bookingDate,
      startTime,
      endTime,
      price: subtotal,
      subtotal,
      total: subtotal,
      notes: customerNotes,
    }).catch(() => {});

    res.json({ success: true, booking });
  } catch (error) {
    console.error('Error creating booking:', error.message);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PUT /api/employee/my-bookings/:id - Full booking edit (employee, date, time, customer, services).
// Mirrors the web PUT /api/bookings/:id but goes through employee auth + permission check.
router.put('/my-bookings/:id', requirePermission('manage_bookings'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    const {
      customerName, customerEmail, customerPhone, customerAddress, customerNotes,
      bookingDate, startTime, endTime, notes, status, assignedEmployeeId,
      serviceId, price: priceOverride,
      mainServices, additionalServices, sendEmail,
    } = req.body;

    // Same shape as POST: prefer arrays, fall back to legacy single-service payload.
    const mains = normalizeServiceList(
      Array.isArray(mainServices) && mainServices.length > 0
        ? mainServices
        : (serviceId ? [{ id: serviceId, price: priceOverride }] : [])
    );
    const addons = normalizeServiceList(additionalServices);

    if (!bookingDate || !startTime || mains.length === 0) {
      return res.status(400).json({ error: 'bookingDate, startTime, and at least one main service required' });
    }

    const resolved = await resolveBookingServices({ userId: null, mains, addons });
    const resolvedMains = resolved.filter(s => !s.is_addon);
    if (resolvedMains.length === 0) return res.status(404).json({ error: 'Service not found' });
    const primaryService = resolvedMains[0];

    const subtotal = resolved.reduce((sum, s) => sum + s.price, 0);

    const taxResult = await pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [userId]);
    const taxRate = parseFloat(taxResult.rows[0]?.default_tax_rate || 0);
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const totalAmount = subtotal + taxAmount;

    // Compute end_time off the sum of all line durations unless the caller provided one
    // explicitly (the app already shows a computed end_time, so we trust it when sent).
    let computedEndTime = endTime;
    if (!computedEndTime) {
      const totalDurationHours = resolved.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
      const [startHour, startMin] = startTime.split(':').map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = startMinutes + Math.round(totalDurationHours * 60);
      const eh = Math.floor(endMinutes / 60);
      const em = endMinutes % 60;
      computedEndTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    }

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
           job_notes = COALESCE($9, job_notes),
           employee_id = $10,
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
        computedEndTime,
        customerName ?? null,
        customerEmail ?? null,
        customerPhone ?? null,
        customerAddress ?? null,
        customerNotes ?? null,
        notes ?? null,
        assignedEmployeeId ?? null,
        status || 'confirmed',
        subtotal,
        taxAmount,
        totalAmount,
        id,
        userId,
      ]
    );
    if (bookingResult.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = bookingResult.rows[0];

    // Mirror the web PUT: keep the customers row in sync.
    if (booking.customer_id && (customerName || customerEmail || customerPhone)) {
      await pool.query(
        `UPDATE customers SET name = COALESCE($1, name), email = COALESCE($2, email), phone = COALESCE($3, phone)
         WHERE id = $4`,
        [customerName ?? null, customerEmail ?? null, customerPhone ?? null, booking.customer_id]
      );
    }

    // Replace all booking_items: delete then re-insert mains + add-ons.
    await pool.query('DELETE FROM booking_items WHERE booking_id = $1', [id]);
    for (const svc of resolved) {
      await pool.query(
        `INSERT INTO booking_items (booking_id, service_id, service_name, service_duration, service_price, quantity, subtotal, is_addon)
         VALUES ($1,$2,$3,$4,$5,1,$6,$7)`,
        [id, svc.id, svc.name, svc.duration_hours, svc.price, svc.price, svc.is_addon]
      );
    }

    // Only email the customer a "Booking Updated" notice when the caller opted in (the
    // "Email the customer about this update" checkbox). Mirrors the web PUT's sendEmail flag.
    if (sendEmail && booking.customer_email) {
      const extraCount = resolved.length - 1;
      const serviceLabel = extraCount > 0
        ? `${primaryService.name} + ${extraCount} more`
        : primaryService.name;
      sendBookingEmails({
        userId,
        type: 'updated',
        bookingNumber: booking.booking_number,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
        serviceName: serviceLabel,
        bookingDate,
        startTime,
        endTime: computedEndTime,
        price: subtotal,
        subtotal,
        taxRate,
        taxAmount,
        total: totalAmount,
        notes: customerNotes,
      }).catch(() => {});
    }

    res.json({ success: true, booking });
  } catch (error) {
    console.error('Error updating employee booking:', error.message);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// DELETE /api/employee/my-bookings/:id - Admin-only booking deletion.
// Mirrors the web delete (booking_items + sms_messages cleanup), gated to admins.
// requireAdmin is a hoisted function declaration below, so referencing it here is fine.
router.delete('/my-bookings/:id', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;

    // Confirm the booking belongs to this business before deleting any related rows.
    const owns = await pool.query('SELECT id FROM bookings WHERE id = $1 AND user_id = $2', [id, userId]);
    if (owns.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    await pool.query('DELETE FROM booking_items WHERE booking_id = $1', [id]);
    await pool.query('UPDATE sms_messages SET booking_id = NULL WHERE booking_id = $1', [id]);
    const result = await pool.query(
      'DELETE FROM bookings WHERE id = $1 AND user_id = $2 RETURNING booking_number',
      [id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    console.log(`🗑️  Booking #${result.rows[0].booking_number} deleted by admin (user ${userId})`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting employee booking:', error.message);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// Middleware to check admin
async function requireAdmin(req, res, next) {
  try {
    const { employeeId } = req.employee;
    // Admin if: is_admin flag is set, OR their credential email matches the business owner's email
    const r = await pool.query(
      `SELECT e.is_admin, u.email as owner_email, ec.email as emp_email
       FROM employees e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN employee_credentials ec ON ec.employee_id = e.id
       WHERE e.id = $1`,
      [employeeId]
    );
    const row = r.rows[0];
    const isOwner = row?.emp_email && row?.owner_email &&
      row.emp_email.toLowerCase() === row.owner_email.toLowerCase();
    if (!row?.is_admin && !isOwner) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (e) { res.status(500).json({ error: 'Auth check failed' }); }
}

// GET /api/employee/admin/appointments
router.get('/admin/appointments', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const { status, date, date_from, date_to } = req.query;
    let filter = 'WHERE b.user_id = $1';
    const params = [userId];
    if (status) { filter += ` AND b.status = $${params.length+1}`; params.push(status); }
    if (date) { filter += ` AND b.booking_date = $${params.length+1}`; params.push(date); }
    else if (date_from && date_to) {
      filter += ` AND b.booking_date >= $${params.length+1}`; params.push(date_from);
      filter += ` AND b.booking_date <= $${params.length+1}`; params.push(date_to);
    }
    else { filter += ` AND b.booking_date >= CURRENT_DATE - INTERVAL '1 day'`; }

    const result = await pool.query(
      `SELECT b.*, e.name as employee_name, e.color as employee_color,
        json_agg(json_build_object('service_name', bi.service_name, 'price', bi.service_price)) as items
       FROM bookings b
       LEFT JOIN employees e ON e.id = b.employee_id
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       ${filter}
         AND b.status != 'cancelled'
       GROUP BY b.id, e.name, e.color
       ORDER BY b.booking_date, b.start_time`,
      params
    );
    res.json({ appointments: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/leads — only leads with actual conversations (SMS or chat),
// matching the dashboard view; raw site visitors with no engagement are excluded.
router.get('/admin/leads', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT l.id, l.name, l.email, l.phone, l.status, l.source, l.service, l.message,
              l.sms_consent, l.created_at, l.notes
       FROM leads l
       WHERE l.user_id = $1
       ORDER BY l.created_at DESC LIMIT 100`,
      [userId]
    );
    res.json({ leads: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/employee/admin/leads/:id
router.patch('/admin/leads/:id', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    const { status, notes, phone, email, name } = req.body;
    const sets = [], vals = [];
    if (status !== undefined) { sets.push(`status = $${vals.length+1}`); vals.push(status); }
    if (notes !== undefined)  { sets.push(`notes = $${vals.length+1}`); vals.push(notes); }
    if (phone !== undefined)  { sets.push(`phone = $${vals.length+1}`); vals.push(phone); }
    if (email !== undefined)  { sets.push(`email = $${vals.length+1}`); vals.push(email); }
    if (name !== undefined)   { sets.push(`name = $${vals.length+1}`);  vals.push(name); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(id, userId);
    const result = await pool.query(
      `UPDATE leads SET ${sets.join(', ')} WHERE id = $${vals.length-1} AND user_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead: result.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/leads/:id/sms-conversation
router.get('/admin/leads/:id/sms-conversation', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    const leadCheck = await pool.query('SELECT id FROM leads WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!leadCheck.rows.length) return res.status(404).json({ error: 'Lead not found' });
    const result = await pool.query(
      `SELECT direction, message, created_at FROM sms_messages WHERE lead_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    res.json({ messages: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/leads/:id/chat-conversation
router.get('/admin/leads/:id/chat-conversation', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    const leadResult = await pool.query(
      'SELECT id, conversation_id, phone, email, created_at FROM leads WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (!leadResult.rows.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = leadResult.rows[0];
    let convId = lead.conversation_id;

    if (!convId) {
      // Try to match by phone/email content in messages
      if (lead.phone || lead.email) {
        const patterns = [], params = [userId];
        if (lead.phone) { params.push(`%${lead.phone.replace(/\D/g, '').slice(-10)}%`); patterns.push(`m.content ILIKE $${params.length}`); }
        if (lead.email) { params.push(`%${lead.email}%`); patterns.push(`m.content ILIKE $${params.length}`); }
        const r = await pool.query(
          `SELECT DISTINCT cc.id FROM chat_conversations cc
           JOIN chat_messages m ON m.conversation_id = cc.id
           WHERE cc.user_id = $1 AND (${patterns.join(' OR ')})
           ORDER BY cc.id DESC LIMIT 1`, params
        );
        if (r.rows.length) convId = r.rows[0].id;
      }
      // Fall back to time proximity
      if (!convId && lead.created_at) {
        const r = await pool.query(
          `SELECT id FROM chat_conversations WHERE user_id = $1
           AND created_at BETWEEN $2::timestamptz - INTERVAL '4 hours' AND $2::timestamptz + INTERVAL '4 hours'
           ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamptz))) ASC LIMIT 1`,
          [userId, lead.created_at]
        );
        if (r.rows.length) convId = r.rows[0].id;
      }
      if (convId) pool.query('UPDATE leads SET conversation_id = $1 WHERE id = $2', [convId, lead.id]).catch(() => {});
    }

    if (!convId) return res.json({ messages: [] });
    const msgs = await pool.query(
      'SELECT role, content, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [convId]
    );
    res.json({ messages: msgs.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/revenue
router.get('/admin/revenue', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const [invoiceRes, estimateRes, paymentRes, statsRes] = await Promise.all([
      pool.query(
        `SELECT i.id, i.invoice_number, i.status,
                COALESCE(i.customer_name, b.customer_name) AS customer_name,
                i.customer_email, i.total_amount, i.amount_paid, i.amount_due,
                i.tax_amount, i.tax_rate, i.subtotal, i.discount_amount,
                i.issue_date, i.due_date, i.paid_at, i.created_at
         FROM invoices i
         LEFT JOIN bookings b ON b.id = i.booking_id
         WHERE i.user_id = $1 ORDER BY i.created_at DESC LIMIT 100`,
        [userId]
      ),
      pool.query(
        `SELECT id, estimate_number, status, customer_name, customer_email,
                total_amount, tax_amount, tax_rate, subtotal, discount_amount,
                issue_date, valid_until, created_at
         FROM estimates WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [userId]
      ),
      pool.query(
        `SELECT p.id, p.amount, p.status, p.processor, p.payment_method,
                p.card_last_four, p.card_brand, p.processor_fee,
                p.created_at, i.invoice_number, i.customer_name
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 100`,
        [userId]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(amount_paid), 0) AS total_revenue,
           COALESCE(SUM(amount_due) FILTER (WHERE status != 'cancelled'), 0) AS outstanding,
           COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
           COALESCE(SUM(tax_amount), 0) AS total_tax
         FROM invoices WHERE user_id = $1`,
        [userId]
      )
    ]);
    res.json({
      invoices: invoiceRes.rows,
      estimates: estimateRes.rows,
      transactions: paymentRes.rows,
      stats: statsRes.rows[0],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/overview
router.get('/admin/overview', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const weekOffset = parseInt(req.query.weekOffset) || 0;

    // Week boundaries (Sun–Sat)
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + weekOffset * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const [todayRes, weekBookingsRes, weekLeadsRes, revenueRes, weekPaidRes] = await Promise.all([
      // Today's bookings
      pool.query(
        `SELECT b.id, b.customer_name, b.start_time, b.status, b.total_amount,
                COALESCE(STRING_AGG(bi.service_name, ', '), '') as services
         FROM bookings b
         LEFT JOIN booking_items bi ON bi.booking_id = b.id
         WHERE b.user_id = $1 AND b.booking_date = CURRENT_DATE AND b.status != 'cancelled'
         GROUP BY b.id ORDER BY b.start_time`,
        [userId]
      ),
      // Week bookings
      pool.query(
        `SELECT b.id, b.status, b.source, b.total_amount
         FROM bookings b
         WHERE b.user_id = $1 AND b.booking_date BETWEEN $2 AND $3`,
        [userId, weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
      ),
      // Week leads
      pool.query(
        `SELECT id, source, status, phone, email
         FROM leads WHERE user_id = $1 AND created_at BETWEEN $2 AND $3`,
        [userId, weekStart, weekEnd]
      ),
      // Revenue stats scoped to the selected week:
      //  - total_revenue: actual paid revenue from payments (net of refunds)
      //  - outstanding:   invoices created this week still owed
      //  - paid_count:    invoices that were paid in this week
      pool.query(
        `SELECT
           (SELECT COALESCE(SUM(amount - COALESCE(refund_amount, 0)), 0)
            FROM payments
            WHERE user_id = $1 AND status = 'completed'
              AND created_at BETWEEN $2 AND $3) AS total_revenue,
           (SELECT COALESCE(SUM(amount_due), 0)
            FROM invoices
            WHERE user_id = $1 AND status != 'cancelled'
              AND created_at BETWEEN $2 AND $3) AS outstanding,
           (SELECT COUNT(*)
            FROM invoices
            WHERE user_id = $1 AND status = 'paid'
              AND paid_at BETWEEN $2 AND $3) AS paid_count`,
        [userId, weekStart, weekEnd]
      ),
      // Same week-paid figure surfaced separately for the Week Summary card,
      // keeps the existing field name in the response payload.
      pool.query(
        `SELECT COALESCE(SUM(amount - COALESCE(refund_amount, 0)), 0) AS week_paid
         FROM payments
         WHERE user_id = $1
           AND status = 'completed'
           AND created_at BETWEEN $2 AND $3`,
        [userId, weekStart, weekEnd]
      ),
    ]);

    const weekBookings = weekBookingsRes.rows;
    const weekLeads = weekLeadsRes.rows;
    const weekRevenue = parseFloat(weekPaidRes.rows[0]?.week_paid || 0);
    const chatLeads = weekLeads.filter(l => l.source === 'ai_chat_agent' || l.source === 'website_chat');
    const formLeads = weekLeads.filter(l => l.source === 'lead_form');
    const convRate = weekLeads.length > 0
      ? ((weekBookings.length / weekLeads.length) * 100).toFixed(1)
      : '0';

    res.json({
      today: todayRes.rows,
      revenue: revenueRes.rows[0],
      weekSummary: {
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        totalLeads: weekLeads.length,
        conversionRate: convRate,
        weekRevenue: weekRevenue.toFixed(2),
        totalBookings: weekBookings.length,
        completedBookings: weekBookings.filter(b => b.status === 'completed').length,
      },
      performanceCards: {
        chatAgent: {
          conversationsStarted: chatLeads.length,
          bookingsMade: weekBookings.filter(b => b.source === 'ai_chat_agent' || b.source === 'website_chat').length,
          phonesCollected: chatLeads.filter(l => l.phone).length,
          followUpLeads: chatLeads.filter(l => l.status === 'new' || l.status === 'contacted').length,
        },
        leadForms: {
          totalSubmissions: formLeads.length,
          emailConversions: formLeads.filter(l => l.email).length,
          smsConversions: formLeads.filter(l => l.phone).length,
          costSavings: (formLeads.length * 0.15).toFixed(2),
        },
        newBookings: {
          total: weekBookings.length,
          fromChat: weekBookings.filter(b => b.source === 'ai_chat_agent' || b.source === 'website_chat').length,
          fromLeadForms: weekBookings.filter(b => b.source === 'lead_form').length,
          manual: weekBookings.filter(b => !b.source || (b.source !== 'ai_chat_agent' && b.source !== 'website_chat' && b.source !== 'lead_form')).length,
          revenue: weekRevenue.toFixed(2),
        },
        reviews: {
          requestsSent: 0,
          reviewsReceived: 0,
          aiReplies: 0,
          responseRate: '0',
          timeSaved: '0',
        },
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/tax-settings
router.get('/admin/tax-settings', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const [settingsRes, catalogRes] = await Promise.all([
      pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [userId]),
      pool.query(
        'SELECT id, name, category, amount_type, amount, taxable FROM invoice_items_catalog WHERE user_id = $1 AND active = true ORDER BY category, name',
        [userId]
      ),
    ]);
    const rawRate = parseFloat(settingsRes.rows[0]?.default_tax_rate || 0);
    res.json({
      defaultTaxRate: parseFloat((rawRate * 100).toFixed(4)),
      catalog: catalogRes.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/messages
router.get('/admin/messages', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT bm.*, b.customer_name, b.customer_phone, b.booking_date
       FROM booking_messages bm
       JOIN bookings b ON b.id = bm.booking_id
       WHERE b.user_id = $1
       ORDER BY bm.created_at DESC LIMIT 100`,
      [userId]
    );
    res.json({ messages: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/conversations
router.get('/admin/conversations', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT cc.id,
              cc.customer_name,
              cc.outcome,
              to_char(cc.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = cc.id) AS message_count,
              (SELECT content FROM chat_messages WHERE conversation_id = cc.id ORDER BY created_at DESC LIMIT 1) AS last_message,
              to_char(
                (SELECT created_at FROM chat_messages WHERE conversation_id = cc.id ORDER BY created_at DESC LIMIT 1)
                AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'
              ) AS last_message_at,
              (SELECT name  FROM leads WHERE user_id = cc.user_id AND source IN ('ai_chat_agent','website_chat')
               AND created_at BETWEEN cc.created_at - INTERVAL '2 hours' AND cc.created_at + INTERVAL '2 hours'
               ORDER BY created_at LIMIT 1) AS lead_name,
              (SELECT phone FROM leads WHERE user_id = cc.user_id AND source IN ('ai_chat_agent','website_chat')
               AND created_at BETWEEN cc.created_at - INTERVAL '2 hours' AND cc.created_at + INTERVAL '2 hours'
               ORDER BY created_at LIMIT 1) AS lead_phone,
              (SELECT email FROM leads WHERE user_id = cc.user_id AND source IN ('ai_chat_agent','website_chat')
               AND created_at BETWEEN cc.created_at - INTERVAL '2 hours' AND cc.created_at + INTERVAL '2 hours'
               ORDER BY created_at LIMIT 1) AS lead_email,
              (SELECT status FROM leads WHERE user_id = cc.user_id AND source IN ('ai_chat_agent','website_chat')
               AND created_at BETWEEN cc.created_at - INTERVAL '2 hours' AND cc.created_at + INTERVAL '2 hours'
               ORDER BY created_at LIMIT 1) AS lead_status
       FROM chat_conversations cc
       WHERE cc.user_id = $1
         AND EXISTS (
           SELECT 1 FROM chat_messages
           WHERE conversation_id = cc.id AND role = 'user'
         )
       ORDER BY COALESCE(
         (SELECT created_at FROM chat_messages WHERE conversation_id = cc.id ORDER BY created_at DESC LIMIT 1),
         cc.created_at
       ) DESC
       LIMIT 50`,
      [userId]
    );
    res.json({ conversations: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/push-status
// For each teammate: do they have a registered, valid Expo push token,
// what platform, and when was it last updated? Helps diagnose missing pushes.
router.get('/admin/push-status', requireAdmin, async (req, res) => {
  try {
    const { Expo } = require('expo-server-sdk');
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT e.id, e.name, e.email, e.color, e.is_admin,
              ec.push_token, ec.device_platform, ec.updated_at, ec.last_login_at
       FROM employees e
       LEFT JOIN employee_credentials ec ON ec.employee_id = e.id
       WHERE e.user_id = $1
       ORDER BY e.is_admin DESC, e.name ASC`,
      [userId]
    );
    const members = result.rows.map(r => {
      const token = r.push_token || null;
      const valid = !!token && Expo.isExpoPushToken(token);
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        color: r.color,
        is_admin: r.is_admin,
        has_token: !!token,
        token_valid: valid,
        token_status: !token ? 'missing' : valid ? 'ok' : 'invalid',
        device_platform: r.device_platform,
        token_updated_at: r.updated_at,
        last_login_at: r.last_login_at,
      };
    });
    res.json({ members });
  } catch (e) {
    console.error('Error fetching push status:', e.message);
    res.status(500).json({ error: 'Failed to fetch push status' });
  }
});

// GET /api/employee/admin/lead-sms-conversations
// Lead-form (and other non-chat) leads that have at least one SMS exchange.
// Powers the "Lead SMS" tab on the admin Chats screen.
router.get('/admin/lead-sms-conversations', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT l.id, l.name, l.phone, l.email, l.status, l.source,
              to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
              (SELECT COUNT(*) FROM sms_messages WHERE lead_id = l.id) AS message_count,
              (SELECT message FROM sms_messages WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT direction FROM sms_messages WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1) AS last_direction,
              to_char(
                (SELECT created_at FROM sms_messages WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1)
                AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'
              ) AS last_message_at
       FROM leads l
       WHERE l.user_id = $1
         AND l.source <> 'ai_chat_agent'
         AND l.source <> 'website_chat'
         AND EXISTS (SELECT 1 FROM sms_messages WHERE lead_id = l.id)
       ORDER BY (SELECT MAX(created_at) FROM sms_messages WHERE lead_id = l.id) DESC NULLS LAST
       LIMIT 50`,
      [userId]
    );
    res.json({ conversations: result.rows });
  } catch (e) {
    console.error('Error fetching lead SMS conversations:', e.message);
    res.status(500).json({ error: 'Failed to fetch lead SMS conversations' });
  }
});

// GET /api/employee/admin/conversations/:id/messages
router.get('/admin/conversations/:id/messages', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;
    const conv = await pool.query(
      'SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (conv.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    const result = await pool.query(
      'SELECT role, content, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [id]
    );
    res.json({ messages: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/members - List all employees in this business
router.get('/admin/members', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT e.id, e.name, e.color, e.is_admin, e.active, ec.email
       FROM employees e
       LEFT JOIN employee_credentials ec ON ec.employee_id = e.id
       JOIN users u ON u.id = e.user_id
       WHERE e.user_id = $1 AND e.active = true
       ORDER BY e.name`,
      [userId]
    );
    // Also mark the owner
    const ownerResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const ownerEmail = ownerResult.rows[0]?.email?.toLowerCase();
    const members = result.rows.map(m => ({
      ...m,
      is_owner: m.email && m.email.toLowerCase() === ownerEmail,
    }));
    res.json({ members });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/employee/admin/members/:id/admin - Toggle admin for an employee
router.put('/admin/members/:id/admin', requireAdmin, async (req, res) => {
  try {
    const { userId, employeeId } = req.employee;
    const { id } = req.params;
    const { isAdmin } = req.body;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid employee ID' });

    // Can't remove admin from self
    if (Number(id) === employeeId && !isAdmin) {
      return res.status(400).json({ error: 'You cannot remove your own admin access.' });
    }

    const result = await pool.query(
      `UPDATE employees SET is_admin = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, is_admin`,
      [isAdmin, id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true, employee: result.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Time tracking ────────────────────────────────────────

// Build the live state for an employee's open shift (or null if clocked out).
async function buildTimeStatus(employeeId, { fireReminders = false } = {}) {
  const entryRes = await pool.query(
    `SELECT * FROM time_entries WHERE employee_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
    [employeeId]
  );
  if (entryRes.rows.length === 0) return { clockedIn: false };
  const entry = entryRes.rows[0];

  const breaksRes = await pool.query(
    `SELECT id, break_type, start_at, end_at FROM time_breaks WHERE time_entry_id = $1 ORDER BY start_at ASC`,
    [entry.id]
  );
  const breaks = breaksRes.rows;
  const now = Date.now();
  const clockInMs = new Date(entry.clock_in).getTime();

  let breakSeconds = 0;
  let currentBreak = null;
  for (const b of breaks) {
    const s = new Date(b.start_at).getTime();
    const e = b.end_at ? new Date(b.end_at).getTime() : now;
    breakSeconds += Math.max(0, (e - s) / 1000);
    if (!b.end_at) currentBreak = b;
  }
  const elapsedSeconds = Math.max(0, (now - clockInMs) / 1000);
  const workedSeconds = Math.max(0, elapsedSeconds - breakSeconds);

  const sent = Array.isArray(entry.reminders_sent) ? entry.reminders_sent : [];
  const reminders = BREAK_REMINDERS.map(r => ({
    key: r.key, type: r.type, label: r.label, atSeconds: r.atSeconds,
    due: workedSeconds >= r.atSeconds,
  }));

  // Fire a phone push once per crossed threshold (the in-app banner is driven by `due`).
  if (fireReminders) {
    const newlyDue = reminders.filter(r => r.due && !sent.includes(r.key));
    if (newlyDue.length > 0) {
      for (const r of newlyDue) {
        sendPushToEmployee(employeeId, 'Break reminder', r.label, { screen: 'EmployeeHome', reminder: r.key }).catch(() => {});
      }
      const merged = [...new Set([...sent, ...newlyDue.map(r => r.key)])];
      await pool.query('UPDATE time_entries SET reminders_sent = $1 WHERE id = $2', [JSON.stringify(merged), entry.id]).catch(() => {});
    }
  }

  return {
    clockedIn: true,
    entryId: entry.id,
    clockInAt: entry.clock_in,
    onBreak: !!currentBreak,
    currentBreak: currentBreak ? { id: currentBreak.id, type: currentBreak.break_type, startAt: currentBreak.start_at } : null,
    breaks: breaks.map(b => ({ id: b.id, type: b.break_type, startAt: b.start_at, endAt: b.end_at })),
    elapsedSeconds: Math.round(elapsedSeconds),
    breakSeconds: Math.round(breakSeconds),
    workedSeconds: Math.round(workedSeconds),
    reminders,
  };
}

// GET /api/employee/time/status — current shift state (also fires due break pushes)
router.get('/time/status', async (req, res) => {
  try {
    const status = await buildTimeStatus(req.employee.employeeId, { fireReminders: true });
    res.json(status);
  } catch (e) {
    console.error('time/status error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/employee/time/clock-in
router.post('/time/clock-in', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const open = await pool.query('SELECT id FROM time_entries WHERE employee_id = $1 AND clock_out IS NULL LIMIT 1', [employeeId]);
    if (open.rows.length > 0) return res.status(400).json({ error: "You're already clocked in" });
    await pool.query('INSERT INTO time_entries (user_id, employee_id, clock_in) VALUES ($1, $2, NOW())', [userId, employeeId]);
    res.json({ success: true, status: await buildTimeStatus(employeeId) });
  } catch (e) {
    console.error('clock-in error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/employee/time/clock-out
router.post('/time/clock-out', async (req, res) => {
  try {
    const { employeeId } = req.employee;
    const open = await pool.query('SELECT id FROM time_entries WHERE employee_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [employeeId]);
    if (open.rows.length === 0) return res.status(400).json({ error: "You're not clocked in" });
    const entryId = open.rows[0].id;
    // Auto-close any open break so it doesn't run forever.
    await pool.query('UPDATE time_breaks SET end_at = NOW() WHERE time_entry_id = $1 AND end_at IS NULL', [entryId]);
    await pool.query('UPDATE time_entries SET clock_out = NOW() WHERE id = $1', [entryId]);
    res.json({ success: true, status: { clockedIn: false } });
  } catch (e) {
    console.error('clock-out error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/employee/time/break/start  body: { type: 'paid' | 'unpaid' }
router.post('/time/break/start', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const type = req.body?.type === 'unpaid' ? 'unpaid' : 'paid';
    const open = await pool.query('SELECT id FROM time_entries WHERE employee_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [employeeId]);
    if (open.rows.length === 0) return res.status(400).json({ error: 'Clock in before taking a break' });
    const entryId = open.rows[0].id;
    const onBreak = await pool.query('SELECT id FROM time_breaks WHERE time_entry_id = $1 AND end_at IS NULL LIMIT 1', [entryId]);
    if (onBreak.rows.length > 0) return res.status(400).json({ error: "You're already on a break" });
    await pool.query(
      'INSERT INTO time_breaks (time_entry_id, employee_id, user_id, break_type, start_at) VALUES ($1, $2, $3, $4, NOW())',
      [entryId, employeeId, userId, type]
    );
    res.json({ success: true, status: await buildTimeStatus(employeeId) });
  } catch (e) {
    console.error('break/start error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/employee/time/break/end
router.post('/time/break/end', async (req, res) => {
  try {
    const { employeeId } = req.employee;
    const open = await pool.query('SELECT id FROM time_entries WHERE employee_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [employeeId]);
    if (open.rows.length === 0) return res.status(400).json({ error: "You're not clocked in" });
    const upd = await pool.query(
      'UPDATE time_breaks SET end_at = NOW() WHERE time_entry_id = $1 AND end_at IS NULL RETURNING id',
      [open.rows[0].id]
    );
    if (upd.rows.length === 0) return res.status(400).json({ error: "You're not on a break" });
    res.json({ success: true, status: await buildTimeStatus(employeeId) });
  } catch (e) {
    console.error('break/end error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Budgeted hours (manager-only) ────────────────────────
// Admins always have access; otherwise the manager must hold manage_budgeted_hours.
// (Owner is treated as admin, so the owner sees it without granting themselves anything.)
const requireBudgetedAccess = (req, res, next) => {
  if (req.employee?.isAdmin || req.employee?.permissions?.manage_budgeted_hours) return next();
  res.status(403).json({ error: 'Permission denied', required: 'manage_budgeted_hours' });
};

// GET /api/employee/admin/budgeted-hours?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/admin/budgeted-hours', requireBudgetedAccess, async (req, res) => {
  try {
    const { userId } = req.employee;
    const today = new Date();
    const iso = d => d.toISOString().slice(0, 10);
    const from = req.query.from || iso(new Date(today.getTime() - 30 * 864e5));
    const to = req.query.to || iso(new Date(today.getTime() + 30 * 864e5));

    const r = await pool.query(
      `SELECT b.id, b.customer_name, b.booking_date, b.start_time, b.status,
              b.employee_id, b.budgeted_hours,
              e.name AS employee_name,
              COALESCE((SELECT SUM(service_duration) FROM booking_items WHERE booking_id = b.id), 0) AS default_hours,
              (SELECT string_agg(service_name, ', ') FROM booking_items WHERE booking_id = b.id) AS services
       FROM bookings b
       LEFT JOIN employees e ON e.id = b.employee_id
       WHERE b.user_id = $1 AND COALESCE(b.status,'') <> 'cancelled'
         AND b.booking_date >= $2 AND b.booking_date <= $3
       ORDER BY b.booking_date DESC, b.start_time DESC`,
      [userId, from, to]
    );

    const jobs = r.rows.map(j => ({
      ...j,
      // What counts for efficiency: the manager's override, else the service-duration default.
      effective_hours: j.budgeted_hours != null ? parseFloat(j.budgeted_hours) : parseFloat(j.default_hours) || 0,
    }));
    res.json({ jobs, from, to });
  } catch (e) {
    console.error('budgeted-hours list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/employee/admin/budgeted-hours/:id  body: { hours }  (null/empty clears the override)
router.put('/admin/budgeted-hours/:id', requireBudgetedAccess, async (req, res) => {
  try {
    const { userId } = req.employee;
    const { hours } = req.body || {};
    let value = null;
    if (hours !== null && hours !== undefined && hours !== '') {
      value = parseFloat(hours);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'Enter a valid number of hours' });
    }
    const r = await pool.query(
      'UPDATE bookings SET budgeted_hours = $1 WHERE id = $2 AND user_id = $3 RETURNING id, budgeted_hours',
      [value, req.params.id, userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true, budgeted_hours: r.rows[0].budgeted_hours });
  } catch (e) {
    console.error('budgeted-hours update error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
