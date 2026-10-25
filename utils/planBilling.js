// Membership billing: a customer on a service plan is charged ONE flat amount per billing
// period through a Square Subscription, no matter how many visits that period holds.
// Visits are generated as $0 bookings (utils/recurringBookings.js) purely for the
// schedule, so nothing here — and nothing about a visit — creates a per-visit invoice.
// (Square itself raises one invoice per billing period for the subscription; that is the
// monthly charge, not a second one.)
//
// Square objects, per service plan:
//   SUBSCRIPTION_PLAN            — container, created once
//   SUBSCRIPTION_PLAN_VARIATION  — carries the price + cadence. Prices live on the
//                                  variation, so a price change makes a NEW variation:
//                                  existing subscribers stay on the one they signed up
//                                  for and only new sign-ups get the new price.

const crypto = require('crypto');
const { pool } = require('../config/database');
const { getSquareClient } = require('./squareCardOnFile');
const { FREQUENCIES, toYmd } = require('./recurringBookings');
const { getTimezoneForBusiness } = require('./zipToTimezone');
const { TRANSACTIONAL_EMAIL } = require('./emailFrom');
const { escapeHtml: esc } = require('./escapeHtml');
const { plainEmail } = require('./emailLayout');

/** Square errors carry `errors[]`; turn them into one readable message. */
function squareError(e) {
  const errs = e?.errors || e?.result?.errors || [];
  const needsScope = e?.statusCode === 403
    || errs.some(x => x.code === 'INSUFFICIENT_SCOPES' || /scope/i.test(x.detail || ''));
  if (needsScope) {
    const err = new Error('Square needs to be reconnected to allow recurring billing. Open Payment Settings, disconnect Square, and connect it again.');
    err.code = 'SQUARE_RECONNECT';
    return err;
  }
  const detail = errs.map(x => x.detail || x.code).filter(Boolean).join('; ');
  const err = new Error(detail || e?.message || 'Square request failed');
  err.code = 'SQUARE_ERROR';
  return err;
}

const cents = (dollars) => Math.round(Number(dollars) * 100);
const key = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 45);

/**
 * Make sure the service plan has a Square plan variation at its CURRENT price + cadence.
 * @returns {Promise<string>} the Square plan variation id
 */
async function ensureSquareVariation(userId, servicePlan, { persist = true } = {}) {
  const priceCents = cents(servicePlan.price);
  const cadence = FREQUENCIES[servicePlan.frequency]?.cadence;
  if (!cadence) throw new Error(`Plan frequency "${servicePlan.frequency}" cannot be billed`);
  if (!(priceCents > 0)) throw new Error('Plan price must be greater than $0');

  if (persist && servicePlan.square_plan_variation_id
      && servicePlan.square_price_cents === priceCents
      && servicePlan.square_cadence === cadence) {
    return servicePlan.square_plan_variation_id;
  }

  const { client } = await getSquareClient(userId);
  try {
    let squarePlanId = servicePlan.square_plan_id;
    if (!squarePlanId) {
      const planResp = await client.catalogApi.upsertCatalogObject({
        idempotencyKey: key('plan', servicePlan.id, Date.now()),
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: '#plan',
          subscriptionPlanData: { name: servicePlan.name },
        },
      });
      squarePlanId = planResp.result.catalogObject.id;
    }

    const varResp = await client.catalogApi.upsertCatalogObject({
      idempotencyKey: key('variation', servicePlan.id, priceCents, cadence, Date.now()),
      object: {
        type: 'SUBSCRIPTION_PLAN_VARIATION',
        id: '#variation',
        subscriptionPlanVariationData: {
          name: `${servicePlan.name} — $${(priceCents / 100).toFixed(2)}`,
          subscriptionPlanId: squarePlanId,
          phases: [{
            cadence,
            ordinal: 0n,
            pricing: { type: 'STATIC', priceMoney: { amount: BigInt(priceCents), currency: 'USD' } },
          }],
        },
      },
    });
    const variationId = varResp.result.catalogObject.id;

    if (persist) {
      await pool.query(
        `UPDATE service_plans SET square_plan_id = $1, square_plan_variation_id = $2,
                square_price_cents = $3, square_cadence = $4, updated_at = NOW() WHERE id = $5`,
        [squarePlanId, variationId, priceCents, cadence, servicePlan.id]
      );
    } else if (!servicePlan.square_plan_id) {
      await pool.query('UPDATE service_plans SET square_plan_id = $1 WHERE id = $2', [squarePlanId, servicePlan.id]);
    }
    return variationId;
  } catch (e) {
    throw squareError(e);
  }
}

