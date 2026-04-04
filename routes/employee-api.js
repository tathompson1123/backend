const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateEmployee, requirePermission } = require('../config/employee-middleware');

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
       JOIN users u ON u.id = b.user_id
       WHERE b.id = $1 AND b.user_id = $2 AND b.employee_id = $3
       GROUP BY b.id, u.default_tax_rate`,
      [id, userId, employeeId]
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
        const autoSend = config ? config.auto_send_enabled : true;

        if (autoSend && (booking.customer_email || booking.customer_phone)) {
          const itemsResult = await pool.query('SELECT service_name FROM booking_items WHERE booking_id = $1 LIMIT 1', [id]);
          const serviceName = itemsResult.rows[0]?.service_name || 'Service';
          const scheduledTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
          const incentiveCode = config?.incentive_enabled
            ? `REV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
            : null;

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

    // Store message
    await pool.query(
      `INSERT INTO sms_messages (user_id, booking_id, direction, to_number, message, twilio_message_sid, status, created_at)
       VALUES ($1, $2, 'outgoing', $3, $4, $5, 'sent', NOW())`,
      [userId, id, phone, message.trim(), smsResult.messageSid]
    );

    res.json({ success: true, messageSid: smsResult.messageSid });
  } catch (error) {
    console.error('Error sending booking message:', error.message);
    res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

// POST /api/employee/my-bookings/:id/invoice - Auto-create invoice from booking
router.post('/my-bookings/:id/invoice', requirePermission('process_payments'), async (req, res) => {
  try {
    const { userId } = req.employee;
    const { id } = req.params;

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
          subtotal, total_amount, amount_due, status, due_date, payment_link_token
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, $12)
        RETURNING *`,
        [userId, id, booking.customer_id, invoiceNumber, booking.customer_name,
         booking.customer_email, booking.customer_phone, booking.subtotal || booking.total_amount,
         booking.total_amount, booking.total_amount, dueDate, paymentLinkToken]
      );

      const invoice = invoiceResult.rows[0];

      // Create line items from booking items
      for (const item of (booking.items || [])) {
        if (item.service_name) {
          await client.query(
            `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, service_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [invoice.id, item.service_name, item.quantity || 1, item.service_price, item.service_price * (item.quantity || 1), item.service_id]
          );
        }
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
          from: { name: businessName, email: 'noreply@sorceintegrations.com' },
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
      `SELECT b.*, e.name as employee_name,
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
       GROUP BY b.id, e.name
       ORDER BY b.booking_date, b.start_time`,
      params
    );

    res.json({ date: targetDate, bookings: result.rows });
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

    let query = `
      SELECT id, name, email, phone, last_service, last_service_date, total_jobs, lifetime_value
      FROM customers
      WHERE user_id = $1
    `;
    const params = [userId];

    if (search && search.trim()) {
      query += ` AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)`;
      params.push(`%${search.trim()}%`);
    }

    query += ' ORDER BY name';

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

    const result = await pool.query(
      `SELECT square_access_token, square_location_id, square_merchant_id
       FROM payment_connections
       WHERE user_id = $1 AND processor = 'square' AND is_active = true
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].square_access_token) {
      return res.json({ connected: false });
    }

    const { square_access_token, square_location_id } = result.rows[0];

    res.json({
      connected: true,
      accessToken: square_access_token,
      locationId: square_location_id,
      environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production'
    });
  } catch (error) {
    console.error('Error fetching Square credentials:', error.message);
    res.status(500).json({ error: 'Failed to fetch Square credentials' });
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

// GET /api/employee/services
router.get('/services', async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      'SELECT id, name, price, duration_hours, description FROM services WHERE user_id = $1 AND active = true AND is_addon = false ORDER BY name',
      [userId]
    );
    res.json({ services: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/employee/bookings - Create a new booking
router.post('/bookings', async (req, res) => {
  try {
    const { userId, employeeId } = req.employee;
    const { customerName, customerEmail, customerPhone, customerAddress, customerNotes,
            serviceId, bookingDate, startTime, endTime, notes, assignedEmployeeId } = req.body;

    if (!customerName || !serviceId || !bookingDate || !startTime || !endTime) {
      return res.status(400).json({ error: 'customerName, serviceId, bookingDate, startTime, endTime required' });
    }

    const serviceRes = await pool.query(
      'SELECT id, name, price, duration_hours FROM services WHERE id = $1 AND user_id = $2',
      [serviceId, userId]
    );
    if (serviceRes.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    const service = serviceRes.rows[0];

    const assignTo = assignedEmployeeId || employeeId;

    const result = await pool.query(
      `INSERT INTO bookings (user_id, employee_id, customer_name, customer_email, customer_phone,
        customer_address, customer_notes, booking_date, start_time, end_time, status, total_amount, job_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed',$11,$12)
       RETURNING *`,
      [userId, assignTo, customerName, customerEmail||null, customerPhone||null,
       customerAddress||null, customerNotes||null, bookingDate, startTime, endTime,
       parseFloat(service.price), notes||null]
    );
    const booking = result.rows[0];

    await pool.query(
      `INSERT INTO booking_items (booking_id, service_id, service_name, service_duration, service_price, quantity)
       VALUES ($1,$2,$3,$4,$5,1)`,
      [booking.id, service.id, service.name, service.duration_hours, service.price]
    );

    res.json({ success: true, booking });
  } catch (error) {
    console.error('Error creating booking:', error.message);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Middleware to check admin
async function requireAdmin(req, res, next) {
  try {
    const { employeeId } = req.employee;
    const r = await pool.query('SELECT is_admin FROM employees WHERE id = $1', [employeeId]);
    if (!r.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (e) { res.status(500).json({ error: 'Auth check failed' }); }
}

// GET /api/employee/admin/appointments
router.get('/admin/appointments', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const { status, date } = req.query;
    let filter = 'WHERE b.user_id = $1';
    const params = [userId];
    if (status) { filter += ` AND b.status = $${params.length+1}`; params.push(status); }
    if (date) { filter += ` AND b.booking_date = $${params.length+1}`; params.push(date); }
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

// GET /api/employee/admin/leads
router.get('/admin/leads', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const result = await pool.query(
      `SELECT id, name, email, phone, status, source, service, created_at, notes
       FROM leads WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    res.json({ leads: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/employee/admin/revenue
router.get('/admin/revenue', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.employee;
    const [invoiceRes, statsRes] = await Promise.all([
      pool.query(
        `SELECT i.*, b.customer_name, b.booking_date, b.start_time
         FROM invoices i
         LEFT JOIN bookings b ON b.id = i.booking_id
         WHERE i.user_id = $1 ORDER BY i.created_at DESC LIMIT 50`,
        [userId]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE payment_status = 'paid') as paid_count,
           COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) as total_revenue,
           COALESCE(SUM(total_amount) FILTER (WHERE payment_status != 'paid' AND status != 'cancelled'), 0) as outstanding,
           COUNT(*) FILTER (WHERE booking_date = CURRENT_DATE AND status != 'cancelled') as today_jobs
         FROM bookings WHERE user_id = $1`,
        [userId]
      )
    ]);
    res.json({ invoices: invoiceRes.rows, stats: statsRes.rows[0] });
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
      `SELECT b.id as booking_id, b.customer_name, b.customer_phone, b.booking_date,
         b.status, COUNT(bm.id) as message_count,
         MAX(bm.created_at) as last_message_at,
         (SELECT body FROM booking_messages WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1) as last_message
       FROM bookings b
       LEFT JOIN booking_messages bm ON bm.booking_id = b.id
       WHERE b.user_id = $1 AND bm.id IS NOT NULL
       GROUP BY b.id
       ORDER BY last_message_at DESC LIMIT 50`,
      [userId]
    );
    res.json({ conversations: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
