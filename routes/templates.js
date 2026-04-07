// ============================================
// TEMPLATES ROUTES
// Register Gemini-generated section templates at runtime.
// ============================================

const express = require('express');
const router  = express.Router();
const path    = require('path');
const { authenticateToken } = require('../config/middleware');
const { convertGeminiTemplate } = require('../utils/convertGeminiTemplate');

// POST /api/templates/register
// Body: the raw JSON object that Gemini outputs (per the template spec)
router.post('/register', authenticateToken, async (req, res) => {
  try {
    const geminiJson = req.body;

    // Convert + write the template file
    const { id } = convertGeminiTemplate(geminiJson);

    // Dynamically load into the live registry (no server restart needed)
    const templatePath = path.join(__dirname, '..', 'sections', 'generated', `${id}.js`);
    delete require.cache[require.resolve(templatePath)]; // bust cache if re-registering
    const template = require(templatePath);

    const { registerSection } = require('../sections/registry');
    registerSection(template);

    console.log(`✅ Template registered at runtime: ${id}`);
    res.json({ success: true, id, name: template.name, category: template.category });
  } catch (error) {
    console.error('Error registering template:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/templates
// Lists all registered section templates (static + generated)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { getAllSections } = require('../sections/registry');
    const sections = getAllSections();

    res.json({
      templates: sections.map(s => ({
        id:           s.id,
        name:         s.name,
        category:     s.category,
        mood:         s.mood || [],
        suitability:  s.suitability || {},
        generated:    !!s.contentSchema?.['__gemini__'] || false
      }))
    });
  } catch (error) {
    console.error('Error listing templates:', error.message);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// ── Industry page-schemas ──────────────────────────────────

const fs = require('fs');
const schemasDir = path.join(__dirname, '..', 'templates', 'page-schemas');

// GET /api/templates/industry
// Returns list of available industry schemas
router.get('/industry', authenticateToken, async (req, res) => {
  try {
    const files = fs.readdirSync(schemasDir).filter(f => f.endsWith('.json'));
    const industries = files.map(f => {
      const key = f.replace('.json', '');
      try {
        const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, f), 'utf8'));
        return { key, title: schema.meta?.title || key, pages: Object.keys(schema.pages || {}) };
      } catch { return { key, title: key, pages: [] }; }
    });
    res.json({ industries });
  } catch (error) {
    console.error('Error listing industry schemas:', error.message);
    res.status(500).json({ error: 'Failed to list industry schemas' });
  }
});

// GET /api/templates/industry/:key
// Returns the full multi-page schema for one industry
router.get('/industry/:key', authenticateToken, async (req, res) => {
  try {
    // Prevent path traversal: only allow alphanumeric, hyphens, underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(req.params.key)) {
      return res.status(400).json({ error: 'Invalid industry key' });
    }
    const filePath = path.join(schemasDir, `${req.params.key}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Industry schema "${req.params.key}" not found` });
    }
    const schema = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(schema);
  } catch (error) {
    console.error('Error loading industry schema:', error.message);
    res.status(500).json({ error: 'Failed to load industry schema' });
  }
});

module.exports = router;
