const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, business_name, plan, google_review_link,
              onboarding_completed, onboarding_current_step, onboarding_steps_completed
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan,
        google_review_link: user.google_review_link,
        onboarding_completed: user.onboarding_completed,
        onboarding_current_step: user.onboarding_current_step,
        onboarding_steps_completed: user.onboarding_steps_completed
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

// POST - Save Google review link
router.post('/google-review-link', authenticateToken, async (req, res) => {
  try {
    const { reviewLink } = req.body;

    if (!reviewLink || !reviewLink.trim()) {
      return res.status(400).json({ success: false, error: 'Review link is required' });
    }

    // Validate URL format
    const link = reviewLink.toLowerCase();
    if (!link.includes('g.page') && !link.includes('google.com')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Google review link. Must contain g.page or google.com'
      });
    }

    await pool.query(
      'UPDATE users SET google_review_link = $1 WHERE id = $2',
      [reviewLink.trim(), req.user.userId]
    );

    console.log(`✅ Google review link saved for user ${req.user.userId}`);
    res.json({ success: true, message: 'Google review link saved successfully' });
  } catch (error) {
    console.error('Error saving Google review link:', error);
    res.status(500).json({ success: false, error: 'Failed to save review link' });
  }
});

module.exports = router;
