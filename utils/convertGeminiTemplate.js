// ============================================
// GEMINI TEMPLATE CONVERTER
// Takes a Gemini JSON output (per the template spec),
// validates it, writes a template module to sections/generated/,
// and returns metadata for runtime registration.
// ============================================

const fs   = require('fs');
const path = require('path');

const generatedDir = path.join(__dirname, '..', 'sections', 'generated');

const VALID_CATEGORIES = [
  'hero', 'nav', 'services', 'features', 'benefits',
  'testimonials', 'gallery', 'cta', 'contact', 'footer',
  'trust', 'pricing', 'faq', 'stats', 'team'
];

/**
 * Validate and convert a Gemini template JSON into a registered section module.
 * @param {object} geminiJson - The raw JSON output from Gemini
 * @returns {{ id: string, filePath: string }} - Metadata on the written file
 * @throws    If validation fails
 */
function convertGeminiTemplate(geminiJson) {
  // ── Validation ────────────────────────────────────────────
  const required = ['id', 'name', 'category', 'contentSchema', 'html', 'css'];
  for (const field of required) {
    if (!geminiJson[field]) {
      throw new Error(`Missing required field: "${field}"`);
    }
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(geminiJson.id)) {
    throw new Error('id must be kebab-case (e.g. "hero-split-image")');
  }

  if (!VALID_CATEGORIES.includes(geminiJson.category)) {
    throw new Error(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  if (typeof geminiJson.html !== 'string' || geminiJson.html.trim().length === 0) {
    throw new Error('html must be a non-empty string');
  }

  if (typeof geminiJson.css !== 'string' || geminiJson.css.trim().length === 0) {
    throw new Error('css must be a non-empty string');
  }

  // ── Generate module source ────────────────────────────────
  const templateSource = `// AUTO-GENERATED — Gemini template
// Registered via POST /api/templates/register
// Do not edit manually. Re-register to update.

const { renderGeminiTemplate } = require('../../utils/renderGeminiTemplate');

const templateData = {
  html: ${JSON.stringify(geminiJson.html)},
  css:  ${JSON.stringify(geminiJson.css)},
  js:   ${JSON.stringify(geminiJson.js || '')}
};

module.exports = {
  id:            ${JSON.stringify(geminiJson.id)},
  name:          ${JSON.stringify(geminiJson.name)},
  category:      ${JSON.stringify(geminiJson.category)},
  mood:          ${JSON.stringify(geminiJson.mood || [])},
  suitability:   ${JSON.stringify(geminiJson.suitability || {})},
  contentSchema: ${JSON.stringify(geminiJson.contentSchema, null, 2)},

  render(content, theme, sectionId) {
    return renderGeminiTemplate(templateData, content, theme, sectionId);
  }
};
`;

  // ── Write file ────────────────────────────────────────────
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const filePath = path.join(generatedDir, `${geminiJson.id}.js`);
  fs.writeFileSync(filePath, templateSource, 'utf8');

  console.log(`✅ convertGeminiTemplate: wrote ${filePath}`);
  return { id: geminiJson.id, filePath };
}

module.exports = { convertGeminiTemplate, generatedDir };
