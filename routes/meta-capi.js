// ============================================
// Meta CAPI config — per-user pixel + access token storage
// Used by utils/metaConversions.js to fire server-side Lead events.
// ============================================
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// Startup migration: per-user pixel config (one row per user).
pool.query(`
  CREATE TABLE IF NOT EXISTS meta_capi_configs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pixel_id VARCHAR(64) NOT NULL,
    access_token TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    test_event_code VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
`).catch(e => console.error('meta_capi_configs migration error:', e.message));

// Mask the token in API responses so the dashboard can show "configured" without exposing it.
function mask(token) {
  if (!token) return '';
  if (token.length <= 12) return '••••';
  return token.slice(0, 4) + '••••' + token.slice(-4);
}

// GET /api/meta-capi/config — current user's pixel config (token masked).
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pixel_id, enabled, test_event_code, access_token, updated_at
       FROM meta_capi_configs WHERE user_id = $1`,
      [req.user.userId]
    );
    if (r.rows.length === 0) return res.json({ configured: false });
    const c = r.rows[0];
    res.json({
      configured: true,
      pixelId: c.pixel_id,
      enabled: c.enabled,
      testEventCode: c.test_event_code,
      tokenMasked: mask(c.access_token),
      updatedAt: c.updated_at,
    });
  } catch (e) {
    console.error('GET /meta-capi/config error:', e.message);
    res.status(500).json({ error: 'Failed to load Meta CAPI config' });
  }
});

// PUT /api/meta-capi/config — upsert pixel + access token. Token only updates when provided.
router.put('/config', authenticateToken, async (req, res) => {
  try {
    const { pixelId, accessToken, enabled, testEventCode } = req.body || {};
    if (!pixelId || !/^\d{6,30}$/.test(String(pixelId).trim())) {
      return res.status(400).json({ error: 'pixelId must be a numeric Meta Pixel ID' });
    }
    const enabledFlag = enabled === false ? false : true;
    const tec = testEventCode ? String(testEventCode).trim() : null;

    if (accessToken && String(accessToken).trim()) {
      await pool.query(
        `INSERT INTO meta_capi_configs (user_id, pixel_id, access_token, enabled, test_event_code, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           pixel_id = EXCLUDED.pixel_id,
           access_token = EXCLUDED.access_token,
           enabled = EXCLUDED.enabled,
           test_event_code = EXCLUDED.test_event_code,
           updated_at = NOW()`,
        [req.user.userId, String(pixelId).trim(), String(accessToken).trim(), enabledFlag, tec]
      );
    } else {
      // No new token provided — update everything except access_token (so existing token stays).
      const existing = await pool.query(
        'SELECT 1 FROM meta_capi_configs WHERE user_id = $1',
        [req.user.userId]
      );
      if (existing.rows.length === 0) {
        return res.status(400).json({ error: 'accessToken required on first save' });
      }
      await pool.query(
        `UPDATE meta_capi_configs
         SET pixel_id = $1, enabled = $2, test_event_code = $3, updated_at = NOW()
         WHERE user_id = $4`,
        [String(pixelId).trim(), enabledFlag, tec, req.user.userId]
      );
    }

    res.json({ success: true });
  } catch (e) {
    console.error('PUT /meta-capi/config error:', e.message);
    res.status(500).json({ error: 'Failed to save Meta CAPI config' });
  }
});

// DELETE /api/meta-capi/config — disconnect.
router.delete('/config', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM meta_capi_configs WHERE user_id = $1', [req.user.userId]);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /meta-capi/config error:', e.message);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

module.exports = router;
