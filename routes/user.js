const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, business_name, plan, google_review_link,
              twilio_phone_number, telnyx_phone_number,
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
        twilio_phone_number: user.twilio_phone_number,
        telnyx_phone_number: user.telnyx_phone_number,
        onboarding_completed: user.onboarding_completed,
        onboarding_current_step: user.onboarding_current_step,
        onboarding_steps_completed: user.onboarding_steps_completed
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error.message);
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
    console.error('Error saving Google review link:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save review link' });
  }
});

// PUT - Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { businessName, email } = req.body;

    if (!businessName?.trim() && !email?.trim()) {
      return res.status(400).json({ success: false, error: 'At least one field is required' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (businessName?.trim()) {
      updates.push(`business_name = $${paramIndex++}`);
      values.push(businessName.trim());
    }

    if (email?.trim()) {
      // Check if email is already taken by another user
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email.toLowerCase(), req.user.userId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, error: 'Email already in use' });
      }
      updates.push(`email = $${paramIndex++}`);
      values.push(email.toLowerCase().trim());
    }

    values.push(req.user.userId);

    await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    console.log(`✅ Profile updated for user ${req.user.userId}`);
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating profile:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// PUT - Change password
router.put('/password', authenticateToken, async (req, res) => {
  const bcrypt = require('bcrypt');

  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    // Hash and save new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hashedPassword, req.user.userId]
    );

    console.log(`✅ Password changed for user ${req.user.userId}`);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error.message);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// ============================================
// SENDGRID SENDER VERIFICATION
// ============================================

// POST - Request sender verification for business email
router.post('/sendgrid/verify', authenticateToken, async (req, res) => {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      return res.status(400).json({ error: 'Email service not configured' });
    }

    const userId = req.user.userId;
    let { email, businessName } = req.body || {};

    // Auto-fill from user profile and business settings when not provided
    if (!email || !businessName) {
      const [userRow, bizRow] = await Promise.all([
        pool.query('SELECT email, business_name FROM users WHERE id = $1', [userId]),
        pool.query('SELECT email FROM business_information WHERE user_id = $1', [userId]),
      ]);
      const u = userRow.rows[0] || {};
      const b = bizRow.rows[0] || {};
      if (!email) email = b.email || u.email;
      if (!businessName) businessName = u.business_name || '';
    }

    if (!email) return res.status(400).json({ error: 'Email is required. Set your email in Business Settings first.' });

    const sgClient = require('@sendgrid/client');
    sgClient.setApiKey(process.env.SENDGRID_API_KEY);

    // Check if already a verified sender
    const [existingRes] = await sgClient.request({
      method: 'GET',
      url: '/v3/verified_senders',
    });
    const existing = (existingRes.body?.results || []).find(s => s.from_email === email);
    if (existing && existing.verified) {
      // Save to DB
      await pool.query(
        `UPDATE users SET sendgrid_sender_id = $1, sendgrid_verified = true WHERE id = $2`,
        [existing.id, userId]
      );
      return res.json({ status: 'verified', message: 'Email is already verified' });
    }

    // Create new verified sender request
    const [createRes] = await sgClient.request({
      method: 'POST',
      url: '/v3/verified_senders',
      body: {
        nickname: businessName || email,
        from_email: email,
        from_name: businessName || 'Business',
        reply_to: email,
        reply_to_name: businessName || 'Business',
        address: '123 Main St',
        city: 'Any',
        state: 'CA',
        zip: '90001',
        country: 'US',
      },
    });

    const senderId = createRes.body?.id;
    // Save sender ID to DB (not yet verified - they need to click the email)
    await pool.query(
      `UPDATE users SET sendgrid_sender_id = $1, sendgrid_verified = false WHERE id = $2`,
      [senderId || 0, userId]
    );

    res.json({ status: 'pending', message: 'Verification email sent — check your inbox and click the link' });
  } catch (error) {
    console.error('SendGrid verify error:', error.response?.body || error.message);
    const sgError = error.response?.body?.errors?.[0]?.message || error.message;
    res.status(500).json({ error: sgError || 'Failed to send verification' });
  }
});

// GET - Check sender verification status
router.get('/sendgrid/status', authenticateToken, async (req, res) => {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      return res.json({ status: 'unconfigured' });
    }

    const userId = req.user.userId;
    const userResult = await pool.query(
      'SELECT sendgrid_sender_id, sendgrid_verified FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    if (!user || !user.sendgrid_sender_id) {
      return res.json({ status: 'not_setup' });
    }

    if (user.sendgrid_verified) {
      return res.json({ status: 'verified' });
    }

    // Check with SendGrid if it's been verified since last check
    const sgClient = require('@sendgrid/client');
    sgClient.setApiKey(process.env.SENDGRID_API_KEY);

    const [sgRes] = await sgClient.request({
      method: 'GET',
      url: '/v3/verified_senders',
    });
    const sender = (sgRes.body?.results || []).find(s => s.id === user.sendgrid_sender_id);
    if (sender?.verified) {
      await pool.query('UPDATE users SET sendgrid_verified = true WHERE id = $1', [userId]);
      return res.json({ status: 'verified' });
    }

    return res.json({ status: 'pending' });
  } catch (error) {
    console.error('SendGrid status error:', error.message);
    res.json({ status: 'unknown' });
  }
});

// DELETE - Delete user account (requires confirmation token)
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { confirmPhrase } = req.body;

    if (confirmPhrase !== 'DELETE MY ACCOUNT') {
      return res.status(400).json({ error: 'Invalid confirmation phrase' });
    }

    // Cancel Stripe subscription if exists
    const userRow = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [userId]);
    const subId = userRow.rows[0]?.stripe_subscription_id;
    if (subId) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        await stripe.subscriptions.cancel(subId);
      } catch (stripeErr) {
        console.error('Stripe cancel error (non-fatal):', stripeErr.message);
      }
    }

    // Delete user data in order (respecting FK constraints)
    await pool.query('DELETE FROM sms_messages WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM review_requests WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM leads WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE user_id = $1)', [userId]);
    await pool.query('DELETE FROM bookings WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM customers WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM services WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM service_categories WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM agent_configs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM websites WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM business_information WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM payment_connections WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM booking_widget_configs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    console.log(`🗑️ Account deleted: user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Account deletion error:', error.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
