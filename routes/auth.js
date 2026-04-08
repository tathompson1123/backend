const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { EFFECTIVE_JWT_SECRET, authenticateToken } = require('../config/middleware');

// POST - Signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, businessName, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

   // In your signup route (POST /api/auth/signup)
const result = await pool.query(
  `INSERT INTO users (email, password_hash, name, business_name, plan, trial_ends_at, onboarding_completed, onboarding_current_step, onboarding_steps_completed, has_seen_welcome, created_at)
   VALUES ($1, $2, $3, $4, 'pro', NOW() + INTERVAL '14 days', false, 1, $5, false, CURRENT_TIMESTAMP)
   RETURNING id, email, name, business_name, plan, trial_ends_at,
             onboarding_completed, onboarding_current_step, onboarding_steps_completed, has_seen_welcome, questionnaire_completed`,
  [
    email.toLowerCase(), 
    hashedPassword, 
    fullName || businessName || 'User',
    businessName || 'My Business',
    JSON.stringify({step1: false, step2: false, step3: false, step4: false, step5: false, step6: false})
  ]
);

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, EFFECTIVE_JWT_SECRET, { expiresIn: '30d' });

    console.log('✅ New user signed up (no plan, onboarding pending):', email);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan,
        trial_ends_at: user.trial_ends_at,
        onboarding_completed: user.onboarding_completed,
        onboarding_current_step: user.onboarding_current_step,
        onboarding_steps_completed: user.onboarding_steps_completed,
        hasSeenWelcome: user.has_seen_welcome,
        questionnaire_completed: user.questionnaire_completed || false
      }
    });

  } catch (error) {
    console.error('❌ Signup error:', error.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST - Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

   const result = await pool.query(
  `SELECT id, email, password_hash, business_name, plan, trial_ends_at,
          onboarding_completed, onboarding_current_step, onboarding_steps_completed,
          has_seen_welcome, questionnaire_completed
   FROM users WHERE email = $1`,
  [email.toLowerCase()]
);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, EFFECTIVE_JWT_SECRET, { expiresIn: '30d' });

    console.log('✅ User logged in:', email);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan,
        trial_ends_at: user.trial_ends_at,
        onboarding_completed: user.onboarding_completed,
        onboarding_current_step: user.onboarding_current_step,
        onboarding_steps_completed: user.onboarding_steps_completed,
        hasSeenWelcome: user.has_seen_welcome,
        questionnaire_completed: user.questionnaire_completed || false
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// POST - Verify token
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);

    const result = await pool.query(
  `SELECT id, email, business_name, plan,
          onboarding_completed, onboarding_current_step, onboarding_steps_completed, has_seen_welcome
   FROM users WHERE id = $1`,
  [decoded.userId]
);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    res.json({
  success: true,
  user: {
    id: user.id,
    email: user.email,
    businessName: user.business_name,
    plan: user.plan,
    onboarding_completed: user.onboarding_completed,
    onboarding_current_step: user.onboarding_current_step,
    onboarding_steps_completed: user.onboarding_steps_completed,
    hasSeenWelcome: user.has_seen_welcome  // ADD THIS LINE
  }
});

  } catch (error) {
    console.error('❌ Verify error:', error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST - Logout
router.post('/logout', async (req, res) => {
  res.json({ 
    success: true, 
    message: 'Logged out successfully' 
  });
});

// POST - Mark welcome as seen
router.post('/welcome-seen', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    await pool.query(
      `UPDATE users 
       SET has_seen_welcome = true
       WHERE id = $1`,
      [userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking welcome as seen:', error.message);
    res.status(500).json({ error: 'Failed to mark welcome as seen' });
  }
});

// Onboarding Routes

// POST - Save onboarding progress
router.post('/onboarding/progress', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentStep, completedSteps } = req.body;

    await pool.query(
      `UPDATE users 
       SET onboarding_current_step = $1,
           onboarding_steps_completed = $2
       WHERE id = $3`,
      [currentStep, JSON.stringify(completedSteps), userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving onboarding progress:', error.message);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// POST - Skip onboarding
router.post('/onboarding/skip', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    await pool.query(
      `UPDATE users 
       SET onboarding_skipped = true,
           onboarding_completed = true,
           onboarding_completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error skipping onboarding:', error.message);
    res.status(500).json({ error: 'Failed to skip onboarding' });
  }
});

// POST - Complete onboarding
router.post('/onboarding/complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    await pool.query(
      `UPDATE users 
       SET onboarding_completed = true,
           onboarding_completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error completing onboarding:', error.message);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

// GET - Get onboarding status
router.get('/onboarding/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT onboarding_completed, onboarding_current_step, 
              onboarding_skipped, onboarding_steps_completed
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      onboarding: result.rows[0]
    });
  } catch (error) {
    console.error('Error getting onboarding status:', error.message);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// POST - Save signup questionnaire answers
router.post('/onboarding/questionnaire', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { leadsPerWeek, revenueRange, interestedFeature } = req.body;

    await pool.query(
      `UPDATE users
       SET leads_per_week = $1, revenue_range = $2, interested_feature = $3, questionnaire_completed = true
       WHERE id = $4`,
      [leadsPerWeek || null, revenueRange || null, interestedFeature || null, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving questionnaire:', error.message);
    res.status(500).json({ error: 'Failed to save questionnaire' });
  }
});

module.exports = router;
