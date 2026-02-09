const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/auth');

// Get business hours for the authenticated user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM business_hours WHERE user_id = $1 
       ORDER BY CASE day_name 
         WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3 
         WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5 WHEN 'saturday' THEN 6 
         WHEN 'sunday' THEN 7 END`,
      [req.user.userId]
    );
    res.json({ success: true, hours: result.rows });
  } catch (error) {
    console.error('Error fetching business hours:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch business hours' });
  }
});

// Save/update business hours
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

    // Insert new hours
    for (const day of hours) {
      await client.query(
        `INSERT INTO business_hours (user_id, day_name, is_open, open_time, close_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, day.day_name, day.is_open, day.open_time, day.close_time]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Business hours saved successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving business hours:', error);
    res.status(500).json({ success: false, error: 'Failed to save business hours' });
  } finally {
    client.release();
  }
});

module.exports = router;
