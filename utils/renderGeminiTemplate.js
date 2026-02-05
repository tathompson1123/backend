// ============================================
// GEMINI TEMPLATE RENDERER
// Generic render engine for templates created via Gemini.
// Handles: scope replacement, theme tokens, opacity tinting,
// array loops, simple field substitution, and conditional blocks.
// ============================================

/**
 * Render a Gemini-generated template into an HTML string.
 * @param {object} templateData  - { html, css, js } raw template strings with placeholders
 * @param {object} content       - The content values (from contentSchema fields)
 * @param {object} theme         - The theme object (primaryColor, accentColor, etc.)
 * @param {string} sectionId     - Unique section ID for CSS scoping
 * @returns {string}             - Rendered HTML + <style> + <script>
 */
function renderGeminiTemplate(templateData, content, theme, sectionId) {
  const s = `section-${sectionId}`;
  let { html, css, js } = templateData;
  js = js || '';

  // ── 1. Scope: {{S}} → section-{id} ────────────────────────
  html = html.replaceAll('{{S}}', s);
  css  = css.replaceAll('{{S}}', s);
  if (js) js = js.replaceAll('{{S}}', s);

  // ── 2. Theme tokens with opacity tinting ──────────────────
  const themeMap = {
    primaryColor:  theme.primaryColor  || '#667eea',
    accentColor:   theme.accentColor   || '#764ba2',
    bgColor:       theme.bgColor       || '#ffffff',
    surfaceColor:  theme.surfaceColor  || '#f9fafb',
    textColor:     theme.textColor     || '#1f2937',
    textMuted:     theme.textMuted     || '#6b7280',
    headingFont:   theme.headingFont   || 'Inter',
    bodyFont:      theme.bodyFont      || 'Inter',
    borderAccent:  theme.borderAccent  || '#e5e7eb',
    borderRadius:  theme.borderRadius  || '16px',
    buttonRadius:  theme.buttonRadius  || '12px',
  };

  // Color keys that can have opacity suffixes (e.g. {{theme.primaryColor}}40)
  const colorKeys = ['primaryColor', 'accentColor', 'bgColor', 'surfaceColor', 'textColor', 'borderAccent'];

  function replaceTokens(str) {
    // Tinted variants first (more specific) — e.g. {{theme.primaryColor}}15
    for (const key of colorKeys) {
      const baseValue = themeMap[key];
      const tintRegex = new RegExp(`\\{\\{theme\\.${key}\\}\\}([0-9a-fA-F]{2})`, 'g');
      str = str.replace(tintRegex, (_, opacity) => `${baseValue}${opacity}`);
    }
    // Exact tokens
    for (const [key, value] of Object.entries(themeMap)) {
      str = str.replaceAll(`{{theme.${key}}}`, String(value));
    }
    return str;
  }

  html = replaceTokens(html);
  css  = replaceTokens(css);
  if (js) js = replaceTokens(js);

  // ── 3. Array loops ─────────────────────────────────────────
  // Syntax: <!-- LOOP_START: fieldName --> ... <!-- LOOP_END: fieldName -->
  // Inside loop: {{item.key}} references itemSchema fields
  for (const [key, value] of Object.entries(content)) {
    if (!Array.isArray(value)) continue;

    const loopRegex = new RegExp(
      `<!-- LOOP_START: ${key} -->([\\s\\S]*?)<!-- LOOP_END: ${key} -->`, 'g'
    );

    html = html.replace(loopRegex, (_, itemTemplate) => {
      return value.map(item => {
        let rendered = itemTemplate;
        if (typeof item === 'object' && item !== null) {
          for (const [itemKey, itemValue] of Object.entries(item)) {
            rendered = rendered.replaceAll(`{{item.${itemKey}}}`, String(itemValue ?? ''));
          }
        }
        return rendered;
      }).join('\n');
    });
  }

  // ── 4. Conditional blocks ──────────────────────────────────
  // Syntax: {{#if fieldName}} ... {{/if}}  (checkbox / truthy fields)
  for (const [key, value] of Object.entries(content)) {
    if (typeof value === 'boolean') {
      const ifRegex = new RegExp(`\\{\\{#if ${key}\\}\\}([\\s\\S]*?)\\{\\{/if\\}\\}`, 'g');
      html = value
        ? html.replace(ifRegex, '$1')          // keep inner content
        : html.replace(ifRegex, '');            // remove block
    }
  }

  // ── 5. Simple field substitution ───────────────────────────
  for (const [key, value] of Object.entries(content)) {
    if (typeof value === 'string' || typeof value === 'number') {
      html = html.replaceAll(`{{${key}}}`, String(value));
    }
  }

  // ── 6. Clean up any remaining unresolved placeholders ─────
  html = html.replace(/\{\{[^}]+\}\}/g, '');
  css  = css.replace(/\{\{[^}]+\}\}/g, '');
  if (js) js = js.replace(/\{\{[^}]+\}\}/g, '');

  // ── 7. Assemble ────────────────────────────────────────────
  let result = html + '\n<style>\n' + css + '\n</style>';
  if (js) result += '\n<script>\n' + js + '\n</script>';

  return result;
}

module.exports = { renderGeminiTemplate };
