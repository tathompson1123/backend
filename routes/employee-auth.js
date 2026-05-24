const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { EFFECTIVE_JWT_SECRET } = require('../config/middleware');
const { authenticateEmployee } = require('../config/employee-middleware');

// POST /api/employee-auth/accept-invite - Accept invite and set password
router.post('/accept-invite', async (req, res) => {
  try {
    const { token, password } = req.body;
    const cleanToken = (token || '').trim();

    if (!cleanToken || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Find credential by invite token
    const credResult = await pool.query(
      `SELECT ec.*, e.name as employee_name, e.user_id, u.business_name
       FROM employee_credentials ec
       JOIN employees e ON e.id = ec.employee_id
       JOIN users u ON u.id = e.user_id
       WHERE ec.invite_token = $1 AND ec.invite_token_expires > NOW()`,
      [cleanToken]
    );

    if (credResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invite link' });
    }

    const cred = credResult.rows[0];

    if (cred.invite_accepted_at) {
      return res.status(400).json({ error: 'Invite has already been accepted. Please log in.' });
    }

    // Hash password and update credentials
    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `UPDATE employee_credentials
       SET password_hash = $1, invite_accepted_at = NOW(), invite_token = NULL, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, cred.id]
    );

    // Update employee invite status
    await pool.query(
      "UPDATE employees SET invite_status = 'accepted' WHERE id = $1",
      [cred.employee_id]
    );

    // Generate JWT
    const jwtToken = jwt.sign(
      {
        employeeId: cred.employee_id,
        userId: cred.user_id,
        email: cred.email,
        role: 'employee'
      },
      EFFECTIVE_JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.json({
      success: true,
      token: jwtToken,
      employee: {
        id: cred.employee_id,
        name: cred.employee_name,
        email: cred.email,
        businessName: cred.business_name
      }
    });
  } catch (error) {
    console.error('Error accepting invite:', error.message);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// GET /api/employee-auth/invite-info/:token - Get invite details (for the accept-invite screen)
router.get('/invite-info/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `SELECT ec.email, ec.invite_accepted_at, e.name as employee_name, u.business_name
       FROM employee_credentials ec
       JOIN employees e ON e.id = ec.employee_id
       JOIN users u ON u.id = e.user_id
       WHERE ec.invite_token = $1 AND ec.invite_token_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invite link' });
    }

    const info = result.rows[0];

    if (info.invite_accepted_at) {
      return res.status(400).json({ error: 'Invite has already been accepted. Please log in.' });
    }

    res.json({
      employeeName: info.employee_name,
      email: info.email,
      businessName: info.business_name
    });
  } catch (error) {
    console.error('Error fetching invite info:', error.message);
    res.status(500).json({ error: 'Failed to fetch invite info' });
  }
});

// POST /api/employee-auth/login - Employee login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const result = await pool.query(
      `SELECT ec.*, e.name as employee_name, e.user_id, e.color, e.active, e.is_admin,
              u.business_name, u.plan, u.email as owner_email,
              bi.address as biz_address, bi.city as biz_city, bi.state as biz_state, bi.zip_code as biz_zip
       FROM employee_credentials ec
       JOIN employees e ON e.id = ec.employee_id
       JOIN users u ON u.id = e.user_id
       LEFT JOIN business_information bi ON bi.user_id = u.id
       WHERE ec.email = $1 AND ec.invite_accepted_at IS NOT NULL`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const cred = result.rows[0];

    if (!cred.active) {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact your employer.' });
    }

    const validPassword = await bcrypt.compare(password, cred.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await pool.query(
      'UPDATE employee_credentials SET last_login_at = NOW() WHERE id = $1',
      [cred.id]
    );

    const token = jwt.sign(
      {
        employeeId: cred.employee_id,
        userId: cred.user_id,
        email: cred.email,
        role: 'employee'
      },
      EFFECTIVE_JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.json({
      success: true,
      token,
      employee: {
        id: cred.employee_id,
        name: cred.employee_name,
        email: cred.email,
        color: cred.color,
        businessName: cred.business_name,
        plan: cred.plan,
        isAdmin: cred.is_admin || (cred.owner_email && cred.email.toLowerCase() === cred.owner_email.toLowerCase()) || false,
        businessAddress: [cred.biz_address, cred.biz_city, cred.biz_state, cred.biz_zip].filter(Boolean).join(', ') || null,
      }
    });
  } catch (error) {
    console.error('Error during employee login:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/employee-auth/verify - Verify employee token
router.get('/verify', authenticateEmployee, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.name, e.color, e.active, e.is_admin, u.business_name, u.plan, u.email as owner_email,
              ec.email,
              bi.address as biz_address, bi.city as biz_city, bi.state as biz_state, bi.zip_code as biz_zip
       FROM employees e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN employee_credentials ec ON ec.employee_id = e.id
       LEFT JOIN business_information bi ON bi.user_id = u.id
       WHERE e.id = $1`,
      [req.employee.employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const emp = result.rows[0];
    if (!emp.active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    res.json({
      valid: true,
      employee: {
        id: emp.id,
        name: emp.name,
        email: emp.email,
        color: emp.color,
        businessName: emp.business_name,
        plan: emp.plan,
        isAdmin: emp.is_admin || (emp.owner_email && emp.email && emp.email.toLowerCase() === emp.owner_email.toLowerCase()) || false,
        businessAddress: [emp.biz_address, emp.biz_city, emp.biz_state, emp.biz_zip].filter(Boolean).join(', ') || null,
      }
    });
  } catch (error) {
    console.error('Error verifying employee token:', error.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// PUT /api/employee-auth/push-token - Register push notification token
router.put('/push-token', authenticateEmployee, async (req, res) => {
  try {
    const { pushToken, platform } = req.body;

    if (!pushToken || typeof pushToken !== 'string') {
      return res.status(400).json({ error: 'Push token is required' });
    }

    if (pushToken.length > 500) {
      return res.status(400).json({ error: 'Push token too long' });
    }

    const allowedPlatforms = ['ios', 'android', 'unknown'];
    const safePlatform = allowedPlatforms.includes(platform) ? platform : 'unknown';

    await pool.query(
      `UPDATE employee_credentials
       SET push_token = $1, device_platform = $2, updated_at = NOW()
       WHERE employee_id = $3`,
      [pushToken, safePlatform, req.employee.employeeId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving push token:', error.message);
    res.status(500).json({ error: 'Failed to save push token' });
  }
});

module.exports = router;
