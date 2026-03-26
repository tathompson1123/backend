const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET /api/rewards/config — Get rewards configuration
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      'SELECT * FROM rewards_config WHERE user_id = $1',
      [userId]
    );
    res.json({ config: result.rows[0] || null });
  } catch (error) {
    console.error('Error fetching rewards config:', error.message);
    res.status(500).json({ error: 'Failed to load rewards config' });
  }
});

// PUT /api/rewards/config — Save rewards configuration
router.put('/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      enabled, bookingsRequired, rewardDescription,
      couponAfterBooking, couponDescription, couponFrequency,
      smsTiming, smsDelayHours, smsTemplate
    } = req.body;

    const result = await pool.query(
      `INSERT INTO rewards_config (user_id, enabled, bookings_required, reward_description,
        coupon_after_booking, coupon_description, coupon_frequency,
        sms_timing, sms_delay_hours, sms_template)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id) DO UPDATE SET
        enabled = $2, bookings_required = $3, reward_description = $4,
        coupon_after_booking = $5, coupon_description = $6, coupon_frequency = $7,
        sms_timing = $8, sms_delay_hours = $9, sms_template = $10, updated_at = NOW()
       RETURNING *`,
      [
        userId,
        enabled ?? false,
        bookingsRequired || 5,
        rewardDescription || '',
        couponAfterBooking ?? false,
        couponDescription || '',
        couponFrequency || 'every',
        smsTiming || 'after_completed',
        smsDelayHours || 1,
        smsTemplate || ''
      ]
    );

    res.json({ success: true, config: result.rows[0] });
  } catch (error) {
    console.error('Error saving rewards config:', error.message);
    res.status(500).json({ error: 'Failed to save rewards config' });
  }
});

// GET /api/rewards/customers — Get customer rewards progress
router.get('/customers', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get rewards config for threshold
    const configResult = await pool.query(
      'SELECT bookings_required FROM rewards_config WHERE user_id = $1',
      [userId]
    );
    const bookingsRequired = configResult.rows[0]?.bookings_required || 5;

    // Get customers with their booking counts
    const result = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.total_jobs,
              c.last_service, c.last_service_date, c.lifetime_value,
              COALESCE(c.total_jobs, 0) AS booking_count,
              CASE WHEN COALESCE(c.total_jobs, 0) >= $2 THEN true ELSE false END AS reward_earned
       FROM customers c
       WHERE c.user_id = $1 AND COALESCE(c.total_jobs, 0) > 0
       ORDER BY c.total_jobs DESC`,
      [userId, bookingsRequired]
    );

    res.json({ customers: result.rows, bookingsRequired });
  } catch (error) {
    console.error('Error fetching reward customers:', error.message);
    res.status(500).json({ error: 'Failed to load reward data' });
  }
});

module.exports = router;
