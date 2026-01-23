const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Fetch business hours
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT * FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
      [userId]
    );
    
    res.json({ success: true, hours: result.rows });
  } catch (error) {
    console.error('Error fetching business hours:', error);
    res.status(500).json({ error: 'Failed to fetch business hours' });
  }
});

module.exports = router;
