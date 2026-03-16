const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// PUT /reorder - Batch update sort_order (must be before /:id to avoid conflict)
router.put('/reorder', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { order } = req.body;

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array' });
    }

    for (const item of order) {
      await pool.query(
        `UPDATE service_categories SET sort_order = $1 WHERE id = $2 AND user_id = $3`,
        [item.sortOrder, item.id, userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error reordering categories:', error.message);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
});

// GET / - List all categories for the user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM service_categories WHERE user_id = $1 ORDER BY sort_order, name',
      [userId]
    );

    res.json({ categories: result.rows });
  } catch (error) {
    console.error('Error fetching service categories:', error.message);
    res.status(500).json({ error: 'Failed to fetch service categories' });
  }
});

// POST / - Create a new category
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, description, imageUrl } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      `INSERT INTO service_categories (user_id, name, description, image_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, name, description, imageUrl]
    );

    res.json({ category: result.rows[0] });
  } catch (error) {
    console.error('Error creating service category:', error.message);
    res.status(500).json({ error: 'Failed to create service category' });
  }
});

// PUT /:id - Update a category
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, description, imageUrl, sortOrder, active } = req.body;

    const result = await pool.query(
      `UPDATE service_categories
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           image_url = COALESCE($3, image_url),
           sort_order = COALESCE($4, sort_order),
           active = COALESCE($5, active)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [name, description, imageUrl, sortOrder, active, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ category: result.rows[0] });
  } catch (error) {
    console.error('Error updating service category:', error.message);
    res.status(500).json({ error: 'Failed to update service category' });
  }
});

// DELETE /:id - Delete a category
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Nullify category_id on services that reference this category
    await pool.query(
      `UPDATE services SET category_id = NULL WHERE category_id = $1 AND user_id = $2`,
      [id, userId]
    );

    const result = await pool.query(
      `DELETE FROM service_categories WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting service category:', error.message);
    res.status(500).json({ error: 'Failed to delete service category' });
  }
});

module.exports = router;
