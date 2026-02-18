const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { getProcessorForUser } = require('../payment/ProcessorFactory');

// GET /api/invoices - List invoices
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, startDate, endDate, customerId } = req.query;

    let query = `
      SELECT i.*,
        json_agg(json_build_object(
          'id', ii.id, 'description', ii.description,
          'quantity', ii.quantity, 'unit_price', ii.unit_price, 'amount', ii.amount
        )) FILTER (WHERE ii.id IS NOT NULL) as items
      FROM invoices i
      LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
      WHERE i.user_id = $1
    `;
    const params = [userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      query += ` AND i.status = $${paramCount}`;
      params.push(status);
    }
    if (startDate) {
      paramCount++;
      query += ` AND i.issue_date >= $${paramCount}`;
      params.push(startDate);
    }
    if (endDate) {
      paramCount++;
      query += ` AND i.issue_date <= $${paramCount}`;
      params.push(endDate);
    }
    if (customerId) {
      paramCount++;
      query += ` AND i.customer_id = $${paramCount}`;
      params.push(customerId);
    }

    query += ' GROUP BY i.id ORDER BY i.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ invoices: result.rows });
  } catch (error) {
    console.error('Error fetching invoices:', error.message);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// POST /api/invoices/sync-square - Sync invoices from Square into local DB
router.post('/sync-square', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const connResult = await pool.query(
      "SELECT * FROM payment_connections WHERE user_id = $1 AND processor = 'square' AND is_active = true",
      [userId]
    );
    if (connResult.rows.length === 0) {
      return res.status(400).json({ error: 'Square not connected' });
    }

    const conn = connResult.rows[0];
    const { Client, Environment } = require('square/legacy');
    const client = new Client({
      bearerAuthCredentials: { accessToken: conn.square_access_token },
      environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? Environment.Sandbox : Environment.Production,
    });

    const { result } = await client.invoicesApi.listInvoices(conn.square_location_id);
    const squareInvoices = result.invoices || [];

    const statusMap = {
      DRAFT: 'draft', UNPAID: 'sent', SCHEDULED: 'sent',
      PARTIALLY_PAID: 'partial', PAID: 'paid',
      REFUNDED: 'refunded', CANCELLED: 'cancelled',
      FAILED: 'overdue', PAYMENT_PENDING: 'sent',
    };

    let synced = 0;
    for (const inv of squareInvoices) {
      const status = statusMap[inv.status] || 'sent';
      const totalAmount = inv.paymentRequests?.[0]?.requestedMoney?.amount
        ? Number(inv.paymentRequests[0].requestedMoney.amount) / 100 : 0;
      const amountPaid = inv.paymentRequests?.[0]?.totalCompletedAmountMoney?.amount
        ? Number(inv.paymentRequests[0].totalCompletedAmountMoney.amount) / 100 : 0;
      const amountDue = Math.max(0, totalAmount - amountPaid);
      const dueDate = inv.paymentRequests?.[0]?.dueDate || null;
      const customerName = inv.primaryRecipient?.givenName
        ? `${inv.primaryRecipient.givenName} ${inv.primaryRecipient.familyName || ''}`.trim()
        : inv.primaryRecipient?.companyName || null;
      const customerEmail = inv.primaryRecipient?.emailAddress || null;
      const invoiceNumber = `SQ-${inv.invoiceNumber || inv.id}`;
      const paidAt = status === 'paid' ? inv.updatedAt : null;

      await pool.query(
        `INSERT INTO invoices (user_id, invoice_number, customer_name, customer_email,
           subtotal, total_amount, amount_paid, amount_due, status, issue_date, due_date,
           paid_at, payment_processor, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'square', $13, $14, NOW())
         ON CONFLICT (invoice_number) DO UPDATE SET
           status = EXCLUDED.status, amount_paid = EXCLUDED.amount_paid,
           amount_due = EXCLUDED.amount_due, paid_at = EXCLUDED.paid_at, updated_at = NOW()`,
        [userId, invoiceNumber, customerName, customerEmail,
         totalAmount, totalAmount, amountPaid, amountDue,
         status, inv.createdAt?.split('T')[0], dueDate,
         paidAt, inv.description || null, inv.createdAt]
      );
      synced++;
    }

    res.json({ success: true, synced });
  } catch (error) {
    console.error('Square invoices sync error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/invoices/:id - Invoice detail
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT i.*,
        json_agg(json_build_object(
          'id', ii.id, 'description', ii.description,
          'quantity', ii.quantity, 'unit_price', ii.unit_price, 'amount', ii.amount, 'service_id', ii.service_id
        )) FILTER (WHERE ii.id IS NOT NULL) as items
       FROM invoices i
       LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
       WHERE i.id = $1 AND i.user_id = $2
       GROUP BY i.id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ invoice: result.rows[0] });
  } catch (error) {
    console.error('Error fetching invoice:', error.message);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// POST /api/invoices - Create invoice
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { customerId, customerName, customerEmail, customerPhone, items, notes, terms, dueDate, taxRate, discountAmount } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    // Generate invoice number: INV-YYYYMMDD-XXXX
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const effectiveTaxRate = taxRate || 0;
    const taxAmount = subtotal * effectiveTaxRate;
    const effectiveDiscount = discountAmount || 0;
    const totalAmount = subtotal + taxAmount - effectiveDiscount;

    // Generate payment link token
    const paymentLinkToken = crypto.randomBytes(32).toString('hex');

    const invoiceResult = await pool.query(
      `INSERT INTO invoices (
        user_id, customer_id, invoice_number, customer_name, customer_email, customer_phone,
        subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_due,
        status, due_date, notes, terms, payment_link_token
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13, $14, $15, $16)
      RETURNING *`,
      [userId, customerId, invoiceNumber, customerName, customerEmail, customerPhone,
       subtotal, effectiveTaxRate, taxAmount, effectiveDiscount, totalAmount, totalAmount,
       dueDate, notes, terms, paymentLinkToken]
    );

    const invoice = invoiceResult.rows[0];

    // Insert line items
    for (const item of items) {
      await pool.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, service_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoice.id, item.description, item.quantity, item.unitPrice, item.quantity * item.unitPrice, item.serviceId || null]
      );
    }

    res.json({ success: true, invoice });
  } catch (error) {
    console.error('Error creating invoice:', error.message);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// POST /api/invoices/from-booking/:bookingId - Auto-generate invoice from booking
router.post('/from-booking/:bookingId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { bookingId } = req.params;

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
      [bookingId, userId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // Check if invoice already exists for this booking
    const existingInvoice = await pool.query(
      'SELECT id, invoice_number FROM invoices WHERE booking_id = $1',
      [bookingId]
    );

    if (existingInvoice.rows.length > 0) {
      return res.status(409).json({
        error: 'Invoice already exists for this booking',
        invoiceId: existingInvoice.rows[0].id,
        invoiceNumber: existingInvoice.rows[0].invoice_number
      });
    }

    // Generate invoice
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;
    const paymentLinkToken = crypto.randomBytes(32).toString('hex');
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const invoiceResult = await pool.query(
      `INSERT INTO invoices (
        user_id, booking_id, customer_id, invoice_number, customer_name, customer_email, customer_phone,
        subtotal, total_amount, amount_due, status, due_date, payment_link_token
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, $12)
      RETURNING *`,
      [userId, bookingId, booking.customer_id, invoiceNumber, booking.customer_name,
       booking.customer_email, booking.customer_phone, booking.subtotal || booking.total_amount,
       booking.total_amount, booking.total_amount, dueDate, paymentLinkToken]
    );

    const invoice = invoiceResult.rows[0];

    // Create line items from booking items
    const bookingItems = booking.items || [];
    for (const item of bookingItems) {
      if (item.service_name) {
        await pool.query(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, service_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [invoice.id, item.service_name, item.quantity || 1, item.service_price, item.service_price * (item.quantity || 1), item.service_id]
        );
      }
    }

    // Link invoice to booking
    await pool.query(
      "UPDATE bookings SET invoice_id = $1, payment_status = 'invoiced' WHERE id = $2",
      [invoice.id, bookingId]
    );

    res.json({ success: true, invoice });
  } catch (error) {
    console.error('Error creating invoice from booking:', error.message);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// PUT /api/invoices/:id - Update draft invoice
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { customerName, customerEmail, customerPhone, items, notes, terms, dueDate, taxRate, discountAmount } = req.body;

    // Verify invoice exists and is draft
    const existing = await pool.query(
      'SELECT status FROM invoices WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.rows[0].status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be edited' });

    // Recalculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const effectiveTaxRate = taxRate || 0;
    const taxAmount = subtotal * effectiveTaxRate;
    const effectiveDiscount = discountAmount || 0;
    const totalAmount = subtotal + taxAmount - effectiveDiscount;

    await pool.query(
      `UPDATE invoices SET
        customer_name = $1, customer_email = $2, customer_phone = $3,
        subtotal = $4, tax_rate = $5, tax_amount = $6, discount_amount = $7,
        total_amount = $8, amount_due = $8, notes = $9, terms = $10, due_date = $11,
        updated_at = NOW()
       WHERE id = $12 AND user_id = $13`,
      [customerName, customerEmail, customerPhone, subtotal, effectiveTaxRate,
       taxAmount, effectiveDiscount, totalAmount, notes, terms, dueDate, id, userId]
    );

    // Replace line items
    await pool.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);
    for (const item of items) {
      await pool.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, service_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, item.description, item.quantity, item.unitPrice, item.quantity * item.unitPrice, item.serviceId || null]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating invoice:', error.message);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// POST /api/invoices/:id/send - Send invoice to customer
router.post('/:id/send', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const invoiceResult = await pool.query(
      `SELECT i.*, u.business_name FROM invoices i
       JOIN users u ON u.id = i.user_id
       WHERE i.id = $1 AND i.user_id = $2`,
      [id, userId]
    );

    if (invoiceResult.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = invoiceResult.rows[0];

    if (!invoice.customer_email) {
      return res.status(400).json({ error: 'Customer email is required to send invoice' });
    }

    const paymentUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/pay/${invoice.payment_link_token}`;

    // Send email via SendGrid
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      await sgMail.send({
        to: invoice.customer_email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@sorceintegrations.com',
        subject: `Invoice ${invoice.invoice_number} from ${invoice.business_name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #d97706;">${invoice.business_name}</h2>
            <p>Hi ${invoice.customer_name},</p>
            <p>You have a new invoice.</p>
            <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Invoice:</strong> ${invoice.invoice_number}</p>
              <p style="margin: 8px 0 0;"><strong>Amount Due:</strong> $${parseFloat(invoice.amount_due).toFixed(2)}</p>
              ${invoice.due_date ? `<p style="margin: 8px 0 0;"><strong>Due Date:</strong> ${new Date(invoice.due_date).toLocaleDateString()}</p>` : ''}
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${paymentUrl}" style="background-color: #d97706; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Pay Now</a>
            </div>
            ${invoice.notes ? `<p style="color: #666; font-size: 14px;"><strong>Notes:</strong> ${invoice.notes}</p>` : ''}
          </div>
        `
      });
    } catch (emailErr) {
      console.error('Failed to send invoice email:', emailErr.message);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    // Update status
    await pool.query(
      "UPDATE invoices SET status = 'sent', sent_at = NOW(), payment_link = $1, updated_at = NOW() WHERE id = $2",
      [paymentUrl, id]
    );

    res.json({ success: true, message: `Invoice sent to ${invoice.customer_email}` });
  } catch (error) {
    console.error('Error sending invoice:', error.message);
    res.status(500).json({ error: 'Failed to send invoice' });
  }
});

// POST /api/invoices/:id/remind - Send payment reminder
router.post('/:id/remind', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT i.*, u.business_name FROM invoices i
       JOIN users u ON u.id = i.user_id
       WHERE i.id = $1 AND i.user_id = $2 AND i.status IN ('sent', 'viewed', 'overdue')`,
      [id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found or not sendable' });
    const invoice = result.rows[0];

    const paymentUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/pay/${invoice.payment_link_token}`;

    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    await sgMail.send({
      to: invoice.customer_email,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@sorceintegrations.com',
      subject: `Payment Reminder: Invoice ${invoice.invoice_number} from ${invoice.business_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #d97706;">Payment Reminder</h2>
          <p>Hi ${invoice.customer_name},</p>
          <p>This is a friendly reminder that invoice <strong>${invoice.invoice_number}</strong> for <strong>$${parseFloat(invoice.amount_due).toFixed(2)}</strong> is still outstanding.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${paymentUrl}" style="background-color: #d97706; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Pay Now</a>
          </div>
        </div>
      `
    });

    await pool.query('UPDATE invoices SET reminder_sent_at = NOW() WHERE id = $1', [id]);

    res.json({ success: true, message: 'Reminder sent' });
  } catch (error) {
    console.error('Error sending reminder:', error.message);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

// POST /api/invoices/:id/void - Void an invoice
router.post('/:id/void', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      "UPDATE invoices SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status != 'paid' RETURNING *",
      [id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found or already paid' });

    // If linked to booking, reset payment status
    if (result.rows[0].booking_id) {
      await pool.query(
        "UPDATE bookings SET payment_status = 'unpaid', invoice_id = NULL WHERE id = $1",
        [result.rows[0].booking_id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error voiding invoice:', error.message);
    res.status(500).json({ error: 'Failed to void invoice' });
  }
});

// DELETE /api/invoices/:id - Delete draft invoice
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM invoices WHERE id = $1 AND user_id = $2 AND status = 'draft' RETURNING id",
      [id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Draft invoice not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting invoice:', error.message);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

module.exports = router;
