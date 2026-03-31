const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - list all time slots for this user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM booking_time_slots WHERE user_id = $1 ORDER BY slot_time',
      [req.user.userId]
    );
    res.json({ slots: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - add a new time slot
router.post('/', authenticateToken, async (req, res) => {
  const { slotTime, label } = req.body;
  if (!slotTime) return res.status(400).json({ error: 'slotTime is required' });
  try {
    const result = await pool.query(
      `INSERT INTO booking_time_slots (user_id, slot_time, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, slot_time) DO UPDATE SET active = true, label = EXCLUDED.label
       RETURNING *`,
      [req.user.userId, slotTime, label || null]
    );
    res.json({ slot: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT - update active status or label
router.put('/:id', authenticateToken, async (req, res) => {
  const { active, label } = req.body;
  try {
    const setClauses = [];
    const values = [];
    if (active !== undefined) { setClauses.push(`active = $${values.length + 1}`); values.push(active); }
    if (label !== undefined)  { setClauses.push(`label = $${values.length + 1}`); values.push(label); }
    if (setClauses.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.params.id, req.user.userId);
    const result = await pool.query(
      `UPDATE booking_time_slots SET ${setClauses.join(', ')} WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Slot not found' });
    res.json({ slot: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE - remove a time slot
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM booking_time_slots WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
