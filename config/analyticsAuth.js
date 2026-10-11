// Auth for the internal /analytics area (SORCE sales team + admins).
//
// This used to be copy-pasted into analytics.js, discovery.js and internal-billing.js, and
// all three trusted the 12-hour token alone — so revoking a rep's access did nothing until
// their token aged out. It now re-checks the team-member row on every request.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('./database');

async function requireAnalytics(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!decoded.analytics) return res.status(403).json({ error: 'Forbidden' });

  // Individual team members: must still be active, and their role is read from the
  // database rather than the token so a demotion takes effect immediately.
  if (decoded.tm) {
    try {
      const r = await pool.query('SELECT active, role FROM sorce_team_members WHERE id = $1', [decoded.tm]);
      if (!r.rows[0] || !r.rows[0].active) {
        return res.status(401).json({ error: 'Access revoked' });
      }
      decoded.role = r.rows[0].role;
    } catch (err) {
      console.error('Analytics auth lookup failed:', err.message);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  }
  req.analytics = decoded;
  next();
}

// Master-password sessions have no `tm` and count as admin.
function requireAdmin(req, res, next) {
  if (!req.analytics?.tm || req.analytics.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

// Constant-time string comparison for shared secrets.
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  if (x.length !== y.length) {
    crypto.timingSafeEqual(x, x); // keep the work roughly constant
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

module.exports = { requireAnalytics, requireAdmin, safeEqual };
