const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// Get business hours for the authenticated user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM business_hours WHERE user_id = $1 ORDER BY day_of_week`,
      [req.user.userId]
    );
    res.json({ success: true, hours: result.rows });
  } catch (error) {
    console.error('Error fetching business hours:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch business hours' });
  }
});

// Save/update business hours
const dayNameToNumber = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

router.post('/', authenticateToken, async (req, res) => {
  const { hours } = req.body;

  if (!hours || !Array.isArray(hours)) {
    return res.status(400).json({ success: false, error: 'Hours array is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete existing hours for this user
    await client.query('DELETE FROM business_hours WHERE user_id = $1', [req.user.userId]);

    // Insert new hours — accept day_name (string) or day_of_week (integer)
    for (const day of hours) {
      const dayOfWeek = day.day_of_week != null ? day.day_of_week : dayNameToNumber[day.day_name?.toLowerCase()];
      if (dayOfWeek == null) continue;
      await client.query(
        `INSERT INTO business_hours (user_id, day_of_week, is_open, open_time, close_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, dayOfWeek, day.is_open, day.open_time, day.close_time]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Business hours saved successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving business hours:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save business hours' });
  } finally {
    client.release();
  }
});

module.exports = router;
