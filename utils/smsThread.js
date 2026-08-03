// Shared helpers for working out which conversation a text belongs to.
//
// Two things make this harder than it looks:
//
// 1. Which end of an sms_messages row is the customer depends on direction —
//    outgoing rows carry them in to_number, incoming rows in from_number.
// 2. Phone formats are inconsistent across the table and across leads/customers
//    (E.164, bare 10-digit, "(555) 123-4567"), because different code paths wrote
//    them at different times. So every comparison normalizes to the last 10 digits.

// SQL expression for "the customer's number on this row", normalized to 10 digits.
// Only meaningful on rows where that side is populated — guard with LEN10_OK.
const COUNTERPARTY_LAST10 = `
  right(regexp_replace(
    CASE WHEN direction = 'outgoing' THEN COALESCE(to_number, '')
         ELSE COALESCE(from_number, '') END,
    '\\D', '', 'g'), 10)`;

// A short/blank number would produce a stub that could collide with another
// contact's, so require a full 10 digits before trusting a match.
const COUNTERPARTY_IS_FULL = `length(${COUNTERPARTY_LAST10}) = 10`;

// Same normalization for an arbitrary column (leads.phone, customers.phone).
const phoneLast10Sql = (col) =>
  `right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 10)`;

// Which conversation a stored row belongs to. Ordered most-specific first: a review
// reply also carries a lead_id once stamped, and the review thread is the truer label.
const THREAD_SOURCE_SQL = `
  CASE WHEN review_request_id   IS NOT NULL THEN 'review'
       WHEN campaign_id         IS NOT NULL THEN 'campaign'
       WHEN booking_id          IS NOT NULL THEN 'booking'
       WHEN sent_by_employee_id IS NOT NULL THEN 'employee'
       WHEN lead_id             IS NOT NULL THEN 'lead'
       ELSE 'other' END`;

function last10(num) {
  const digits = String(num || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

// Build the set of phone formats we may have stored historically.
// Twilio gives us E.164 (+1XXXXXXXXXX), but earlier code paths stored
// 10-digit (XXXXXXXXXX) or 11-digit (1XXXXXXXXXX). Match all three.
function phoneVariants(num) {
  if (!num) return [num];
  const digits = num.replace(/\D/g, '');
  const variants = new Set([num]);
  if (digits.length === 11 && digits.startsWith('1')) {
    variants.add('+' + digits);          // +1XXXXXXXXXX
    variants.add(digits);                // 1XXXXXXXXXX
    variants.add(digits.slice(1));       // XXXXXXXXXX
  } else if (digits.length === 10) {
    variants.add(digits);                // XXXXXXXXXX
    variants.add('1' + digits);          // 1XXXXXXXXXX
    variants.add('+1' + digits);         // +1XXXXXXXXXX
  } else if (digits) {
    variants.add(digits);
  }
  return [...variants];
}

// The lead this number belongs to, or null. Deliberately does NOT create one —
// this is for stamping lead_id onto messages so a thread stays whole, and minting
// a lead for every campaign blast recipient would flood the owner's Leads box.
async function findLeadIdByPhone(pool, userId, phone) {
  const l10 = last10(phone);
  if (!l10 || !userId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM leads
        WHERE user_id = $1 AND ${phoneLast10Sql('phone')} = $2
        ORDER BY created_at DESC LIMIT 1`,
      [userId, l10]
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    // Stamping is best-effort: never fail a send because the lookup hiccuped.
    console.error('findLeadIdByPhone failed:', e.message);
    return null;
  }
}

// The most recent message exchanged with this number that actually names a thread,
// in EITHER direction. This is the basis for attributing an inbound reply: the last
// thing that happened in a conversation is what a reply is answering.
//
// Looking only at what we last SENT (the old rule) reads a one-way blast as the
// state of the relationship, which it isn't — the customer's own last message is
// usually the better signal, and it's the one that says whether they've already
// moved on from the blast.
async function resolveThread(pool, userId, phone) {
  const l10 = last10(phone);
  if (!l10 || !userId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, direction, message, created_at,
              lead_id, booking_id, campaign_id, review_request_id,
              ${THREAD_SOURCE_SQL} AS thread_source
         FROM sms_messages
        WHERE user_id = $1
          AND (lead_id IS NOT NULL OR booking_id IS NOT NULL
               OR campaign_id IS NOT NULL OR review_request_id IS NOT NULL)
          AND ${COUNTERPARTY_IS_FULL}
          AND ${COUNTERPARTY_LAST10} = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [userId, l10]
    );
    return rows[0] || null;
  } catch (e) {
    console.error('resolveThread failed:', e.message);
    return null;
  }
}

module.exports = {
  COUNTERPARTY_LAST10,
  COUNTERPARTY_IS_FULL,
  THREAD_SOURCE_SQL,
  phoneLast10Sql,
  last10,
  phoneVariants,
  findLeadIdByPhone,
  resolveThread,
};
