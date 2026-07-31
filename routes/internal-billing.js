// Taking payment for SORCE itself, from the internal /analytics dashboard —
// typically the moment a discovery call closes.
//
// Two ways to capture the card, because both have their place:
//   1. A Stripe-hosted checkout link we text/email them. The card never touches
//      our staff, browser or servers. This is the one to reach for.
//   2. A SetupIntent the dashboard confirms with Stripe Elements, for taking the
//      card while on the phone. Card data still goes straight to Stripe from the
//      browser, but staff keying in card numbers puts you in a heavier PCI scope
//      (SAQ C-VT rather than SAQ A) — worth knowing you've opted into that.
//
// Either way the subscription is what recurs; a "front end offer" rides along as a
// one-off invoice item so it shows on the first Stripe invoice by name.
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SITE_URL = process.env.FRONTEND_URL || 'https://sorceintegrations.com';

// Price ids per plan. Falls back to building the price inline so this works before
// the ids are configured, though real Stripe Prices are tidier in reporting.
const PLAN_PRICES = {
  pro:   { env: 'STRIPE_PRICE_PRO',   amount: 9995,  label: 'SORCE Pro' },
  scale: { env: 'STRIPE_PRICE_SCALE', amount: 17595, label: 'SORCE Scale' },
  basic: { env: 'STRIPE_PRICE_BASIC', amount: 2995,  label: 'SORCE Basic' },
};

const requireAnalytics = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.analytics) return res.status(403).json({ error: 'Forbidden' });
    req.analytics = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Taking money is admin-only. Invited members get the discovery calendar and
// nothing else; a master-password session has no `tm` and counts as admin.
const requireAdmin = (req, res, next) => {
  if (!req.analytics?.tm || req.analytics.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
};

function planLineItem(plan) {
  const cfg = PLAN_PRICES[plan];
  if (!cfg) return null;
  const priceId = process.env[cfg.env];
  if (priceId) return { price: priceId, quantity: 1 };
  return {
    quantity: 1,
    price_data: {
      currency: 'usd',
      unit_amount: cfg.amount,
      recurring: { interval: 'month' },
      product_data: { name: cfg.label },
    },
  };
}

// Find or create the Stripe customer for a SORCE user.
async function resolveCustomer({ userId, email, name }) {
  let user = null;
  if (userId) {
    user = (await pool.query(
      'SELECT id, email, business_name, stripe_customer_id FROM users WHERE id = $1', [userId]
    )).rows[0];
  } else if (email) {
    user = (await pool.query(
      'SELECT id, email, business_name, stripe_customer_id FROM users WHERE LOWER(email) = LOWER($1)', [email]
    )).rows[0];
  }

  if (user?.stripe_customer_id) return { user, customerId: user.stripe_customer_id };

  const customer = await stripe.customers.create({
    email: user?.email || email,
    name: user?.business_name || name || undefined,
    metadata: { sorce_user_id: user?.id ? String(user.id) : '' },
  });

  if (user?.id) {
    await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customer.id, user.id]);
  }
  return { user, customerId: customer.id };
}

// GET /api/internal-billing/search?q= — pick who you're charging
router.get('/search', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const result = await pool.query(
      `SELECT id, email, business_name, plan, subscription_status, stripe_customer_id
       FROM users
       WHERE email ILIKE $1 OR business_name ILIKE $1
       ORDER BY created_at DESC LIMIT 20`,
      [q]
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/internal-billing/checkout-link
// Stripe-hosted page. Recurring plan plus any one-off front end offer, both on the
// first invoice. Optionally texted/emailed straight to them.
router.post('/checkout-link', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const { userId, email, name, plan, offerAmount, offerDescription, trialDays, send } = req.body;
    if (!plan && !offerAmount) {
      return res.status(400).json({ error: 'Pick a plan, an offer amount, or both' });
    }

    const { user, customerId } = await resolveCustomer({ userId, email, name });

    const lineItems = [];
    const planItem = plan ? planLineItem(plan) : null;
    if (planItem) lineItems.push(planItem);

    // The front end offer — named so it reads properly on the Stripe invoice.
    if (offerAmount > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(Number(offerAmount) * 100),
          product_data: { name: offerDescription?.trim() || 'SORCE onboarding offer' },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: planItem ? 'subscription' : 'payment',
      customer: customerId,
      line_items: lineItems,
      success_url: `${SITE_URL}/analytics?payment=success`,
      cancel_url: `${SITE_URL}/analytics?payment=cancelled`,
      // Keep the card for future charges either way.
      ...(planItem
        ? { subscription_data: { metadata: { sorce_user_id: user?.id || '', plan },
                                 ...(trialDays ? { trial_period_days: Number(trialDays) } : {}) } }
        : { payment_intent_data: { setup_future_usage: 'off_session' } }),
      metadata: {
        sorce_user_id: user?.id ? String(user.id) : '',
        plan: plan || '',
        offer: offerDescription || '',
        taken_by: req.analytics?.name || 'internal',
      },
    });

    let delivery = null;
    if (send && (send.sms || send.email)) {
      delivery = await deliverLink({ session, user, email, name, send });
    }

    res.json({ success: true, url: session.url, sessionId: session.id, delivery });
  } catch (err) {
    console.error('Checkout link error:', err.message);
    res.status(500).json({ error: err.message || 'Could not create the payment link' });
  }
});

