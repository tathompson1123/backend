// ============================================
// PAGE RENDERER (V2 - Scoped CSS)
// Combines section templates + content + theme → full HTML
// ============================================

const { getSection } = require('./registry');

function renderPage(pageSchema) {
  console.log('🎨 RENDERER: renderPage called');
  console.log('🎨 RENDERER: pageSchema exists:', !!pageSchema);
  console.log('🎨 RENDERER: sections count:', pageSchema?.sections?.length || 0);
  
  if (pageSchema?.sections) {
    console.log('🎨 RENDERER: Section templates requested:', pageSchema.sections.map(s => s.template));
  }

  if (!pageSchema || !pageSchema.sections) {
    console.log('❌ RENDERER: No pageSchema or sections!');
    return '<html><body><p>No content</p></body></html>';
  }

  const theme = pageSchema.theme || {};
  const meta = pageSchema.meta || {};

  const sectionsHtml = pageSchema.sections
    .map(section => {
      console.log(`🎨 RENDERER: Looking for template: ${section.template}`);
      const template = getSection(section.template);
      
      if (!template) {
        console.warn(`⚠️ RENDERER: Template NOT FOUND: ${section.template}`);
        return `<!-- Unknown section: ${section.template} -->`;
      }
      
      console.log(`✅ RENDERER: Found template: ${section.template}`);
      
      try {
        const sectionId = section.id || section.template;
        const html = template.render(section.content || {}, theme, sectionId);
        console.log(`✅ RENDERER: Rendered ${section.template} - ${html.length} chars`);
        // Wrap in an id-tagged div so anchor links (#services, #contact, etc.) resolve
        return `<div id="${sectionId}">${html}</div>`;
      } catch (err) {
        console.error(`❌ RENDERER: Error rendering ${section.template}:`, err);
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
    .reveal {
      opacity: 0;
      transform: translateY(40px);
      transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1), transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .reveal.visible {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>
${sectionsHtml}

<script>
document.addEventListener('DOMContentLoaded', () => {
  // Scroll-reveal animations
  var revealObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  document.querySelectorAll('.reveal').forEach(function(el) { revealObserver.observe(el); });

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(function(link) {
    link.addEventListener('click', function(e) {
      var target = document.querySelector(link.getAttribute('href'));
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
