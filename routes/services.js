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
    console.error('Error fetching services:', error.message);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// POST - Create new service
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, description, durationHours, price, categoryId, imageUrl, bufferMinutes, sortOrder, isAddon, locationType, customAddress } = req.body;

    if (!name || !durationHours || (price === undefined || price === null || price === '')) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO services (user_id, name, description, duration_hours, price, category_id, image_url, buffer_minutes, sort_order, is_addon, location_type, custom_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [userId, name, description, durationHours, price, categoryId || null, imageUrl || '', bufferMinutes || 0, sortOrder || 0, isAddon || false, locationType || 'business_address', customAddress || null]
    );

    res.json({ service: result.rows[0] });
  } catch (error) {
    console.error('Error creating service:', error.message);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// PUT - Update service
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, description, durationHours, price, active, categoryId, imageUrl, bufferMinutes, sortOrder, isAddon, locationType, customAddress } = req.body;

    const result = await pool.query(
      `UPDATE services
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           duration_hours = COALESCE($3, duration_hours),
           price = COALESCE($4, price),
           active = COALESCE($5, active),
           category_id = COALESCE($6, category_id),
           image_url = COALESCE($7, image_url),
           buffer_minutes = COALESCE($8, buffer_minutes),
           sort_order = COALESCE($9, sort_order),
           is_addon = COALESCE($10, is_addon),
           location_type = COALESCE($13, location_type),
           custom_address = COALESCE($14, custom_address)
       WHERE id = $11 AND user_id = $12
       RETURNING *`,
      [name, description, durationHours, price, active, categoryId, imageUrl, bufferMinutes, sortOrder, isAddon, id, userId, locationType || null, customAddress !== undefined ? customAddress : null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ service: result.rows[0] });
  } catch (error) {
    console.error('Error updating service:', error.message);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// GET - Fetch addons for a specific service
router.get('/:id/addons', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT s.* FROM service_addons sa
       JOIN services s ON s.id = sa.addon_service_id
       WHERE sa.main_service_id = $1 AND s.user_id = $2 AND s.active = true
       ORDER BY sa.sort_order, s.name`,
      [id, userId]
    );
    res.json({ addons: result.rows });
  } catch (error) {
    console.error('Error fetching addons:', error.message);
    res.status(500).json({ error: 'Failed to fetch addons' });
  }
});

// PUT - Set addon relationships for a service (replaces existing)
router.put('/:id/addons', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { addonServiceIds = [] } = req.body;

    // Verify service belongs to user
    const svc = await pool.query('SELECT id FROM services WHERE id = $1 AND user_id = $2', [id, userId]);
    if (svc.rows.length === 0) return res.status(404).json({ error: 'Service not found' });

    // Replace all addons
    await pool.query('DELETE FROM service_addons WHERE main_service_id = $1', [id]);
    for (let i = 0; i < addonServiceIds.length; i++) {
      await pool.query(
        'INSERT INTO service_addons (main_service_id, addon_service_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, addonServiceIds[i], i]
      );
    }

    // Return updated addons
    const result = await pool.query(
      `SELECT s.* FROM service_addons sa
       JOIN services s ON s.id = sa.addon_service_id
       WHERE sa.main_service_id = $1 AND s.user_id = $2 AND s.active = true
       ORDER BY sa.sort_order`,
      [id, userId]
    );
    res.json({ addons: result.rows });
  } catch (error) {
    console.error('Error updating addons:', error.message);
    res.status(500).json({ error: 'Failed to update addons' });
  }
});

// GET - Fetch variants for a service
router.get('/:id/variants', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    // Verify service belongs to user
    const svc = await pool.query('SELECT id FROM services WHERE id = $1 AND user_id = $2', [id, userId]);
    if (svc.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    const result = await pool.query(
      'SELECT * FROM service_variants WHERE service_id = $1 ORDER BY sort_order, id',
      [id]
    );
    res.json({ variants: result.rows });
  } catch (error) {
    console.error('Error fetching variants:', error.message);
    res.status(500).json({ error: 'Failed to fetch variants' });
  }
});

// POST - Create a variant for a service
router.post('/:id/variants', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, price, durationHours, sortOrder } = req.body;
    if (!name || price === undefined || price === null || price === '') {
      return res.status(400).json({ error: 'name and price are required' });
    }
    const svc = await pool.query('SELECT id FROM services WHERE id = $1 AND user_id = $2', [id, userId]);
    if (svc.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    const result = await pool.query(
      'INSERT INTO service_variants (service_id, name, price, duration_hours, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, name, price, durationHours || null, sortOrder || 0]
    );
    res.json({ variant: result.rows[0] });
  } catch (error) {
    console.error('Error creating variant:', error.message);
    res.status(500).json({ error: 'Failed to create variant' });
  }
});

// PUT - Update a variant
router.put('/variants/:variantId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { variantId } = req.params;
    const { name, price, durationHours, sortOrder } = req.body;
    // Verify ownership via service
    const check = await pool.query(
      'SELECT sv.id FROM service_variants sv JOIN services s ON s.id = sv.service_id WHERE sv.id = $1 AND s.user_id = $2',
      [variantId, userId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Variant not found' });
    const result = await pool.query(
      `UPDATE service_variants SET name = COALESCE($1, name), price = COALESCE($2, price),
       duration_hours = $3, sort_order = COALESCE($4, sort_order)
       WHERE id = $5 RETURNING *`,
      [name, price, durationHours !== undefined ? (durationHours || null) : null, sortOrder, variantId]
    );
    res.json({ variant: result.rows[0] });
  } catch (error) {
    console.error('Error updating variant:', error.message);
    res.status(500).json({ error: 'Failed to update variant' });
  }
});

// DELETE - Delete a variant
router.delete('/variants/:variantId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { variantId } = req.params;
    const check = await pool.query(
      'SELECT sv.id FROM service_variants sv JOIN services s ON s.id = sv.service_id WHERE sv.id = $1 AND s.user_id = $2',
      [variantId, userId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Variant not found' });
    await pool.query('DELETE FROM service_variants WHERE id = $1', [variantId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting variant:', error.message);
    res.status(500).json({ error: 'Failed to delete variant' });
  }
});

// Helper: Scrape page with Puppeteer (JS-rendered sites)
async function scrapeWithPuppeteer(url) {
  const puppeteer = require('puppeteer-core');
  const chromium = require('@sparticuz/chromium');

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1920, height: 1080 },
    executablePath: await chromium.executablePath(),
    headless: 'new',
    ignoreHTTPSErrors: true,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll to trigger lazy-loaded content
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1000);

    let mainText = await page.evaluate(() => document.body.innerText);

    // Find and scrape service-related linked pages + all nav links
    const serviceLinks = await page.evaluate((baseUrl) => {
      const base = new URL(baseUrl);
      const found = [];
      const seen = new Set();
      seen.add(base.pathname); // skip the current page

      function addLink(href) {
        if (found.length >= 6) return;
        try {
          const u = new URL(href, base.origin);
          if (u.origin !== base.origin) return;
          const path = u.pathname;
          if (seen.has(path) || path === '/' || path === '') return;
          // skip non-page resources
          if (/\.(jpg|jpeg|png|gif|svg|pdf|css|js|ico|webp|mp4|mp3)$/i.test(path)) return;
          seen.add(path);
          found.push(u.href);
        } catch {}
      }

      const keywords = ['service', 'pricing', 'price', 'book', 'menu', 'offerings', 'packages', 'what-we-do', 'our-work', 'schedule', 'appointment', 'detail', 'wash', 'clean', 'repair', 'maintain', 'rate', 'cost', 'catalog', 'shop', 'order', 'gallery', 'portfolio'];

      // Priority 1: Links matching service-related keywords
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      for (const link of allLinks) {
        const href = link.href;
        const text = (link.textContent || '').toLowerCase().trim();
        const hrefLower = href.toLowerCase();
        const isRelevant = keywords.some(kw => hrefLower.includes(kw) || text.includes(kw));
        if (isRelevant) addLink(href);
      }

      // Priority 2: All nav/header links (these are almost always important pages)
      const navLinks = document.querySelectorAll('nav a[href], header a[href], [role="navigation"] a[href]');
      for (const link of navLinks) {
        addLink(link.href);
      }

      return found;
    }, url);

    for (const link of serviceLinks) {
      try {
        console.log('  → Also scraping linked page:', link);
        await page.goto(link, { waitUntil: 'networkidle2', timeout: 20000 });
        await page.waitForTimeout(2000);
        await page.evaluate(async () => {
          for (let i = 0; i < 3; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); }
        });
        await page.waitForTimeout(500);
        const pageText = await page.evaluate(() => document.body.innerText);
        mainText += '\n\n--- ADDITIONAL PAGE ---\n\n' + pageText;
      } catch (e) {
        console.warn('  ⚠️ Could not scrape linked page:', link, e.message);
      }
    }

    return mainText;
  } finally {
    await browser.close();
  }
}

// Helper: Scrape page with axios (fallback when Puppeteer/Chromium unavailable)
async function scrapeWithAxios(url) {
  const axios = require('axios');
  const response = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    maxRedirects: 5
  });
  const html = response.data;

  // Find service-related links + nav links in the HTML
  const baseUrl = new URL(url);
  const extraLinks = [];
  const seenPaths = new Set([baseUrl.pathname]);
  const keywords = ['service', 'pricing', 'price', 'book', 'menu', 'offerings', 'packages', 'what-we-do', 'our-work', 'schedule', 'appointment', 'detail', 'wash', 'clean', 'repair', 'maintain', 'rate', 'cost', 'catalog', 'shop', 'order', 'gallery', 'portfolio'];

  // Find all hrefs in the HTML
  const allHrefRegex = /href=["']([^"'#]+)["']/gi;
  let match;
  // Also extract nav section links specifically
  const navSection = (html.match(/<nav[^>]*>[\s\S]*?<\/nav>/gi) || []).join(' ') +
                     (html.match(/<header[^>]*>[\s\S]*?<\/header>/gi) || []).join(' ');
  const combinedHtml = html + '\n' + navSection; // nav links get checked twice = higher priority

  while ((match = allHrefRegex.exec(combinedHtml)) !== null && extraLinks.length < 6) {
    let href = match[1];
    if (href.startsWith('/')) href = baseUrl.origin + href;
    try {
      const u = new URL(href);
      if (u.origin !== baseUrl.origin) continue;
      if (seenPaths.has(u.pathname) || u.pathname === '/' || u.pathname === '') continue;
      if (/\.(jpg|jpeg|png|gif|svg|pdf|css|js|ico|webp|mp4|mp3)$/i.test(u.pathname)) continue;
      const hrefLower = href.toLowerCase();
      const isRelevant = keywords.some(kw => hrefLower.includes(kw));
      // Accept keyword matches or nav links
      const isNavLink = navSection.includes(match[0]);
      if (isRelevant || isNavLink) {
        seenPaths.add(u.pathname);
        extraLinks.push(u.href);
      }
    } catch {}
  }

  let mainText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Scrape additional linked pages
  for (const link of extraLinks) {
    try {
      console.log('  → Also fetching linked page:', link);
      const extraRes = await axios.get(link, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SORCEBot/1.0)' } });
      const extraText = extraRes.data
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      mainText += '\n\n--- ADDITIONAL PAGE ---\n\n' + extraText;
    } catch (e) {
      console.warn('  ⚠️ Could not fetch linked page:', link, e.message);
    }
  }

  return mainText;
}

// POST /scrape - Scrape services from a website URL using headless browser + AI
router.post('/scrape', authenticateToken, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Website URL is required' });
    }

    console.log('🌐 Scraping services from:', url);

    // Try Puppeteer first (renders JS), fall back to axios if chromium unavailable
    let mainText;
    try {
      mainText = await scrapeWithPuppeteer(url);
      console.log('📄 Used Puppeteer (JS-rendered) scrape');
    } catch (puppeteerErr) {
      console.warn('⚠️ Puppeteer unavailable, falling back to axios:', puppeteerErr.message);
      try {
        mainText = await scrapeWithAxios(url);
        console.log('📄 Used axios (static HTML) scrape');
      } catch (axiosErr) {
        return res.status(400).json({ error: `Could not fetch website: ${axiosErr.message}` });
      }
    }

    const textContent = mainText.replace(/\s+/g, ' ').trim().slice(0, 60000);

    if (textContent.length < 50) {
      return res.status(400).json({ error: 'Could not extract meaningful content from the website' });
    }

    // Log a preview of extracted content for debugging
    console.log(`📄 Extracted ${textContent.length} chars of text content`);
    console.log(`📄 Text preview (first 500 chars): ${textContent.slice(0, 500)}`);
    console.log(`📄 Text preview (last 500 chars): ${textContent.slice(-500)}`);

    // Use Claude to extract services
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are extracting services from a business website. Your job is to find EVERY SINGLE service listed on the page. Do NOT skip any. Do NOT summarize or combine services. If there are 15 services listed, return all 15.

For each service found, provide:
- name: The exact service name as shown on the website
- description: A brief 1-2 sentence description (from the website text if available, or a reasonable description)
- price: The price if mentioned (number only, no $ sign). Use 0 if price is not found — do NOT estimate.
- durationHours: The duration in hours if mentioned. Use 0 if not found — do NOT estimate.

IMPORTANT RULES:
- Include EVERY service, package, add-on, and upgrade you can find
- If services appear under different categories or sections, include them ALL
- Look for service names in headings, lists, pricing tables, booking menus, etc.
- Each variation counts as a separate service (e.g., "Basic Wash" and "Premium Wash" are 2 services)
- Check ALL sections of the content including "ADDITIONAL PAGE" sections

Return ONLY a valid JSON array. No markdown, no explanation, no commentary.
Example: [{"name": "Service Name", "description": "What it includes", "price": 99, "durationHours": 2}]

If no services are found, return: []

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
    console.error('Error scraping services:', error.message);
    res.status(500).json({ error: 'Failed to scrape services from website' });
  }
});

module.exports = router;
