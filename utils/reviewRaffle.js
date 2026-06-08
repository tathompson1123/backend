// ============================================
// MONTHLY GOOGLE REVIEW RAFFLE
// ============================================
// Each month, customers who clicked their review link (our concrete
// "engaged with leaving a review" signal) are entered into a raffle.
// One winner is drawn at random and texted the reward configured in the
// GBP incentive field; everyone else gets a consolation offer text.
//
// "Verification" note: Google's Places API only exposes ~5 of a business's
// reviews and gives us no reviewer→phone mapping, so we cannot reliably
// confirm every entrant actually posted a review. We best-effort match
// entrant names against the reviews Google does return and flag matches as
// `review_verified`. If a business turns on `raffle_require_verified`, the
// draw is restricted to those verified entrants; otherwise all clickers are
// eligible.

const { pool } = require('../config/database');
const { sendSMS } = require('./twilio');

const PLACES_BASE = 'https://places.googleapis.com/v1';

// ─── Name matching helpers ──────────────────────────────────
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tolerant match between a customer name and a Google review author name.
// Matches on exact normalized equality, or first name + last initial.
function namesMatch(customerName, authorName) {
  const a = normalizeName(customerName);
  const b = normalizeName(authorName);
  if (!a || !b) return false;
  if (a === b) return true;

  const at = a.split(' ').filter(Boolean);
  const bt = b.split(' ').filter(Boolean);
  if (!at.length || !bt.length) return false;

  // First names must match
  if (at[0] !== bt[0]) return false;

  // If either only has a first name, first-name match is enough
  if (at.length === 1 || bt.length === 1) return true;

  // Otherwise require last-name initial to agree (handles "Monica B" vs "Monica Boos")
  const aLast = at[at.length - 1];
  const bLast = bt[bt.length - 1];
  return aLast[0] === bLast[0];
}

// ─── Google review fetch ────────────────────────────────────
async function fetchGoogleReviewAuthors(placeId) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !placeId) return [];
  try {
    const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'reviews'
      }
    });
    const data = await res.json();
    if (data.error || !data.reviews) return [];
    return data.reviews
      .map(r => r.authorAttribution?.displayName)
      .filter(Boolean);
  } catch (err) {
    console.warn('⚠️ Raffle: could not fetch Google reviews:', err.message);
    return [];
  }
}

