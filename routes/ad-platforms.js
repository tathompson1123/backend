const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tathompson1123@gmail.com';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
// Google Ads API version — bump when Google sunsets. v18 was retired early 2026.
const GADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v20';
const GADS_BASE = `https://googleads.googleapis.com/${GADS_API_VERSION}`;

// ── Google OAuth2 client factory ──────────────────────────────────
function makeGoogleOAuth2(callbackPath) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_ADS_CLIENT_ID,
    process.env.GOOGLE_ADS_CLIENT_SECRET,
    `${BACKEND_URL}/api/ad-platforms/${callbackPath}/callback`
  );
}

// Refresh Google access token if expired (within 60s buffer)
async function refreshGoogleToken(conn) {
  if (conn.token_expires_at && new Date(conn.token_expires_at) > new Date(Date.now() + 60_000)) {
    return conn.access_token;
  }
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_ADS_CLIENT_ID,
    process.env.GOOGLE_ADS_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2.refreshAccessToken();
  await pool.query(
    `UPDATE ad_platform_connections SET access_token = $1, token_expires_at = $2 WHERE id = $3`,
    [credentials.access_token, new Date(credentials.expiry_date), conn.id]
  );
  return credentials.access_token;
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

// ── GET /google-ads/diagnose — tries multiple API versions & reports back ──
// Temporary diagnostic endpoint to figure out why listAccessibleCustomers 404s.
router.get('/google-ads/diagnose', authenticateToken, async (req, res) => {
  try {
    const connRes = await pool.query(
      `SELECT * FROM ad_platform_connections WHERE user_id = $1 AND platform = 'google_ads'`,
      [req.user.userId]
    );
    if (!connRes.rows[0]) return res.json({ error: 'No google_ads connection for this user' });
    const conn = connRes.rows[0];

    // Inspect stored credentials without leaking them
    const tokenInfo = {
      hasAccessToken: !!conn.access_token,
      accessTokenLen: (conn.access_token || '').length,
      accessTokenPrefix: (conn.access_token || '').slice(0, 12),
      hasRefreshToken: !!conn.refresh_token,
      refreshTokenLen: (conn.refresh_token || '').length,
      refreshTokenPrefix: (conn.refresh_token || '').slice(0, 8),
      tokenExpiresAt: conn.token_expires_at,
      expired: conn.token_expires_at ? new Date(conn.token_expires_at) < new Date() : null,
      connectedAt: conn.connected_at,
      accountId: conn.account_id,
    };

    // Check token validity against Google's tokeninfo endpoint (tells us granted scopes)
    let tokenInfoGoogle = null;
    if (conn.access_token) {
      try {
        const ti = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${conn.access_token}`);
        tokenInfoGoogle = { status: ti.status, body: await ti.text() };
      } catch (e) { tokenInfoGoogle = { error: e.message }; }
    }

    // Force a fresh refresh to rule out stale token
    let refreshResult = null;
    let freshToken = null;
    try {
      const oauth2 = new google.auth.OAuth2(
        process.env.GOOGLE_ADS_CLIENT_ID,
        process.env.GOOGLE_ADS_CLIENT_SECRET
      );
      oauth2.setCredentials({ refresh_token: conn.refresh_token });
      const { credentials } = await oauth2.refreshAccessToken();
      freshToken = credentials.access_token;
      refreshResult = {
        ok: true,
        newTokenLen: (freshToken || '').length,
        newTokenPrefix: (freshToken || '').slice(0, 12),
        expiryDate: credentials.expiry_date,
        scope: credentials.scope,
      };
      await pool.query(
        `UPDATE ad_platform_connections SET access_token = $1, token_expires_at = $2 WHERE id = $3`,
        [freshToken, new Date(credentials.expiry_date), conn.id]
      );
    } catch (e) {
      refreshResult = { ok: false, error: e.message, data: e.response?.data };
    }

    const hasDevToken = !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const devTokenLen = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').length;
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null;

    const attempts = [];
    if (freshToken) {
      const url = `https://googleads.googleapis.com/v20/customers:listAccessibleCustomers`;
      try {
        const r = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${freshToken}`,
            'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
            ...(loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
          },
        });
        const body = await r.text();
        attempts.push({
          label: 'v20 with fresh refreshed token',
          status: r.status,
          contentType: r.headers.get('content-type') || '',
          bodyPreview: body.slice(0, 800),
        });
      } catch (e) {
        attempts.push({ label: 'v20 with fresh refreshed token', error: e.message });
      }
    }
    res.json({ tokenInfo, tokenInfoGoogle, refreshResult, hasDevToken, devTokenLen, loginCustomerId, attempts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /connections ──────────────────────────────────────────────
router.get('/connections', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT platform, account_id, account_name, connected_at, last_synced_at, metadata
       FROM ad_platform_connections WHERE user_id = $1 ORDER BY connected_at DESC`,
      [req.user.userId]
    );
    res.json({ connections: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// VERIFICATION REQUESTS (Google-only, while OAuth app is in testing mode)
// ══════════════════════════════════════════════════════════════════

// GET /verification-requests — user's own verification statuses
router.get('/verification-requests', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT platform, email, status, requested_at, verified_at
       FROM ad_verification_requests WHERE user_id = $1`,
      [req.user.userId]
    );
    res.json({ requests: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /verification-requests — user submits account for verification
router.post('/verification-requests', authenticateToken, async (req, res) => {
  try {
    const { platform, email } = req.body;
    if (!platform || !email) return res.status(400).json({ error: 'platform and email required' });
    if (!['google_ads', 'google_lsa'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be google_ads or google_lsa' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid email' });

    const result = await pool.query(`
      INSERT INTO ad_verification_requests (user_id, platform, email, status)
      VALUES ($1, $2, $3, 'pending')
      ON CONFLICT (user_id, platform) DO UPDATE SET
        email = $3, status = 'pending', requested_at = NOW(), verified_at = NULL
      RETURNING *
    `, [req.user.userId, platform, email]);

    // Notify admin
    const userRes = await pool.query(
      'SELECT name, email, business_name FROM users WHERE id = $1',
      [req.user.userId]
    );
    const u = userRes.rows[0] || {};
    const platformLabel = platform === 'google_ads' ? 'Google Ads' : 'Google Local Services';

    if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
      try {
        await sgMail.send({
          to: ADMIN_EMAIL,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: `[SORCE] New ${platformLabel} verification request`,
          html: `
            <h2 style="font-family:sans-serif">New ${platformLabel} verification request</h2>
            <p style="font-family:sans-serif"><strong>User:</strong> ${u.name || '—'} (${u.email || '—'})</p>
            <p style="font-family:sans-serif"><strong>Business:</strong> ${u.business_name || '—'}</p>
            <p style="font-family:sans-serif"><strong>Account email to whitelist:</strong> ${email}</p>
            <hr>
            <ol style="font-family:sans-serif">
              <li>Go to <a href="https://console.cloud.google.com/apis/credentials/consent">Google Cloud OAuth consent screen</a></li>
              <li>Scroll to <strong>Test users</strong> → Add <code>${email}</code></li>
              <li>Come back to the SORCE admin analytics page and click <strong>Mark as Verified</strong> for this request</li>
            </ol>
          `,
        });
      } catch (e) { console.error('Admin notification email failed:', e.message); }
    }

    res.json({ request: result.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// GOOGLE ADS
// ══════════════════════════════════════════════════════════════════

router.get('/google-ads/auth', authenticateToken, (req, res) => {
  if (!process.env.GOOGLE_ADS_CLIENT_ID) {
    return res.status(503).json({ error: 'Google Ads not configured on this server' });
  }
  const state = jwt.sign({ userId: req.user.userId, platform: 'google_ads' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = makeGoogleOAuth2('google-ads').generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/adwords'],
    state,
    prompt: 'consent',
  });
  res.json({ url });
});

router.get('/google-ads/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const redirectBase = `${FRONTEND_URL}/dashboard`;
  if (error || !code || !state) {
    return res.redirect(`${redirectBase}?ad_connect=error&platform=google_ads`);
  }
  try {
    const { userId } = jwt.verify(state, process.env.JWT_SECRET);
    const oauth2 = makeGoogleOAuth2('google-ads');
    const { tokens } = await oauth2.getToken(code);

    // Save tokens first — even if we can't list customers, the connection is valid.
    // account_id will be populated on first successful sync or via manual entry.
    let accountId = null;
    let resourceNames = [];
    let listError = null;

    if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      try {
        const cusRes = await fetch(`${GADS_BASE}/customers:listAccessibleCustomers`, {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
            ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
              ? { 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
              : {}),
          },
        });
        const bodyText = await cusRes.text();
        const ct = cusRes.headers.get('content-type') || '';
        if (cusRes.ok && ct.includes('application/json')) {
          const cusData = JSON.parse(bodyText);
          resourceNames = cusData.resourceNames || [];
          accountId = resourceNames[0]?.replace('customers/', '') || null;
        } else {
          listError = `listAccessibleCustomers ${cusRes.status}: ${bodyText.slice(0, 300)}`;
          console.error('Google Ads listAccessibleCustomers failed:', listError);
        }
      } catch (e) {
        listError = e.message;
        console.error('Google Ads listAccessibleCustomers error:', e.message);
      }
    } else {
      listError = 'GOOGLE_ADS_DEVELOPER_TOKEN not set';
      console.error(listError);
    }

    await pool.query(`
      INSERT INTO ad_platform_connections (user_id, platform, access_token, refresh_token, account_id, token_expires_at, metadata)
      VALUES ($1, 'google_ads', $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform) DO UPDATE SET
        access_token = $2, refresh_token = COALESCE($3, ad_platform_connections.refresh_token),
        account_id = COALESCE($4, ad_platform_connections.account_id),
        token_expires_at = $5, metadata = $6, connected_at = NOW()
    `, [userId, tokens.access_token, tokens.refresh_token || null, accountId,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        JSON.stringify({ resource_names: resourceNames, list_error: listError })]);

    if (accountId) {
      await syncGoogleAds(userId).catch(e => console.error('Initial Google Ads sync error:', e.message));
    }
    res.redirect(`${redirectBase}?ad_connect=success&platform=google_ads`);
  } catch (e) {
    console.error('Google Ads callback error:', e.message);
    res.redirect(`${redirectBase}?ad_connect=error&platform=google_ads`);
  }
});

router.post('/google-ads/sync', authenticateToken, async (req, res) => {
  try {
    const result = await syncGoogleAds(req.user.userId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function syncGoogleAds(userId) {
  const connRes = await pool.query(
    `SELECT * FROM ad_platform_connections WHERE user_id = $1 AND platform = 'google_ads'`,
    [userId]
  );
  if (!connRes.rows[0]) throw new Error('Google Ads not connected');
  const conn = connRes.rows[0];

  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN not set on server');
  }

  const accessToken = await refreshGoogleToken(conn);

  // Self-heal: if account_id missing, fetch accessible customers now (API may have
  // been disabled at OAuth time but enabled now).
  if (!conn.account_id) {
    const cusRes = await fetch(`${GADS_BASE}/customers:listAccessibleCustomers`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
          ? { 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
          : {}),
      },
    });
    const cusText = await cusRes.text();
    const cusCt = cusRes.headers.get('content-type') || '';
    if (!cusRes.ok || !cusCt.includes('application/json')) {
      throw new Error(`listAccessibleCustomers ${cusRes.status}: ${cusText.slice(0, 300)}`);
    }
    const cusData = JSON.parse(cusText);
    const resourceNames = cusData.resourceNames || [];
    const accountId = resourceNames[0]?.replace('customers/', '') || null;
    if (!accountId) throw new Error('No Google Ads accounts accessible with this Google account');
    await pool.query(
      `UPDATE ad_platform_connections SET account_id = $2, metadata = $3 WHERE id = $1`,
      [conn.id, accountId, JSON.stringify({ resource_names: resourceNames })]
    );
    conn.account_id = accountId;
  }

  // GAQL: daily cost for last 90 days, aggregate into months in JS.
  // LAST_90_DAYS is not a valid DURING literal — use explicit BETWEEN.
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const fmt = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD
  const query = `
    SELECT segments.date, metrics.cost_micros
    FROM customer
    WHERE segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'
  `;
  const gaqlRes = await fetch(
    `${GADS_BASE}/customers/${conn.account_id}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'Content-Type': 'application/json',
        ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
          ? { 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
          : {}),
      },
      body: JSON.stringify({ query }),
    }
  );
  const gaqlText = await gaqlRes.text();
  const gaqlCt = gaqlRes.headers.get('content-type') || '';
  if (!gaqlRes.ok || !gaqlCt.includes('application/json')) {
    throw new Error(`Google Ads API ${gaqlRes.status}: ${gaqlText.slice(0, 300)}`);
  }
  const gaqlData = JSON.parse(gaqlText);
  if (gaqlData.error) throw new Error(gaqlData.error.message || 'Google Ads API error');

  // Aggregate cost_micros by YYYY-MM
  const byMonth = {};
  for (const row of (gaqlData.results || [])) {
    const monthKey = (row.segments?.date || '').substring(0, 7); // "2024-01"
    const costUsd = (row.metrics?.costMicros || 0) / 1_000_000;
    if (monthKey) byMonth[monthKey] = (byMonth[monthKey] || 0) + costUsd;
  }

  for (const [month, amount] of Object.entries(byMonth)) {
    await pool.query(`
      INSERT INTO ad_spend (user_id, source, amount, month, notes)
      VALUES ($1, 'google_ads', $2, $3, 'Auto-synced from Google Ads')
      ON CONFLICT (user_id, source, month) DO UPDATE SET
        amount = $2, notes = 'Auto-synced from Google Ads', updated_at = NOW()
    `, [userId, amount.toFixed(2), month]);
  }

  await pool.query(
    `UPDATE ad_platform_connections SET last_synced_at = NOW() WHERE user_id = $1 AND platform = 'google_ads'`,
    [userId]
  );
  return { synced_months: Object.keys(byMonth).length, spend: byMonth };
}

// ══════════════════════════════════════════════════════════════════
// GOOGLE LOCAL SERVICES ADS (LSA)
// ══════════════════════════════════════════════════════════════════

router.get('/google-lsa/auth', authenticateToken, (req, res) => {
  if (!process.env.GOOGLE_ADS_CLIENT_ID) {
    return res.status(503).json({ error: 'Google not configured on this server' });
  }
  const state = jwt.sign({ userId: req.user.userId, platform: 'google_lsa' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = makeGoogleOAuth2('google-lsa').generateAuthUrl({
    access_type: 'offline',
    // LSA reporting uses the Google Ads (adwords) OAuth scope — there is no separate localservices scope
    scope: ['https://www.googleapis.com/auth/adwords'],
    state,
    prompt: 'consent',
  });
  res.json({ url });
});

router.get('/google-lsa/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const redirectBase = `${FRONTEND_URL}/dashboard`;
  if (error || !code || !state) {
    return res.redirect(`${redirectBase}?ad_connect=error&platform=google_lsa`);
  }
  try {
    const { userId } = jwt.verify(state, process.env.JWT_SECRET);
    const oauth2 = makeGoogleOAuth2('google-lsa');
    const { tokens } = await oauth2.getToken(code);

    // LSA has no accounts:list endpoint — account IDs are returned inline on each
    // accountReports.search row. Store tokens now; account_id gets populated on first sync.
    await pool.query(`
      INSERT INTO ad_platform_connections (user_id, platform, access_token, refresh_token, token_expires_at, metadata)
      VALUES ($1, 'google_lsa', $2, $3, $4, $5)
      ON CONFLICT (user_id, platform) DO UPDATE SET
        access_token = $2, refresh_token = COALESCE($3, ad_platform_connections.refresh_token),
        token_expires_at = $4, metadata = $5, connected_at = NOW()
    `, [userId, tokens.access_token, tokens.refresh_token || null,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        JSON.stringify({})]);

    await syncGoogleLSA(userId).catch(e => console.error('Initial LSA sync error:', e.message));
    res.redirect(`${redirectBase}?ad_connect=success&platform=google_lsa`);
  } catch (e) {
    console.error('Google LSA callback error:', e.message);
    res.redirect(`${redirectBase}?ad_connect=error&platform=google_lsa`);
  }
});

router.post('/google-lsa/sync', authenticateToken, async (req, res) => {
  try {
    const result = await syncGoogleLSA(req.user.userId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Collect LSA manager_customer_id candidates. LSA can be linked to any Google Ads
// account in the user's tree, not necessarily the first one returned.
async function lsaCandidateManagerIds(conn, accessToken) {
  const ids = new Set();
  if (conn.account_id) ids.add(conn.account_id);
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    try {
      const cusRes = await fetch(`${GADS_BASE}/customers:listAccessibleCustomers`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        },
      });
      if (cusRes.ok && (cusRes.headers.get('content-type') || '').includes('application/json')) {
        const cusData = JSON.parse(await cusRes.text());
        for (const rn of (cusData.resourceNames || [])) {
          const id = rn.replace('customers/', '');
          if (id) ids.add(id);
        }
      }
    } catch (e) { console.error('LSA listAccessibleCustomers failed:', e.message); }
  }
  return [...ids];
}

// Query the LSA accountReports:search endpoint for a single calendar month.
// Returns { status, accountReports, rawText, url }.
async function lsaFetchMonth({ accessToken, managerId, year, month }) {
  const lastDay = new Date(year, month, 0).getDate();
  const params = new URLSearchParams({
    'startDate.year': String(year),
    'startDate.month': String(month),
    'startDate.day': '1',
    'endDate.year': String(year),
    'endDate.month': String(month),
    'endDate.day': String(lastDay),
    'query': `manager_customer_id:${managerId}`,
  });
  const url = `https://localservices.googleapis.com/v1/accountReports:search?${params}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, accountReports: data?.accountReports || [], error: data?.error || null, rawText: text, url };
}

// Read the cost value off an LSA AccountReport row. The API returns Money objects
// in `currentPeriodTotalCost` (not `totalCost`). Some versions of the API also
// surface a top-level `currentPeriodCharges`, and older docs reference `totalCost`.
function lsaCostFromReport(report) {
  const candidates = [
    report?.currentPeriodTotalCost,
    report?.currentPeriodCharges,
    report?.totalCost,
  ];
  for (const m of candidates) {
    if (!m) continue;
    const units = parseFloat(m.units || 0);
    const nanos = (Number(m.nanos) || 0) / 1e9;
    const val = units + nanos;
    if (val > 0) return val;
  }
  return 0;
}

async function syncGoogleLSA(userId) {
  const connRes = await pool.query(
    `SELECT * FROM ad_platform_connections WHERE user_id = $1 AND platform = 'google_lsa'`,
    [userId]
  );
  if (!connRes.rows[0]) throw new Error('Google LSA not connected');
  const conn = connRes.rows[0];
  const accessToken = await refreshGoogleToken(conn);

  const managerIds = await lsaCandidateManagerIds(conn, accessToken);
  if (managerIds.length === 0) {
    throw new Error('No linked Google Ads account — connect Google Ads first (LSA reporting is scoped to an Ads account)');
  }

  // Query the last 3 calendar months (including current) one at a time.
  const now = new Date();
  const months = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const byMonth = {};
  let firstAccountId = null;
  let firstAccountName = null;
  const tried = [];
  for (const { year, month } of months) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    for (const managerId of managerIds) {
      const r = await lsaFetchMonth({ accessToken, managerId, year, month });
      tried.push({ monthKey, managerId, status: r.status, reports: r.accountReports.length, err: r.error?.message });
      if (r.status !== 200) continue;
      for (const report of r.accountReports) {
        if (!firstAccountId) {
          firstAccountId = report.accountId || null;
          firstAccountName = report.businessName || null;
        }
        const cost = lsaCostFromReport(report);
        if (cost > 0) byMonth[monthKey] = (byMonth[monthKey] || 0) + cost;
      }
    }
  }

  if (firstAccountId) {
    await pool.query(
      `UPDATE ad_platform_connections SET account_id = $2, account_name = $3 WHERE user_id = $1 AND platform = 'google_lsa'`,
      [userId, firstAccountId, firstAccountName]
    );
  }

  console.log(`LSA sync for user ${userId}:`, { monthsQueried: months.length, managersQueried: managerIds.length, monthsWithData: Object.keys(byMonth).length, tried });

  for (const [month, amount] of Object.entries(byMonth)) {
    await pool.query(`
      INSERT INTO ad_spend (user_id, source, amount, month, notes)
      VALUES ($1, 'google_lsa', $2, $3, 'Auto-synced from Google LSA')
      ON CONFLICT (user_id, source, month) DO UPDATE SET
        amount = $2, notes = 'Auto-synced from Google LSA', updated_at = NOW()
    `, [userId, amount.toFixed(2), month]);
  }

  await pool.query(
    `UPDATE ad_platform_connections SET last_synced_at = NOW() WHERE user_id = $1 AND platform = 'google_lsa'`,
    [userId]
  );
  return { synced_months: Object.keys(byMonth).length, spend: byMonth, debug: { managerIds, tried } };
}

// ── GET /google-lsa/diagnose — dumps raw LSA response for each (month, manager) pair ──
router.get('/google-lsa/diagnose', authenticateToken, async (req, res) => {
  try {
    const connRes = await pool.query(
      `SELECT * FROM ad_platform_connections WHERE user_id = $1 AND platform = 'google_lsa'`,
      [req.user.userId]
    );
    if (!connRes.rows[0]) return res.json({ error: 'No google_lsa connection for this user' });
    const conn = connRes.rows[0];
    const accessToken = await refreshGoogleToken(conn);
    const managerIds = await lsaCandidateManagerIds(conn, accessToken);
    const now = new Date();
    const results = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      for (const managerId of managerIds) {
        const r = await lsaFetchMonth({
          accessToken, managerId,
          year: d.getFullYear(), month: d.getMonth() + 1,
        });
        results.push({
          monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          managerId,
          status: r.status,
          url: r.url,
          error: r.error,
          reportsCount: r.accountReports.length,
          rawPreview: r.rawText.slice(0, 1500),
          firstReport: r.accountReports[0] || null,
        });
      }
    }
    res.json({
      storedAccountId: conn.account_id,
      managerIds,
      results,
    });
  } catch (e) { res.status(500).json({ error: e.message, stack: e.stack }); }
});

// ══════════════════════════════════════════════════════════════════
// META ADS
// ══════════════════════════════════════════════════════════════════

router.get('/meta/auth', authenticateToken, (req, res) => {
  if (!process.env.META_APP_ID) {
    return res.status(503).json({ error: 'Meta Ads not configured on this server' });
  }
  const state = jwt.sign({ userId: req.user.userId, platform: 'meta' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const redirectUri = `${BACKEND_URL}/api/ad-platforms/meta/callback`;
  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id', process.env.META_APP_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'ads_read,business_management');
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  res.json({ url: url.toString() });
});

router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const redirectBase = `${FRONTEND_URL}/dashboard`;
  if (error || !code || !state) {
    return res.redirect(`${redirectBase}?ad_connect=error&platform=meta`);
  }
  try {
    const { userId } = jwt.verify(state, process.env.JWT_SECRET);
    const redirectUri = `${BACKEND_URL}/api/ad-platforms/meta/callback`;

    // Exchange code → short-lived token
    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', process.env.META_APP_ID);
    tokenUrl.searchParams.set('client_secret', process.env.META_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);
    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // Exchange short-lived → long-lived token (60 days)
    const llUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    llUrl.searchParams.set('grant_type', 'fb_exchange_token');
    llUrl.searchParams.set('client_id', process.env.META_APP_ID);
    llUrl.searchParams.set('client_secret', process.env.META_APP_SECRET);
    llUrl.searchParams.set('fb_exchange_token', tokenData.access_token);
    const llRes = await fetch(llUrl.toString());
    const llData = await llRes.json();
    const longToken = llData.access_token || tokenData.access_token;
    const expiresAt = llData.expires_in ? new Date(Date.now() + llData.expires_in * 1000) : null;

    // Fetch ad accounts
    const acctRes = await fetch(
      `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,currency&access_token=${longToken}`
    );
    const acctData = await acctRes.json();
    const firstAccount = acctData.data?.[0];
    const accountId = firstAccount?.id || null;   // e.g. "act_123456"
    const accountName = firstAccount?.name || null;

    await pool.query(`
      INSERT INTO ad_platform_connections (user_id, platform, access_token, account_id, account_name, token_expires_at, metadata)
      VALUES ($1, 'meta', $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform) DO UPDATE SET
        access_token = $2, account_id = $3, account_name = $4,
        token_expires_at = $5, metadata = $6, connected_at = NOW()
    `, [userId, longToken, accountId, accountName, expiresAt,
        JSON.stringify({ accounts: acctData.data || [] })]);

    await syncMeta(userId).catch(e => console.error('Initial Meta sync error:', e.message));
    res.redirect(`${redirectBase}?ad_connect=success&platform=meta`);
  } catch (e) {
    console.error('Meta callback error:', e.message);
    res.redirect(`${redirectBase}?ad_connect=error&platform=meta`);
  }
});

router.post('/meta/sync', authenticateToken, async (req, res) => {
  try {
    const result = await syncMeta(req.user.userId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function syncMeta(userId) {
  const connRes = await pool.query(
    `SELECT * FROM ad_platform_connections WHERE user_id = $1 AND platform = 'meta'`,
    [userId]
  );
  if (!connRes.rows[0]) throw new Error('Meta Ads not connected');
  const { access_token: token, account_id: accountId } = connRes.rows[0];
  if (!accountId) throw new Error('No Meta ad account configured — reconnect');

  const byMonth = {};

  // Pull last 3 calendar months individually
  for (let i = 0; i < 3; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const lastDay = new Date(year, month, 0).getDate();
    const since = `${year}-${String(month).padStart(2, '0')}-01`;
    const until = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const url = new URL(`https://graph.facebook.com/v19.0/${accountId}/insights`);
    url.searchParams.set('fields', 'spend');
    url.searchParams.set('time_range', JSON.stringify({ since, until }));
    url.searchParams.set('level', 'account');
    url.searchParams.set('access_token', token);

    const insightRes = await fetch(url.toString());
    const insightData = await insightRes.json();
    if (insightData.error) {
      console.error(`Meta insights error for ${monthKey}:`, insightData.error.message);
      continue;
    }
    const spend = parseFloat(insightData.data?.[0]?.spend || 0);
    if (spend > 0) byMonth[monthKey] = spend;
  }

  for (const [month, amount] of Object.entries(byMonth)) {
    await pool.query(`
      INSERT INTO ad_spend (user_id, source, amount, month, notes)
      VALUES ($1, 'meta', $2, $3, 'Auto-synced from Meta Ads')
      ON CONFLICT (user_id, source, month) DO UPDATE SET
        amount = $2, notes = 'Auto-synced from Meta Ads', updated_at = NOW()
    `, [userId, amount.toFixed(2), month]);
  }

  await pool.query(
    `UPDATE ad_platform_connections SET last_synced_at = NOW() WHERE user_id = $1 AND platform = 'meta'`,
    [userId]
  );
  return { synced_months: Object.keys(byMonth).length, spend: byMonth };
}

// URL paths use hyphens, DB stores underscores — normalize
const normalizePlatform = (p) => p.replace(/-/g, '_');

// ── PATCH /:platform/account — switch account ID after connect ───
router.patch('/:platform/account', authenticateToken, async (req, res) => {
  try {
    const { accountId, accountName } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    await pool.query(
      `UPDATE ad_platform_connections SET account_id = $1, account_name = $2 WHERE user_id = $3 AND platform = $4`,
      [accountId, accountName || null, req.user.userId, normalizePlatform(req.params.platform)]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /:platform — disconnect ───────────────────────────────
router.delete('/:platform', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM ad_platform_connections WHERE user_id = $1 AND platform = $2`,
      [req.user.userId, normalizePlatform(req.params.platform)]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /sync-all — sync every connected platform ───────────────
router.post('/sync-all', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const conns = await pool.query(
    `SELECT platform FROM ad_platform_connections WHERE user_id = $1`,
    [userId]
  );
  const results = {};
  for (const { platform } of conns.rows) {
    try {
      if (platform === 'google_ads') results.google_ads = await syncGoogleAds(userId);
      else if (platform === 'google_lsa') results.google_lsa = await syncGoogleLSA(userId);
      else if (platform === 'meta') results.meta = await syncMeta(userId);
    } catch (e) {
      results[platform] = { error: e.message };
    }
  }
  res.json({ results });
});

module.exports = router;
module.exports.syncGoogleAds = syncGoogleAds;
module.exports.syncGoogleLSA = syncGoogleLSA;
module.exports.syncMeta = syncMeta;
