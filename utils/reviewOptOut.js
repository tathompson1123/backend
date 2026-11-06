const { pool } = require('../config/database');

// "Stop review texts" is per PERSON, not per customers row: bookings historically insert
// their own customer row, so one person can be several rows. Everything here matches on
// email or phone digits across all of the owner's rows.

const digits = (v) => String(v || '').replace(/\D/g, '');

// SQL predicate: customer alias `c` has a stopped sibling row (same email or phone).
// Used by the review cron jobs so a flag on one row covers the rest and future rows.
const PERSON_STOPPED_SQL = (alias = 'c') => `
  EXISTS (
    SELECT 1 FROM customers s
     WHERE s.user_id = ${alias}.user_id
       AND COALESCE(s.review_requests_stopped, FALSE) = TRUE
       AND (
         (NULLIF(TRIM(${alias}.email), '') IS NOT NULL AND LOWER(s.email) = LOWER(${alias}.email))
         OR (NULLIF(REGEXP_REPLACE(COALESCE(${alias}.phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
             AND RIGHT(REGEXP_REPLACE(COALESCE(s.phone, ''), '[^0-9]', '', 'g'), 10)
               = RIGHT(REGEXP_REPLACE(${alias}.phone, '[^0-9]', '', 'g'), 10))
       )
  )`;

/**
 * Turn review texts off (or back on) for one person.
 * Stopping also closes any open review requests so nothing queued goes out.
 */
async function setReviewTextsStopped(userId, { customerId, email, phone }, stopped) {
  const em = (email || '').trim().toLowerCase();
  const ph = digits(phone).slice(-10);

  const ids = (await pool.query(
    `SELECT id FROM customers
      WHERE user_id = $1 AND (
        id = $2
        OR ($3 <> '' AND LOWER(email) = $3)
        OR ($4 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $4)
      )`,
    [userId, customerId || null, em, ph]
  )).rows.map(r => r.id);
  if (ids.length === 0) return { updated: 0 };

  await pool.query(
    'UPDATE customers SET review_requests_stopped = $1 WHERE user_id = $2 AND id = ANY($3)',
    [!!stopped, userId, ids]
  );
  if (stopped) {
    await pool.query(
      `UPDATE review_requests SET status = 'stopped'
        WHERE user_id = $1 AND customer_id = ANY($2)
          AND status IN ('pending','awaiting_reply','replied_positive','replied_neutral','needs_attention','sent')`,
      [userId, ids]
    );
  }
  return { updated: ids.length };
}

module.exports = { setReviewTextsStopped, PERSON_STOPPED_SQL };
