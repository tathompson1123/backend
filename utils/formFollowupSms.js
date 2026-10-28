// The "next steps" TEXT a visitor gets after submitting an embed form — the SMS twin of
// utils/formFollowupEmail. One owner-written message per form, merged with the visitor's
// first name and sent from the business's own number.
//
// Guard rails (a form is anonymous, and a text costs money and carries legal weight):
//   - Only sent when the visitor ticked the SMS consent box (sms_consent) — the form shows
//     that box whenever this or the AI follow-up is on.
//   - sendSMS (utils/twilio) already runs the destination / rate / opt-out checks.
//   - Counts toward the plan's monthly SMS allowance exactly like the AI lead texts.
//   - One per phone number per form per day.
//   - Only the first name is merged; "Reply STOP to opt out" is appended if the owner's
//     wording left it out (first message to a number must carry it).

const { pool } = require('../config/database');
const { sendSMS } = require('./twilio');
const textSafe = require('./textSafe');

const DEFAULT_FOLLOWUP_SMS = {
  enabled: false,
  message:
    "Hi {{first_name}}, thanks for contacting {{business_name}}! Here's what happens next: " +
    "1) We review your request 2) We call or text you to confirm details 3) We get you scheduled. " +
    "Questions? Just reply here.",
};

const MAX_LEN = 600;
const OPT_OUT = ' Reply STOP to opt out.';

function sanitizeFollowupSms(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === undefined ? DEFAULT_FOLLOWUP_SMS.enabled : !!r.enabled,
    message: String(r.message ?? '').replace(/\r/g, '').trim().slice(0, MAX_LEN) || DEFAULT_FOLLOWUP_SMS.message,
  };
}

function fill(text, vars) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

/** The final text for a lead (also used by tests). */
function renderFollowupSms(cfg, { name, businessName, formName }) {
  const first = textSafe.firstWord(name) || 'there';
  let msg = fill(cfg.message, {
    first_name: first,
    name: textSafe.singleLine(name) || first,
    business_name: textSafe.displayName(businessName || 'our team'),
    form_name: textSafe.singleLine(formName || ''),
  }).trim();
  if (!/\bstop\b/i.test(msg)) msg += OPT_OUT;
  return msg;
}

const SMS_LIMITS = { scale: 500, pro: 500, expert: 200, basic: 100 };

/**
 * Send the next-steps text for a submission. Never throws.
 * @returns {Promise<'sent'|'skipped'|'failed'>}
 */
async function sendFollowupSms({ cfg, form, lead }) {
  try {
    if (!cfg?.enabled || !lead.phone || !lead.sms_consent) return 'skipped';

    const owner = (await pool.query(
      'SELECT business_name, plan, email, twilio_phone_number FROM users WHERE id = $1', [form.user_id]
    )).rows[0];
    if (!owner?.twilio_phone_number) return 'skipped';

    // Same monthly allowance the AI lead texts draw from.
    const { isUnlimitedSms } = require('../routes/sms-campaigns');
    if (!isUnlimitedSms(owner.email)) {
      const limit = SMS_LIMITS[owner.plan] || 0;
      if (limit === 0) return 'skipped';
      const used = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sms_messages
         WHERE user_id = $1 AND direction = 'outgoing' AND campaign_id IS NULL
           AND created_at >= date_trunc('month', NOW())`, [form.user_id]);
      if (used.rows[0].n >= limit) {
        console.log(`⚠️ Next-steps text skipped — SMS limit reached for user ${form.user_id}`);
        return 'skipped';
      }
    }

    // One per number per form per day: a form is a way to make us text a stranger.
    const digits = String(lead.phone).replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const dup = await pool.query(
        `SELECT 1 FROM leads
          WHERE user_id = $1 AND source = $2 AND id <> $3
            AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $4
            AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
        [form.user_id, form.source, lead.id, digits]
      );
      if (dup.rows.length) return 'skipped';
    }

    const message = renderFollowupSms(cfg, { name: lead.name, businessName: owner.business_name, formName: form.name });
    const result = await sendSMS(lead.phone, message, form.user_id);
    await pool.query(
      `INSERT INTO sms_messages (lead_id, user_id, direction, to_number, from_number, provider, message, twilio_message_sid, created_at)
       VALUES ($1, $2, 'outgoing', $3, $4, 'twilio', $5, $6, CURRENT_TIMESTAMP)`,
      [lead.id, form.user_id, lead.phone, owner.twilio_phone_number, message, result.messageSid]
    );
    await pool.query('UPDATE leads SET last_contact_at = CURRENT_TIMESTAMP WHERE id = $1', [lead.id]);
    console.log(`✅ Next-steps text sent to lead ${lead.id} (form ${form.id})`);
    return 'sent';
  } catch (e) {
    console.error('Embed form next-steps text error:', e.message);
    return 'failed';
  }
}

module.exports = { DEFAULT_FOLLOWUP_SMS, MAX_LEN, sanitizeFollowupSms, renderFollowupSms, sendFollowupSms };
