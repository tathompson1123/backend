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

// One-off repair for subscriptions Stripe took but our webhook never heard about.
//
// checkout.session.completed is the only thing that writes plan, the Stripe ids and
// the Twilio number. With no live endpoint configured, real customers were charged
// and left looking like free accounts. This walks live Stripe subscriptions, matches
// them to users by email, and fills in what checkout should have written.
//
// Phone numbers are reported, never bought — provisioning costs money and belongs to
// a deliberate decision, not a repair script.
const AMOUNT_TO_PLAN = {
  19500: 'pro',
  9900: 'pro', 9995: 'pro',   // legacy Pro pricing, before $195
  17500: 'scale', 17595: 'scale',
  2995: 'basic', // legacy only
};

async function backfillFromStripe({ dryRun = true } = {}) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { error: 'STRIPE_SECRET_KEY not set' };
  }

  const report = { scanned: 0, matched: 0, updated: 0, alreadyLinked: 0, unmatched: [], needsPhone: [] };

  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] })) {
    report.scanned++;

    const customer = typeof sub.customer === 'object' ? sub.customer : null;
    const email = (customer?.email || '').trim().toLowerCase();
    if (!email) {
      report.unmatched.push({ subscription: sub.id, reason: 'no email on the Stripe customer' });
      continue;
    }

    const found = await pool.query(
      `SELECT id, email, business_name, plan, stripe_subscription_id, twilio_phone_number
       FROM users WHERE LOWER(email) = $1`,
      [email]
    );
    const user = found.rows[0];
    if (!user) {
      report.unmatched.push({ subscription: sub.id, email, reason: 'no SORCE account with that email' });
      continue;
    }

    report.matched++;
    if (user.stripe_subscription_id === sub.id && user.plan) {
      report.alreadyLinked++;
      continue;
    }

    const amount = sub.items?.data?.[0]?.price?.unit_amount;
    // Scale is quoted per customer, so a custom amount won't be in the table. The plan
    // staff stamped on the subscription is the next best source of truth, ahead of
    // whatever the user row already says.
    const metaPlan = ['pro', 'scale', 'basic'].includes(sub.metadata?.plan) ? sub.metadata.plan : null;
    const plan = AMOUNT_TO_PLAN[amount] || metaPlan || user.plan || null;
    const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

    let lastPaidAt = null;
    let lastPaidAmount = null;
    try {
      const invoices = await stripe.invoices.list({ customer: sub.customer.id || sub.customer, status: 'paid', limit: 1 });
      const paid = invoices.data[0];
      if (paid) {
        lastPaidAt = paid.status_transitions?.paid_at || paid.created;
        lastPaidAmount = paid.amount_paid;
      }
    } catch { /* leave null */ }

    if (!dryRun) {
      await pool.query(
        `UPDATE users SET
           stripe_customer_id     = $1,
           stripe_subscription_id = $2,
           plan                   = COALESCE($3, plan),
           base_plan              = COALESCE($3, base_plan),
           subscription_status    = $4,
           current_period_end     = COALESCE(to_timestamp($5), current_period_end),
           last_payment_at        = COALESCE(to_timestamp($6), last_payment_at),
           last_payment_amount    = COALESCE($7, last_payment_amount),
           stripe_synced_at       = NOW()
         WHERE id = $8`,
        [sub.customer.id || sub.customer, sub.id, plan, sub.status,
         periodEnd, lastPaidAt, lastPaidAmount, user.id]
      );
    }
    report.updated++;

    // Pro and Scale are meant to get a dedicated number at checkout.
    if (!user.twilio_phone_number && (plan === 'pro' || plan === 'scale')) {
      report.needsPhone.push({ userId: user.id, email, business: user.business_name, plan });
    }
  }

  console.log(
    `🔧 Stripe backfill${dryRun ? ' (dry run)' : ''}: scanned ${report.scanned}, ` +
    `matched ${report.matched}, updated ${report.updated}, ` +
    `${report.unmatched.length} unmatched, ${report.needsPhone.length} missing a phone number`
  );
  return report;
}

module.exports.backfillFromStripe = backfillFromStripe;
