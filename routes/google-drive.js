const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Reuse the existing Google Cloud project's OAuth client unless a Drive-specific one is set.
const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET;

// drive.file is a NON-sensitive scope: the app can only see/edit files it created itself,
// so Google doesn't require restricted-scope verification. It's enough for the Sheets API
// to create, read, write and share the spreadsheets SORCE makes. openid/email just let us
// show which Google account is connected.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
  'profile',
];

function makeOAuth2() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, `${BACKEND_URL}/api/google-drive/callback`);
}

// ── Startup migrations ───────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS google_drive_connections (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    account_email TEXT,
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('google_drive_connections migration error:', e.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS google_sheets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spreadsheet_id TEXT NOT NULL,
    url TEXT,
    title TEXT,
    kind TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('google_sheets migration error:', e.message));

// ── Token helpers ────────────────────────────────────────

// Return an OAuth2 client authed for this user, refreshing the access token if it's expired.
async function getAuthedClient(userId) {
  const r = await pool.query('SELECT * FROM google_drive_connections WHERE user_id = $1', [userId]);
  const conn = r.rows[0];
  if (!conn || !conn.refresh_token) return null;

  const oauth2 = makeOAuth2();
  oauth2.setCredentials({
    refresh_token: conn.refresh_token,
    access_token: conn.access_token || undefined,
    expiry_date: conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : undefined,
  });

  // Refresh if expiring within 60s.
  if (!conn.token_expires_at || new Date(conn.token_expires_at) <= new Date(Date.now() + 60_000)) {
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    await pool.query(
      'UPDATE google_drive_connections SET access_token = $1, token_expires_at = $2, updated_at = NOW() WHERE user_id = $3',
      [credentials.access_token, credentials.expiry_date ? new Date(credentials.expiry_date) : null, userId]
    );
  }
  return oauth2;
}

// Parse a spreadsheet cell into a number, tolerating "$1,234.50", " 80 ", blanks.
function toNumber(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Monday→Sunday week containing `dateStr` (or today). Returns {start, end} as YYYY-MM-DD.
function weekBounds(dateStr) {
  const base = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const day = (base.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(base); start.setDate(base.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const iso = d => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

// ── Header templates ─────────────────────────────────────
// The summary endpoint relies on these column orders, so keep them in sync.
const SHEET_TEMPLATES = {
  tips:    { tab: 'Tips',    headers: ['Date', 'Detailer', 'Tip Amount', 'Notes'] },
  payroll: { tab: 'Payroll', headers: ['Week Starting', 'Employee', 'Hours', 'Pay Amount', 'Notes'] },
  general: { tab: 'Sheet1',  headers: [] },
};

// ── Routes ───────────────────────────────────────────────

// GET /api/google-drive/status — is the owner's Google account connected?
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT account_email, connected_at FROM google_drive_connections WHERE user_id = $1',
      [req.user.userId]
    );
    res.json({
      connected: r.rows.length > 0,
      configured: !!CLIENT_ID,
      email: r.rows[0]?.account_email || null,
      connectedAt: r.rows[0]?.connected_at || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/google-drive/auth — return the Google consent URL
router.get('/auth', authenticateToken, (req, res) => {
  if (!CLIENT_ID) return res.status(503).json({ error: 'Google Drive is not configured on this server yet.' });
  const state = jwt.sign({ userId: req.user.userId, scope: 'google_drive' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = makeOAuth2().generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent', // force a refresh_token every time
    include_granted_scopes: true,
  });
  res.json({ url });
});

// GET /api/google-drive/callback — OAuth redirect target
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const redirectBase = `${FRONTEND_URL}/dashboard`;
  if (error || !code || !state) {
    return res.redirect(`${redirectBase}?gdrive=error`);
  }
  try {
    const { userId } = jwt.verify(state, process.env.JWT_SECRET);
    const oauth2 = makeOAuth2();
    const { tokens } = await oauth2.getToken(code);

    // Pull the connected account's email for display.
    let email = null;
    try {
      oauth2.setCredentials(tokens);
      const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
      const me = await oauth2Api.userinfo.get();
      email = me.data.email || null;
    } catch (_) {}

    await pool.query(
      `INSERT INTO google_drive_connections (user_id, access_token, refresh_token, token_expires_at, account_email, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = $2,
         refresh_token = COALESCE($3, google_drive_connections.refresh_token),
         token_expires_at = $4,
         account_email = COALESCE($5, google_drive_connections.account_email),
         updated_at = NOW()`,
      [userId, tokens.access_token, tokens.refresh_token || null,
       tokens.expiry_date ? new Date(tokens.expiry_date) : null, email]
    );

    res.redirect(`${redirectBase}?gdrive=success`);
  } catch (e) {
    console.error('Google Drive callback error:', e.message);
    res.redirect(`${redirectBase}?gdrive=error`);
  }
});

// POST /api/google-drive/disconnect
router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM google_drive_connections WHERE user_id = $1', [req.user.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/google-drive/sheets — sheets SORCE has created for this user
router.get('/sheets', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, spreadsheet_id, url, title, kind, created_at FROM google_sheets WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json({ sheets: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/google-drive/sheets — create a new spreadsheet in the owner's Drive
router.post('/sheets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title, kind = 'general' } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'A sheet title is required' });

    const auth = await getAuthedClient(userId);
    if (!auth) return res.status(400).json({ error: 'Connect your Google account first' });

    const template = SHEET_TEMPLATES[kind] || SHEET_TEMPLATES.general;
    const sheets = google.sheets({ version: 'v4', auth });

    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: title.trim() },
        sheets: [{ properties: { title: template.tab } }],
      },
    });
    const spreadsheetId = created.data.spreadsheetId;
    const url = created.data.spreadsheetUrl;

    // Seed the header row + bold it so the manager knows what to type where.
    if (template.headers.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${template.tab}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [template.headers] },
      });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          }],
        },
      });
    }

    const saved = await pool.query(
      'INSERT INTO google_sheets (user_id, spreadsheet_id, url, title, kind) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [userId, spreadsheetId, url, title.trim(), kind]
    );
    res.json({ success: true, sheet: saved.rows[0] });
  } catch (e) {
    console.error('Create sheet error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to create sheet' });
  }
});

