const { pool } = require('../config/database');

// QuickBooks Online OAuth 2.0.
//
// Two expiries matter, unlike Square:
//   • access token  — 1 hour
//   • refresh token — ~100 days, and Intuit rotates it on most refreshes
// so the refresh response must always be written back, and a merchant who goes
// quiet for 100+ days has to reconnect.

const ACCESS_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh with 5 min to spare
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

const isSandbox = () => process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox';

// Accounting API host. Sandbox companies are only reachable on the sandbox host.
function quickBooksApiBase() {
  return isSandbox()
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

// The QuickBooks web app, for deep-linking the merchant to the draft.
function quickBooksAppBase() {
  return isSandbox() ? 'https://sandbox.qbo.intuit.com' : 'https://qbo.intuit.com';
}

function basicAuthHeader() {
  const id = process.env.QUICKBOOKS_CLIENT_ID;
  const secret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('QuickBooks is not configured — set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET');
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

function redirectUri() {
  const base = process.env.PRODUCTION_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3001';
  return `${base.replace(/\/$/, '')}/api/payment-connections/quickbooks/callback`;
}

// Scope note: com.intuit.quickbooks.accounting is what the Invoice/Customer/Item
// entities live under. openid/profile/email are not needed — we already know who
// the SORCE user is.
function getOAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.QUICKBOOKS_CLIENT_ID || '',
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri(),
    state: String(state),
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `QuickBooks token request failed (${res.status})`);
  }
  return data;
}

// Turn { expires_in, x_refresh_token_expires_in } into absolute timestamps.
function expiryTimestamps(token) {
  const now = Date.now();
  return {
    accessExpiresAt: new Date(now + (Number(token.expires_in) || 3600) * 1000),
    refreshExpiresAt: new Date(now + (Number(token.x_refresh_token_expires_in) || 8726400) * 1000),
  };
}

/**
 * Exchange an authorization code for tokens and store the connection.
 * @param {number} userId
 * @param {string} code
 * @param {string} realmId  QuickBooks company id, returned as a query param on the callback
 */
async function exchangeCodeForTokens(userId, code, realmId) {
  const token = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });
  const { accessExpiresAt, refreshExpiresAt } = expiryTimestamps(token);

  await pool.query(
    `INSERT INTO payment_connections (
       user_id, processor, is_active, quickbooks_realm_id, quickbooks_access_token,
       quickbooks_refresh_token, quickbooks_token_expires_at, quickbooks_refresh_expires_at,
       connected_at, last_verified_at
     )
     VALUES ($1, 'quickbooks', true, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (user_id, processor) DO UPDATE SET
       is_active = true,
       quickbooks_realm_id = EXCLUDED.quickbooks_realm_id,
       quickbooks_access_token = EXCLUDED.quickbooks_access_token,
       quickbooks_refresh_token = EXCLUDED.quickbooks_refresh_token,
       quickbooks_token_expires_at = EXCLUDED.quickbooks_token_expires_at,
       quickbooks_refresh_expires_at = EXCLUDED.quickbooks_refresh_expires_at,
       connected_at = NOW(),
       last_verified_at = NOW(),
       updated_at = NOW()`,
    [userId, realmId, token.access_token, token.refresh_token, accessExpiresAt, refreshExpiresAt]
  );

  return { realmId, accessExpiresAt, refreshExpiresAt };
}

/**
 * Returns a usable QuickBooks access token, refreshing it if it's within five
 * minutes of expiry. Intuit rotates the refresh token on refresh, so the new pair
 * is always written back.
 *
 * Throws if there's no active connection or the refresh token is dead — in the
 * latter case the connection is deactivated so we stop retrying.
 *
 * @param {number} userId
 * @returns {Promise<{accessToken: string, realmId: string}>}
 */
async function getValidQuickBooksToken(userId) {
  const result = await pool.query(
    `SELECT quickbooks_realm_id, quickbooks_access_token, quickbooks_refresh_token,
            quickbooks_token_expires_at, quickbooks_refresh_expires_at
     FROM payment_connections
     WHERE user_id = $1 AND processor = 'quickbooks' AND is_active = true
     LIMIT 1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row || !row.quickbooks_access_token) {
    throw new Error('QuickBooks is not connected. Connect it in Payment Settings first.');
  }

  const expiresAt = row.quickbooks_token_expires_at
    ? new Date(row.quickbooks_token_expires_at).getTime()
    : 0;
  const stillValid = expiresAt - Date.now() > ACCESS_REFRESH_THRESHOLD_MS;
  if (stillValid) {
    return { accessToken: row.quickbooks_access_token, realmId: row.quickbooks_realm_id };
  }

  if (!row.quickbooks_refresh_token) {
    throw new Error('QuickBooks connection is incomplete. Reconnect QuickBooks in Payment Settings.');
  }

  try {
    const token = await postToken({
      grant_type: 'refresh_token',
      refresh_token: row.quickbooks_refresh_token,
    });
    const { accessExpiresAt, refreshExpiresAt } = expiryTimestamps(token);
    await pool.query(
      `UPDATE payment_connections
         SET quickbooks_access_token = $1,
             quickbooks_refresh_token = $2,
             quickbooks_token_expires_at = $3,
             quickbooks_refresh_expires_at = $4,
             last_verified_at = NOW(),
             updated_at = NOW()
       WHERE user_id = $5 AND processor = 'quickbooks'`,
      [token.access_token, token.refresh_token, accessExpiresAt, refreshExpiresAt, userId]
    );
    return { accessToken: token.access_token, realmId: row.quickbooks_realm_id };
  } catch (err) {
    console.error(`❌ QuickBooks refresh failed for user ${userId}:`, err.message);
    // A dead refresh token can only be fixed by reconnecting; deactivate so we
    // don't keep hitting Intuit on every invoice attempt.
    if (/invalid_grant|invalid_request|401|403/i.test(err.message)) {
      await pool.query(
        `UPDATE payment_connections SET is_active = false, updated_at = NOW()
         WHERE user_id = $1 AND processor = 'quickbooks'`,
        [userId]
      );
      console.warn(`⚠️ Marked QuickBooks connection inactive for user ${userId} — reconnect required`);
      throw new Error('QuickBooks connection expired. Reconnect QuickBooks in Payment Settings.');
    }
    throw err;
  }
}

// Best-effort token revocation on disconnect. Never throws — a failed revoke must
// not block removing the connection locally.
async function revokeQuickBooksToken(refreshToken) {
  if (!refreshToken) return;
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: refreshToken }),
    });
  } catch (err) {
    console.error('QuickBooks token revoke failed:', err.message);
  }
}

module.exports = {
  getOAuthUrl,
  exchangeCodeForTokens,
  getValidQuickBooksToken,
  revokeQuickBooksToken,
  quickBooksApiBase,
  quickBooksAppBase,
};
