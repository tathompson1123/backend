const express = require('express');
const router = express.Router();
const { authenticateToken, requirePlan } = require('../config/middleware');

// All market research routes require Expert plan
router.use(requirePlan('expert'));

// Get market research data
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Your market research logic here
    res.json({ 
      success: true,
      data: {
        // Market research data
      }
    });
  } catch (error) {
    console.error('Market research error:', error);
    res.status(500).json({ error: 'Failed to fetch market research' });
  }
});

module.exports = router;
