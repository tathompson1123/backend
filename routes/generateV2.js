// ============================================
// GENERATE ROUTE (V2 - Section Template System)
// AI generates JSON schema → renderer builds HTML
// Also saves business info to DB so Business Settings auto-populates
// ============================================
//
// INSTALLATION:
// 1. Copy this file to your backend/routes/ folder
// 2. Make sure sections/ folder is in your backend root
// 3. Wire into Express:
//
//    const generateV2 = require('./routes/generateV2');
//    app.post('/api/generate-v2', authenticateToken, generateV2);
//
// REQUIRED: npm install @anthropic-ai/sdk
// ============================================

const Anthropic = require('@anthropic-ai/sdk');
const { buildSchemaPrompt } = require('../sections/generateSchemaPrompt');
const { renderPage } = require('../sections/renderer');
const { getThemeForBusinessType } = require('../sections/themes');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function generateWebsite(req, res) {
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
      // Contact & location fields (NEW)
      phone,
      email,
      city,
      state,
    } = req.body;

    if (!businessName || !businessType) {
      return res.status(400).json({ error: 'businessName and businessType are required' });
    }

    const pool = req.app.get('pool');
    const userId = req.user.id;

    console.log(`🚀 Generating website for: ${businessName} (${businessType})`);

    // ==========================================
    // STEP 0: Save business info to DB
    // This seeds the Business Settings page so 
    // the user doesn't have to re-enter anything
    // ==========================================
    if (pool && (phone || email || city || state)) {
      try {
        const existing = await pool.query(
          'SELECT id FROM business_info WHERE user_id = $1',
          [userId]
        );

        if (existing.rows.length > 0) {
          // Only update fields that were provided (don't overwrite with empty)
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
              `UPDATE business_info SET ${updates.join(', ')} WHERE user_id = $${paramIndex}`,
              values
            );
            console.log('✅ Updated business_info with form data');
          }
        } else {
          // Insert new row
          await pool.query(
            `INSERT INTO business_info (user_id, phone, email, city, state)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, phone || '', email || '', city || '', state || '']
          );
          console.log('✅ Created business_info from form data');
        }
      } catch (bizErr) {
        // Non-fatal — don't block generation if this fails
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
    pageSchema.theme = theme;
    pageSchema.version = 2;

    if (req.user && req.user.id) {
      if (!pageSchema.meta) pageSchema.meta = {};
      pageSchema.meta.userId = req.user.id;
    }

    console.log('🎨 Rendering HTML from schema...');
    const html = renderPage(pageSchema);

    // ==========================================
    // STEP 5: Save website to DB
    // ==========================================
    if (pool) {
      try {
        const existing = await pool.query(
          'SELECT id FROM websites WHERE user_id = $1',
          [userId]
        );

        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE websites 
             SET html_content = $1, page_data = $2, business_name = $3, business_type = $4, updated_at = NOW()
             WHERE user_id = $5`,
            [html, JSON.stringify(pageSchema), businessName, businessType, userId]
          );
          console.log('✅ Updated existing website');
        } else {
          await pool.query(
            `INSERT INTO websites (user_id, html_content, page_data, business_name, business_type)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, html, JSON.stringify(pageSchema), businessName, businessType]
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
