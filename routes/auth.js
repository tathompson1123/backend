const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { EFFECTIVE_JWT_SECRET, authenticateToken } = require('../config/middleware');
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const FROM_EMAIL = { name: 'SORCE', email: 'noreply@sorceintegrations.com' };

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

    // Generate and store email verification code
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 15 minutes
    await pool.query(
      `UPDATE users SET email_verification_code = $1, email_verification_expires_at = $2 WHERE id = $3`,
      [verificationCode, expiresAt, user.id]
    );

    // Send verification email — fire and forget so signup response is instant
    sgMail.send({
      to: email,
      from: FROM_EMAIL,
      subject: 'Verify your SORCE account',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff">
          <h1 style="font-size:22px;font-weight:800;color:#111;margin-bottom:8px">Welcome to SORCE 👋</h1>
          <p style="color:#555;font-size:15px;margin-bottom:28px">Enter this code to verify your email and get started:</p>
          <div style="background:#f9fafb;border:2px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px">
            <span style="font-size:40px;font-weight:900;letter-spacing:10px;color:#111">${verificationCode}</span>
          </div>
          <p style="color:#888;font-size:13px">This code expires in 1 hour. If you didn't sign up for SORCE, you can safely ignore this email.</p>
        </div>
      `,
    }).catch(emailErr => console.error('⚠️ Verification email failed:', emailErr.message));

    console.log('✅ New user signed up:', email);

    res.json({
      success: true,
      token,
      email_verified: false,
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
        questionnaire_completed: user.questionnaire_completed || false,
        email_verified: false
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
          has_seen_welcome, questionnaire_completed, email_verified
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
        questionnaire_completed: user.questionnaire_completed || false,
        email_verified: user.email_verified || false
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
  `SELECT id, email, business_name, plan, trial_ends_at,
          onboarding_completed, onboarding_current_step, onboarding_steps_completed,
          has_seen_welcome, questionnaire_completed, email_verified
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
    trial_ends_at: user.trial_ends_at,
    onboarding_completed: user.onboarding_completed,
    onboarding_current_step: user.onboarding_current_step,
    onboarding_steps_completed: user.onboarding_steps_completed,
    hasSeenWelcome: user.has_seen_welcome,
    questionnaire_completed: user.questionnaire_completed || false,
    email_verified: user.email_verified || false
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

// POST - Verify email with code
router.post('/verify-email', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { code } = req.body;

    if (!code) return res.status(400).json({ error: 'Code is required' });

    const result = await pool.query(
      `SELECT email_verification_code, email_verification_expires_at, email_verified FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = result.rows[0];
    if (user.email_verified) return res.json({ success: true, already_verified: true });

    if (!user.email_verification_code || user.email_verification_code !== code.trim()) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    if (new Date(user.email_verification_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
    }

    await pool.query(
      `UPDATE users SET email_verified = true, email_verification_code = NULL, email_verification_expires_at = NULL WHERE id = $1`,
      [userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error verifying email:', error.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST - Resend verification code
router.post('/resend-verification', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(`SELECT email, email_verified FROM users WHERE id = $1`, [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (result.rows[0].email_verified) return res.json({ success: true, already_verified: true });

    const email = result.rows[0].email;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      `UPDATE users SET email_verification_code = $1, email_verification_expires_at = $2 WHERE id = $3`,
      [code, expiresAt, userId]
    );

    // Fire and forget — respond immediately, email sends in background
    sgMail.send({
      to: email,
      from: FROM_EMAIL,
      subject: 'Your new SORCE verification code',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff">
          <h1 style="font-size:22px;font-weight:800;color:#111;margin-bottom:8px">New verification code</h1>
          <p style="color:#555;font-size:15px;margin-bottom:28px">Here's your new code:</p>
          <div style="background:#f9fafb;border:2px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px">
            <span style="font-size:40px;font-weight:900;letter-spacing:10px;color:#111">${code}</span>
          </div>
          <p style="color:#888;font-size:13px">This code expires in 1 hour.</p>
        </div>
      `,
    }).then(() => console.log(`✅ Verification code resent to ${email}`))
      .catch(emailErr => console.error('⚠️ Resend email failed:', emailErr.response?.body?.errors || emailErr.message));

    res.json({ success: true });
  } catch (error) {
    console.error('Error resending verification:', error.message);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// POST - Save signup questionnaire answers
router.post('/onboarding/questionnaire', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { leadsPerWeek, revenueRange, interestedFeature, businessType, businessServices, businessKnownFor } = req.body;

    await pool.query(
      `UPDATE users
       SET leads_per_week = $1, revenue_range = $2, interested_feature = $3, questionnaire_completed = true,
           business_type = $4, business_services = $5, business_known_for = $6
       WHERE id = $7`,
      [leadsPerWeek || null, revenueRange || null, interestedFeature || null,
       businessType || null, businessServices || null, businessKnownFor || null, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving questionnaire:', error.message);
    res.status(500).json({ error: 'Failed to save questionnaire' });
  }
});

// POST - Admin: manually verify a user's email (protected by ADMIN_SECRET env var)
router.post('/admin/force-verify', async (req, res) => {
  try {
    const { adminSecret, email } = req.body;
    const expectedSecret = process.env.ADMIN_SECRET;
    if (!expectedSecret || adminSecret !== expectedSecret) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!email) return res.status(400).json({ error: 'email required' });

    const result = await pool.query(
      `UPDATE users SET email_verified = true, email_verification_code = NULL, email_verification_expires_at = NULL
       WHERE email = $1 RETURNING id, email, email_verified`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    console.log(`✅ Admin force-verified email for ${email}`);
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Admin force-verify error:', error.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
