// Self-hosted click tracking for email campaigns.
//
// Replaces SendGrid's link rewriting, which had two problems. It emitted
// http://url9694.sorceintegrations.com/ls/click?upn=<350 characters> — an opaque,
// unencrypted redirector on a domain whose certificate says *.sendgrid.net, so any browser
// in HTTPS-First mode shows a security warning instead of the destination. Getting HTTPS on
// that domain needs a reverse proxy you run yourself, or an Enterprise Cloudflare plan.
// And the click data landed in SendGrid's dashboard where nothing in this codebase could
// read it.
//
// This runs on infrastructure we already have, over certificates Vercel and Railway already
// manage, using the same pattern as the review links in utils/reviewLink.js. The links come
// out around 48 characters:
//
//   https://sorceintegrations.com/c/a1b2c3d4/e5f6g7h8
//
// Two tokens rather than one signed blob. A JWT carrying campaign, recipient and
// destination would be 300+ characters, which is the length problem we just removed from
// every transactional template — so the destination and the recipient are each a short
// random key looked up server-side instead.
const crypto = require('crypto');

const BASE = (process.env.REVIEW_LINK_BASE || process.env.FRONTEND_URL || 'https://sorceintegrations.com').replace(/\/$/, '');
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes, same set as review links

function randomToken(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

// Links that must never be rewritten.
//
// Unsubscribe is the important one: it is already a per-recipient signed URL, and routing a
// one-click unsubscribe through a tracker risks breaking the RFC 8058 POST that Gmail and
// Yahoo require. A broken unsubscribe is far more expensive than a missing click metric —
// people hit "report spam" instead, and that burns the sending domain for every message on
// it, transactional included.
function shouldSkip(url) {
  if (!url) return true;
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) return true;              // mailto:, tel:, #anchor, relative
  if (/\/unsubscribe\b/i.test(u)) return true;
  if (/[?&]token=/i.test(u) && /unsub/i.test(u)) return true;
  if (u.includes('{{') || u.includes('%%')) return true;  // unresolved merge placeholder
  return false;
}

// One row per distinct destination per campaign — a handful of rows, not one per recipient.
// Reused across every recipient of that campaign so the same destination always resolves to
// the same token.
async function ensureLinkTokens(pool, { campaignId, userId, html }) {
  const urls = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const raw = m[1].trim();
    if (!shouldSkip(raw)) urls.add(raw);
  }
  if (!urls.size) return new Map();

  const map = new Map();
  for (const url of urls) {
    const existing = await pool.query(
      'SELECT token FROM campaign_links WHERE campaign_id = $1 AND destination = $2',
      [campaignId, url]
    );
    if (existing.rows[0]) { map.set(url, existing.rows[0].token); continue; }

    let token = null;
    for (let attempt = 0; attempt < 8 && !token; attempt++) {
      const candidate = randomToken(attempt < 4 ? 8 : 10);
      try {
        const saved = await pool.query(
          `INSERT INTO campaign_links (campaign_id, user_id, token, destination)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (token) DO NOTHING
           RETURNING token`,
          [campaignId, userId, candidate, url]
        );
        if (saved.rows[0]) token = saved.rows[0].token;
      } catch (e) {
        // A concurrent send may have inserted the same destination first.
        const recheck = await pool.query(
          'SELECT token FROM campaign_links WHERE campaign_id = $1 AND destination = $2',
          [campaignId, url]
        );
        if (recheck.rows[0]) token = recheck.rows[0].token;
      }
    }
    if (token) map.set(url, token);
  }
  return map;
}

// One row per recipient per campaign. This is also the send log — which addresses a campaign
// actually went to was not recorded anywhere before, so a click had nothing to attribute
// against and "who did we email" was unanswerable after the fact.
async function ensureRecipientToken(pool, { campaignId, userId, email }) {
  const existing = await pool.query(
    'SELECT token FROM campaign_recipients WHERE campaign_id = $1 AND LOWER(email) = LOWER($2)',
    [campaignId, email]
  );
  if (existing.rows[0]) return existing.rows[0].token;

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = randomToken(attempt < 4 ? 8 : 10);
    try {
      const saved = await pool.query(
        `INSERT INTO campaign_recipients (campaign_id, user_id, email, token)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (token) DO NOTHING
         RETURNING token`,
        [campaignId, userId, email, candidate]
      );
      if (saved.rows[0]) return saved.rows[0].token;
    } catch {
      const recheck = await pool.query(
        'SELECT token FROM campaign_recipients WHERE campaign_id = $1 AND LOWER(email) = LOWER($2)',
        [campaignId, email]
      );
      if (recheck.rows[0]) return recheck.rows[0].token;
    }
  }
  return null;
}

// Swap each href for its tracked equivalent. Anchors only — a bare URL sitting in body text
// is left alone, because rewriting it would put an unrecognisable token string in front of
// the reader where they expected to see a domain they recognise.
function rewriteHtml(html, linkTokens, recipientToken) {
  if (!html || !linkTokens.size || !recipientToken) return html;
  return html.replace(/(<a\b[^>]*\bhref\s*=\s*["'])([^"']+)(["'])/gi, (full, pre, url, post) => {
    const token = linkTokens.get(url.trim());
    if (!token) return full;
    return `${pre}${BASE}/c/${token}/${recipientToken}${post}`;
  });
}

module.exports = { ensureLinkTokens, ensureRecipientToken, rewriteHtml, shouldSkip, randomToken, BASE };
