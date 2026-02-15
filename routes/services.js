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

// POST /scrape - Scrape services from a website URL using headless browser + AI
router.post('/scrape', authenticateToken, async (req, res) => {
  let browser;
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Website URL is required' });
    }

    // Launch headless browser to render JavaScript
    const puppeteer = require('puppeteer-core');
    const chromium = require('@sparticuz/chromium');

    console.log('🌐 Launching browser to scrape services from:', url);

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: await chromium.executablePath(),
      headless: 'new',
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to the provided URL and wait for JS to render
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(3000); // Extra wait for dynamic content

    // Scroll down to trigger lazy-loaded content
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1000);

    // Extract text content from the rendered page
    let mainText = await page.evaluate(() => document.body.innerText);

    // Also look for service-related links to scrape additional pages
    const serviceLinks = await page.evaluate((baseUrl) => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const keywords = ['service', 'pricing', 'book', 'menu', 'offerings', 'packages', 'what-we-do', 'our-work'];
      const found = [];
      const base = new URL(baseUrl);

      for (const link of links) {
        const href = link.href;
        const text = (link.textContent || '').toLowerCase();
        const hrefLower = href.toLowerCase();

        if (href.startsWith(base.origin) || href.startsWith('/')) {
          const isRelevant = keywords.some(kw => hrefLower.includes(kw) || text.includes(kw));
          if (isRelevant && !found.includes(href) && found.length < 3) {
            found.push(href);
          }
        }
      }
      return found;
    }, url);

    // Scrape up to 3 additional service-related pages
    for (const link of serviceLinks) {
      try {
        console.log('  → Also scraping linked page:', link);
        await page.goto(link, { waitUntil: 'networkidle2', timeout: 20000 });
        await page.waitForTimeout(2000);
        await page.evaluate(async () => {
          for (let i = 0; i < 3; i++) {
            window.scrollBy(0, window.innerHeight);
            await new Promise(r => setTimeout(r, 400));
          }
        });
        await page.waitForTimeout(500);
        const pageText = await page.evaluate(() => document.body.innerText);
        mainText += '\n\n--- ADDITIONAL PAGE ---\n\n' + pageText;
      } catch (e) {
        console.warn('  ⚠️ Could not scrape linked page:', link, e.message);
      }
    }

    await browser.close();
    browser = null;

    // Trim to reasonable context size
    const textContent = mainText.replace(/\s+/g, ' ').trim().slice(0, 20000);

    if (textContent.length < 50) {
      return res.status(400).json({ error: 'Could not extract meaningful content from the website' });
    }

    console.log(`📄 Extracted ${textContent.length} chars of text content, sending to AI...`);

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

    console.log(`✅ Found ${extractedServices.length} services`);
    res.json({ services: extractedServices });
  } catch (error) {
    console.error('Error scraping services:', error);
    res.status(500).json({ error: 'Failed to scrape services from website' });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
});

module.exports = router;
