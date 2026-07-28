const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// Archiving (soft delete) instead of hard-deleting preserves an employee's clock/payroll
// history — their time_entries would otherwise be cascade-deleted with the employee row.
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ')
  .catch(e => console.error('employees archived_at migration error:', e.message));

// Validation helpers
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
function isValidId(id) { return Number.isInteger(Number(id)) && Number(id) > 0; }

// All routes require business owner authentication
router.use(authenticateToken);

// GET - Fetch all employees
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    // Archived employees are hidden from the default roster; pass ?includeArchived=1 to see them.
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';

    const result = await pool.query(
      `SELECT e.*,
        (SELECT json_agg(se.service_id) FROM service_employees se WHERE se.employee_id = e.id) as service_ids
       FROM employees e
       WHERE e.user_id = $1 ${includeArchived ? '' : 'AND e.archived_at IS NULL'}
       ORDER BY e.archived_at IS NOT NULL, e.name`,
      [userId]
    );

    res.json({ employees: result.rows });
  } catch (error) {
    console.error('Error fetching employees:', error.message);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// POST - Create new employee
router.post('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, phone, color, serviceIds, workHours, workDays } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'Name must be under 100 characters' });
    }

    if (email && !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (phone && phone.length > 20) {
      return res.status(400).json({ error: 'Phone number too long' });
    }

    if (color && !COLOR_REGEX.test(color)) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g. #3b82f6)' });
    }

    if (serviceIds && (!Array.isArray(serviceIds) || serviceIds.some(id => !isValidId(id)))) {
      return res.status(400).json({ error: 'serviceIds must be an array of valid IDs' });
    }

    const defaultWorkHours = { startTime: '09:00', endTime: '17:00' };
    const defaultWorkDays = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false };
    const result = await pool.query(
      `INSERT INTO employees (user_id, name, email, phone, color, work_hours, work_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, name.trim(), email ? email.trim() : null, phone ? phone.trim() : null, color || '#3b82f6',
       JSON.stringify(workHours || defaultWorkHours), JSON.stringify(workDays || defaultWorkDays)]
    );

    const employee = result.rows[0];

    // Auto-assign all active services for this business.
    // If the caller passed a specific serviceIds list, use that instead.
    const servicesToAssign = (serviceIds && serviceIds.length > 0)
      ? serviceIds
      : (await pool.query(
          'SELECT id FROM services WHERE user_id = $1 AND active = true',
          [userId]
        )).rows.map(r => r.id);

    for (const serviceId of servicesToAssign) {
      await pool.query(
        `INSERT INTO service_employees (service_id, employee_id)
         VALUES ($1, $2)
         ON CONFLICT (service_id, employee_id) DO NOTHING`,
        [serviceId, employee.id]
      );
    }

    res.json({ employee });
  } catch (error) {
    console.error('Error creating employee:', error.message);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// PUT - Update employee
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, email, phone, color, active, serviceIds, workHours, workDays } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid employee ID' });
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length > 100)) {
      return res.status(400).json({ error: 'Name must be under 100 characters' });
    }

    if (email && !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (phone && phone.length > 20) {
      return res.status(400).json({ error: 'Phone number too long' });
    }

    if (color && !COLOR_REGEX.test(color)) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g. #3b82f6)' });
    }

    if (serviceIds !== undefined && serviceIds !== null && (!Array.isArray(serviceIds) || serviceIds.some(sid => !isValidId(sid)))) {
      return res.status(400).json({ error: 'serviceIds must be an array of valid IDs' });
    }

    const result = await pool.query(
      `UPDATE employees
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           color = COALESCE($4, color),
           active = COALESCE($5, active),
           work_hours = COALESCE($8, work_hours),
           work_days = COALESCE($9, work_days)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [name, email, phone, color, active, id, userId,
       workHours ? JSON.stringify(workHours) : null,
       workDays ? JSON.stringify(workDays) : null]
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
    console.error('Error updating employee:', error.message);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// DELETE - Archive employee (soft delete). Their time entries, breaks, and payroll history
// are preserved and stay viewable; use POST /:id/restore to bring them back.
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid employee ID' });
    }

    const bookingsCheck = await pool.query(
      `SELECT COUNT(*) as count FROM bookings
       WHERE employee_id = $1
       AND booking_date >= CURRENT_DATE
       AND status NOT IN ('cancelled', 'completed')`,
      [id]
    );

    if (parseInt(bookingsCheck.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot remove an employee with upcoming bookings. Reassign or cancel them first.',
        activeBookings: bookingsCheck.rows[0].count
      });
    }

    const result = await pool.query(
      `UPDATE employees SET active = false, archived_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Revoke app access so an archived employee can't keep logging in.
    await pool.query('DELETE FROM employee_credentials WHERE employee_id = $1', [id]).catch(() => {});
    await pool.query("UPDATE employees SET invite_status = 'none' WHERE id = $1", [id]);

    res.json({ success: true, message: 'Employee archived' });
  } catch (error) {
    console.error('Error archiving employee:', error.message);
    res.status(500).json({ error: 'Failed to archive employee' });
  }
});

// POST - Restore a previously archived employee
router.post('/:id/restore', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid employee ID' });
    }

    const result = await pool.query(
      `UPDATE employees SET active = true, archived_at = NULL
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ success: true, employee: result.rows[0] });
  } catch (error) {
    console.error('Error restoring employee:', error.message);
    res.status(500).json({ error: 'Failed to restore employee' });
  }
});

