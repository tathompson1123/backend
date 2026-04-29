const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Fetch all customers (deduped: one record per unique email/name)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Dedup: for customers sharing the same email (or same name when no email),
    // return only the record with the most data (non-null fields), then earliest created.
    const result = await pool.query(
      `WITH ranked AS (
         SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY
               LOWER(COALESCE(NULLIF(TRIM(email), ''), LOWER(TRIM(name))))
             ORDER BY
               (CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 2 END),
               (CASE WHEN phone IS NOT NULL AND phone != '' THEN 0 ELSE 1 END),
               created_at ASC
           ) AS rn
         FROM customers WHERE user_id = $1
       )
       SELECT * FROM ranked WHERE rn = 1 ORDER BY name`,
      [userId]
    );

    res.json({ customers: result.rows });
  } catch (error) {
    console.error('Error fetching customers:', error.message);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// POST - Create new customer
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, phone, last_service, last_service_date, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Coerce empty/invalid dates to null so PostgreSQL doesn't throw
    const safeDate = last_service_date && /^\d{4}-\d{2}-\d{2}/.test(last_service_date)
      ? last_service_date
      : null;

    const result = await pool.query(
      `INSERT INTO customers (user_id, name, email, phone, last_service, last_service_date, notes, total_jobs, lifetime_value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, name, email || null, phone || null, last_service || null, safeDate, notes || null]
    );

    console.log(`✅ Customer created: ${name}`);

    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating customer:', error.message);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// POST - Bulk import customers from CSV
router.post('/bulk-import', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { customers } = req.body;

    if (!Array.isArray(customers) || customers.length === 0) {
      return res.status(400).json({ error: 'customers array is required' });
    }
    if (customers.length > 5000) {
      return res.status(400).json({ error: 'Maximum 5000 customers per import' });
    }

    // Load existing emails and phones for dedup. We intentionally do NOT dedup on name —
    // two people can share a name (and CRM exports often have 100s of "John Smith"-style
    // collisions), so name-only matches were silently dropping ~94% of legitimate rows.
    const existingResult = await pool.query(
      `SELECT LOWER(TRIM(email)) AS email,
              regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') AS phone
       FROM customers WHERE user_id = $1`,
      [userId]
    );
    const normPhone10 = p => p ? p.replace(/\D/g, '').slice(-10) : null;
    const existingEmails = new Set(existingResult.rows.map(r => r.email).filter(Boolean));
    const existingPhones = new Set(existingResult.rows.map(r => normPhone10(r.phone)).filter(e => e && e.length === 10));

    // Dedup within the CSV batch by email or phone only
    const seenEmails = new Set();
    const seenPhones = new Set();

    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const c of customers) {
        if (!c.name || !c.name.trim()) { errorCount++; continue; }

        const normEmail = c.email ? c.email.toLowerCase().trim() : null;
        const rawPhone = normPhone10(c.phone);
        const normPhone = rawPhone && rawPhone.length === 10 ? rawPhone : null;

        // Dedup: only by email or phone (10-digit). Name collisions are not duplicates.
        if (normEmail && (existingEmails.has(normEmail) || seenEmails.has(normEmail))) {
          duplicateCount++; continue;
        }
        if (normPhone && (existingPhones.has(normPhone) || seenPhones.has(normPhone))) {
          duplicateCount++; continue;
        }

        if (normEmail) seenEmails.add(normEmail);
        if (normPhone) seenPhones.add(normPhone);

        const safeDate = c.last_service_date && /^\d{4}-\d{2}-\d{2}/.test(c.last_service_date)
          ? c.last_service_date : null;

        try {
          await client.query(
            `INSERT INTO customers (user_id, name, email, phone, last_service, last_service_date, notes, total_jobs, lifetime_value, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, CURRENT_TIMESTAMP)`,
            [userId, c.name.trim(), normEmail || null, c.phone || null,
             c.last_service || null, safeDate, c.notes || null]
          );
          // Track newly inserted so subsequent rows in same batch treat it as existing
          if (normEmail) existingEmails.add(normEmail);
          if (normPhone) existingPhones.add(normPhone);
          successCount++;
        } catch (rowErr) {
          console.error('Bulk import row error:', rowErr.message, { name: c.name, email: c.email });
          errorCount++;
        }
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    console.log(`✅ Bulk import: ${successCount} added, ${duplicateCount} duplicates skipped for user ${userId}`);
    res.json({ success: true, successCount, duplicateCount, errorCount });
  } catch (error) {
    console.error('Error bulk importing customers:', error.message);
    res.status(500).json({ error: 'Failed to import customers' });
  }
});

const ALLOWED_CUSTOMER_FIELDS = new Set([
  'name', 'email', 'phone', 'last_service', 'last_service_date',
  'notes', 'total_jobs', 'lifetime_value'
]);

// PATCH - Update customer field
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const updates = req.body;

    const invalidFields = Object.keys(updates).filter(f => !ALLOWED_CUSTOMER_FIELDS.has(f));
    if (invalidFields.length > 0) {
      return res.status(400).json({ error: `Invalid field(s): ${invalidFields.join(', ')}` });
    }

    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((field, idx) => `${field} = $${idx + 2}`).join(', ');

    const result = await pool.query(
      `UPDATE customers 
       SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $${fields.length + 2}
       RETURNING *`,
      [id, ...values, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating customer:', error.message);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// DELETE - Delete customer
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM customers WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    console.log(`✅ Customer deleted: ${result.rows[0].name}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error.message);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

module.exports = router;
