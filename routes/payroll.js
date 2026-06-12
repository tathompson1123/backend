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

// Owner override of an employee's clocked hours for a week (e.g. a forgotten clock-out).
pool.query(`
  CREATE TABLE IF NOT EXISTS payroll_hours (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    hours NUMERIC NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (employee_id, week_start)
  )
`).catch(e => console.error('payroll_hours migration error:', e.message));

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

// PUT /api/payroll/hours — owner override of clocked hours for a week (empty clears it)
router.put('/hours', authenticateToken, async (req, res) => {
  try {
    const { employeeId, weekStart, hours } = req.body || {};
    if (!employeeId || !weekStart) return res.status(400).json({ error: 'employeeId and weekStart required' });
    const { start } = weekBounds(weekStart);
    if (hours === null || hours === undefined || hours === '') {
      await pool.query('DELETE FROM payroll_hours WHERE user_id = $1 AND employee_id = $2 AND week_start = $3',
        [req.user.userId, employeeId, start]);
      return res.json({ success: true, cleared: true });
    }
    const h = parseFloat(hours);
    if (!Number.isFinite(h) || h < 0) return res.status(400).json({ error: 'Enter a valid number of hours' });
    await pool.query(
      `INSERT INTO payroll_hours (user_id, employee_id, week_start, hours, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (employee_id, week_start) DO UPDATE SET hours = $4, updated_at = NOW()`,
      [req.user.userId, employeeId, start, h]
    );
    res.json({ success: true, hours: h });
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

    // Owner overrides of clocked hours (forgotten clock-outs, corrections).
    const hoursOverrides = (await pool.query(
      'SELECT employee_id, hours FROM payroll_hours WHERE user_id = $1 AND week_start = $2',
      [userId, start]
    )).rows;
    const overrideByEmp = {};
    for (const h of hoursOverrides) overrideByEmp[h.employee_id] = Number(h.hours);

    // Budgeted hours assigned to each employee in the week (their override, else the sum of
    // the job's service durations). Counts every non-cancelled assigned job — so budgeted
    // hours pre-fill as soon as jobs are on the schedule, before anything is marked complete.
    const earned = (await pool.query(
      `SELECT b.employee_id,
              SUM(COALESCE(b.budgeted_hours, item.total, 0))::numeric AS earned
       FROM bookings b
       LEFT JOIN LATERAL (SELECT SUM(service_duration) AS total FROM booking_items WHERE booking_id = b.id) item ON true
       WHERE b.user_id = $1 AND b.employee_id IS NOT NULL
         AND COALESCE(b.status, '') NOT IN ('cancelled', 'canceled')
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
      const computedHours = Math.round((clockedByEmp[emp.id] || 0) * 100) / 100;
      const overridden = overrideByEmp[emp.id] != null;
      const clockedHours = overridden ? Math.round(overrideByEmp[emp.id] * 100) / 100 : computedHours;
      const budgetedEarned = Math.round((earnedByEmp[emp.id] || 0) * 100) / 100;
      const efficiency = clockedHours > 0 ? Math.round((budgetedEarned / clockedHours) * 1000) / 10 : null;
      const adjustedRate = applyTier(efficiency, baseRate, tiers);
      const projected = Math.round(baseRate * clockedHours * 100) / 100;
      const adjustedProjected = Math.round(adjustedRate * clockedHours * 100) / 100;
      const actual = actualByEmp[emp.id] != null ? actualByEmp[emp.id] : null;
      totalProjected += projected;
      if (actual != null) totalActual += actual;
      return {
        id: emp.id, name: emp.name, baseRate, clockedHours, computedHours, clockedOverridden: overridden,
        budgetedEarned, efficiency, adjustedRate, projected, adjustedProjected, actual,
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

// ── Individual clock in/out entries (view + edit) ────────────
// These let the owner see and correct the raw punches behind the weekly
// "Clocked" total. Note: a weekly override in payroll_hours still supersedes
// these in the summary until it's cleared.

// GET /api/payroll/time-entries?employeeId=&weekStart=
router.get('/time-entries', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const employeeId = parseInt(req.query.employeeId, 10);
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
    const { start, end } = weekBounds(req.query.weekStart);

    const emp = await pool.query('SELECT id FROM employees WHERE id = $1 AND user_id = $2', [employeeId, userId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const entries = (await pool.query(
      `SELECT id, clock_in, clock_out FROM time_entries
       WHERE user_id = $1 AND employee_id = $2
         AND clock_in >= $3::date AND clock_in < ($4::date + INTERVAL '1 day')
       ORDER BY clock_in ASC`,
      [userId, employeeId, start, end]
    )).rows;

    // Pull every break for these entries and group by entry.
    const ids = entries.map(e => e.id);
    const breaksByEntry = {};
    if (ids.length) {
      const brs = (await pool.query(
        `SELECT id, time_entry_id, break_type, start_at, end_at
         FROM time_breaks WHERE time_entry_id = ANY($1) ORDER BY start_at ASC`,
        [ids]
      )).rows;
      for (const b of brs) (breaksByEntry[b.time_entry_id] ||= []).push(b);
    }

    const secsBetween = (a, b) => Math.max(0, (new Date(b || Date.now()).getTime() - new Date(a).getTime()) / 1000);

    const rows = entries.map(e => {
      const brs = breaksByEntry[e.id] || [];
      const breakSecs = brs.reduce((s, b) => s + secsBetween(b.start_at, b.end_at), 0);
      const elapsed = secsBetween(e.clock_in, e.clock_out);
      const worked = Math.max(0, (elapsed - breakSecs) / 3600);
      return {
        id: e.id,
        clockIn: e.clock_in,
        clockOut: e.clock_out,
        breakHours: Math.round((breakSecs / 3600) * 100) / 100,
        workedHours: Math.round(worked * 100) / 100,
        open: !e.clock_out,
        breaks: brs.map(b => ({
          id: b.id, breakType: b.break_type, startAt: b.start_at, endAt: b.end_at, open: !b.end_at,
        })),
      };
    });
    const totalWorked = Math.round(rows.reduce((s, r) => s + r.workedHours, 0) * 100) / 100;
    res.json({ employeeId, weekStart: start, weekEnd: end, entries: rows, totalWorked });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared validation for a clock-in/out pair. Returns { in, out } Dates or an error string.
function parsePunch(clockIn, clockOut, existing = {}) {
  const inDate = clockIn != null ? new Date(clockIn) : (existing.clock_in ? new Date(existing.clock_in) : null);
  if (!inDate || isNaN(inDate.getTime())) return { error: 'Invalid clock-in time' };
  let outDate;
  if (clockOut === null || clockOut === '') outDate = null;              // explicitly cleared
  else if (clockOut != null) outDate = new Date(clockOut);              // provided
  else outDate = existing.clock_out ? new Date(existing.clock_out) : null; // unchanged
  if (outDate && isNaN(outDate.getTime())) return { error: 'Invalid clock-out time' };
  if (outDate && outDate <= inDate) return { error: 'Clock-out must be after clock-in' };
  if (inDate > new Date(Date.now() + 60 * 1000)) return { error: 'Clock-in cannot be in the future' };
  return { in: inDate, out: outDate };
}

// PUT /api/payroll/time-entries/:id  { clockIn?, clockOut? }
router.put('/time-entries/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);
    const cur = await pool.query('SELECT clock_in, clock_out FROM time_entries WHERE id = $1 AND user_id = $2', [id, userId]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });

    const { clockIn, clockOut } = req.body || {};
    const p = parsePunch(clockIn, clockOut, cur.rows[0]);
    if (p.error) return res.status(400).json({ error: p.error });

    await pool.query('UPDATE time_entries SET clock_in = $1, clock_out = $2 WHERE id = $3 AND user_id = $4',
      [p.in.toISOString(), p.out ? p.out.toISOString() : null, id, userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/payroll/time-entries  { employeeId, clockIn, clockOut? }
router.post('/time-entries', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { employeeId, clockIn, clockOut } = req.body || {};
    if (!employeeId || !clockIn) return res.status(400).json({ error: 'employeeId and clockIn required' });

    const emp = await pool.query('SELECT id FROM employees WHERE id = $1 AND user_id = $2', [employeeId, userId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const p = parsePunch(clockIn, clockOut === undefined ? null : clockOut);
    if (p.error) return res.status(400).json({ error: p.error });

    const ins = await pool.query(
      'INSERT INTO time_entries (user_id, employee_id, clock_in, clock_out) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, employeeId, p.in.toISOString(), p.out ? p.out.toISOString() : null]
    );
    res.json({ success: true, id: ins.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/payroll/time-entries/:id
router.delete('/time-entries/:id', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM time_entries WHERE id = $1 AND user_id = $2 RETURNING id',
      [parseInt(req.params.id, 10), req.user.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Breaks within a time entry (view via /time-entries, edit here) ───────────
// Note: every break (paid or unpaid) currently subtracts from worked hours.
function parseBreak(startAt, endAt, breakType, existing = {}) {
  const s = startAt != null ? new Date(startAt) : (existing.start_at ? new Date(existing.start_at) : null);
  if (!s || isNaN(s.getTime())) return { error: 'Invalid break start time' };
  let e;
  if (endAt === null || endAt === '') e = null;                          // explicitly cleared / still on break
  else if (endAt != null) e = new Date(endAt);                          // provided
  else e = existing.end_at ? new Date(existing.end_at) : null;          // unchanged
  if (e && isNaN(e.getTime())) return { error: 'Invalid break end time' };
  if (e && e <= s) return { error: 'Break end must be after its start' };
  let type = breakType != null ? String(breakType) : (existing.break_type || 'paid');
  if (!['paid', 'unpaid'].includes(type)) type = 'paid';
  return { start: s, end: e, type };
}

// POST /api/payroll/time-entries/:entryId/breaks  { startAt, endAt?, breakType? }
router.post('/time-entries/:entryId/breaks', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const entryId = parseInt(req.params.entryId, 10);
    const entry = await pool.query('SELECT id, employee_id FROM time_entries WHERE id = $1 AND user_id = $2', [entryId, userId]);
    if (entry.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });

    const { startAt, endAt, breakType } = req.body || {};
    if (!startAt) return res.status(400).json({ error: 'startAt required' });
    const p = parseBreak(startAt, endAt === undefined ? null : endAt, breakType);
    if (p.error) return res.status(400).json({ error: p.error });

    const ins = await pool.query(
      `INSERT INTO time_breaks (time_entry_id, employee_id, user_id, break_type, start_at, end_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [entryId, entry.rows[0].employee_id, userId, p.type, p.start.toISOString(), p.end ? p.end.toISOString() : null]
    );
    res.json({ success: true, id: ins.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/payroll/breaks/:id  { startAt?, endAt?, breakType? }
router.put('/breaks/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);
    const cur = await pool.query('SELECT start_at, end_at, break_type FROM time_breaks WHERE id = $1 AND user_id = $2', [id, userId]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Break not found' });

    const { startAt, endAt, breakType } = req.body || {};
    const p = parseBreak(startAt, endAt, breakType, cur.rows[0]);
    if (p.error) return res.status(400).json({ error: p.error });

    await pool.query('UPDATE time_breaks SET start_at = $1, end_at = $2, break_type = $3 WHERE id = $4 AND user_id = $5',
      [p.start.toISOString(), p.end ? p.end.toISOString() : null, p.type, id, userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/payroll/breaks/:id
router.delete('/breaks/:id', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM time_breaks WHERE id = $1 AND user_id = $2 RETURNING id',
      [parseInt(req.params.id, 10), req.user.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Break not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
