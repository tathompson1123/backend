const { pool } = require('../config/database');

/**
 * Record a successful payment and update invoice/booking statuses
 */
async function recordPayment({ userId, invoiceId, bookingId, customerId, amount, processor, processorPaymentId, paymentMethod, cardLastFour, cardBrand, processorFee }) {
  // Create payment record
  const paymentResult = await pool.query(
    `INSERT INTO payments (user_id, invoice_id, booking_id, customer_id, amount, processor, processor_payment_id, payment_method, card_last_four, card_brand, processor_fee, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'succeeded')
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [userId, invoiceId, bookingId, customerId, amount, processor, processorPaymentId, paymentMethod || 'card', cardLastFour, cardBrand, processorFee]
  );

  if (paymentResult.rows.length === 0) {
    console.log(`⚠️ Payment ${processorPaymentId} already recorded (idempotent)`);
    return;
  }

  // Update invoice
  if (invoiceId) {
    const invoiceResult = await pool.query('SELECT total_amount, amount_paid FROM invoices WHERE id = $1', [invoiceId]);
    if (invoiceResult.rows.length > 0) {
      const invoice = invoiceResult.rows[0];
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
      if (bookingId || invoice.booking_id) {
        await pool.query(
          "UPDATE bookings SET payment_status = $1 WHERE id = $2",
          [newStatus === 'paid' ? 'paid' : 'partial', bookingId || invoice.booking_id]
        );
      }
    }
  }

  console.log(`✅ Payment recorded: ${processorPaymentId} ($${amount}) via ${processor}`);
}

// Stripe Connect webhook handler
async function stripeConnect(req, res) {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`📨 Stripe Connect webhook: ${event.type}`);

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata || {};
      const invoiceId = metadata.invoiceId ? parseInt(metadata.invoiceId) : null;
      const userId = metadata.userId ? parseInt(metadata.userId) : null;

      if (invoiceId && userId) {
        const invoiceResult = await pool.query('SELECT booking_id, customer_id FROM invoices WHERE id = $1', [invoiceId]);
        const invoice = invoiceResult.rows[0];

        await recordPayment({
          userId,
          invoiceId,
          bookingId: invoice?.booking_id,
          customerId: invoice?.customer_id,
          amount: paymentIntent.amount / 100,
          processor: 'stripe',
          processorPaymentId: paymentIntent.id,
          paymentMethod: 'card',
          processorFee: paymentIntent.application_fee_amount ? paymentIntent.application_fee_amount / 100 : null
        });
      }
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const refundAmount = charge.amount_refunded / 100;

      await pool.query(
        `UPDATE payments SET refund_amount = $1, status = CASE WHEN $1 >= amount THEN 'refunded' ELSE 'partially_refunded' END,
         refunded_at = NOW(), updated_at = NOW()
         WHERE processor_payment_id = $2 OR processor_payment_id = $3`,
        [refundAmount, charge.payment_intent, charge.id]
      );
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// Square webhook handler
async function square(req, res) {
  try {
    const body = JSON.parse(req.body.toString());
    console.log(`📨 Square webhook: ${body.type}`);

    if (body.type === 'payment.completed') {
      const payment = body.data?.object?.payment;
      if (!payment) return res.json({ received: true });

      const referenceId = payment.reference_id;
      const invoiceId = referenceId ? parseInt(referenceId) : null;

      if (invoiceId) {
        const invoiceResult = await pool.query('SELECT user_id, booking_id, customer_id FROM invoices WHERE id = $1', [invoiceId]);
        if (invoiceResult.rows.length > 0) {
          const invoice = invoiceResult.rows[0];
          await recordPayment({
            userId: invoice.user_id,
            invoiceId,
            bookingId: invoice.booking_id,
            customerId: invoice.customer_id,
            amount: Number(payment.amount_money.amount) / 100,
            processor: 'square',
            processorPaymentId: payment.id,
            paymentMethod: payment.source_type?.toLowerCase() || 'card'
          });
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Square webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// PayPal webhook handler
async function paypal(req, res) {
  try {
    const body = JSON.parse(req.body.toString());
    console.log(`📨 PayPal webhook: ${body.event_type}`);

    if (body.event_type === 'CHECKOUT.ORDER.APPROVED' || body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource = body.resource;
      const captureAmount = resource.amount?.value || resource.purchase_units?.[0]?.amount?.value;
      const referenceId = resource.purchase_units?.[0]?.reference_id || resource.supplementary_data?.related_ids?.order_id;

      if (referenceId) {
        const invoiceId = parseInt(referenceId);
        const invoiceResult = await pool.query('SELECT user_id, booking_id, customer_id FROM invoices WHERE id = $1', [invoiceId]);

        if (invoiceResult.rows.length > 0) {
          const invoice = invoiceResult.rows[0];
          await recordPayment({
            userId: invoice.user_id,
            invoiceId,
            bookingId: invoice.booking_id,
            customerId: invoice.customer_id,
            amount: parseFloat(captureAmount),
            processor: 'paypal',
            processorPaymentId: resource.id,
            paymentMethod: 'paypal'
          });
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { stripeConnect, square, paypal, recordPayment };
