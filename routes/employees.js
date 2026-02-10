const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Fetch all employees
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT e.*, 
        (SELECT json_agg(se.service_id) FROM service_employees se WHERE se.employee_id = e.id) as service_ids
       FROM employees e
       WHERE e.user_id = $1
       ORDER BY e.name`,
      [userId]
    );

    res.json({ employees: result.rows });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// POST - Create new employee
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, phone, color, serviceIds } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name required' });
    }

    const result = await pool.query(
      `INSERT INTO employees (user_id, name, email, phone, color)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, name, email, phone, color || '#3b82f6']
    );

    const employee = result.rows[0];

    if (serviceIds && serviceIds.length > 0) {
      for (const serviceId of serviceIds) {
        await pool.query(
          `INSERT INTO service_employees (service_id, employee_id)
           VALUES ($1, $2)
           ON CONFLICT (service_id, employee_id) DO NOTHING`,
          [serviceId, employee.id]
        );
      }
    }

    res.json({ employee });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// PUT - Update employee
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, email, phone, color, active, serviceIds } = req.body;

    const result = await pool.query(
      `UPDATE employees
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           color = COALESCE($4, color),
           active = COALESCE($5, active)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [name, email, phone, color, active, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (serviceIds !== undefined) {
      await pool.query('DELETE FROM service_employees WHERE employee_id = $1', [id]);

      if (serviceIds && serviceIds.length > 0) {
        for (const serviceId of serviceIds) {
          await pool.query(
            `INSERT INTO service_employees (service_id, employee_id)
             VALUES ($1, $2)
             ON CONFLICT (service_id, employee_id) DO NOTHING`,
            [serviceId, id]
          );
        }
      }
    }

    res.json({ employee: result.rows[0] });
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// DELETE - Delete employee
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const bookingsCheck = await pool.query(
      `SELECT COUNT(*) as count FROM bookings 
       WHERE employee_id = $1 
       AND booking_date >= CURRENT_DATE 
       AND status NOT IN ('cancelled', 'completed')`,
      [id]
    );

    if (parseInt(bookingsCheck.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete employee with active bookings',
        activeBookings: bookingsCheck.rows[0].count
      });
    }

    await pool.query('DELETE FROM employees WHERE id = $1 AND user_id = $2', [id, userId]);
    res.json({ success: true, message: 'Employee deleted' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// POST - Send invite to employee for mobile app access
router.post('/:id/invite', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Verify employee belongs to this user
    const empResult = await pool.query(
      'SELECT * FROM employees WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const employee = empResult.rows[0];

    if (!employee.email) {
      return res.status(400).json({ error: 'Employee must have an email address to receive an invite' });
    }

    // Generate secure invite token (72-hour expiry)
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    // Upsert employee credentials
    await pool.query(
      `INSERT INTO employee_credentials (employee_id, email, invite_token, invite_token_expires)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id)
       DO UPDATE SET invite_token = $3, invite_token_expires = $4, updated_at = NOW()`,
      [id, employee.email.toLowerCase(), inviteToken, expiresAt]
    );

    // Update invite status
    await pool.query(
      "UPDATE employees SET invite_status = 'pending' WHERE id = $1",
      [id]
    );

    // Get business name for the email
    const userResult = await pool.query('SELECT business_name FROM users WHERE id = $1', [userId]);
    const businessName = userResult.rows[0]?.business_name || 'Your employer';

    // Send invite email via SendGrid
    const inviteUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/employee-invite?token=${inviteToken}`;

    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      await sgMail.send({
        to: employee.email,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@sorceintegrations.com',
        subject: `You're invited to join ${businessName} on SORCE`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #d97706;">Welcome to SORCE</h2>
            <p>Hi ${employee.name},</p>
            <p><strong>${businessName}</strong> has invited you to join their team on SORCE. You'll be able to view your schedule, manage bookings, and see service details from your phone.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteUrl}" style="background-color: #d97706; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Accept Invite</a>
            </div>
            <p style="color: #666; font-size: 14px;">This invite expires in 72 hours.</p>
            <p style="color: #666; font-size: 12px;">If you didn't expect this invite, you can safely ignore this email.</p>
          </div>
        `
      });
      console.log(`✅ Invite email sent to ${employee.email}`);
    } catch (emailErr) {
      console.error('⚠️ Failed to send invite email:', emailErr.message);
      // Don't fail the request — the token is created, they can still use the link
    }

    // Optionally send SMS if phone is available and Twilio is configured
    if (employee.phone && process.env.TWILIO_ACCOUNT_SID) {
      try {
        const { sendSMS } = require('../utils/twilio');
        const userPhone = await pool.query('SELECT twilio_phone_number FROM users WHERE id = $1', [userId]);
        const fromPhone = userPhone.rows[0]?.twilio_phone_number;

        if (fromPhone) {
          await sendSMS(
            fromPhone,
            employee.phone,
            `${businessName} invited you to SORCE! Set up your account: ${inviteUrl}`
          );
          console.log(`✅ Invite SMS sent to ${employee.phone}`);
        }
      } catch (smsErr) {
        console.error('⚠️ Failed to send invite SMS:', smsErr.message);
      }
    }

    res.json({
      success: true,
      message: `Invite sent to ${employee.email}`,
      inviteStatus: 'pending'
    });
  } catch (error) {
    console.error('Error sending employee invite:', error);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// POST - Revoke employee access
router.post('/:id/revoke', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Verify employee belongs to this user
    const empResult = await pool.query(
      'SELECT id FROM employees WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Remove credentials
    await pool.query('DELETE FROM employee_credentials WHERE employee_id = $1', [id]);

    // Reset invite status
    await pool.query("UPDATE employees SET invite_status = 'none' WHERE id = $1", [id]);

    res.json({ success: true, message: 'Employee access revoked' });
  } catch (error) {
    console.error('Error revoking employee access:', error);
    res.status(500).json({ error: 'Failed to revoke access' });
  }
});

// GET - Fetch groups
router.get('/groups', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM groups WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// POST - Create group
router.post('/groups', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, employeeIds } = req.body;

    if (!name || !employeeIds || !Array.isArray(employeeIds)) {
      return res.status(400).json({ error: 'name and employeeIds (array) required' });
    }

    const result = await pool.query(
      'INSERT INTO groups (user_id, name, employee_ids) VALUES ($1, $2, $3) RETURNING *',
      [userId, name, employeeIds]
    );

    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PUT - Update group
router.put('/groups/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, employeeIds } = req.body;

    if (!name || !employeeIds || !Array.isArray(employeeIds)) {
      return res.status(400).json({ error: 'name and employeeIds (array) required' });
    }

    const result = await pool.query(
      'UPDATE groups SET name = $1, employee_ids = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
      [name, employeeIds, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE - Delete group
router.delete('/groups/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM groups WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

module.exports = router;
