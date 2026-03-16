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
  // Payment mode: 'none' | 'card_on_file' | 'pay_at_booking'
  paymentMode: 'none',
  // Deposit settings (only relevant when paymentMode is 'pay_at_booking')
  depositEnabled: false,
  depositType: 'percent', // 'percent' or 'fixed'
  depositAmount: 50,
  // Contact form field configuration
  contactFields: [
    { key: 'name', label: 'Full Name', type: 'text', required: true, enabled: true, removable: false },
    { key: 'email', label: 'Email', type: 'email', required: true, enabled: true, removable: false },
    { key: 'phone', label: 'Phone', type: 'tel', required: true, enabled: true, removable: false },
    { key: 'address', label: 'Address', type: 'text', required: false, enabled: false, removable: true },
    { key: 'notes', label: 'Notes', type: 'textarea', required: false, enabled: true, removable: true }
  ],
  // Display options
  showPrices: true,
  showDurations: true,
  accentColor: null,
  // Legacy compat
  requirePayment: false,
  depositPercent: null
};

// ============================================
// GET - Fetch booking widget config (authenticated)
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

    // Merge saved config with defaults so new fields are always present
    const saved = result.rows[0].config;
    const merged = {
      ...DEFAULT_CONFIG,
      ...saved,
      steps: { ...DEFAULT_CONFIG.steps, ...(saved.steps || {}) },
      contactFields: saved.contactFields || DEFAULT_CONFIG.contactFields
    };

    res.json({ config: merged });
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