// ─── Period helpers ─────────────────────────────────────────
// Returns 'YYYY-MM' for a given date (defaults to now).
function periodOf(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Returns the 'YYYY-MM' for the month before the given date.
function previousPeriod(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return periodOf(d);
}

function formatPhone(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function firstName(name) {
  return String(name || 'there').trim().split(/\s+/)[0] || 'there';
}

// ─── Pool selection ─────────────────────────────────────────
// One entry per customer (earliest click that month), with a phone,
// who clicked the review link during `period`, has not already won a prior
// raffle, and has not already been processed into a raffle.
async function selectPoolRows(userId, period) {
  const result = await pool.query(
    `SELECT DISTINCT ON (rr.customer_id)
            rr.id, rr.customer_id, rr.review_verified,
            c.name AS customer_name, c.phone AS customer_phone
     FROM review_requests rr
     JOIN customers c ON c.id = rr.customer_id
     WHERE rr.user_id = $1
       AND rr.link_clicked = true
       AND c.phone IS NOT NULL
       AND rr.raffle_period IS NULL
       AND COALESCE(rr.link_clicked_at, rr.actual_send_time, rr.created_at) >= to_date($2, 'YYYY-MM')
       AND COALESCE(rr.link_clicked_at, rr.actual_send_time, rr.created_at) <  (to_date($2, 'YYYY-MM') + INTERVAL '1 month')
       AND NOT EXISTS (
         SELECT 1 FROM review_requests w
         WHERE w.user_id = rr.user_id
           AND w.customer_id = rr.customer_id
           AND w.raffle_status = 'won'
       )
     ORDER BY rr.customer_id, COALESCE(rr.link_clicked_at, rr.actual_send_time, rr.created_at) ASC`,
    [userId, period]
  );

  // Collapse duplicate customer records that share a phone number so the same
  // person can't be entered (or texted) twice. Keep the first occurrence.
  const seenPhones = new Set();
  const deduped = [];
  for (const row of result.rows) {
    const phone = formatPhone(row.customer_phone);
    if (!phone || seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    deduped.push(row);
  }
  return deduped;
}

// Best-effort: flag pool rows whose name matches a fetched Google review.
async function applyVerification(userId, rows) {
  if (!rows.length) return rows;
  const profile = await pool.query('SELECT place_id FROM gbp_profiles WHERE user_id = $1', [userId]);
  const placeId = profile.rows[0]?.place_id;
  if (!placeId) return rows;

  const authors = await fetchGoogleReviewAuthors(placeId);
  if (!authors.length) return rows;

  for (const row of rows) {
    const matched = authors.some(a => namesMatch(row.customer_name, a));
    if (matched && !row.review_verified) {
      row.review_verified = true;
      await pool.query(
        `UPDATE review_requests SET review_verified = true, review_verified_at = NOW() WHERE id = $1`,
        [row.id]
      );
    } else if (matched) {
      row.review_verified = true;
    }
  }
  return rows;
}

// ─── Preview (no draw, no texts) ────────────────────────────
// Used by the dashboard to show the current month's pool.
async function previewPool(userId, period = periodOf()) {
  const rows = await selectPoolRows(userId, period);
  await applyVerification(userId, rows);
  return rows.map(r => ({
    requestId: r.id,
    customerId: r.customer_id,
    name: r.customer_name,
    phone: r.customer_phone,
    verified: !!r.review_verified
  }));
}

// ─── Draw + notify for one user ─────────────────────────────
async function runRaffleForUser(userId, period, { dryRun = false } = {}) {
  // Load config + business identity
  const cfgRes = await pool.query(
    `SELECT rc.incentive, rc.incentive_enabled, rc.raffle_enabled,
            rc.raffle_consolation, rc.raffle_require_verified,
            u.business_name, u.twilio_phone_number
     FROM users u
     LEFT JOIN review_configs rc ON rc.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const cfg = cfgRes.rows[0];
  if (!cfg) return { status: 'error', notes: 'user not found' };

  if (!cfg.raffle_enabled) return { status: 'skipped', notes: 'raffle disabled' };

  const reward = (cfg.incentive_enabled && cfg.incentive) ? cfg.incentive : null;
  if (!reward) return { status: 'skipped', notes: 'no incentive/reward configured' };

  const consolation = cfg.raffle_consolation || '$50 off any Full Detail';
  const businessName = cfg.business_name || 'us';

  // Don't double-draw a month
  const existing = await pool.query(
    'SELECT id, status FROM review_raffles WHERE user_id = $1 AND period = $2',
    [userId, period]
  );
  if (existing.rows.length) {
    return { status: 'already_drawn', notes: `raffle already exists for ${period}`, raffleId: existing.rows[0].id };
  }

  // Build the pool
  let rows = await selectPoolRows(userId, period);
  await applyVerification(userId, rows);
  if (cfg.raffle_require_verified) {
    rows = rows.filter(r => r.review_verified);
  }

  if (!rows.length) {
    if (dryRun) return { status: 'skipped_empty', period, poolSize: 0, pool: [] };
    await pool.query(
      `INSERT INTO review_raffles (user_id, period, reward, consolation, pool_size, texts_sent, status, notes)
       VALUES ($1, $2, $3, $4, 0, 0, 'skipped_empty', 'no eligible entrants')
       ON CONFLICT (user_id, period) DO NOTHING`,
      [userId, period, reward, consolation]
    );
    return { status: 'skipped_empty', period, poolSize: 0 };
  }

  // Pick the winner
  const winner = rows[Math.floor(Math.random() * rows.length)];

  if (dryRun) {
    return {
      status: 'dry_run', period, poolSize: rows.length, reward, consolation,
      winner: { name: winner.customer_name, phone: winner.customer_phone, verified: !!winner.review_verified },
      pool: rows.map(r => ({ name: r.customer_name, verified: !!r.review_verified }))
    };
  }

  if (!cfg.twilio_phone_number) {
    await pool.query(
      `INSERT INTO review_raffles (user_id, period, reward, consolation, pool_size, texts_sent, status, notes)
       VALUES ($1, $2, $3, $4, $5, 0, 'error', 'no SMS number assigned')
       ON CONFLICT (user_id, period) DO NOTHING`,
      [userId, period, reward, consolation, rows.length]
    );
    return { status: 'error', notes: 'no SMS number assigned', period };
  }

  // Send the texts
  let textsSent = 0;
  for (const row of rows) {
    const isWinner = row.id === winner.id;
    const to = formatPhone(row.customer_phone);
    if (!to) continue;

    const message = isWinner
      ? `🎉 Congratulations ${firstName(row.customer_name)}! You WON this month's review raffle at ${businessName}: ${reward}. Reply to this text to claim it. Thank you for your review!`
      : `Thanks for reviewing ${businessName}, ${firstName(row.customer_name)}! You weren't this month's raffle winner — but as a thank-you, here's ${consolation}. Reply to redeem. We appreciate you!`;

    try {
      const result = await sendSMS(to, message, userId);
      await pool.query(
        `INSERT INTO sms_messages (user_id, direction, to_number, from_number, provider, message, twilio_message_sid, created_at)
         VALUES ($1, 'outgoing', $2, $3, 'twilio', $4, $5, NOW())`,
        [userId, to, cfg.twilio_phone_number, message, result.messageSid]
      );
      await pool.query(
        `UPDATE review_requests
         SET raffle_status = $2, raffle_period = $3, raffle_notified_at = NOW()
         WHERE id = $1`,
        [row.id, isWinner ? 'won' : 'lost', period]
      );
      textsSent++;
    } catch (sendErr) {
      console.error(`❌ Raffle SMS failed for request ${row.id}:`, sendErr.message);
      // Still mark the entry as processed for this period so it isn't re-drawn next month
      await pool.query(
        `UPDATE review_requests SET raffle_status = $2, raffle_period = $3 WHERE id = $1`,
        [row.id, isWinner ? 'won' : 'lost', period]
      );
    }
  }

  const raffleRes = await pool.query(
    `INSERT INTO review_raffles
       (user_id, period, winner_request_id, winner_name, winner_phone, reward, consolation, pool_size, texts_sent, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed')
     ON CONFLICT (user_id, period) DO NOTHING
     RETURNING id`,
    [userId, period, winner.id, winner.customer_name, formatPhone(winner.customer_phone),
     reward, consolation, rows.length, textsSent]
  );

  console.log(`🎁 Raffle drawn for user ${userId} (${period}): winner "${winner.customer_name}", pool ${rows.length}, ${textsSent} texts sent`);

  return {
    status: 'completed', period, raffleId: raffleRes.rows[0]?.id,
    poolSize: rows.length, textsSent,
    winner: { name: winner.customer_name, phone: formatPhone(winner.customer_phone) }
  };
}

// ─── Monthly runner (cron entry point) ──────────────────────
// Draws for the *previous* month across every user with the raffle enabled.
async function runMonthlyRaffles() {
  const period = previousPeriod();
  try {
    const users = await pool.query(
      `SELECT user_id FROM review_configs
       WHERE raffle_enabled = true AND incentive_enabled = true
         AND incentive IS NOT NULL AND incentive <> ''`
    );
    console.log(`🎁 Monthly raffle run for ${period}: ${users.rows.length} enabled business(es)`);
    for (const { user_id } of users.rows) {
      try {
        const r = await runRaffleForUser(user_id, period);
        if (r.status !== 'completed' && r.status !== 'already_drawn') {
          console.log(`   • user ${user_id}: ${r.status}${r.notes ? ' — ' + r.notes : ''}`);
        }
      } catch (err) {
        console.error(`❌ Raffle failed for user ${user_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Monthly raffle runner error:', err.message);
  }
}

module.exports = {
  runMonthlyRaffles,
  runRaffleForUser,
  previewPool,
  periodOf,
  previousPeriod,
  // exported for tests
  namesMatch,
  normalizeName
};
