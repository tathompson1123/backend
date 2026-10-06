// Bills customers for the SMS marketing blasts they send.
//
// A blast costs us real Twilio money per text, so it is charged to the customer, not
// absorbed. Each finished campaign becomes a pending Stripe invoice item on their
// customer record, which Stripe rolls into their next subscription invoice. The
// result is tracked on the sms_campaigns row, so there is always a record of what
// was owed and whether it reached their bill:
//
//   billing_status: 'billed'   — invoice item created (stripe_invoice_item_id set)
//                   'pending'  — not attempted yet / retrying
//                   'failed'   — Stripe rejected it (billing_error has why); retried hourly
//                   'unbilled' — no Stripe customer on file; needs manual billing
//                   'exempt'   — comped account, nothing owed
//                   'none'     — no texts actually went out
//
// Only campaign texts are billed here. Lead-agent and review texts stay included in
// the plan, and are excluded from this count via sms_messages.campaign_id.

const { pool } = require('../config/database');
const { isUnlimitedAccount } = require('./unlimitedAccounts');

// Cents charged per campaign text. Overridable without a deploy.
const SMS_CAMPAIGN_RATE_CENTS = parseInt(process.env.SMS_CAMPAIGN_RATE_CENTS || '3', 10);

let _stripe = null;
function stripe() {
  if (!_stripe) _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

pool.query(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS billed_texts INTEGER DEFAULT 0`)
  .then(() => pool.query(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS charge_cents INTEGER DEFAULT 0`))
  .then(() => pool.query(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS billing_status TEXT`))
  .then(() => pool.query(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS stripe_invoice_item_id TEXT`))
  .then(() => pool.query(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS billing_error TEXT`))
  .then(() => pool.query(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ`))
  .catch(e => console.error('sms_campaigns billing migration error:', e.message));

// Charge one finished campaign. Safe to call repeatedly: a campaign already 'billed'
// is skipped, and the Stripe idempotency key stops a retry creating a second item.
async function chargeCampaign(campaignId) {
  const row = (await pool.query(
    `SELECT sc.id, sc.user_id, sc.recipient_count, sc.billing_status,
            u.email, u.stripe_customer_id
       FROM sms_campaigns sc JOIN users u ON u.id = sc.user_id
      WHERE sc.id = $1`,
    [campaignId]
  )).rows[0];
  if (!row || row.billing_status === 'billed') return row?.billing_status || null;

  const texts = parseInt(row.recipient_count, 10) || 0;
  const save = (status, fields = {}) => pool.query(
    `UPDATE sms_campaigns
        SET billing_status = $2, billed_texts = $3, charge_cents = $4,
            stripe_invoice_item_id = COALESCE($5, stripe_invoice_item_id),
            billing_error = $6, billed_at = CASE WHEN $2 = 'billed' THEN NOW() ELSE billed_at END
      WHERE id = $1`,
    [campaignId, status, texts, fields.cents || 0, fields.itemId || null, fields.error || null]
  );

  if (texts === 0) { await save('none'); return 'none'; }
  if (isUnlimitedAccount(row.email)) { await save('exempt'); return 'exempt'; }

  const cents = texts * SMS_CAMPAIGN_RATE_CENTS;
  if (!row.stripe_customer_id) {
    console.error(`🚨 SMS campaign ${campaignId}: user ${row.user_id} owes $${(cents / 100).toFixed(2)} but has no Stripe customer — bill manually`);
    await save('unbilled', { cents, error: 'No Stripe customer on file' });
    return 'unbilled';
  }

  try {
    const item = await stripe().invoiceItems.create({
      customer: row.stripe_customer_id,
      amount: cents,
      currency: 'usd',
      description: `SMS marketing campaign #${campaignId} — ${texts} text${texts === 1 ? '' : 's'} × $${(SMS_CAMPAIGN_RATE_CENTS / 100).toFixed(2)}`,
      metadata: { type: 'sms_campaign', campaign_id: String(campaignId), user_id: String(row.user_id), texts: String(texts) },
    }, { idempotencyKey: `sms-campaign-${campaignId}` });
    await save('billed', { cents, itemId: item.id });
    console.log(`💳 SMS campaign ${campaignId}: billed user ${row.user_id} $${(cents / 100).toFixed(2)} (${texts} texts)`);
    return 'billed';
  } catch (e) {
    console.error(`❌ SMS campaign ${campaignId} billing failed for user ${row.user_id}: ${e.message}`);
    await save('failed', { cents, error: e.message });
    return 'failed';
  }
}

// Retry anything that didn't bill first time (Stripe blip, customer added since).
// Only rows explicitly marked pending/failed/unbilled are touched — campaigns sent
// before billing existed have a NULL status and are deliberately never back-billed.
async function retryUnbilledCampaigns() {
  const r = await pool.query(
    `SELECT id FROM sms_campaigns
      WHERE status IN ('sent', 'failed') AND COALESCE(recipient_count, 0) > 0
        AND billing_status IN ('pending', 'failed', 'unbilled')
        AND created_at < NOW() - INTERVAL '5 minutes'
      ORDER BY id LIMIT 100`
  );
  for (const c of r.rows) await chargeCampaign(c.id);
  return r.rows.length;
}

module.exports = { SMS_CAMPAIGN_RATE_CENTS, chargeCampaign, retryUnbilledCampaigns };
