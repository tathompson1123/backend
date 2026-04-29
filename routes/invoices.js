const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { getProcessorForUser } = require('../payment/ProcessorFactory');
const { syncSquareInvoices } = require('../utils/squareSync');

// GET /api/invoices - List invoices
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Clean up orphaned invoices from disconnected processors
    await pool.query(
      `DELETE FROM invoices WHERE user_id = $1
       AND payment_processor IS NOT NULL
       AND payment_processor NOT IN (
         SELECT processor FROM payment_connections WHERE user_id = $1 AND is_active = true
       )`,
      [userId]
    );

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
    let accessToken, locationId;
    try {
      const { getValidSquareToken } = require('../utils/squareAuth');
      ({ accessToken, locationId } = await getValidSquareToken(userId));
    } catch {
      return res.json({ success: true, synced: 0, skipped: 'Square not connected' });
    }
    const synced = await syncSquareInvoices(userId, accessToken, locationId, pool);
    res.json({ success: true, synced });
  } catch (error) {
    console.error('Square invoices sync error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/invoices/settings - Default tax rate
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [req.user.userId]);
    const rate = parseFloat(result.rows[0]?.default_tax_rate || 0);
    res.json({ defaultTaxRate: parseFloat((rate * 100).toFixed(4)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/invoices/catalog - Saved fees/supplies catalog
router.get('/catalog', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM invoice_items_catalog WHERE user_id = $1 AND active = true ORDER BY category, name',
      [req.user.userId]
    );
    res.json({ items: result.rows });
  } catch (error) {
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

    // Calculate totals — tax only applies to taxable line items
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const taxableSubtotal = items.reduce((sum, item) => item.taxable !== false ? sum + (item.quantity * item.unitPrice) : sum, 0);
    const effectiveTaxRate = taxRate || 0;
    const taxAmount = taxableSubtotal * effectiveTaxRate;
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
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, service_id, taxable)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoice.id, item.description, item.quantity, item.unitPrice, item.quantity * item.unitPrice, item.serviceId || null, item.taxable !== false]
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

// ── Invoice Settings (tax rate) ──────────────────────────────────────────────

router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const rate = parseFloat(req.body.defaultTaxRate); // e.g. 9.8 → stored as 0.098
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({ error: 'Invalid tax rate' });
    }
    await pool.query('UPDATE users SET default_tax_rate = $1 WHERE id = $2', [rate / 100, req.user.userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/invoices/:id - Update draft invoice
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { customerName, customerEmail, customerPhone, items, notes, terms, dueDate, taxRate, discountAmount } = req.body;

    // Verify invoice exists and is editable
    const existing = await pool.query(
      'SELECT status FROM invoices WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    if (['paid', 'cancelled', 'refunded'].includes(existing.rows[0].status)) {
      return res.status(400).json({ error: 'Paid, cancelled, or refunded invoices cannot be edited' });
    }

    // Recalculate totals — tax only applies to taxable line items
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const taxableSubtotal = items.reduce((sum, item) => item.taxable !== false ? sum + (item.quantity * item.unitPrice) : sum, 0);
    const effectiveTaxRate = taxRate || 0;
    const taxAmount = taxableSubtotal * effectiveTaxRate;
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
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, service_id, taxable)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, item.description, item.quantity, item.unitPrice, item.quantity * item.unitPrice, item.serviceId || null, item.taxable !== false]
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
      `SELECT i.*, u.business_name, u.email as owner_email FROM invoices i
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

    // Fetch line items for the email
    const itemsResult = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [id]);

    // Send email via SendGrid
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const { buildInvoiceEmailHtml } = require('../utils/invoiceEmail');

      await sgMail.send({
        to: invoice.customer_email,
        from: { name: invoice.business_name, email: 'noreply@sorceintegrations.com' },
        replyTo: invoice.owner_email ? { name: invoice.business_name, email: invoice.owner_email } : undefined,
        subject: `Invoice ${invoice.invoice_number} from ${invoice.business_name}`,
        html: buildInvoiceEmailHtml({
          businessName: invoice.business_name,
          customerName: invoice.customer_name,
          invoiceNumber: invoice.invoice_number,
          amountDue: invoice.amount_due,
          dueDate: invoice.due_date,
          paymentUrl,
          items: itemsResult.rows,
          subtotal: invoice.subtotal,
          taxAmount: invoice.tax_amount,
          totalAmount: invoice.total_amount,
          notes: invoice.notes,
        }),
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
      `SELECT i.*, u.business_name, u.email as owner_email FROM invoices i
       JOIN users u ON u.id = i.user_id
       WHERE i.id = $1 AND i.user_id = $2 AND i.status IN ('sent', 'viewed', 'overdue')`,
      [id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found or not sendable' });
    const invoice = result.rows[0];

    const paymentUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/pay/${invoice.payment_link_token}`;

    // Fetch line items for the email
    const itemsResult = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [id]);

    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const { buildInvoiceEmailHtml } = require('../utils/invoiceEmail');

    await sgMail.send({
      to: invoice.customer_email,
      from: { name: invoice.business_name, email: 'noreply@sorceintegrations.com' },
      replyTo: invoice.owner_email ? { name: invoice.business_name, email: invoice.owner_email } : undefined,
      subject: `Payment Reminder: Invoice ${invoice.invoice_number} from ${invoice.business_name}`,
      html: buildInvoiceEmailHtml({
        businessName: invoice.business_name,
        customerName: invoice.customer_name,
        invoiceNumber: invoice.invoice_number,
        amountDue: invoice.amount_due,
        dueDate: invoice.due_date,
        paymentUrl,
        items: itemsResult.rows,
        subtotal: invoice.subtotal,
        taxAmount: invoice.tax_amount,
        totalAmount: invoice.total_amount,
        notes: invoice.notes,
        isReminder: true,
      }),
    });

    await pool.query('UPDATE invoices SET reminder_sent_at = NOW() WHERE id = $1', [id]);

    res.json({ success: true, message: 'Reminder sent' });
  } catch (error) {
    console.error('Error sending reminder:', error.message);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

// POST /api/invoices/:id/send-square - Create in Square (if needed) + publish so Square emails the customer
router.post('/:id/send-square', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { randomUUID } = require('crypto');
    const { Client, Environment } = require('square/legacy');

    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (invoiceResult.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = invoiceResult.rows[0];

    if (!invoice.customer_email) {
      return res.status(400).json({ error: 'Customer email is required to send via Square' });
    }

    let squareAccessToken, squareLocationId;
    try {
      const { getValidSquareToken } = require('../utils/squareAuth');
      ({ accessToken: squareAccessToken, locationId: squareLocationId } = await getValidSquareToken(userId));
    } catch {
      return res.status(400).json({ error: 'Square not connected. Connect Square in Payment Settings first.' });
    }

    const ownerResult = await pool.query('SELECT email, business_name FROM users WHERE id = $1', [userId]);
    const ownerEmail = ownerResult.rows[0]?.email || null;

    const client = new Client({
      bearerAuthCredentials: { accessToken: squareAccessToken },
      environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? Environment.Sandbox : Environment.Production,
    });

    // Use raw fetch for all Square invoice API calls — the legacy SDK schema
    // strips accepted_payment_methods so we bypass it entirely for invoices.
    const sqBase = process.env.SQUARE_ENVIRONMENT === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';
    const sqHdrs = {
      'Authorization': `Bearer ${squareAccessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2025-01-23',
    };

    let squareInvoiceId = invoice.square_invoice_id;
    let version = 0;

    if (!squareInvoiceId) {
      const dueDate = invoice.due_date
        ? new Date(invoice.due_date).toISOString().split('T')[0]
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const amountCents = Math.round(parseFloat(invoice.total_amount || 0) * 100);
      if (amountCents <= 0) {
        return res.status(400).json({ error: 'Invoice total must be greater than $0 to send via Square' });
      }

      const nameParts = (invoice.customer_name || '').trim().split(/\s+/);
      const givenName = nameParts[0] || null;
      const familyName = nameParts.slice(1).join(' ') || null;

      // Step 1: Find or create a Square Customer (invoice recipient requires customer_id)
      let customerId;
      const { result: searchResult } = await client.customersApi.searchCustomers({
        query: { filter: { emailAddress: { exact: invoice.customer_email } } }
      });
      if (searchResult.customers?.length > 0) {
        const existing = searchResult.customers[0];
        customerId = existing.id;
        // Update name if our invoice has a name and it differs from what's in Square
        if (givenName && existing.givenName !== givenName) {
          const updateBody = {};
          if (givenName) updateBody.givenName = givenName;
          if (familyName) updateBody.familyName = familyName;
          else updateBody.familyName = '';
          await client.customersApi.updateCustomer(customerId, updateBody);
        }
      } else {
        const newCustBody = { emailAddress: invoice.customer_email, idempotencyKey: randomUUID() };
        if (givenName) newCustBody.givenName = givenName;
        if (familyName) newCustBody.familyName = familyName;
        const { result: newCust } = await client.customersApi.createCustomer(newCustBody);
        customerId = newCust.customer.id;
      }

      // Step 2: Create a Square Order to set the invoice amount (required by Square Invoice API)
      const itemsResult = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [id]);
      const lineItems = itemsResult.rows.length > 0
        ? itemsResult.rows.map(item => ({
            name: (item.description || 'Service').slice(0, 255),
            quantity: String(parseFloat(item.quantity) || 1),
            basePriceMoney: { amount: BigInt(Math.round(parseFloat(item.unit_price) * 100)), currency: 'USD' },
          }))
        : [{ name: invoice.notes || 'Service', quantity: '1', basePriceMoney: { amount: BigInt(amountCents), currency: 'USD' } }];

      // Append tax as a line item if the invoice has tax (tax is stored at invoice level, not as a line item)
      const taxAmountCents = Math.round(parseFloat(invoice.tax_amount || 0) * 100);
      if (taxAmountCents > 0) {
        lineItems.push({
          name: 'Sales Tax',
          quantity: '1',
          basePriceMoney: { amount: BigInt(taxAmountCents), currency: 'USD' },
        });
      }

      // Append discount as a negative line item if applicable
      const discountAmountCents = Math.round(parseFloat(invoice.discount_amount || 0) * 100);
      if (discountAmountCents > 0) {
        lineItems.push({
          name: 'Discount',
          quantity: '1',
          basePriceMoney: { amount: BigInt(-discountAmountCents), currency: 'USD' },
        });
      }

      const { result: orderResult } = await client.ordersApi.createOrder({
        order: { locationId: squareLocationId, customerId, lineItems },
        idempotencyKey: randomUUID(),
      });
      const orderId = orderResult.order.id;

      // Step 3: Create the invoice via raw fetch.
      // accepted_payment_methods is a TOP-LEVEL invoice field, NOT inside payment_requests.
      // payment_requests only needs request_type + due_date.
      const invoiceBody = {
        idempotency_key: randomUUID(),
        invoice: {
          location_id: squareLocationId,
          order_id: orderId,
          primary_recipient: { customer_id: customerId },
          payment_requests: [{
            request_type: 'BALANCE',
            due_date: dueDate,
          }],
          accepted_payment_methods: {
            card: true,
            square_gift_card: false,
            bank_account: false,
            buy_now_pay_later: false,
            cash_app_pay: false,
          },
          delivery_method: 'EMAIL',
          title: `Invoice for ${invoice.customer_name || invoice.customer_email}`,
          description: [
            invoice.notes?.trim() || null,
            ownerEmail ? `If you have questions about this invoice, reply to ${ownerEmail}.` : null,
          ].filter(Boolean).join('\n\n').slice(0, 500),
        },
      };

      const createResp = await fetch(`${sqBase}/v2/invoices`, {
        method: 'POST', headers: sqHdrs, body: JSON.stringify(invoiceBody),
      });
      const createData = await createResp.json();
      if (!createResp.ok) {
        const errs = createData.errors?.map(e => `${e.code}: ${e.detail}`).join('; ') || JSON.stringify(createData);
        throw new Error(errs);
      }
      squareInvoiceId = createData.invoice.id;
      version = createData.invoice.version;
      await pool.query('UPDATE invoices SET square_invoice_id = $1 WHERE id = $2', [squareInvoiceId, id]);
    } else {
      const getResp = await fetch(`${sqBase}/v2/invoices/${squareInvoiceId}`, { headers: sqHdrs });
      const getData = await getResp.json();
      version = getData.invoice.version;
    }

    // Publish — Square emails the customer with a payment link
    const publishResp = await fetch(`${sqBase}/v2/invoices/${squareInvoiceId}/publish`, {
      method: 'POST',
      headers: sqHdrs,
      body: JSON.stringify({ version, idempotency_key: randomUUID() }),
    });
    if (!publishResp.ok) {
      const publishData = await publishResp.json();
      const errs = publishData.errors?.map(e => `${e.code}: ${e.detail}`).join('; ') || JSON.stringify(publishData);
      throw new Error(errs);
    }

    await pool.query(
      "UPDATE invoices SET status = 'sent', sent_at = NOW(), payment_processor = 'square', updated_at = NOW() WHERE id = $1",
      [id]
    );

    res.json({ success: true, message: `Invoice sent via Square to ${invoice.customer_email}` });
  } catch (error) {
    // Surface the actual Square API error details
    const squareErrors = error.errors?.map(e => `${e.code}: ${e.detail}`).join('; ');
    const msg = squareErrors || error.message || 'Failed to send via Square';
    console.error('Error sending invoice via Square:', msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/invoices/:id/send-stripe - Create in Stripe + finalize + send so Stripe emails the customer
router.post('/:id/send-stripe', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const Stripe = require('stripe');

    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (invoiceResult.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = invoiceResult.rows[0];

    if (!invoice.customer_email) {
      return res.status(400).json({ error: 'Customer email is required to send via Stripe' });
    }

    const connResult = await pool.query(
      "SELECT * FROM payment_connections WHERE user_id = $1 AND processor = 'stripe' AND is_active = true",
      [userId]
    );
    if (connResult.rows.length === 0) {
      return res.status(400).json({ error: 'Stripe not connected. Connect Stripe in Payment Settings first.' });
    }
    const conn = connResult.rows[0];
    const stripe = new Stripe(conn.stripe_access_token);

    // Find or create Stripe customer
    let customerId;
    const existing = await stripe.customers.list({ email: invoice.customer_email, limit: 1 });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: invoice.customer_email,
        name: invoice.customer_name || undefined,
      });
      customerId = customer.id;
    }

    // Create invoice item
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: Math.round(parseFloat(invoice.total_amount) * 100),
      currency: 'usd',
      description: `${invoice.invoice_number}${invoice.notes ? ' — ' + invoice.notes : ''}`,
    });

    // Create invoice
    const daysUntilDue = invoice.due_date
      ? Math.max(1, Math.ceil((new Date(invoice.due_date) - new Date()) / (1000 * 60 * 60 * 24)))
      : 30;

    const stripeInvoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: daysUntilDue,
      metadata: { local_invoice_id: id, invoice_number: invoice.invoice_number },
    });

    // Finalize then send — Stripe emails the customer with a hosted payment page
    await stripe.invoices.finalizeInvoice(stripeInvoice.id);
    await stripe.invoices.sendInvoice(stripeInvoice.id);

    await pool.query(
      "UPDATE invoices SET status = 'sent', sent_at = NOW(), payment_processor = 'stripe', stripe_invoice_id = $1, updated_at = NOW() WHERE id = $2",
      [stripeInvoice.id, id]
    );

    res.json({ success: true, message: `Invoice sent via Stripe to ${invoice.customer_email}` });
  } catch (error) {
    console.error('Error sending invoice via Stripe:', error.message);
    res.status(500).json({ error: error.message || 'Failed to send via Stripe' });
  }
});

// POST /api/invoices/:id/send-paypal - Create in PayPal + send so PayPal emails the customer
router.post('/:id/send-paypal', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (invoiceResult.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = invoiceResult.rows[0];

    if (!invoice.customer_email) {
      return res.status(400).json({ error: 'Customer email is required to send via PayPal' });
    }

    const connResult = await pool.query(
      "SELECT * FROM payment_connections WHERE user_id = $1 AND processor = 'paypal' AND is_active = true",
      [userId]
    );
    if (connResult.rows.length === 0) {
      return res.status(400).json({ error: 'PayPal not connected. Connect PayPal in Payment Settings first.' });
    }
    const conn = connResult.rows[0];

    const paypalBase = process.env.PAYPAL_ENVIRONMENT === 'sandbox'
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';

    // Get PayPal access token
    const tokenRes = await fetch(`${paypalBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${conn.paypal_client_id}:${conn.paypal_client_secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) throw new Error('Failed to get PayPal access token');
    const { access_token } = await tokenRes.json();

    const dueDate = invoice.due_date
      ? new Date(invoice.due_date).toISOString().split('T')[0]
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const nameParts = (invoice.customer_name || '').split(' ');

    // Create PayPal invoice
    const createRes = await fetch(`${paypalBase}/v2/invoicing/invoices`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        detail: {
          invoice_number: invoice.invoice_number,
          invoice_date: new Date().toISOString().split('T')[0],
          currency_code: 'USD',
          note: invoice.notes || '',
          payment_term: { term_type: 'DUE_ON_DATE', due_date: dueDate },
        },
        primary_recipients: [{
          billing_info: {
            email_address: invoice.customer_email,
            name: { given_name: nameParts[0] || '', surname: nameParts.slice(1).join(' ') || '' },
          },
        }],
        items: [{
          name: `Invoice ${invoice.invoice_number}`,
          description: invoice.notes || `Payment for ${invoice.customer_name}`,
          quantity: '1',
          unit_amount: { currency_code: 'USD', value: parseFloat(invoice.total_amount).toFixed(2) },
        }],
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`PayPal invoice creation failed: ${body}`);
    }
    const paypalInvoice = await createRes.json();

    // Send — PayPal emails the customer with a payment link
    const sendRes = await fetch(`${paypalBase}/v2/invoicing/invoices/${paypalInvoice.id}/send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ send_to_invoicer: true }),
    });
    if (!sendRes.ok) {
      const body = await sendRes.text();
      throw new Error(`PayPal invoice send failed: ${body}`);
    }

    await pool.query(
      "UPDATE invoices SET status = 'sent', sent_at = NOW(), payment_processor = 'paypal', paypal_invoice_id = $1, updated_at = NOW() WHERE id = $2",
      [paypalInvoice.id, id]
    );

    res.json({ success: true, message: `Invoice sent via PayPal to ${invoice.customer_email}` });
  } catch (error) {
    console.error('Error sending invoice via PayPal:', error.message);
    res.status(500).json({ error: error.message || 'Failed to send via PayPal' });
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

// ── Invoice Items Catalog (fees, supplies, etc.) ─────────────────────────────

router.post('/catalog', authenticateToken, async (req, res) => {
  try {
    const { name, category, amountType, amount, taxable } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    const result = await pool.query(
      'INSERT INTO invoice_items_catalog (user_id, name, category, amount_type, amount, taxable) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.userId, name.trim(), category || 'fee', amountType || 'fixed', parseFloat(amount) || 0, taxable !== undefined ? taxable : false]
    );
    res.json({ item: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/catalog/:itemId', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM invoice_items_catalog WHERE id = $1 AND user_id = $2',
      [req.params.itemId, req.user.userId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
