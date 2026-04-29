const { pool } = require('../config/database');
const SquareProcessor = require('../payment/SquareProcessor');

// Refresh proactively when the access token expires within this window.
// Square access tokens last 30 days; refreshing at 7 days remaining leaves plenty of headroom.
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns a valid Square access token for the given user, refreshing it via the stored
 * refresh token if it's expired or about to expire. Updates the DB with the new
 * access_token + refresh_token + expires_at on success.
 *
 * Throws if the user has no Square connection or if both the existing access token and
 * the refresh attempt fail (e.g. refresh token expired after 90 days of inactivity —
 * merchant must reconnect via OAuth).
 *
 * @param {number} userId
 * @returns {Promise<{accessToken: string, locationId: string|null, merchantId: string|null}>}
 */
async function getValidSquareToken(userId) {
  const result = await pool.query(
    `SELECT square_access_token, square_refresh_token, square_location_id,
            square_merchant_id, square_token_expires_at
     FROM payment_connections
     WHERE user_id = $1 AND processor = 'square' AND is_active = true
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].square_access_token) {
    throw new Error('No active Square connection for this user');
  }

  const row = result.rows[0];
  const now = Date.now();
  const expiresAt = row.square_token_expires_at ? new Date(row.square_token_expires_at).getTime() : null;
  const expiringSoon = expiresAt != null && (expiresAt - now) < REFRESH_THRESHOLD_MS;
  // If we have no recorded expiry (legacy connection) AND a refresh token, refresh once
  // so we get an authoritative expiry going forward.
  const noRecordedExpiry = expiresAt == null && !!row.square_refresh_token;

  if ((expiringSoon || noRecordedExpiry) && row.square_refresh_token) {
    try {
      const fresh = await SquareProcessor.refreshAccessToken(row.square_refresh_token);
      await pool.query(
        `UPDATE payment_connections
           SET square_access_token = $1,
               square_refresh_token = $2,
               square_token_expires_at = $3,
               updated_at = NOW()
         WHERE user_id = $4 AND processor = 'square'`,
        [fresh.accessToken, fresh.refreshToken, fresh.expiresAt, userId]
      );
      console.log(`✅ Refreshed Square token for user ${userId}, new expiry ${fresh.expiresAt}`);
      return {
        accessToken: fresh.accessToken,
        locationId: row.square_location_id,
        merchantId: row.square_merchant_id,
      };
    } catch (err) {
      console.error(`❌ Square refresh failed for user ${userId}:`, err.message);
      // If the refresh token itself is dead (90+ days idle), mark the connection inactive
      // so the cron stops hammering Square's auth server every 10 minutes.
      if (/refresh_token/i.test(err.message) || /401|403/.test(err.message)) {
        await pool.query(
          `UPDATE payment_connections SET is_active = false, updated_at = NOW()
           WHERE user_id = $1 AND processor = 'square'`,
          [userId]
        );
        console.warn(`⚠️ Marked Square connection inactive for user ${userId} — manual reconnect required`);
      }
      throw err;
    }
  }

  return {
    accessToken: row.square_access_token,
    locationId: row.square_location_id,
    merchantId: row.square_merchant_id,
  };
}

module.exports = { getValidSquareToken };
