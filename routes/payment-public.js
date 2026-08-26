const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { getProcessorForUser } = require('../payment/ProcessorFactory');

// GET /api/pay/:token - Get invoice details for payment page (NO AUTH)
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `SELECT i.invoice_number, i.customer_name, i.customer_email,
              i.subtotal, i.tax_amount, i.discount_amount, i.total_amount,
              i.amount_paid, i.amount_due, i.status, i.due_date, i.notes,
              i.payment_processor, i.user_id,
              u.business_name,
              json_agg(json_build_object(
                'name', ii.name, 'description', ii.description, 'quantity', ii.quantity,
                'unit_price', ii.unit_price, 'amount', ii.amount, 'taxable', ii.taxable
              )) FILTER (WHERE ii.id IS NOT NULL) as items
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
       WHERE i.payment_link_token = $1
       GROUP BY i.id, u.business_name`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = result.rows[0];

    if (invoice.status === 'paid') {
      return res.json({ invoice, paid: true });
    }
    if (invoice.status === 'cancelled') {
      return res.status(410).json({ error: 'This invoice has been cancelled' });
    }

    // Mark as viewed
    await pool.query(
      "UPDATE invoices SET viewed_at = COALESCE(viewed_at, NOW()), status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END WHERE payment_link_token = $1",
      [token]
    );

    // Get available payment processors for this user
    const connections = await pool.query(
      'SELECT processor, is_primary FROM payment_connections WHERE user_id = $1 AND is_active = true',
      [invoice.user_id]
    );

    res.json({
      invoice,
      paid: false,
      processors: connections.rows.map(c => ({ name: c.processor, primary: c.is_primary }))
    });
  } catch (error) {
    console.error('Error fetching payment page:', error.message);
    res.status(500).json({ error: 'Failed to load invoice' });
  }
});

// POST /api/pay/:token/create-session - Create checkout session (NO AUTH)
router.post('/:token/create-session', async (req, res) => {
  try {
    const { token } = req.params;
    const { processor: preferredProcessor } = req.body;

    const invoiceResult = await pool.query(
      `SELECT i.*, u.business_name FROM invoices i
       JOIN users u ON u.id = i.user_id
       WHERE i.payment_link_token = $1 AND i.status NOT IN ('paid', 'cancelled')`,
      [token]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found or already paid' });
    }

    const invoice = invoiceResult.rows[0];
    const amountToPay = parseFloat(invoice.amount_due);

    if (amountToPay <= 0) {
      return res.status(400).json({ error: 'No amount due' });
    }

    const processor = await getProcessorForUser(invoice.user_id, pool, preferredProcessor);
    if (!processor) {
      return res.status(400).json({ error: 'No payment processor configured' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
    const successUrl = `${frontendUrl}/pay/${token}?success=true`;
    const cancelUrl = `${frontendUrl}/pay/${token}?cancelled=true`;

    const session = await processor.createCheckoutSession({
      amount: amountToPay,
      currency: 'USD',
      description: `Invoice ${invoice.invoice_number} - ${invoice.business_name}`,
      customerEmail: invoice.customer_email,
      successUrl,
      cancelUrl,
      metadata: {
        invoiceId: invoice.id.toString(),
        invoiceNumber: invoice.invoice_number,
        userId: invoice.user_id.toString()
      }
    });

    // Store processor choice on invoice
    await pool.query(
      'UPDATE invoices SET payment_processor = $1 WHERE id = $2',
      [processor.processorName, invoice.id]
    );

    res.json({
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
      processor: processor.processorName
    });
  } catch (error) {
    console.error('Error creating payment session:', error.message);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

module.exports = router;