// POST /api/google-drive/sheets/:id/share — share a created sheet with a teammate
router.post('/sheets/:id/share', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { email, role = 'writer' } = req.body || {};
    if (!email?.trim()) return res.status(400).json({ error: 'A recipient email is required' });

    const sheetRow = await pool.query(
      'SELECT spreadsheet_id FROM google_sheets WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    if (sheetRow.rows.length === 0) return res.status(404).json({ error: 'Sheet not found' });

    const auth = await getAuthedClient(userId);
    if (!auth) return res.status(400).json({ error: 'Connect your Google account first' });

    const drive = google.drive({ version: 'v3', auth });
    await drive.permissions.create({
      fileId: sheetRow.rows[0].spreadsheet_id,
      sendNotificationEmail: true,
      requestBody: {
        type: 'user',
        role: role === 'reader' ? 'reader' : 'writer',
        emailAddress: email.trim(),
      },
    });
    res.json({ success: true, sharedWith: email.trim() });
  } catch (e) {
    console.error('Share sheet error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to share sheet' });
  }
});

// DELETE /api/google-drive/sheets/:id — stop tracking the sheet in SORCE (leaves the file in Drive)
router.delete('/sheets/:id', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM google_sheets WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Sheet not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/google-drive/summary?weekStart=YYYY-MM-DD
// Reads the most recent Tips + Payroll sheets, sums them for the chosen week, and compares
// payroll to SORCE booking revenue for that week.
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { start, end } = weekBounds(req.query.weekStart);

    const auth = await getAuthedClient(userId);
    if (!auth) return res.status(400).json({ error: 'Connect your Google account first' });
    const sheets = google.sheets({ version: 'v4', auth });

    const pick = async (kind) => {
      const r = await pool.query(
        'SELECT spreadsheet_id, title, url FROM google_sheets WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1',
        [userId, kind]
      );
      return r.rows[0] || null;
    };
    const tipsSheet = await pick('tips');
    const payrollSheet = await pick('payroll');

    const readRows = async (sheet, tab) => {
      if (!sheet) return [];
      try {
        const r = await sheets.spreadsheets.values.get({
          spreadsheetId: sheet.spreadsheet_id,
          range: `${tab}!A2:Z`,
        });
        return r.data.values || [];
      } catch (e) {
        console.warn(`Summary read failed for ${tab}:`, e.message);
        return [];
      }
    };

    // Tips: Date | Detailer | Tip Amount | Notes — sum + group by detailer, filtered to the week.
    const inWeek = (d) => {
      if (!d) return true; // undated rows always count
      const iso = String(d).trim().slice(0, 10);
      return iso >= start && iso <= end;
    };
    const tipsRows = await readRows(tipsSheet, SHEET_TEMPLATES.tips.tab);
    let tipsTotal = 0;
    const tipsByDetailer = {};
    for (const row of tipsRows) {
      if (!inWeek(row[0])) continue;
      const detailer = (row[1] || 'Unassigned').trim() || 'Unassigned';
      const amt = toNumber(row[2]);
      if (amt === 0 && !row[1]) continue;
      tipsTotal += amt;
      tipsByDetailer[detailer] = (tipsByDetailer[detailer] || 0) + amt;
    }

    // Payroll: Week Starting | Employee | Hours | Pay Amount | Notes
    const payrollRows = await readRows(payrollSheet, SHEET_TEMPLATES.payroll.tab);
    let payrollTotal = 0;
    const payrollByEmployee = {};
    for (const row of payrollRows) {
      if (!inWeek(row[0])) continue;
      const emp = (row[1] || 'Unassigned').trim() || 'Unassigned';
      const amt = toNumber(row[3]);
      if (amt === 0 && !row[1]) continue;
      payrollTotal += amt;
      payrollByEmployee[emp] = (payrollByEmployee[emp] || 0) + amt;
    }

    // SORCE revenue for the week — non-cancelled bookings in the date range.
    const revRow = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue
       FROM bookings
       WHERE user_id = $1
         AND booking_date >= $2 AND booking_date <= $3
         AND COALESCE(status, '') <> 'cancelled'`,
      [userId, start, end]
    );
    const revenue = parseFloat(revRow.rows[0].revenue) || 0;

    res.json({
      weekStart: start,
      weekEnd: end,
      tips: {
        total: Math.round(tipsTotal * 100) / 100,
        byDetailer: tipsByDetailer,
        sheet: tipsSheet ? { title: tipsSheet.title, url: tipsSheet.url } : null,
      },
      payroll: {
        total: Math.round(payrollTotal * 100) / 100,
        byEmployee: payrollByEmployee,
        sheet: payrollSheet ? { title: payrollSheet.title, url: payrollSheet.url } : null,
      },
      revenue,
      payrollPctOfRevenue: revenue > 0 ? Math.round((payrollTotal / revenue) * 1000) / 10 : null,
    });
  } catch (e) {
    console.error('Summary error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to build summary' });
  }
});

module.exports = router;
