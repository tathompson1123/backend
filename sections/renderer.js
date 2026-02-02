// ============================================
// PAGE RENDERER (V2 - Scoped CSS)
// Combines section templates + content + theme → full HTML
// ============================================

const { getSection } = require('./registry');

function renderPage(pageSchema) {
  if (!pageSchema || !pageSchema.sections) {
    return '<html><body><p>No content</p></body></html>';
  }

  const theme = pageSchema.theme || {};
  const meta = pageSchema.meta || {};

  // Render each section — pass sectionId for scoped CSS
  const sectionsHtml = pageSchema.sections
    .map(section => {
      const template = getSection(section.template);
      if (!template) {
        console.warn(`⚠️ Unknown section template: ${section.template}`);
        return `<!-- Unknown section: ${section.template} -->`;
      }
      try {
        return template.render(section.content || {}, theme, section.id || section.template);
      } catch (err) {
        console.error(`❌ Error rendering section ${section.template}:`, err);
        return `<!-- Error rendering: ${section.template} -->`;
      }
    })
    .join('\n\n');

  // Build full HTML document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meta.title || 'Website')}</title>
  <meta name="description" content="${escapeHtml(meta.description || '')}">
  ${meta.userId ? `<meta name="user-id" content="${meta.userId}">` : ''}
  <link href="${theme.fontImport || 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'}" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: '${theme.bodyFont || 'Inter'}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: ${theme.textColor || '#1f2937'};
      background: ${theme.bgColor || '#ffffff'};
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    img { max-width: 100%; height: auto; }
    a { color: inherit; text-decoration: none; }
    ::selection { background: ${theme.primaryColor || '#DC143C'}33; }
  </style>
</head>
<body>
${sectionsHtml}

<script>
// Intersection Observer for scroll animations
const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -50px 0px' };
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.animationPlayState = 'running';
    }
  });
}, observerOptions);

document.addEventListener('DOMContentLoaded', () => {
  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});
</script>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

module.exports = { renderPage };
