const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// ── Schema ───────────────────────────────────────────────
pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC DEFAULT 0`)
  .catch(e => console.error('employees hourly_rate migration error:', e.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS payroll_configs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    efficiency_tiers JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('payroll_configs migration error:', e.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS payroll_actuals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (employee_id, week_start)
  )
`).catch(e => console.error('payroll_actuals migration error:', e.message));

// Tiers: [{ min, max, delta }] — efficiency% in [min,max) adjusts hourly by +delta.
const DEFAULT_TIERS = [
  { min: 0,   max: 90,   delta: -2 },
  { min: 90,  max: 110,  delta: 0 },
  { min: 110, max: 1000, delta: 2 },
];

function weekBounds(dateStr) {
  const base = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const day = (base.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(base); start.setDate(base.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const iso = d => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function applyTier(effPct, baseRate, tiers) {
  if (effPct == null) return baseRate;
  const t = (tiers || []).find(t => effPct >= t.min && effPct < t.max);
  const delta = t ? Number(t.delta) || 0 : 0;
  return Math.max(0, Number(baseRate) + delta);
}

// ── Config ───────────────────────────────────────────────
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT efficiency_tiers FROM payroll_configs WHERE user_id = $1', [req.user.userId]);
    const tiers = r.rows[0]?.efficiency_tiers;
    res.json({ tiers: (Array.isArray(tiers) && tiers.length) ? tiers : DEFAULT_TIERS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/config', authenticateToken, async (req, res) => {
  try {
    const { tiers } = req.body || {};
    if (!Array.isArray(tiers)) return res.status(400).json({ error: 'tiers array required' });
    const clean = tiers
      .map(t => ({ min: Number(t.min) || 0, max: Number(t.max) || 0, delta: Number(t.delta) || 0 }))
      .filter(t => t.max > t.min);
    await pool.query(
      `INSERT INTO payroll_configs (user_id, efficiency_tiers, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET efficiency_tiers = $2, updated_at = NOW()`,
      [req.user.userId, JSON.stringify(clean)]
    );
    res.json({ success: true, tiers: clean });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/payroll/employees/:id/rate — set base hourly rate
router.put('/employees/:id/rate', authenticateToken, async (req, res) => {
  try {
    const rate = parseFloat(req.body?.rate);
    if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: 'Enter a valid hourly rate' });
    const r = await pool.query(
      'UPDATE employees SET hourly_rate = $1 WHERE id = $2 AND user_id = $3 RETURNING id, hourly_rate',
      [rate, req.params.id, req.user.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true, hourly_rate: r.rows[0].hourly_rate });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/payroll/actual — set the manually-entered (pay-for-performance) amount for a week
router.put('/actual', authenticateToken, async (req, res) => {
  try {
    const { employeeId, weekStart, amount } = req.body || {};
    const amt = parseFloat(amount);
    if (!employeeId || !weekStart) return res.status(400).json({ error: 'employeeId and weekStart required' });
    if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: 'Enter a valid amount' });
    const { start } = weekBounds(weekStart);
    await pool.query(
      `INSERT INTO payroll_actuals (user_id, employee_id, week_start, amount, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (employee_id, week_start) DO UPDATE SET amount = $4, updated_at = NOW()`,
      [req.user.userId, employeeId, start, amt]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/payroll/summary?weekStart=YYYY-MM-DD
// Per-employee: clocked hours, budgeted hours earned (completed jobs), efficiency,
// base + efficiency-adjusted rate, projected payroll, and the manual actual.
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { start, end } = weekBounds(req.query.weekStart);

    const cfgRow = await pool.query('SELECT efficiency_tiers FROM payroll_configs WHERE user_id = $1', [userId]);
    const cfgTiers = cfgRow.rows[0]?.efficiency_tiers;
    const tiers = (Array.isArray(cfgTiers) && cfgTiers.length) ? cfgTiers : DEFAULT_TIERS;

    const employees = (await pool.query(
      'SELECT id, name, COALESCE(hourly_rate, 0) AS hourly_rate FROM employees WHERE user_id = $1 AND active = true ORDER BY name',
      [userId]
    )).rows;

    // Clocked worked hours (elapsed minus breaks) per employee for the week.
    const clocked = (await pool.query(
      `SELECT te.employee_id,
              SUM(EXTRACT(EPOCH FROM (COALESCE(te.clock_out, NOW()) - te.clock_in)))::numeric AS elapsed,
              COALESCE(SUM(br.break_secs), 0)::numeric AS break_secs
       FROM time_entries te
       LEFT JOIN LATERAL (
         SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(tb.end_at, NOW()) - tb.start_at))) AS break_secs
         FROM time_breaks tb WHERE tb.time_entry_id = te.id
       ) br ON true
       WHERE te.user_id = $1 AND te.clock_in >= $2::date AND te.clock_in < ($3::date + INTERVAL '1 day')
       GROUP BY te.employee_id`,
      [userId, start, end]
    )).rows;
    const clockedByEmp = {};
    for (const c of clocked) {
      clockedByEmp[c.employee_id] = Math.max(0, (Number(c.elapsed) - Number(c.break_secs)) / 3600);
    }

    // Budgeted hours earned = completed jobs assigned to the employee in the week.
    const earned = (await pool.query(
      `SELECT b.employee_id,
              SUM(COALESCE(b.budgeted_hours, item.total, 0))::numeric AS earned
       FROM bookings b
       LEFT JOIN LATERAL (SELECT SUM(service_duration) AS total FROM booking_items WHERE booking_id = b.id) item ON true
       WHERE b.user_id = $1 AND b.status = 'completed' AND b.employee_id IS NOT NULL
         AND b.booking_date >= $2 AND b.booking_date <= $3
       GROUP BY b.employee_id`,
      [userId, start, end]
    )).rows;
    const earnedByEmp = {};
    for (const e of earned) earnedByEmp[e.employee_id] = Number(e.earned) || 0;

    const actuals = (await pool.query(
      'SELECT employee_id, amount FROM payroll_actuals WHERE user_id = $1 AND week_start = $2',
      [userId, start]
    )).rows;
    const actualByEmp = {};
    for (const a of actuals) actualByEmp[a.employee_id] = Number(a.amount) || 0;

    let totalProjected = 0, totalActual = 0;
    const rows = employees.map(emp => {
      const baseRate = Number(emp.hourly_rate) || 0;
      const clockedHours = Math.round((clockedByEmp[emp.id] || 0) * 100) / 100;
      const budgetedEarned = Math.round((earnedByEmp[emp.id] || 0) * 100) / 100;
      const efficiency = clockedHours > 0 ? Math.round((budgetedEarned / clockedHours) * 1000) / 10 : null;
      const adjustedRate = applyTier(efficiency, baseRate, tiers);
      const projected = Math.round(baseRate * clockedHours * 100) / 100;
      const adjustedProjected = Math.round(adjustedRate * clockedHours * 100) / 100;
      const actual = actualByEmp[emp.id] != null ? actualByEmp[emp.id] : null;
      totalProjected += projected;
      if (actual != null) totalActual += actual;
      return {
        id: emp.id, name: emp.name, baseRate, clockedHours, budgetedEarned,
        efficiency, adjustedRate, projected, adjustedProjected, actual,
      };
    });

    // Square revenue for the week (collected, minus refunds) to compare against payroll.
    const revRow = await pool.query(
      `SELECT COALESCE(SUM(p.amount - COALESCE(p.refund_amount, 0)), 0)::numeric AS revenue
       FROM payments p
       WHERE p.user_id = $1 AND p.processor = 'square' AND p.status IN ('succeeded','completed')
         AND p.created_at >= $2::date AND p.created_at < ($3::date + INTERVAL '1 day')`,
      [userId, start, end]
    ).catch(() => ({ rows: [{ revenue: 0 }] }));
    const revenue = parseFloat(revRow.rows[0].revenue) || 0;

    res.json({
      weekStart: start, weekEnd: end, tiers,
      employees: rows,
      totals: {
        projected: Math.round(totalProjected * 100) / 100,
        actual: Math.round(totalActual * 100) / 100,
        revenue,
        actualPctOfRevenue: revenue > 0 ? Math.round((totalActual / revenue) * 1000) / 10 : null,
      },
    });
  } catch (e) {
    console.error('payroll summary error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
