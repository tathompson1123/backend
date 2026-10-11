const crypto = require('crypto');
const { pool } = require('../config/database');

/**
 * Record a successful payment and update invoice/booking statuses
 */
async function recordPayment({ userId, invoiceId, bookingId, customerId, amount, processor, processorPaymentId, paymentMethod, cardLastFour, cardBrand, processorFee }) {
  // Never trust the caller's idea of who owns the invoice.
  if (invoiceId) {
    const owner = await pool.query('SELECT user_id FROM invoices WHERE id = $1', [invoiceId]);
    if (!owner.rows[0] || Number(owner.rows[0].user_id) !== Number(userId)) {
      console.warn(`🚫 recordPayment: invoice ${invoiceId} does not belong to user ${userId} — ignored`);
      return;
    }
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    console.warn(`🚫 recordPayment: bad amount "${amount}" for ${processorPaymentId} — ignored`);
    return;
  }

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
    const invoiceResult = await pool.query('SELECT total_amount, amount_paid, booking_id FROM invoices WHERE id = $1', [invoiceId]);
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

// Webhook payloads are only a hint about WHAT to look at. Square and PayPal send nothing we
// can authenticate cheaply, so a payment is recorded only after we ask the processor itself,
// using the invoice owner's own credentials, and it confirms the payment exists, is
// complete, and belongs to that invoice. Amount and status come from that response, never
// from the webhook body. (These endpoints used to take the body at face value, so anyone
// could POST a fake payment.completed and mark any invoice paid.)
async function processorFor(userId, name) {
  const { getProcessorForUser } = require('../payment/ProcessorFactory');
  return getProcessorForUser(userId, pool, name);
}

// Extra layer for Square when the signature key is configured: a bad signature is rejected
// outright. The re-fetch below is what makes this safe, so an unset key only skips this.
function squareSignatureOk(req) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) return true;
  const sig = req.headers['x-square-hmacsha256-signature'] || req.headers['x-square-signature'];
  if (!sig) return false;
  const bases = [process.env.BACKEND_URL, process.env.PRODUCTION_BACKEND_URL, 'https://backend-production-ab50.up.railway.app']
    .filter(Boolean).map(b => b.replace(/\/+$/, '') + '/api/webhooks/square');
  return bases.some(url => {
    const expected = crypto.createHmac('sha256', key).update(url + req.body.toString()).digest('base64');
    const a = Buffer.from(expected), b = Buffer.from(String(sig));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
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
      return res.status(400).send('Webhook Error: invalid signature');
    }

    console.log(`📨 Stripe Connect webhook: ${event.type}`);

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata || {};
      const invoiceId = metadata.invoiceId ? parseInt(metadata.invoiceId) : null;

      if (invoiceId) {
        // The invoice, not the metadata, says who owns it. Metadata is set by whichever
        // connected account created the PaymentIntent, so a merchant could name someone
        // else's invoice. The event's own `account` must be the owner's connected account.
        const invoiceResult = await pool.query(
          `SELECT i.user_id, i.booking_id, i.customer_id, pc.stripe_account_id
             FROM invoices i
             LEFT JOIN payment_connections pc
               ON pc.user_id = i.user_id AND pc.processor = 'stripe' AND pc.is_active = true
            WHERE i.id = $1`, [invoiceId]);
        const invoice = invoiceResult.rows[0];
        if (!invoice) {
          console.warn(`Stripe webhook: invoice ${invoiceId} not found`);
        } else if (!event.account || event.account !== invoice.stripe_account_id) {
          console.warn(`🚫 Stripe webhook: account ${event.account} does not own invoice ${invoiceId} — ignored`);
        } else {
          await recordPayment({
            userId: invoice.user_id,
            invoiceId,
            bookingId: invoice.booking_id,
            customerId: invoice.customer_id,
            amount: (paymentIntent.amount_received != null ? paymentIntent.amount_received : paymentIntent.amount) / 100,
            processor: 'stripe',
            processorPaymentId: paymentIntent.id,
            paymentMethod: 'card',
            processorFee: paymentIntent.application_fee_amount ? paymentIntent.application_fee_amount / 100 : null
          });
        }
      }
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const refundAmount = charge.amount_refunded / 100;

      await pool.query(
        `UPDATE payments SET refund_amount = $1, status = CASE WHEN $1 >= amount THEN 'refunded' ELSE 'partially_refunded' END,
         refunded_at = NOW(), updated_at = NOW()
         WHERE (processor_payment_id = $2 OR processor_payment_id = $3)
           AND processor = 'stripe'`,
        [refundAmount, charge.payment_intent, charge.id]
      );
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// Square webhook handler
async function square(req, res) {
  try {
    if (!squareSignatureOk(req)) {
      console.warn('🚫 Square webhook with bad signature rejected');
      return res.status(403).json({ error: 'Invalid signature' });
    }
    const body = JSON.parse(req.body.toString());
    console.log(`📨 Square webhook: ${body.type}`);

    if (body.type === 'payment.completed' || body.type === 'payment.updated') {
      const claimed = body.data?.object?.payment;
      if (!claimed?.id) return res.json({ received: true });

      const invoiceId = claimed.reference_id ? parseInt(claimed.reference_id) : null;
      if (invoiceId) {
        const invoiceResult = await pool.query('SELECT user_id, booking_id, customer_id FROM invoices WHERE id = $1', [invoiceId]);
        if (invoiceResult.rows.length > 0) {
          const invoice = invoiceResult.rows[0];
          // Ask Square, as the invoice's owner, whether this payment is real.
          const processor = await processorFor(invoice.user_id, 'square');
          const { result } = await processor.client.paymentsApi.getPayment(claimed.id);
          const real = result?.payment;
          if (real && String(real.status).toUpperCase() === 'COMPLETED' && String(real.referenceId) === String(invoiceId)) {
            await recordPayment({
              userId: invoice.user_id,
              invoiceId,
              bookingId: invoice.booking_id,
              customerId: invoice.customer_id,
              amount: Number(real.amountMoney.amount) / 100,
              processor: 'square',
              processorPaymentId: real.id,
              paymentMethod: real.sourceType?.toLowerCase() || 'card'
            });
          } else {
            console.warn(`🚫 Square webhook for invoice ${invoiceId} did not check out with Square — ignored`);
          }
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Square webhook error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// PayPal webhook handler
async function paypal(req, res) {
  try {
    const body = JSON.parse(req.body.toString());
    console.log(`📨 PayPal webhook: ${body.event_type}`);

    if (body.event_type === 'CHECKOUT.ORDER.APPROVED' || body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource = body.resource || {};
      const orderId = body.event_type === 'CHECKOUT.ORDER.APPROVED'
        ? resource.id
        : resource.supplementary_data?.related_ids?.order_id;
      const claimedRef = resource.purchase_units?.[0]?.reference_id;
      const invoiceId = claimedRef ? parseInt(claimedRef) : null;

      if (orderId && invoiceId) {
        const invoiceResult = await pool.query('SELECT user_id, booking_id, customer_id FROM invoices WHERE id = $1', [invoiceId]);
        if (invoiceResult.rows.length > 0) {
          const invoice = invoiceResult.rows[0];
          // Ask PayPal, with the invoice owner's credentials, what this order really is.
          const processor = await processorFor(invoice.user_id, 'paypal');
          const order = await processor._apiRequest('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
          const unit = order.purchase_units?.[0];
          const capture = unit?.payments?.captures?.[0];
          const okStatus = capture
            ? String(capture.status).toUpperCase() === 'COMPLETED'
            : String(order.status).toUpperCase() === 'APPROVED';
          if (okStatus && String(unit?.reference_id) === String(invoiceId)) {
            await recordPayment({
              userId: invoice.user_id,
              invoiceId,
              bookingId: invoice.booking_id,
              customerId: invoice.customer_id,
              amount: parseFloat(capture?.amount?.value || unit?.amount?.value),
              processor: 'paypal',
              processorPaymentId: capture?.id || order.id,
              paymentMethod: 'paypal'
            });
          } else {
            console.warn(`🚫 PayPal webhook for invoice ${invoiceId} did not check out with PayPal — ignored`);
          }
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('PayPal webhook error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { stripeConnect, square, paypal, recordPayment };
