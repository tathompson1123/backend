const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

router.use(authenticateToken);

// GET /api/status-templates - List all templates for this business
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;

    // Seed defaults if none exist
    const existing = await pool.query(
      'SELECT * FROM status_update_templates WHERE user_id = $1 ORDER BY status',
      [userId]
    );

    if (existing.rows.length === 0) {
      const defaults = [
        { status: 'in_progress', message: 'Hey {{customerFirstName}}, this is {{employeeFirstName}} with {{businessName}}. Your technician has begun the service!', enabled: true },
        { status: 'completed', message: 'Hey {{customerFirstName}}, this is {{employeeFirstName}} with {{businessName}}. Your service has been completed! Thank you for choosing us.', enabled: true },
        { status: 'no_show', message: 'Hey {{customerFirstName}}, this is {{employeeFirstName}} with {{businessName}}. We attempted to service your appointment but were unable to reach you. Please contact us to reschedule.', enabled: false },
        { status: 'progress_update', message: 'Hey {{customerFirstName}}, this is {{employeeFirstName}} with {{businessName}}. Updating you on our progress.', enabled: true },
      ];

      for (const d of defaults) {
        await pool.query(
          'INSERT INTO status_update_templates (user_id, status, message_template, enabled) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, status) DO NOTHING',
          [userId, d.status, d.message, d.enabled]
        );
      }

      const seeded = await pool.query(
        'SELECT * FROM status_update_templates WHERE user_id = $1 ORDER BY status',
        [userId]
      );
      return res.json({ templates: seeded.rows });
    }

    res.json({ templates: existing.rows });
  } catch (error) {
    console.error('Error fetching status templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// PUT /api/status-templates/:status - Update a template
router.put('/:status', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status } = req.params;
    const { messageTemplate, enabled } = req.body;

    const allowedStatuses = ['in_progress', 'completed', 'no_show', 'progress_update'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (messageTemplate !== undefined) {
      updates.push(`message_template = $${paramIndex++}`);
      values.push(messageTemplate);
    }
    if (enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      values.push(enabled);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId, status);

    const result = await pool.query(
      `UPDATE status_update_templates SET ${updates.join(', ')}
       WHERE user_id = $${paramIndex++} AND status = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('Error updating status template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

module.exports = router;