async function businessToday(userId) {
  const { todayInTz } = require('./recurringBookings');
  const r = await pool.query('SELECT state, zip_code FROM business_information WHERE user_id = $1', [userId]);
  const tz = getTimezoneForBusiness(r.rows[0]?.state, r.rows[0]?.zip_code);
  return { today: todayInTz(tz), tz };
}

/**
 * Start the Square subscription for a customer's plan using the card they just saved.
 * First charge is on the first visit date (or today if that has already passed), then it
 * repeats on that day each billing period. Idempotent per recurring plan: a second call
 * returns the existing subscription instead of billing twice.
 */
async function startSubscription(recurringPlanId) {
  const rp = (await pool.query(
    `SELECT rp.*, sp.name AS sp_name, sp.price AS sp_price, sp.frequency AS sp_frequency,
            sp.square_plan_id, sp.square_plan_variation_id, sp.square_price_cents, sp.square_cadence, sp.id AS sp_id
     FROM recurring_plans rp JOIN service_plans sp ON sp.id = rp.service_plan_id
     WHERE rp.id = $1`, [recurringPlanId])).rows[0];
  if (!rp) throw new Error('Plan not found');
  if (rp.square_subscription_id) return { subscriptionId: rp.square_subscription_id, alreadyStarted: true };
  if (!rp.square_customer_id || !rp.square_card_id) throw new Error('No card on file for this plan yet');

  const servicePlan = {
    id: rp.sp_id, name: rp.sp_name, price: rp.sp_price, frequency: rp.sp_frequency,
    square_plan_id: rp.square_plan_id, square_plan_variation_id: rp.square_plan_variation_id,
    square_price_cents: rp.square_price_cents, square_cadence: rp.square_cadence,
  };
  // The customer agreed to the price shown on the card page (pinned at sign-up). If the
  // catalog price has since changed, bill what they agreed to, not the new price — on its
  // own variation, leaving the plan's current one for new sign-ups.
  const priceChanged = rp.price_cents && rp.price_cents !== cents(rp.sp_price);
  if (priceChanged) servicePlan.price = rp.price_cents / 100;
  const variationId = await ensureSquareVariation(rp.user_id, servicePlan, { persist: !priceChanged });

  const { client, locationId } = await getSquareClient(rp.user_id);
  const { today, tz } = await businessToday(rp.user_id);
  const first = toYmd(rp.start_date);
  const startDate = first > today ? first : today;

  try {
    const resp = await client.subscriptionsApi.createSubscription({
      idempotencyKey: key('sub', rp.id, rp.square_card_id),
      locationId,
      planVariationId: variationId,
      customerId: rp.square_customer_id,
      cardId: rp.square_card_id,
      startDate,
      timezone: tz,
    });
    const sub = resp.result.subscription;
    await pool.query(
      `UPDATE recurring_plans SET square_subscription_id = $1, square_plan_variation_id = $2,
              billing_status = 'active', billing_error = NULL, billing_start_date = $3, updated_at = NOW()
       WHERE id = $4`,
      [sub.id, variationId, startDate, rp.id]
    );
    return { subscriptionId: sub.id, startDate };
  } catch (e) {
    const err = squareError(e);
    await pool.query("UPDATE recurring_plans SET billing_status = 'failed', billing_error = $1 WHERE id = $2", [err.message.slice(0, 500), rp.id]);
    throw err;
  }
}

