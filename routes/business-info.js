const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET /api/business-info - Fetch business information for authenticated user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM business_information WHERE user_id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.json({ businessInfo: null });
    }

    res.json({ businessInfo: result.rows[0] });
  } catch (error) {
    console.error('Error fetching business info:', error.message);
    res.status(500).json({ error: 'Failed to fetch business information' });
  }
});

// POST /api/business-info - Create or update business information
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      phone, email, address, city, state, zipCode,
      serviceAreaType, serviceZipCodes, serviceRadius, centerZipCode
    } = req.body;

    const result = await pool.query(
      `INSERT INTO business_information (
        user_id, phone, email, address, city, state, zip_code,
        service_area_type, service_zip_codes, service_radius, center_zip_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id)
      DO UPDATE SET
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip_code = EXCLUDED.zip_code,
        service_area_type = EXCLUDED.service_area_type,
        service_zip_codes = EXCLUDED.service_zip_codes,
        service_radius = EXCLUDED.service_radius,
        center_zip_code = EXCLUDED.center_zip_code,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        phone || '',
        email || '',
        address || '',
        city || '',
        state || '',
        zipCode || '',
        serviceAreaType || 'zipcodes',
        JSON.stringify(serviceZipCodes || []),
        serviceRadius || 25,
        centerZipCode || ''
      ]
    );

    res.json({ success: true, businessInfo: result.rows[0] });
  } catch (error) {
    console.error('Error saving business info:', error.message);
    res.status(500).json({ error: 'Failed to save business information' });
  }
});

module.exports = router;
