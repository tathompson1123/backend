const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { authenticateEmployee } = require('../config/employee-middleware');

// Resolve the owner user_id and (when posted from the app) the creating employee
async function resolveOwner(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  // Try user-token path first (dashboard — owner adds with no employee id)
  authenticateToken(req, res, (err) => {
    if (!err && req.user?.userId) {
      req.ownerUserId = req.user.userId;
      req.creatorEmployeeId = null;
      return next();
    }
    // Fall back to employee-token path (any team member in the app)
    authenticateEmployee(req, res, async (err2) => {
      if (err2 || !req.employee?.employeeId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      try {
        const r = await pool.query(
          `SELECT e.user_id FROM employees e WHERE e.id = $1`,
          [req.employee.employeeId]
        );
        if (!r.rows.length) return res.status(403).json({ error: 'Not on a team' });
        req.ownerUserId = r.rows[0].user_id;
        req.creatorEmployeeId = req.employee.employeeId;
        next();
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  });
}

const TODO_SELECT = `
  t.id, t.text, t.done, t.priority, t.scope, t.created_at, t.created_by_employee_id,
  e.name AS creator_name, e.color AS creator_color
`;

function normalizeScope(raw) {
  return raw === 'team' ? 'team' : 'admin';
}

router.get('/', resolveOwner, async (req, res) => {
  try {
    const scope = normalizeScope(req.query.scope);
    const r = await pool.query(
      `SELECT ${TODO_SELECT}
       FROM admin_todos t
       LEFT JOIN employees e ON e.id = t.created_by_employee_id
       WHERE t.user_id = $1 AND t.scope = $2
       ORDER BY t.done ASC, t.created_at DESC`,
      [req.ownerUserId, scope]
    );
    res.json({ todos: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', resolveOwner, async (req, res) => {
  try {
    const { text, priority, scope: scopeIn } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const scope = normalizeScope(scopeIn);
    const ins = await pool.query(
      `INSERT INTO admin_todos (user_id, text, priority, scope, created_by_employee_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.ownerUserId, text.trim(), priority || 'medium', scope, req.creatorEmployeeId]
    );
    const r = await pool.query(
      `SELECT ${TODO_SELECT}
       FROM admin_todos t
       LEFT JOIN employees e ON e.id = t.created_by_employee_id
       WHERE t.id = $1`,
      [ins.rows[0].id]
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
    const upd = await pool.query(
      `UPDATE admin_todos SET ${sets.join(', ')}
       WHERE id = $${vals.length - 1} AND user_id = $${vals.length} RETURNING id`,
      vals
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = await pool.query(
      `SELECT ${TODO_SELECT}
       FROM admin_todos t
       LEFT JOIN employees e ON e.id = t.created_by_employee_id
       WHERE t.id = $1`,
      [upd.rows[0].id]
    );
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