// POST - Send invite to employee for mobile app access
router.post('/:id/invite', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid employee ID' });
    }

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

    // Generate secure invite token (7-day expiry)
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Upsert employee credentials — also reset invite_accepted_at so re-invites work
    await pool.query(
      `INSERT INTO employee_credentials (employee_id, email, invite_token, invite_token_expires)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id)
       DO UPDATE SET invite_token = $3, invite_token_expires = $4, invite_accepted_at = NULL, updated_at = NOW()`,
      [id, employee.email.toLowerCase(), inviteToken, expiresAt]
    );

    // Update invite status
    await pool.query(
      "UPDATE employees SET invite_status = 'pending' WHERE id = $1",
      [id]
    );

    // Get business name for the email
    const userResult = await pool.query('SELECT business_name, email FROM users WHERE id = $1', [userId]);
    const businessName = userResult.rows[0]?.business_name || 'Your employer';
    const ownerEmail = userResult.rows[0]?.email;

    // Send invite email via SendGrid
    const inviteUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/employee-invite?token=${inviteToken}`;

    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      await sgMail.send({
        to: employee.email,
        from: { name: businessName, email: 'noreply@sorceintegrations.com' },
        replyTo: ownerEmail ? { name: businessName, email: ownerEmail } : undefined,
        subject: `You're invited to join ${businessName} on SORCE`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #d97706;">Welcome to SORCE</h2>
            <p>Hi ${employee.name},</p>
            <p><strong>${businessName}</strong> has invited you to join their team on SORCE. You'll be able to view your schedule, manage bookings, and see service details from your phone.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteUrl}" style="background-color: #d97706; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Accept Invite</a>
            </div>
            <p style="color: #666; font-size: 14px;">This invite expires in 7 days.</p>
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
        await sendSMS(
          employee.phone,
          `${businessName} invited you to SORCE! Set up your account: ${inviteUrl}`,
          userId
        );
        console.log(`✅ Invite SMS sent to ${employee.phone}`);
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
    console.error('Error sending employee invite:', error.message);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// POST - Revoke employee access
router.post('/:id/revoke', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid employee ID' });
    }

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
    console.error('Error revoking employee access:', error.message);
    res.status(500).json({ error: 'Failed to revoke access' });
  }
});

// GET - Fetch groups
router.get('/groups', async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM groups WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Error fetching groups:', error.message);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// POST - Create group
router.post('/groups', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, employeeIds } = req.body;

    if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({ error: 'Group name is required (max 100 characters)' });
    }

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.some(eid => !isValidId(eid))) {
      return res.status(400).json({ error: 'employeeIds must be an array of valid IDs' });
    }

    const result = await pool.query(
      'INSERT INTO groups (user_id, name, employee_ids) VALUES ($1, $2, $3) RETURNING *',
      [userId, name.trim(), employeeIds]
    );

    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    console.error('Error creating group:', error.message);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PUT - Update group
