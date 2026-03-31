const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

const DEFAULTS = [
  { hours_before: 120, label: '5 days before', enabled: true },
  { hours_before: 72,  label: '3 days before', enabled: true },
  { hours_before: 24,  label: '24 hours before', enabled: true },
];

// GET - Get reminder settings (creates defaults if none exist)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      'SELECT * FROM booking_reminder_settings WHERE user_id = $1 ORDER BY hours_before DESC',
      [userId]
    );
    if (result.rows.length > 0) {
      return res.json({ reminders: result.rows });
    }
    // Insert defaults
    const inserted = [];
    for (const d of DEFAULTS) {
      const r = await pool.query(
        'INSERT INTO booking_reminder_settings (user_id, hours_before, label, enabled) VALUES ($1, $2, $3, $4) RETURNING *',
        [userId, d.hours_before, d.label, d.enabled]
      );
      inserted.push(r.rows[0]);
    }
    res.json({ reminders: inserted });
  } catch (error) {
    console.error('Error fetching reminder settings:', error.message);
    res.status(500).json({ error: 'Failed to fetch reminder settings' });
  }
});

// PUT - Update a single reminder setting
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { enabled, hours_before, label, custom_message } = req.body;
    const result = await pool.query(
      `UPDATE booking_reminder_settings
       SET enabled = COALESCE($1, enabled),
           hours_before = COALESCE($2, hours_before),
           label = COALESCE($3, label),
           custom_message = $4
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [enabled, hours_before, label, custom_message || null, id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ reminder: result.rows[0] });
  } catch (error) {
    console.error('Error updating reminder:', error.message);
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

// POST - Create a custom reminder interval
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { hours_before, label } = req.body;
    if (!hours_before || hours_before < 1) return res.status(400).json({ error: 'hours_before must be >= 1' });
    const result = await pool.query(
      'INSERT INTO booking_reminder_settings (user_id, hours_before, label, enabled) VALUES ($1, $2, $3, true) RETURNING *',
      [userId, hours_before, label || `${hours_before} hours before`]
    );
    res.json({ reminder: result.rows[0] });
  } catch (error) {
    console.error('Error creating reminder:', error.message);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// DELETE - Remove a reminder interval
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    await pool.query('DELETE FROM booking_reminder_settings WHERE id = $1 AND user_id = $2', [id, userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting reminder:', error.message);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

module.exports = router;
