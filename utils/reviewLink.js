// Builds the review link we text/email to a customer.
//
// The point is that the recipient recognises it. They did business with
// "Thompson's Auto Detailing", not with us — so a bare sorceintegrations.com link
// reads like spam. Putting their business name in the path fixes that without
// asking the business to configure anything on their own domain:
//
//   sorceintegrations.com/r/thompsons-auto-detailing/k3f9qa
//
// The trailing token (not the row id) is what we track, so the URLs aren't
// sequential and can't be walked to inflate somebody else's click count.
const crypto = require('crypto');

const BASE = (process.env.REVIEW_LINK_BASE || 'https://sorceintegrations.com').replace(/\/$/, '');
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes, this gets read aloud

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

function randomToken(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

// One slug per business, generated on first use and then stable forever — the
// links live in customers' text threads, so it must never change under them.
async function ensureReviewSlug(pool, userId) {
  const existing = await pool.query(
    'SELECT review_slug, business_name FROM users WHERE id = $1',
    [userId]
  );
  if (!existing.rows[0]) return null;
  if (existing.rows[0].review_slug) return existing.rows[0].review_slug;

  const base = slugify(existing.rows[0].business_name) || `business-${userId}`;
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const saved = await pool.query(
        `UPDATE users SET review_slug = $1
         WHERE id = $2 AND review_slug IS NULL
           AND NOT EXISTS (SELECT 1 FROM users WHERE review_slug = $1)
         RETURNING review_slug`,
        [candidate, userId]
      );
      if (saved.rows[0]) return saved.rows[0].review_slug;
      // Lost a race — re-read; somebody else may have set ours already.
      const recheck = await pool.query('SELECT review_slug FROM users WHERE id = $1', [userId]);
      if (recheck.rows[0]?.review_slug) return recheck.rows[0].review_slug;
    } catch {
      /* unique violation — try the next suffix */
    }
  }
  return `business-${userId}`;
}

async function ensureClickToken(pool, reviewRequestId) {
  const existing = await pool.query(
    'SELECT click_token FROM review_requests WHERE id = $1',
    [reviewRequestId]
  );
  if (existing.rows[0]?.click_token) return existing.rows[0].click_token;

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = randomToken(attempt < 5 ? 6 : 8);
    try {
      const saved = await pool.query(
        `UPDATE review_requests SET click_token = $1
         WHERE id = $2 AND click_token IS NULL
           AND NOT EXISTS (SELECT 1 FROM review_requests WHERE click_token = $1)
         RETURNING click_token`,
        [candidate, reviewRequestId]
      );
      if (saved.rows[0]) return saved.rows[0].click_token;
      const recheck = await pool.query('SELECT click_token FROM review_requests WHERE id = $1', [reviewRequestId]);
      if (recheck.rows[0]?.click_token) return recheck.rows[0].click_token;
    } catch {
      /* collision — try again */
    }
  }
  return null;
}

/**
 * @param customBase optional per-business domain. Still honoured for anyone who
 *   already set one up, but it is no longer the recommended path — the branded
 *   default below needs nothing from the business.
 * @returns the URL to put in the message, or null when there's no Google link yet.
 */
async function buildReviewLink(pool, { reviewRequestId, userId, customBase, hasGoogleLink = true }) {
  if (!hasGoogleLink) return null;

  const token = await ensureClickToken(pool, reviewRequestId);
  if (!token) {
    // Fall back to the id-based link rather than sending nothing.
    return customBase
      ? `${String(customBase).replace(/\/$/, '')}/${reviewRequestId}`
      : `${BASE}/r/${reviewRequestId}`;
  }

  if (customBase) return `${String(customBase).replace(/\/$/, '')}/${token}`;

  const slug = await ensureReviewSlug(pool, userId);
  return slug ? `${BASE}/r/${slug}/${token}` : `${BASE}/r/${token}`;
}

module.exports = { buildReviewLink, ensureReviewSlug, ensureClickToken, slugify, randomToken };
