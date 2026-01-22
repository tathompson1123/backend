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

    const result = await pool.query(
      `INSERT INTO users (
        email, password_hash, name, business_name, plan, 
        onboarding_completed, onboarding_current_step, 
        onboarding_steps_completed, created_at
      )
       VALUES ($1, $2, $3, $4, NULL, false, 1, $5, CURRENT_TIMESTAMP)
       RETURNING id, email, name, business_name, plan, 
                 onboarding_completed, onboarding_current_step, onboarding_steps_completed`,
      [
        email.toLowerCase(), 
        hashedPassword, 
        fullName || businessName || 'User',
        businessName || 'My Business',
        JSON.stringify({step1: false, step2: false, step3: false, step4: false, step5: false, step6: false})
      ]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, EFFECTIVE_JWT_SECRET, { expiresIn: '7d' });

    console.log('✅ New user signed up (no plan, onboarding pending):', email);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan,
        onboarding_completed: user.onboarding_completed,
        onboarding_current_step: user.onboarding_current_step,
        onboarding_steps_completed: user.onboarding_steps_completed
      }
    });

  } catch (error) {
    console.error('❌ Signup error:', error);
    res.status(500).json({ error: 'Registration failed', message: error.message });
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
      `SELECT id, email, password_hash, business_name, plan,
              onboarding_completed, onboarding_current_step, onboarding_steps_completed
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

    const token = jwt.sign({ userId: user.id, email: user.email }, EFFECTIVE_JWT_SECRET, { expiresIn: '7d' });

    console.log('✅ User logged in:', email);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan,
        onboarding_completed: user.onboarding_completed,
        onboarding_current_step: user.onboarding_current_step,
        onboarding_steps_completed: user.onboarding_steps_completed
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
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
              onboarding_completed, onboarding_current_step, onboarding_steps_completed
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
        onboarding_steps_completed: user.onboarding_steps_completed
      }
    });

  } catch (error) {
    console.error('❌ Verify error:', error);
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
    console.error('Error saving onboarding progress:', error);
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
    console.error('Error skipping onboarding:', error);
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
    console.error('Error completing onboarding:', error);
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
    console.error('Error getting onboarding status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

module.exports = router;
