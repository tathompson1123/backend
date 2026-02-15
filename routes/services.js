const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Fetch all services (authenticated)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM services WHERE user_id = $1 AND active = true ORDER BY name',
      [userId]
    );

    res.json({ services: result.rows });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// POST - Create new service
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, description, durationHours, price } = req.body;

    if (!name || !durationHours || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO services (user_id, name, description, duration_hours, price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, name, description, durationHours, price]
    );

    res.json({ service: result.rows[0] });
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// PUT - Update service
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, description, durationHours, price, active } = req.body;

    const result = await pool.query(
      `UPDATE services 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           duration_hours = COALESCE($3, duration_hours),
           price = COALESCE($4, price),
           active = COALESCE($5, active)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [name, description, durationHours, price, active, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ service: result.rows[0] });
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// POST /scrape - Scrape services from a website URL using AI
router.post('/scrape', authenticateToken, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Website URL is required' });
    }

    // Fetch the website HTML
    const axios = require('axios');
    let html;
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SORCEBot/1.0)' },
        maxRedirects: 5
      });
      html = response.data;
    } catch (fetchErr) {
      return res.status(400).json({ error: `Could not fetch website: ${fetchErr.message}` });
    }

    // Strip HTML to text (remove scripts, styles, tags)
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000); // Limit context to ~12k chars

    if (textContent.length < 50) {
      return res.status(400).json({ error: 'Could not extract meaningful content from the website' });
    }

    // Use Claude to extract services
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Extract all services/offerings from this business website content. For each service found, provide:
- name: The service name
- description: A brief 1-2 sentence description
- price: The price if mentioned (number only, no $ sign). If not found, estimate a reasonable price or use 0.
- durationHours: Estimated duration in hours. If not mentioned, estimate reasonably (1-4 hours typical).

Return ONLY a valid JSON array. No markdown, no explanation. Example:
[{"name": "Service Name", "description": "What it includes", "price": 99, "durationHours": 2}]

If no services are found, return an empty array: []

Website content:
${textContent}`
      }]
    });

    const aiText = aiResponse.content[0].text.trim();
    let extractedServices;
    try {
      extractedServices = JSON.parse(aiText);
    } catch (parseErr) {
      // Try to extract JSON from the response
      const jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        extractedServices = JSON.parse(jsonMatch[0]);
      } else {
        return res.status(500).json({ error: 'Could not parse AI response' });
      }
    }

    if (!Array.isArray(extractedServices)) {
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    res.json({ services: extractedServices });
  } catch (error) {
    console.error('Error scraping services:', error);
    res.status(500).json({ error: 'Failed to scrape services from website' });
  }
});

module.exports = router;
