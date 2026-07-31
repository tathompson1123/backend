// Reconciles our idea of who's paying against Stripe's.
//
// Webhooks keep things current going forward, but they only ever fire once. Anyone
// who subscribed before the payment columns existed has no history, a missed or
// failed webhook leaves a user permanently wrong, and the `plan` column stays set
// through the entire dunning window on a failing card. So Stripe is the source of
// truth and this pulls it down on a schedule.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../config/database');

// Stripe statuses that mean money is actually arriving.
const PAYING = new Set(['active']);

async function reconcileUser(user) {
  if (!user.stripe_customer_id && !user.stripe_subscription_id) {
    // Never had a subscription — make sure they don't linger as "paying".
    await pool.query(
      `UPDATE users SET subscription_status = COALESCE(subscription_status, 'none'), stripe_synced_at = NOW()
       WHERE id = $1`,
      [user.id]
    );
    return { id: user.id, status: 'none' };
  }

  let subscription = null;
  if (user.stripe_subscription_id) {
    try {
      subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
    } catch (err) {
      if (err.code !== 'resource_missing') throw err;
    }
  }
  // Fall back to whatever subscription the customer has, in case the stored id is stale.
  if (!subscription && user.stripe_customer_id) {
    const list = await stripe.subscriptions.list({
      customer: user.stripe_customer_id, status: 'all', limit: 1,
    });
    subscription = list.data[0] || null;
  }

  if (!subscription) {
    await pool.query(
      `UPDATE users SET subscription_status = 'canceled', stripe_synced_at = NOW() WHERE id = $1`,
      [user.id]
    );
    return { id: user.id, status: 'canceled' };
  }

  // Most recent invoice that actually cleared — what "last payment" means.
  let lastPaidAt = null;
  let lastPaidAmount = null;
  try {
    const invoices = await stripe.invoices.list({
      customer: subscription.customer, status: 'paid', limit: 1,
    });
    const paid = invoices.data[0];
    if (paid) {
      lastPaidAt = paid.status_transitions?.paid_at || paid.created;
      lastPaidAmount = paid.amount_paid;
    }
  } catch (err) {
    console.warn(`⚠️ Could not list invoices for ${subscription.customer}:`, err.message);
  }

  // Basil (2025-03-31) moved current_period_end onto the subscription items, so
  // accept either shape rather than depending on the pinned API version.
  const periodEnd = subscription.current_period_end
    ?? subscription.items?.data?.[0]?.current_period_end
    ?? null;

  await pool.query(
    `UPDATE users SET
       subscription_status = $1,
       current_period_end  = COALESCE(to_timestamp($2), current_period_end),
       stripe_subscription_id = $3,
       last_payment_at     = COALESCE(to_timestamp($4), last_payment_at),
       last_payment_amount = COALESCE($5, last_payment_amount),
       last_payment_failed_at = CASE WHEN $1 IN ('past_due','unpaid','incomplete')
                                     THEN COALESCE(last_payment_failed_at, NOW())
                                     ELSE NULL END,
       stripe_synced_at    = NOW()
     WHERE id = $6`,
    [subscription.status, periodEnd, subscription.id,
     lastPaidAt, lastPaidAmount, user.id]
  );

  return { id: user.id, status: subscription.status, paying: PAYING.has(subscription.status) };
}

async function reconcileAllSubscriptions({ limit = 500 } = {}) {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('⚠️ Stripe reconcile skipped — STRIPE_SECRET_KEY not set');
    return { synced: 0, errors: 0, skipped: true };
  }

  const users = (await pool.query(
    `SELECT id, stripe_customer_id, stripe_subscription_id
     FROM users
     WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL OR plan IS NOT NULL
     ORDER BY stripe_synced_at NULLS FIRST
     LIMIT $1`,
    [limit]
  )).rows;

  let synced = 0;
  let errors = 0;
  for (const user of users) {
    try {
      await reconcileUser(user);
      synced++;
    } catch (err) {
      errors++;
      console.error(`⚠️ Stripe reconcile failed for user ${user.id}:`, err.message);
    }
    // Stay well under Stripe's rate limit on big accounts.
    await new Promise(r => setTimeout(r, 60));
  }

  console.log(`💳 Stripe reconcile: ${synced} synced, ${errors} error(s)`);
  return { synced, errors };
}

module.exports = { reconcileAllSubscriptions, reconcileUser, PAYING };
