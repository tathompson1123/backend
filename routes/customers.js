const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Fetch all customers
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM customers WHERE user_id = $1 ORDER BY name',
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
    const { name, email, phone, last_service, last_service_date, left_review, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      `INSERT INTO customers (user_id, name, email, phone, last_service, last_service_date, left_review, notes, total_jobs, lifetime_value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, name, email, phone, last_service, last_service_date, left_review || 'N', notes]
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

// PATCH - Update customer field
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const updates = req.body;

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
