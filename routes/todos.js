const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { authenticateEmployee } = require('../config/employee-middleware');

// Resolve the owner user_id from either a user JWT (dashboard) or an admin employee JWT (app)
async function resolveOwner(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  // Try user-token path first (dashboard)
  authenticateToken(req, res, (err) => {
    if (!err && req.user?.userId) {
      req.ownerUserId = req.user.userId;
      return next();
    }
    // Fall back to employee-token path (app admin)
    authenticateEmployee(req, res, async (err2) => {
      if (err2 || !req.employee?.employeeId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      try {
        const r = await pool.query(
          `SELECT e.user_id, e.is_admin FROM employees e WHERE e.id = $1`,
          [req.employee.employeeId]
        );
        if (!r.rows.length || !r.rows[0].is_admin) {
          return res.status(403).json({ error: 'Admin only' });
        }
        req.ownerUserId = r.rows[0].user_id;
        next();
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  });
}

router.get('/', resolveOwner, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, text, done, priority, created_at FROM admin_todos
       WHERE user_id = $1 ORDER BY done ASC, created_at DESC`,
      [req.ownerUserId]
    );
    res.json({ todos: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', resolveOwner, async (req, res) => {
  try {
    const { text, priority } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const r = await pool.query(
      `INSERT INTO admin_todos (user_id, text, priority) VALUES ($1, $2, $3) RETURNING *`,
      [req.ownerUserId, text.trim(), priority || 'medium']
    );
    res.json({ todo: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', resolveOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { text, done, priority } = req.body || {};
    const sets = [], vals = [];
    if (text !== undefined)     { sets.push(`text = $${vals.length + 1}`);     vals.push(text); }
    if (done !== undefined)     { sets.push(`done = $${vals.length + 1}`);     vals.push(!!done); }
    if (priority !== undefined) { sets.push(`priority = $${vals.length + 1}`); vals.push(priority); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = NOW()`);
    vals.push(id, req.ownerUserId);
    const r = await pool.query(
      `UPDATE admin_todos SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND user_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ todo: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', resolveOwner, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM admin_todos WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.ownerUserId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