router.put('/groups/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, employeeIds } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({ error: 'Group name is required (max 100 characters)' });
    }

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.some(eid => !isValidId(eid))) {
      return res.status(400).json({ error: 'employeeIds must be an array of valid IDs' });
    }

    const result = await pool.query(
      'UPDATE groups SET name = $1, employee_ids = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
      [name.trim(), employeeIds, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    console.error('Error updating group:', error.message);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE - Delete group
router.delete('/groups/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    const result = await pool.query(
      'DELETE FROM groups WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting group:', error.message);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ===== EMPLOYEE PERMISSIONS =====

const VALID_PERMISSIONS = [
  'view_bookings', 'manage_bookings', 'view_customers',
  'view_all_bookings', 'send_messages', 'process_payments', 'view_reports',
  // Manager-only: set/override budgeted hours per job in the app's admin section.
  'manage_budgeted_hours'
];

// PUT - Update individual employee permissions
router.put('/:id/permissions', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { permissions } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid employee ID' });
    }

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'Permissions object required' });
    }

    // Validate all keys are allowed
    const invalidKeys = Object.keys(permissions).filter(k => !VALID_PERMISSIONS.includes(k));
    if (invalidKeys.length > 0) {
      return res.status(400).json({ error: `Invalid permission keys: ${invalidKeys.join(', ')}` });
    }

    const result = await pool.query(
      'UPDATE employees SET permissions = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING id, permissions',
      [JSON.stringify(permissions), id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ success: true, permissions: result.rows[0].permissions });
  } catch (error) {
    console.error('Error updating permissions:', error.message);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

// ===== PERMISSION TEMPLATES =====

// GET - Fetch all permission templates
router.get('/permission-templates', async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      'SELECT * FROM permission_templates WHERE user_id = $1 ORDER BY name',
      [userId]
    );
    res.json({ templates: result.rows });
  } catch (error) {
    console.error('Error fetching permission templates:', error.message);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST - Create permission template
router.post('/permission-templates', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, permissions } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Template name required' });
    }

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'Permissions object required' });
    }

    const result = await pool.query(
      'INSERT INTO permission_templates (user_id, name, permissions) VALUES ($1, $2, $3) RETURNING *',
      [userId, name.trim(), JSON.stringify(permissions)]
    );

    res.status(201).json({ template: result.rows[0] });
  } catch (error) {
    console.error('Error creating permission template:', error.message);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT - Update permission template
router.put('/permission-templates/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, permissions } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }

    const result = await pool.query(
      'UPDATE permission_templates SET name = COALESCE($1, name), permissions = COALESCE($2, permissions), updated_at = NOW() WHERE id = $3 AND user_id = $4 RETURNING *',
      [name?.trim() || null, permissions ? JSON.stringify(permissions) : null, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ template: result.rows[0] });
  } catch (error) {
    console.error('Error updating permission template:', error.message);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE - Delete permission template
router.delete('/permission-templates/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }

    const result = await pool.query(
      'DELETE FROM permission_templates WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting permission template:', error.message);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// POST - Apply template to employees
router.post('/apply-template', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { templateId, employeeIds } = req.body;

    if (!isValidId(templateId) || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'templateId and employeeIds array required' });
    }

    // Get template
    const templateResult = await pool.query(
      'SELECT permissions FROM permission_templates WHERE id = $1 AND user_id = $2',
      [templateId, userId]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const permissions = templateResult.rows[0].permissions;

    // Update all specified employees
    const validIds = employeeIds.filter(id => isValidId(id));
    const result = await pool.query(
      'UPDATE employees SET permissions = $1, updated_at = NOW() WHERE id = ANY($2::int[]) AND user_id = $3 RETURNING id',
      [JSON.stringify(permissions), validIds, userId]
    );

    res.json({ success: true, updatedCount: result.rows.length });
  } catch (error) {
    console.error('Error applying template:', error.message);
    res.status(500).json({ error: 'Failed to apply template' });
  }
});

// PUT /:id/admin - Toggle admin access for an employee
router.put('/:id/admin', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { isAdmin } = req.body;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid employee ID' });
    if (typeof isAdmin !== 'boolean') return res.status(400).json({ error: 'isAdmin must be a boolean' });

    const result = await pool.query(
      `UPDATE employees SET is_admin = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, is_admin`,
      [isAdmin, id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true, employee: result.rows[0] });
  } catch (error) {
    console.error('Error updating admin status:', error.message);
    res.status(500).json({ error: 'Failed to update admin status' });
  }
});

// GET /api/employees/team-chat - Recent team chat messages (the shared feed employees
// post to from the app), surfaced on the owner's dashboard Overview. Read-only here.
router.get('/team-chat', async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const result = await pool.query(
      `SELECT id, employee_name, employee_color, body, created_at
       FROM employee_messages
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    // Newest first — the dashboard feed shows the most recent message at the top.
    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Error fetching team chat:', error.message);
    res.status(500).json({ error: 'Failed to fetch team chat' });
  }
});

module.exports = router;
