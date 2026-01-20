const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { EFFECTIVE_JWT_SECRET } = require('../config/middleware');

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
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, business_name, plan, created_at)
       VALUES ($1, $2, $3, $4, NULL, CURRENT_TIMESTAMP)
       RETURNING id, email, name, business_name, plan`,
      [
        email.toLowerCase(), 
        hashedPassword, 
        fullName || businessName || 'User',
        businessName || 'My Business'
      ]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, EFFECTIVE_JWT_SECRET, { expiresIn: '7d' });

    console.log('✅ New user (no plan):', email);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan
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
      'SELECT id, email, password_hash, business_name, plan FROM users WHERE email = $1',
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
        plan: user.plan
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
      'SELECT id, email, business_name, plan FROM users WHERE id = $1',
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
        plan: user.plan
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

module.exports = router;
