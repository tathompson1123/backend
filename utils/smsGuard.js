// Central guard for every outbound text.
//
// Before this, sendSMS would text any string it was handed, as often as asked. Several
// endpoints take the destination from an unauthenticated visitor (lead forms, webhooks,
// discovery booking), so anyone could point our numbers and our AI at a stranger — and, with
// an international number, at a premium-rate line.
const { pool } = require('../config/database');

const PER_NUMBER_PER_DAY_PER_BUSINESS = 25; // a long AI conversation is ~10; this leaves headroom
const PER_NUMBER_PER_DAY_ALL_BUSINESSES = 40;

class SmsBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SmsBlockedError';
    this.code = 'SMS_BLOCKED';
  }
}

function last10(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-10);
}

// US/Canada only. Anything else is either a typo or toll fraud.
function assertDestinationAllowed(to) {
  const s = String(to || '').trim();
  if (!s) throw new SmsBlockedError('No destination number');
  if (s.startsWith('+') && !s.startsWith('+1')) throw new SmsBlockedError('Only US and Canadian numbers can be texted');
  const digits = s.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) throw new SmsBlockedError('Invalid phone number');
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) throw new SmsBlockedError('Invalid phone number');
  return national;
}

async function trialHasEnded(userId) {
  if (process.env.ENFORCE_TRIAL_EXPIRY !== 'true') return false;
  const r = await pool.query(
    'SELECT email, trial_ends_at, stripe_subscription_id, is_demo FROM users WHERE id = $1', [userId]
  );
  const u = r.rows[0];
  if (!u) return false;
  const { isUnlimitedAccount } = require('./unlimitedAccounts');
  if (isUnlimitedAccount(u.email) || u.is_demo || u.stripe_subscription_id) return false;
  return !!u.trial_ends_at && new Date(u.trial_ends_at) <= new Date();
}

/**
 * Throws SmsBlockedError if this text should not go out. `userId` may be null for SORCE's
 * own messages (discovery calls), in which case only the destination checks apply.
 */
async function assertSendAllowed({ to, userId }) {
  const national = assertDestinationAllowed(to);

  const counts = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE user_id = $2)::int AS mine, COUNT(*)::int AS everyone
       FROM sms_messages
      WHERE direction = 'outgoing'
        AND created_at > NOW() - INTERVAL '24 hours'
        AND right(regexp_replace(COALESCE(to_number, ''), '\\D', '', 'g'), 10) = $1`,
    [national, userId || -1]
  );
  const { mine, everyone } = counts.rows[0];
  if (userId && mine >= PER_NUMBER_PER_DAY_PER_BUSINESS) {
    throw new SmsBlockedError('Daily text limit to this number reached');
  }
  if (everyone >= PER_NUMBER_PER_DAY_ALL_BUSINESSES) {
    throw new SmsBlockedError('Daily text limit to this number reached');
  }

  if (userId) {
    const opted = await pool.query(
      `SELECT 1 FROM customers
        WHERE user_id = $1 AND sms_unsubscribed = TRUE
          AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2
        LIMIT 1`,
      [userId, national]
    );
    if (opted.rows.length) throw new SmsBlockedError('Recipient has opted out of texts');

    if (await trialHasEnded(userId)) throw new SmsBlockedError('Trial has ended — subscribe to keep texting');
  }
}

module.exports = { assertSendAllowed, assertDestinationAllowed, SmsBlockedError, last10, trialHasEnded };