// POST /api/internal-billing/setup-intent
// For the Elements form: gives the browser a client secret to attach a card with.
router.post('/setup-intent', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const { userId, email, name } = req.body;
    const { user, customerId } = await resolveCustomer({ userId, email, name });
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      metadata: { taken_by: req.analytics?.name || 'internal' },
    });
    res.json({ success: true, clientSecret: intent.client_secret, customerId, userId: user?.id || null });
  } catch (err) {
    console.error('Setup intent error:', err.message);
    res.status(500).json({ error: 'Could not start card capture' });
  }
});

// POST /api/internal-billing/subscribe
// Called once Elements has confirmed the SetupIntent. Puts the card on file as the
// default, drops the front end offer on as a pending invoice item, then subscribes.
router.post('/subscribe', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const { customerId, paymentMethodId, userId, plan, offerAmount, offerDescription, trialDays } = req.body;
    if (!customerId || !paymentMethodId) {
      return res.status(400).json({ error: 'Missing customer or payment method' });
    }

    // Card on file, and the default for everything that follows.
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // A pending invoice item is swept onto the next invoice Stripe generates —
    // which is the subscription's first one. The description is what shows there.
    if (offerAmount > 0) {
      await stripe.invoiceItems.create({
        customer: customerId,
        amount: Math.round(Number(offerAmount) * 100),
        currency: 'usd',
        description: offerDescription?.trim() || 'SORCE onboarding offer',
      });
    }

    let subscription = null;
    if (plan) {
      const item = planLineItem(plan);
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [item.price ? { price: item.price } : { price_data: item.price_data }],
        default_payment_method: paymentMethodId,
        ...(trialDays ? { trial_period_days: Number(trialDays) } : {}),
        metadata: { sorce_user_id: userId ? String(userId) : '', plan },
      });
    } else if (offerAmount > 0) {
      // Offer with no plan — bill it on its own and take the money now.
      const invoice = await stripe.invoices.create({ customer: customerId, auto_advance: true });
      await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.pay(invoice.id);
    }

    if (userId) {
      await pool.query(
        `UPDATE users SET stripe_customer_id = $1,
                          stripe_subscription_id = COALESCE($2, stripe_subscription_id),
                          plan = COALESCE($3, plan),
                          base_plan = COALESCE($3, base_plan),
                          subscription_status = COALESCE($4, subscription_status)
         WHERE id = $5`,
        [customerId, subscription?.id || null, plan || null, subscription?.status || null, userId]
      );
    }

    res.json({
      success: true,
      subscriptionId: subscription?.id || null,
      status: subscription?.status || 'paid',
    });
  } catch (err) {
    console.error('Subscribe error:', err.message);
    res.status(500).json({ error: err.message || 'Could not start the subscription' });
  }
});

// Text and/or email the checkout link.
async function deliverLink({ session, user, email, name, send }) {
  const result = { smsSent: false, emailSent: false, errors: [] };
  const firstName = String(user?.business_name || name || 'there').split(/\s+/)[0];

  if (send.sms && send.phone) {
    try {
      const { sendDiscoverySMS } = require('../utils/discoveryNotify');
      await sendDiscoverySMS(
        send.phone,
        `Hi ${firstName}! Here's your secure link to get SORCE set up: ${session.url}`
      );
      result.smsSent = true;
    } catch (err) {
      result.errors.push(`SMS: ${err.message}`);
    }
  }

  const to = email || user?.email;
  if (send.email && to) {
    try {
      const sgMail = require('@sendgrid/mail');
      if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      await sgMail.send({
        to,
        from: { name: 'SORCE', email: process.env.DISCOVERY_FROM_EMAIL || 'hello@sorceintegrations.com' },
        subject: 'Your SORCE setup link',
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;">
            <h2 style="color:#111827;margin:0 0 12px;">You're nearly set up</h2>
            <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">
              Here's your secure payment link. It's hosted by Stripe — we never see your card details.
            </p>
            <a href="${session.url}" style="background:#d97706;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">Complete setup</a>
            <p style="color:#6b7280;font-size:13px;margin-top:24px;">Any questions, just reply to this email.</p>
          </div>`,
      });
      result.emailSent = true;
    } catch (err) {
      result.errors.push(`Email: ${err.message}`);
    }
  }

  return result;
}

module.exports = router;
