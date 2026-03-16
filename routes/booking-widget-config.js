const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

const DEFAULT_CONFIG = {
  steps: {
    categories: { title: "Our Services", subtitle: "Choose a category" },
    services: { title: "Select a Service", subtitle: "" },
    addons: { title: "Enhance Your Service", subtitle: "Popular add-ons for this service" },
    datetime: { title: "Choose Date & Time", subtitle: "" },
    contact: { title: "Your Information", subtitle: "" },
    payment: { title: "Confirm & Pay", subtitle: "" },
    confirmation: { title: "Booking Confirmed!", subtitle: "" }
  },
  requirePayment: false,
  depositPercent: null,
  showPrices: true,
  showDurations: true,
  accentColor: null
};

// ============================================
// GET - Fetch booking widget config
// ============================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT config FROM booking_widget_configs WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ config: DEFAULT_CONFIG });
    }

    res.json({ config: result.rows[0].config });
  } catch (error) {
    console.error('Error fetching booking widget config:', error.message);
    res.status(500).json({ error: 'Failed to fetch booking widget config' });
  }
});

// ============================================
// PUT - Save/update booking widget config
// ============================================
router.put('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { config } = req.body;

    const result = await pool.query(
      `INSERT INTO booking_widget_configs (user_id, config)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET config = $2, updated_at = NOW()
       RETURNING config`,
      [userId, JSON.stringify(config)]
    );

    res.json({ config: result.rows[0].config });
  } catch (error) {
    console.error('Error saving booking widget config:', error.message);
    res.status(500).json({ error: 'Failed to save booking widget config' });
  }
});

module.exports = router;
