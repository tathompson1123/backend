const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// 1×1 transparent GIF — returned immediately so the browser paint isn't blocked
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// GET /api/track/:userId  — public, no auth, CORS handled at mount
router.get('/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const referrer = (req.query.r || '').slice(0, 500);
  const pageUrl  = (req.query.u || '').slice(0, 500);

  // Respond immediately — don't make the visitor's browser wait on DB
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.end(GIF_1x1);

  if (!userId || isNaN(userId)) return;

  // Fire-and-forget insert
  pool.query(
    `INSERT INTO website_visits (user_id, page_url, referrer, visited_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
    [userId, pageUrl, referrer]
  ).catch(err => console.error('[track] DB error:', err.message));
});

module.exports = router;
