// ============================================
// GENERATE ROUTE (V2 - Section Template System)
// AI generates JSON schema → renderer builds HTML
// Also saves business info to DB so Business Settings auto-populates
// ============================================

const Anthropic = require('@anthropic-ai/sdk');
const { buildSchemaPrompt } = require('../sections/generateSchemaPrompt');
const { renderPage, renderMultiPage } = require('../sections/renderer');
const { getThemeForBusinessType } = require('../sections/themes');

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
    // STEP 1: Build the AI prompt
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
    });

    // ==========================================
    // STEP 2: Call Claude API
    // ==========================================
    console.log('🤖 Calling Claude API for content schema...');
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt }
      ],
    });

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
    // STEP 4: Apply theme + render HTML
    // ==========================================
    const theme = getThemeForBusinessType(businessType);
    console.log(`🎨 Using theme: ${theme.name}`);

    pageSchema.theme = theme;
    pageSchema.version = 2;

    if (req.user && req.user.id) {
      if (!pageSchema.meta) pageSchema.meta = {};
      pageSchema.meta.userId = req.user.id;
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
                    files: [{ file: 'index.html', data: Buffer.from(html).toString('base64') }],
                    projectSettings: { framework: null }
                  })
                });

                if (deployResponse.ok) {
                  const deployData = await deployResponse.json();
                  const deployUrl = `https://${deployData.url}`;
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

module.exports = generateWebsite;
