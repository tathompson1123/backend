// ============================================
// GENERATE ROUTE (V2 - Section Template System)
// AI generates JSON schema → renderer builds HTML
// ============================================
//
// INSTALLATION:
// 1. Copy this file to your backend/routes/ folder (or wherever your routes live)
// 2. Make sure sections/ folder is in your backend root
// 3. Wire this into your Express app:
//
//    const generateV2 = require('./routes/generateV2');
//    app.post('/api/generate-v2', authenticateToken, generateV2);
//
//    Or replace your existing /api/generate route body with this logic.
//
// REQUIRED: npm install anthropic (if not already installed)
// ============================================

const Anthropic = require('@anthropic-ai/sdk');
const { buildSchemaPrompt } = require('../sections/generateSchemaPrompt');
const { renderPage } = require('../sections/renderer');
const { getThemeForBusinessType } = require('../sections/themes');

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function generateWebsite(req, res) {
  try {
    const {
      businessName,
      businessType,
      phone,
      email,
      address,
      city,
      state,
      services,
      description,
      hours,
      serviceArea,
    } = req.body;

    if (!businessName || !businessType) {
      return res.status(400).json({ error: 'businessName and businessType are required' });
    }

    console.log(`🚀 Generating website for: ${businessName} (${businessType})`);

    // 1. Build the AI prompt
    const prompt = buildSchemaPrompt({
      businessName,
      businessType,
      phone,
      email,
      address,
      city,
      state,
      services,
      description,
      hours,
      serviceArea,
    });

    // 2. Call Claude API to generate the content schema
    console.log('🤖 Calling Claude API for content schema...');
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt }
      ],
    });

    // 3. Parse the AI response as JSON
    let rawText = message.content[0].text.trim();
    
    // Strip markdown code fences if present
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

    // 4. Apply theme based on business type
    const theme = getThemeForBusinessType(businessType);
    pageSchema.theme = theme;
    pageSchema.version = 2;

    // Add user ID if available
    if (req.user && req.user.id) {
      if (!pageSchema.meta) pageSchema.meta = {};
      pageSchema.meta.userId = req.user.id;
    }

    // 5. Render the full HTML from schema + templates
    console.log('🎨 Rendering HTML from schema...');
    const html = renderPage(pageSchema);

    // 6. Save to database (both schema and rendered HTML)
    const pool = req.app.get('pool'); // Your PostgreSQL pool
    if (pool) {
      try {
        // Check if website exists for this user
        const existing = await pool.query(
          'SELECT id FROM websites WHERE user_id = $1',
          [req.user.id]
        );

        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE websites 
             SET html_content = $1, page_data = $2, business_name = $3, business_type = $4, updated_at = NOW()
             WHERE user_id = $5`,
            [html, JSON.stringify(pageSchema), businessName, businessType, req.user.id]
          );
          console.log('✅ Updated existing website');
        } else {
          await pool.query(
            `INSERT INTO websites (user_id, html_content, page_data, business_name, business_type)
             VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, html, JSON.stringify(pageSchema), businessName, businessType]
          );
          console.log('✅ Created new website');
        }
      } catch (dbErr) {
        console.error('⚠️ Database save failed (website still generated):', dbErr.message);
      }
    }

    // 7. Return both schema and HTML
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
