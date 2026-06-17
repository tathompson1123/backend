// ============================================
// GENERATE ROUTE (V2 - Section Template System)
// AI generates JSON schema → renderer builds HTML
// Also saves business info to DB so Business Settings auto-populates
// ============================================

const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('../utils/claudeUsage');
const { buildSchemaPrompt, detectLayout, buildOrganicSchemaFromContent } = require('../sections/generateSchemaPrompt');
const { renderPage, renderMultiPage } = require('../sections/renderer');
const { getThemeForBusinessType, THEMES } = require('../sections/themes');
const { fetchPexelsImages } = require('../utils/fetchPexelsImages');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function generateWebsite(req, res) 
{console.log('🔍 req.user:', req.user);
  try {
    const {
      businessName,
      businessType,
      tagline,
      services,
      description,
      uniqueSellingPoints,
      targetCustomer,
      yearsInBusiness,
      certifications,
      phone,
      email,
      city,
      state,
    } = req.body;

    if (!businessName || !businessType) {
      return res.status(400).json({ error: 'businessName and businessType are required' });
    }

    const pool = req.app.get('pool');
    const userId = req.user.userId;

    console.log(`🚀 Generating website for: ${businessName} (${businessType})`);

    // ==========================================
    // STEP 0: Save business info to DB
    // ==========================================
    if (pool && (phone || email || city || state)) {
      try {
        const existing = await pool.query(
          'SELECT id FROM business_information WHERE user_id = $1',
          [userId]
        );

        if (existing.rows.length > 0) {
          const updates = [];
          const values = [];
          let paramIndex = 1;

          if (phone) { updates.push(`phone = $${paramIndex++}`); values.push(phone); }
          if (email) { updates.push(`email = $${paramIndex++}`); values.push(email); }
          if (city) { updates.push(`city = $${paramIndex++}`); values.push(city); }
          if (state) { updates.push(`state = $${paramIndex++}`); values.push(state); }

          if (updates.length > 0) {
            updates.push(`updated_at = NOW()`);
            values.push(userId);
            await pool.query(
              `UPDATE business_information SET ${updates.join(', ')} WHERE user_id = $${paramIndex}`,
              values
            );
            console.log('✅ Updated business_information with form data');
          }
        } else {
          await pool.query(
            `INSERT INTO business_information (user_id, phone, email, city, state)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, phone || '', email || '', city || '', state || '']
          );
          console.log('✅ Created business_information from form data');
        }
      } catch (bizErr) {
        console.error('⚠️ Could not save business info (continuing):', bizErr.message);
      }
    }

    // ==========================================
    // STEP 1: Pre-fetch verified images from Pexels
    // ==========================================
    const layout = detectLayout(businessType);
    const pexelsImages = await fetchPexelsImages(businessType, layout);

    // ==========================================
    // STEP 2: Build the AI prompt
    // ==========================================
    const prompt = buildSchemaPrompt({
      businessName,
      businessType,
      phone: phone || '(555) 555-5555',
      email: email || 'info@business.com',
      city: city || '',
      state: state || '',
      services,
      description,
      images: pexelsImages,
    });

    // ==========================================
    // STEP 2: Call Claude API
    // ==========================================
    console.log('🤖 Calling Claude API for content schema...');
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        { role: 'user', content: prompt }
      ],
    });
    logClaudeUsage(userId, 'claude-sonnet-4-6', message.usage, 'website_gen');

    // ==========================================
    // STEP 3: Parse JSON response
    // ==========================================
    let rawText = message.content[0].text.trim();
    
    if (rawText.startsWith('```json')) {
      rawText = rawText.slice(7);
    } else if (rawText.startsWith('```')) {
      rawText = rawText.slice(3);
    }
    if (rawText.endsWith('```')) {
      rawText = rawText.slice(0, -3);
    }
    rawText = rawText.trim();

    let pageSchema;
    try {
      pageSchema = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('❌ Failed to parse AI response as JSON:', parseErr.message);
      console.error('Raw response:', rawText.substring(0, 500));
      return res.status(500).json({
        error: 'AI returned invalid JSON',
        details: parseErr.message
      });
    }

    // ==========================================
    // STEP 3b: For organic layout, build full schema from text content
    // Claude returns only text content; we construct the full multi-page schema
    // ==========================================
    if (layout === 'organic') {
      const hoursRaw = req.body.hours || '';
      const serviceArea = req.body.serviceArea || '';
      const phoneClean = (phone || '').replace(/\D/g, '');
      const hoursText = hoursRaw || 'Mon-Fri: 8AM-6PM\nSat: 9AM-4PM\nSun: Closed';
      const areaText = serviceArea || ((city || state) ? [city, state].filter(Boolean).join(', ') + ' and surrounding areas' : 'Local and surrounding areas');

      let parsedServices = services;
      if (typeof services === 'string' && services.trim()) {
        parsedServices = services.split(',').map(s => s.trim()).filter(Boolean);
      }
      const servicesList = Array.isArray(parsedServices) && parsedServices.length > 0
        ? parsedServices.map(s => typeof s === 'string' ? s : (s.name || s.title || '')).filter(Boolean)
        : ['Lawn Care', 'Garden Design', 'Landscaping'];

      console.log('🌿 Organic layout: building schema from content...');
      pageSchema = buildOrganicSchemaFromContent(pageSchema, {
        businessName,
        phone: phone || '(555) 555-5555',
        phoneClean,
        email: email || 'info@business.com',
        hoursText,
        areaText,
        servicesList,
      });
    }

    // ==========================================
    // STEP 4: Apply theme + render HTML
    // ==========================================
    // Use themeId embedded in schema (e.g. photography variants), else fall back to business-type lookup
    const theme = (pageSchema.themeId && THEMES[pageSchema.themeId])
      ? THEMES[pageSchema.themeId]
      : getThemeForBusinessType(businessType);
    console.log(`🎨 Using theme: ${pageSchema.themeId || businessType} →`, theme.primaryColor);

    pageSchema.theme = theme;
    pageSchema.version = 2;

    if (req.user && (req.user.userId || req.user.id)) {
      if (!pageSchema.meta) pageSchema.meta = {};
      pageSchema.meta.userId = req.user.userId || req.user.id;
    }

    const { injectAgents } = require('../utils/injectAgents');
    let html;
    let pages;

    if (pageSchema.multiPage) {
      // ── Multi-page site (e.g. auto detailing) ──────────────────────
      console.log('📄 Multi-page schema detected, rendering pages...');
      const renderedPages = renderMultiPage(pageSchema);
      console.log('✅ Pages rendered:', Object.keys(renderedPages).join(', '));

      // Inject chat widget into every page
      pages = {};
      for (const [filename, pageHtml] of Object.entries(renderedPages)) {
        pages[filename] = await injectAgents(pageHtml, userId, pool, pageSchema.theme);
      }

      // index.html is the primary page returned to the frontend for preview
      html = pages['index.html'] || Object.values(pages)[0];
    } else {
      // ── Single-page site ────────────────────────────────────────────
      console.log('🎨 Rendering HTML from schema...');
      html = renderPage(pageSchema);
      console.log('✅ HTML generated, length:', html.length);
      html = await injectAgents(html, userId, pool, pageSchema.theme);
      pages = { 'index.html': html };
    }

    // ==========================================
    // STEP 5: Save website to DB
    // ==========================================

    console.log('📝 Saving with:', { businessName, businessType, userId });

    if (pool) {
      try {
        const existing = await pool.query(
          'SELECT id, is_published FROM websites WHERE user_id = $1',
          [userId]
        );

        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE websites
             SET html_content = $1, page_data = $2, pages = $3, business_name = $4, business_type = $5, updated_at = NOW()
             WHERE user_id = $6`,
            [html, JSON.stringify(pageSchema), JSON.stringify(pages), businessName, businessType, userId]
          );
          console.log('✅ Updated existing website');

          // Auto-redeploy if already published
          if (existing.rows[0].is_published) {
            try {
              const vercelToken = process.env.VERCEL_TOKEN;
              if (vercelToken) {
                const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${vercelToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    name: `website-${userId}`,
                    files: [
                      ...Object.entries(pages).map(([filename, pageHtml]) => ({ file: filename, data: pageHtml })),
                      { file: 'vercel.json', data: JSON.stringify({ cleanUrls: true, trailingSlash: false }) }
                    ],
                    target: 'production',
                    projectSettings: { framework: null }
                  })
                });

                if (deployResponse.ok) {
                  const deployData = await deployResponse.json();
                  const stableAlias = deployData.alias?.[0];
                  const deployUrl = `https://${(stableAlias || deployData.url || '').replace(/^https?:?\/*/, '')}`;
                  await pool.query(
                    'UPDATE websites SET vercel_url = $1, vercel_deployment_id = $2 WHERE user_id = $3',
                    [deployUrl, deployData.id, userId]
                  );
                  console.log(`✅ Auto-redeployed to ${deployUrl}`);
                } else {
                  console.error('⚠️ Auto-redeploy failed:', await deployResponse.text());
                }
              }
            } catch (deployErr) {
              console.error('⚠️ Auto-redeploy error:', deployErr.message);
            }
          }
        } else {
          await pool.query(
            `INSERT INTO websites (user_id, html_content, page_data, pages, business_name, business_type)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, html, JSON.stringify(pageSchema), JSON.stringify(pages), businessName, businessType]
          );
          console.log('✅ Created new website');
        }
      } catch (dbErr) {
        console.error('⚠️ Database save failed (website still generated):', dbErr.message);
      }
    }

    // ==========================================
    // STEP 6: Return response
    // ==========================================
    console.log('✅ Website generated successfully!');
    res.json({
      success: true,
      html,
      pages,
      schema: pageSchema,
      theme: theme.id,
    });

  } catch (err) {
    console.error('❌ Generation error:', err);
    res.status(500).json({ 
      error: 'Failed to generate website', 
      details: err.message 
    });
  }
}

// ============================================
// Public preview endpoint — no auth required.
// Generates the website but does NOT save to DB or inject agents.
// Returns HTML + schema for the preview page.
// ============================================
async function generatePreview(req, res) {
  try {
    const {
      businessName,
      businessType,
      tagline,
      services,
      description,
      uniqueSellingPoints,
      targetCustomer,
      yearsInBusiness,
      certifications,
      phone,
      email,
      city,
      state,
    } = req.body;

    if (!businessName || !businessType) {
      return res.status(400).json({ error: 'businessName and businessType are required' });
    }

    console.log(`🚀 [Preview] Generating website for: ${businessName} (${businessType})`);

    // STEP 1: Pre-fetch images
    const layout = detectLayout(businessType);
    const pexelsImages = await fetchPexelsImages(businessType, layout);

    // STEP 2: Build prompt + call Claude
    const prompt = buildSchemaPrompt({
      businessName,
      businessType,
      phone: phone || '(555) 555-5555',
      email: email || 'info@business.com',
      city: city || '',
      state: state || '',
      services,
      description,
      images: pexelsImages,
    });

    console.log('🤖 [Preview] Calling Claude API...');
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });
    logClaudeUsage(userId, 'claude-sonnet-4-6', message.usage, 'website_gen');

    // STEP 3: Parse JSON
    let rawText = message.content[0].text.trim();
    if (rawText.startsWith('```json')) rawText = rawText.slice(7);
    else if (rawText.startsWith('```')) rawText = rawText.slice(3);
    if (rawText.endsWith('```')) rawText = rawText.slice(0, -3);
    rawText = rawText.trim();

    let pageSchema;
    try {
      pageSchema = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('❌ [Preview] Failed to parse AI response:', parseErr.message);
      return res.status(500).json({ error: 'AI returned invalid JSON', details: parseErr.message });
    }

    // STEP 3b: Organic layout
    if (layout === 'organic') {
      const hoursRaw = req.body.hours || '';
      const serviceArea = req.body.serviceArea || '';
      const phoneClean = (phone || '').replace(/\D/g, '');
      const hoursText = hoursRaw || 'Mon-Fri: 8AM-6PM\nSat: 9AM-4PM\nSun: Closed';
      const areaText = serviceArea || ((city || state) ? [city, state].filter(Boolean).join(', ') + ' and surrounding areas' : 'Local and surrounding areas');

      let parsedServices = services;
      if (typeof services === 'string' && services.trim()) {
        parsedServices = services.split(',').map(s => s.trim()).filter(Boolean);
      }
      const servicesList = Array.isArray(parsedServices) && parsedServices.length > 0
        ? parsedServices.map(s => typeof s === 'string' ? s : (s.name || s.title || '')).filter(Boolean)
        : ['Lawn Care', 'Garden Design', 'Landscaping'];

      pageSchema = buildOrganicSchemaFromContent(pageSchema, {
        businessName,
        phone: phone || '(555) 555-5555',
        phoneClean,
        email: email || 'info@business.com',
        hoursText,
        areaText,
        servicesList,
      });
    }

    // STEP 4: Apply theme + render HTML (no agent injection)
    const theme = (pageSchema.themeId && THEMES[pageSchema.themeId])
      ? THEMES[pageSchema.themeId]
      : getThemeForBusinessType(businessType);

    pageSchema.theme = theme;
    pageSchema.version = 2;

    let html;
    let pages;

    if (pageSchema.multiPage) {
      const renderedPages = renderMultiPage(pageSchema);
      pages = renderedPages;
      html = pages['index.html'] || Object.values(pages)[0];
    } else {
      html = renderPage(pageSchema);
      pages = { 'index.html': html };
    }

    console.log('✅ [Preview] Website generated successfully!');
    res.json({
      success: true,
      html,
      pages,
      schema: pageSchema,
      theme: theme.id,
      formData: { businessName, businessType, tagline, services, description, phone, email, city, state },
    });
  } catch (err) {
    console.error('❌ [Preview] Generation error:', err);
    res.status(500).json({ error: 'Failed to generate website', details: err.message });
  }
}

// ============================================
// Claim endpoint — after signup, save preview website to new user's account.
// Expects: { schema, pages, html, formData } in body + auth token.
// ============================================
async function claimPreview(req, res) {
  try {
    const { schema, pages, html, formData } = req.body;
    const pool = req.app.get('pool');
    const userId = req.user.userId;

    if (!schema || !html) {
      return res.status(400).json({ error: 'Missing preview data' });
    }

    // Save business info
    if (formData && (formData.phone || formData.email || formData.city || formData.state)) {
      try {
        const existing = await pool.query('SELECT id FROM business_information WHERE user_id = $1', [userId]);
        if (existing.rows.length > 0) {
          const updates = [];
          const values = [];
          let i = 1;
          if (formData.phone) { updates.push(`phone = $${i++}`); values.push(formData.phone); }
          if (formData.email) { updates.push(`email = $${i++}`); values.push(formData.email); }
          if (formData.city) { updates.push(`city = $${i++}`); values.push(formData.city); }
          if (formData.state) { updates.push(`state = $${i++}`); values.push(formData.state); }
          if (updates.length > 0) {
            updates.push('updated_at = NOW()');
            values.push(userId);
            await pool.query(`UPDATE business_information SET ${updates.join(', ')} WHERE user_id = $${i}`, values);
          }
        } else {
          await pool.query(
            'INSERT INTO business_information (user_id, phone, email, city, state) VALUES ($1, $2, $3, $4, $5)',
            [userId, formData.phone || '', formData.email || '', formData.city || '', formData.state || '']
          );
        }
      } catch (bizErr) {
        console.error('⚠️ Could not save business info during claim:', bizErr.message);
      }
    }

    // Update business name on user record
    if (formData?.businessName) {
      await pool.query('UPDATE users SET business_name = $1 WHERE id = $2 AND (business_name IS NULL OR business_name = $3)',
        [formData.businessName, userId, '']);
    }

    // Save website
    const existing = await pool.query('SELECT id FROM websites WHERE user_id = $1', [userId]);
    const schemaStr = JSON.stringify(schema);
    const pagesStr = JSON.stringify(pages);

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE websites SET html_content = $1, page_data = $2, pages = $3, business_name = $4, business_type = $5, updated_at = NOW() WHERE user_id = $6`,
        [html, schemaStr, pagesStr, formData?.businessName || '', formData?.businessType || '', userId]
      );
    } else {
      await pool.query(
        `INSERT INTO websites (user_id, html_content, page_data, pages, business_name, business_type) VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, html, schemaStr, pagesStr, formData?.businessName || '', formData?.businessType || '']
      );
    }

    console.log(`✅ Preview claimed by user ${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Claim error:', err);
    res.status(500).json({ error: 'Failed to save website', details: err.message });
  }
}

module.exports = generateWebsite;
module.exports.generatePreview = generatePreview;
module.exports.claimPreview = claimPreview;
