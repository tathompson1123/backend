const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { getProcessorForUser } = require('../payment/ProcessorFactory');

// GET /api/payments - List payments
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, startDate, endDate } = req.query;

    let query = 'SELECT * FROM payments WHERE user_id = $1';
    const params = [userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }
    if (startDate) {
      paramCount++;
      query += ` AND created_at >= $${paramCount}`;
      params.push(startDate);
    }
    if (endDate) {
      paramCount++;
      query += ` AND created_at <= $${paramCount}`;
      params.push(endDate);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ payments: result.rows });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// GET /api/payments/:id - Payment detail
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM payments WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
    res.json({ payment: result.rows[0] });
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// POST /api/payments/:id/refund - Initiate refund
router.post('/:id/refund', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { amount } = req.body; // null = full refund

    const paymentResult = await pool.query(
      'SELECT * FROM payments WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (paymentResult.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
    const payment = paymentResult.rows[0];

    if (payment.status !== 'succeeded') {
      return res.status(400).json({ error: 'Can only refund successful payments' });
    }

    const processor = await getProcessorForUser(userId, pool, payment.processor);
    if (!processor) return res.status(400).json({ error: 'Payment processor not connected' });

    const refundResult = await processor.refundPayment(payment.processor_payment_id, amount);

    const refundAmount = amount || payment.amount;
    const newRefundTotal = parseFloat(payment.refund_amount || 0) + refundAmount;
    const newStatus = newRefundTotal >= parseFloat(payment.amount) ? 'refunded' : 'partially_refunded';

    await pool.query(
      `UPDATE payments SET refund_amount = $1, status = $2, refunded_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [newRefundTotal, newStatus, id]
    );

    // Update invoice if linked
    if (payment.invoice_id) {
      await pool.query(
        `UPDATE invoices SET amount_paid = amount_paid - $1, amount_due = amount_due + $1,
         status = CASE WHEN amount_paid - $1 <= 0 THEN 'refunded' ELSE 'partial' END,
         updated_at = NOW() WHERE id = $2`,
        [refundAmount, payment.invoice_id]
      );
    }

    // Update booking if linked
    if (payment.booking_id) {
      await pool.query(
        "UPDATE bookings SET payment_status = $1 WHERE id = $2",
        [newStatus === 'refunded' ? 'refunded' : 'partial', payment.booking_id]
      );
    }

    res.json({ success: true, refund: refundResult });
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// POST /api/payments/record-manual - Record cash/check payment
router.post('/record-manual', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { invoiceId, amount, paymentMethod, notes } = req.body;

    if (!invoiceId || !amount) {
      return res.status(400).json({ error: 'Invoice ID and amount are required' });
    }

    // Verify invoice
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, userId]
    );

    if (invoiceResult.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = invoiceResult.rows[0];

    // Create payment record
    const paymentResult = await pool.query(
      `INSERT INTO payments (user_id, invoice_id, booking_id, customer_id, amount, processor, payment_method, status, metadata)
       VALUES ($1, $2, $3, $4, $5, 'manual', $6, 'succeeded', $7)
       RETURNING *`,
      [userId, invoiceId, invoice.booking_id, invoice.customer_id, amount,
       paymentMethod || 'cash', JSON.stringify({ notes: notes || '' })]
    );

    // Update invoice
    const newAmountPaid = parseFloat(invoice.amount_paid || 0) + parseFloat(amount);
    const newAmountDue = parseFloat(invoice.total_amount) - newAmountPaid;
    const newStatus = newAmountDue <= 0 ? 'paid' : 'partial';

    await pool.query(
      `UPDATE invoices SET amount_paid = $1, amount_due = $2, status = $3,
       paid_at = CASE WHEN $3 = 'paid' THEN NOW() ELSE paid_at END,
       updated_at = NOW() WHERE id = $4`,
      [newAmountPaid, Math.max(0, newAmountDue), newStatus, invoiceId]
    );

    // Update booking payment status
    if (invoice.booking_id) {
      await pool.query(
        "UPDATE bookings SET payment_status = $1 WHERE id = $2",
        [newStatus === 'paid' ? 'paid' : 'partial', invoice.booking_id]
      );
    }

    res.json({ success: true, payment: paymentResult.rows[0] });
  } catch (error) {
    console.error('Error recording manual payment:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

module.exports = router;
