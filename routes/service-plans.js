const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { FREQUENCIES } = require('../utils/recurringBookings');
const { normalizeServiceList } = require('../utils/bookingServices');

// The plan catalog: "Monthly Detail — $X/month", "Bi-monthly Detail — $Y/month", ...
// A plan = how often + which services are done on each visit + ONE flat price per billing
// period. Customers are linked to a plan from the booking form (or online booking), and
// what they pay is this price — never the sum of the visits.

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    frequency: row.frequency,
    frequency_label: FREQUENCIES[row.frequency]?.label || row.frequency,
    billing_period: FREQUENCIES[row.frequency]?.cadence === 'ANNUAL' ? 'year'
      : FREQUENCIES[row.frequency]?.cadence === 'QUARTERLY' ? 'quarter' : 'month',
    price: Number(row.price),
    services: row.services,
    active: row.active,
    show_online: row.show_online,
    subscribers: row.subscribers !== undefined ? Number(row.subscribers) : undefined,
  };
}

async function validated(userId, body) {
  const { name, description, frequency, price, mainServices, additionalServices } = body;
  if (!name || !String(name).trim()) return { error: 'Give the plan a name' };
  if (!FREQUENCIES[frequency]) return { error: 'Choose how often the visits happen' };
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return { error: 'Enter the price charged per billing period' };
  const mains = normalizeServiceList(mainServices).map(s => ({ id: s.id }));
  const addons = normalizeServiceList(additionalServices).map(s => ({ id: s.id }));
  if (!mains.length) return { error: 'Pick at least one service for each visit' };

  const ids = [...mains, ...addons].map(s => s.id);
  const owned = await pool.query('SELECT id FROM services WHERE user_id = $1 AND id = ANY($2::int[])', [userId, ids]);
  if (owned.rows.length !== new Set(ids).size) return { error: 'One of the selected services was not found' };
  return {
    value: {
      name: String(name).trim().slice(0, 120),
      description: description ? String(description).trim().slice(0, 1000) : null,
      frequency, price: p, services: { mains, addons },
    },
  };
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT sp.*, (SELECT COUNT(*) FROM recurring_plans rp
                     WHERE rp.service_plan_id = sp.id AND rp.status <> 'cancelled') AS subscribers
       FROM service_plans sp WHERE sp.user_id = $1 AND sp.active = true
       ORDER BY sp.sort_order, sp.created_at`,
      [req.user.userId]
    );
    res.json({ plans: r.rows.map(serialize) });
  } catch (e) {
    console.error('Error fetching service plans:', e.message);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const v = await validated(req.user.userId, req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { name, description, frequency, price, services } = v.value;
    const r = await pool.query(
      `INSERT INTO service_plans (user_id, name, description, frequency, price, services, show_online)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.userId, name, description, frequency, price, JSON.stringify(services), req.body.showOnline !== false]
    );
    res.json({ plan: serialize(r.rows[0]) });
  } catch (e) {
    console.error('Error creating service plan:', e.message);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// Editing a plan never touches people already on it: their agreed price is pinned on their
// own record, and Square keeps them on the price they signed up at.
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const v = await validated(req.user.userId, req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { name, description, frequency, price, services } = v.value;
    const r = await pool.query(
      `UPDATE service_plans SET name=$1, description=$2, frequency=$3, price=$4, services=$5,
              show_online=COALESCE($6, show_online), updated_at=NOW()
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      [name, description, frequency, price, JSON.stringify(services),
       typeof req.body.showOnline === 'boolean' ? req.body.showOnline : null,
       req.params.id, req.user.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: serialize(r.rows[0]) });
  } catch (e) {
    console.error('Error updating service plan:', e.message);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// Retire, don't delete: customers already on the plan keep it.
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE service_plans SET active = false, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('Error retiring service plan:', e.message);
    res.status(500).json({ error: 'Failed to remove plan' });
  }
});

module.exports = router;
module.exports.serialize = serialize;
