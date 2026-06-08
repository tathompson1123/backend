const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Get review configuration
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM review_configs WHERE user_id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      // Return default config if none exists
      return res.json({
        success: true,
        config: {
          message_template: "Hi {name}! Thank you for choosing {business}. We'd love to hear about your experience! Could you take a moment to leave us a review?",
          incentive: "$10 off your next service",
          incentive_enabled: true,
          auto_send_enabled: true,
          send_delay: 24,
          send_trigger: 'booking_completed',
          raffle_enabled: false,
          raffle_consolation: '$50 off any Full Detail',
          raffle_require_verified: false
        }
      });
    }

    res.json({ success: true, config: result.rows[0] });
  } catch (error) {
    console.error('Error fetching review config:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch config' });
  }
});

// POST - Save review configuration
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      messageTemplate, incentive, incentiveEnabled, autoSendEnabled, sendDelay, sendTrigger,
      raffleEnabled, raffleConsolation, raffleRequireVerified
    } = req.body;
    const trigger = sendTrigger === 'service_duration' ? 'service_duration' : 'booking_completed';
    const consolation = (raffleConsolation && String(raffleConsolation).trim())
      ? String(raffleConsolation).trim()
      : '$50 off any Full Detail';

    // Upsert - insert or update on conflict
    await pool.query(
      `INSERT INTO review_configs
         (user_id, message_template, incentive, incentive_enabled, auto_send_enabled, send_delay, send_trigger,
          raffle_enabled, raffle_consolation, raffle_require_verified, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET
         message_template = $2,
         incentive = $3,
         incentive_enabled = $4,
         auto_send_enabled = $5,
         send_delay = $6,
         send_trigger = $7,
         raffle_enabled = $8,
         raffle_consolation = $9,
         raffle_require_verified = $10,
         updated_at = CURRENT_TIMESTAMP`,
      [req.user.userId, messageTemplate, incentive, incentiveEnabled, autoSendEnabled, sendDelay, trigger,
       !!raffleEnabled, consolation, !!raffleRequireVerified]
    );

    console.log(`✅ Review config saved for user ${req.user.userId}`);
    res.json({ success: true, message: 'Review config saved successfully' });
  } catch (error) {
    console.error('Error saving review config:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save config' });
  }
});

module.exports = router;