/** Pause / resume / cancel the Square subscription. Square first: never stop the schedule while billing runs on. */
async function changeSubscription(userId, squareSubscriptionId, action) {
  if (!squareSubscriptionId) return;
  const { client } = await getSquareClient(userId);
  try {
    if (action === 'pause') await client.subscriptionsApi.pauseSubscription(squareSubscriptionId, {});
    else if (action === 'resume') await client.subscriptionsApi.resumeSubscription(squareSubscriptionId, {});
    else if (action === 'cancel') await client.subscriptionsApi.cancelSubscription(squareSubscriptionId);
    else throw new Error(`Unknown subscription action: ${action}`);
  } catch (e) {
    // Cancelling something Square already cancelled is fine.
    const errs = e?.errors || [];
    if (action === 'cancel' && errs.some(x => /cancel/i.test(x.detail || '') && /already/i.test(x.detail || ''))) return;
    throw squareError(e);
  }
}

const SQUARE_STATUS = { ACTIVE: 'active', PAUSED: 'paused', CANCELED: 'canceled', DEACTIVATED: 'failed', PENDING: 'active' };

/**
 * Pull current subscription statuses from Square into recurring_plans.billing_status, so a
 * declined card or a subscription cancelled in the Square dashboard shows up in SORCE.
 * Best effort and time-boxed: the list must load even if Square is slow or unreachable.
 */
async function syncBillingStatuses(userId, plans) {
  const subs = plans.filter(p => p.square_subscription_id);
  if (!subs.length) return;
  try {
    const { client, locationId } = await getSquareClient(userId);
    const resp = await Promise.race([
      client.subscriptionsApi.searchSubscriptions({
        query: { filter: { locationIds: [locationId], customerIds: [...new Set(subs.map(p => p.square_customer_id).filter(Boolean))] } },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    const byId = new Map((resp.result.subscriptions || []).map(s => [s.id, s]));
    for (const p of subs) {
      const sq = byId.get(p.square_subscription_id);
      if (!sq) continue;
      const mapped = SQUARE_STATUS[sq.status];
      if (mapped && mapped !== p.billing_status) {
        await pool.query('UPDATE recurring_plans SET billing_status = $1 WHERE id = $2', [mapped, p.id]);
        p.billing_status = mapped;
      }
    }
  } catch (e) {
    console.warn('[plan-billing] status sync skipped:', e.message);
  }
}

const fmtLong = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** What the customer is agreeing to, in one place so the email and the card page say the same thing. */
function termsFor(rp, sp) {
  const f = FREQUENCIES[sp.frequency];
  const per = f.cadence === 'ANNUAL' ? 'year' : f.cadence === 'QUARTERLY' ? 'quarter' : 'month';
  return {
    planName: sp.name,
    priceText: `$${(cents(sp.price) / 100).toFixed(2)}`,
    per,
    frequencyLabel: f.label,
    firstChargeDate: toYmd(rp.start_date),
  };
}

/**
 * A card this customer already saved with the business, if Square still has it enabled.
 * Matched by email/phone across ALL the owner's customer rows (booking creation can leave
 * several rows per person), newest first. Never throws: no card, or Square unreachable,
 * just means "ask for a new card".
 * @returns {Promise<{cardId, squareCustomerId, brand, last4}|null>}
 */
async function findSavedCard(userId, { email, phone }) {
  try {
    const r = await pool.query(
      `SELECT square_customer_id, square_card_id,
              COALESCE(square_card_brand, card_brand) AS brand,
              COALESCE(square_card_last_four, card_last_four) AS last4
       FROM customers
       WHERE user_id = $1 AND square_card_id IS NOT NULL AND square_customer_id IS NOT NULL
         AND ((email IS NOT NULL AND email <> '' AND LOWER(email) = LOWER($2))
           OR (phone IS NOT NULL AND phone <> '' AND phone = $3))
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [userId, email || '', phone || '']
    );
    const row = r.rows[0];
    if (!row) return null;
    const { client } = await getSquareClient(userId);
    const resp = await client.cardsApi.retrieveCard(row.square_card_id);
    const card = resp.result.card;
    if (!card || card.enabled === false || card.customerId !== row.square_customer_id) return null;
    return {
      cardId: card.id,
      squareCustomerId: row.square_customer_id,
      brand: card.cardBrand || row.brand || 'Card',
      last4: card.last4 || row.last4 || '',
    };
  } catch (e) {
    console.warn('[plan-billing] saved card check skipped:', e.message);
    return null;
  }
}

/** Create a card link for a plan and email it. Returns the link. */
async function sendPlanCardLink(recurringPlanId) {
  const rp = (await pool.query(
    `SELECT rp.*, u.business_name, u.email AS owner_email FROM recurring_plans rp
     JOIN users u ON u.id = rp.user_id WHERE rp.id = $1`, [recurringPlanId])).rows[0];
  if (!rp || !rp.service_plan_id) throw new Error('Plan not found');
  if (!rp.customer_email) throw new Error('Customer has no email address on file');
  const sp = (await pool.query('SELECT * FROM service_plans WHERE id = $1', [rp.service_plan_id])).rows[0];

  // Billing terms are pinned at sign-up so a later catalog price change can't bill more
  // than the customer agreed to.
  if (!rp.price_cents) {
    await pool.query('UPDATE recurring_plans SET price_cents = $1 WHERE id = $2', [cents(sp.price), rp.id]);
  }

  const tok = await pool.query(
    `INSERT INTO card_on_file_tokens (user_id, customer_email, customer_name, recurring_plan_id, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days') RETURNING token`,
    [rp.user_id, rp.customer_email, rp.customer_name, rp.id]
  );
  const link = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/card-on-file/${tok.rows[0].token}`;
  const t = termsFor(rp, sp);
  // Already has a card with this business: no card entry, but still an explicit yes to the
  // recurring charge — that older card was saved on "we won't charge it" terms.
  const saved = await findSavedCard(rp.user_id, { email: rp.customer_email, phone: rp.customer_phone });

  if (process.env.SENDGRID_API_KEY) {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: rp.customer_email,
      from: { name: rp.business_name || 'Your Service Provider', email: TRANSACTIONAL_EMAIL },
      replyTo: rp.owner_email ? { email: rp.owner_email } : undefined,
      subject: saved
        ? `Please confirm your ${t.planName} plan — ${rp.business_name || 'us'}`
        : `Finish setting up your ${t.planName} plan — ${rp.business_name || 'us'}`,
      html: plainEmail({
        greeting: `Hi ${esc(rp.customer_name)},`,
        paragraphs: [
          `You're set up for the <strong>${esc(t.planName)}</strong> plan with <strong>${esc(rp.business_name || 'us')}</strong> (${esc(t.frequencyLabel)}), starting ${esc(fmtLong(t.firstChargeDate))}.`,
          saved
            ? `We have your ${esc(saved.brand)} card ending in ${esc(saved.last4)} on file, so there's nothing to enter again. Please confirm to start the plan: <strong>that card will be charged ${esc(t.priceText)} per ${t.per}</strong>, beginning ${esc(fmtLong(t.firstChargeDate))} and then once every ${t.per} until you cancel. That one ${t.per}ly charge covers every visit on the plan — you are never charged per visit.`
            : `To start it, please save a card. <strong>This card will be charged ${esc(t.priceText)} per ${t.per}</strong>, beginning ${esc(fmtLong(t.firstChargeDate))} and then once every ${t.per} until you cancel. That one ${t.per}ly charge covers every visit on the plan — you are never charged per visit.`,
        ],
        action: { label: saved ? 'Confirm and start my plan' : 'Save a card and start my plan', url: link },
        after: [`That link expires in 7 days. To pause or cancel at any time, just contact ${esc(rp.business_name || 'us')}.`],
        signature: esc(rp.business_name || ''),
      }),
    });
  }
  await pool.query("UPDATE recurring_plans SET billing_status = 'awaiting_card' WHERE id = $1 AND billing_status IN ('none','awaiting_card','failed')", [rp.id]);
  return { link, usesSavedCard: !!saved };
}

module.exports = {
  squareError, ensureSquareVariation, startSubscription, changeSubscription,
  syncBillingStatuses, sendPlanCardLink, termsFor, cents, findSavedCard,
};
