// ============================================
// PAGE RENDERER (V2 - Scoped CSS)
// Combines section templates + content + theme → full HTML
// Supports single-page (renderPage) and multi-page (renderMultiPage)
// ============================================

const { getSection } = require('./registry');

// ── Shared helpers ────────────────────────────────────────────────────

function renderSectionHtml(section, theme) {
  const template = getSection(section.template);
  if (!template) {
    console.warn(`⚠️ RENDERER: Template NOT FOUND: ${section.template}`);
    return `<!-- Unknown section: ${section.template} -->`;
  }
  try {
    const sectionId = section.id || section.template;
    // Merge per-section color overrides (set in editor) on top of the global theme
    const effectiveTheme = (section.colors && Object.keys(section.colors).length > 0)
      ? { ...theme, ...section.colors }
      : theme;
    const html = template.render(section.content || {}, effectiveTheme, sectionId);
    // Optional per-section background color override set in the editor
    const bgOverride = section.content?.bgColor
      ? `<style>.section-${sectionId}{background-color:${section.content.bgColor}!important}</style>`
      : '';
    // Belt-and-suspenders CSS overrides for section.colors (ensures visual changes even if
    // template CSS doesn't pick up the effectiveTheme due to specificity or caching)
    const colorsOverride = (() => {
      const sc = section.colors;
      if (!sc || !Object.keys(sc).length) return '';
      const sp = `section-${sectionId}`;
      const css = [];
      if (sc.primaryColor) {
        const c = sc.primaryColor;
        css.push(
          `.${sp}-cta{background:${c}!important;border-color:${c}!important}`,
          `.${sp}-cta:hover{box-shadow:0 8px 25px ${c}40!important}`,
          `.${sp}-btn-primary{background:${c}!important;box-shadow:0 4px 20px ${c}40!important}`,
          `.${sp}-btn-primary:hover{box-shadow:0 8px 30px ${c}60!important}`,
          `.${sp}-highlight{color:${c}!important;-webkit-text-fill-color:${c}!important;background-image:none!important}`,
          `.${sp}-stat-number{color:${c}!important}`,
          `.${sp}-badge{color:${c}!important;border-color:${c}40!important;background:${c}20!important}`,
          `.${sp}-links a:hover,.${sp}-link:hover{color:${c}!important}`,
          `.${sp}-scroll-line{background:linear-gradient(to bottom,${c},transparent)!important}`,
          `.${sp}-logo{color:${c}!important}`
        );
      }
      if (sc.textColor) {
        const c = sc.textColor;
        css.push(
          `.${sp}-links a:not(.${sp}-cta){color:${c}!important}`,
          `.${sp}-link{color:${c}!important}`,
          `.${sp}-mobile span,.${sp}-burger span{background:${c}!important}`,
          `.${sp}-subtitle,.${sp}-body,.${sp}-text{color:${c}!important}`
        );
      }
      return css.length ? `<style>${css.join('')}</style>` : '';
    })();
    // Wrap in id-tagged div so anchor links (#services, etc.) resolve
    return `<div id="${sectionId}">${html}${bgOverride}${colorsOverride}</div>`;
  } catch (err) {
    console.error(`❌ RENDERER: Error rendering ${section.template}:`, err);
    return `<!-- Error rendering: ${section.template} -->`;
  }
}

function buildPageHtml(sectionsHtml, theme, meta) {
  // Resolve /booking placeholder → real booking URL
  if (meta.userId) {
    const appUrl = process.env.VITE_APP_URL || 'https://www.sorceintegrations.com';
    const bookingUrl = `${appUrl}/book/${meta.userId}`;
    sectionsHtml = sectionsHtml.replace(/href="\/booking"/g, `href="${bookingUrl}" target="_blank" rel="noopener noreferrer"`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meta.title || 'Website')}</title>
  <meta name="description" content="${escapeHtml(meta.description || '')}">
  ${meta.userId ? `<meta name="user-id" content="${meta.userId}">` : ''}
  ${meta.userId ? `<script>window.__SORCE_USER_ID__='${meta.userId}';window.__SORCE_APP_URL__='${process.env.VITE_APP_URL || 'https://www.sorceintegrations.com'}';window.__SORCE_API_URL__='${process.env.VITE_API_URL || process.env.BACKEND_URL || 'https://backend-production-ab50.up.railway.app'}';</script>` : ''}
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
// ── Image fallback — swap broken Unsplash photos with curated verified ones ──
(function() {
  var FALLBACKS = [
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&q=80',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=80',
    'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=800&q=80',
    'https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800&q=80',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
  ];
  var _fi = 0;
  function attachFallback(img) {
    if (img._fbAttached) return;
    img._fbAttached = true;
    img.onerror = function() {
      if (!this._fbUsed) {
        this._fbUsed = true;
        this.src = FALLBACKS[_fi++ % FALLBACKS.length];
      }
    };
  }
  document.querySelectorAll('img').forEach(attachFallback);
  // Also catch lazy-loaded or JS-injected images
  if (window.MutationObserver) {
    new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.tagName === 'IMG') attachFallback(node);
          else if (node.querySelectorAll) node.querySelectorAll('img').forEach(attachFallback);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
})();

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

  // Smooth scroll for anchor links only (not page links)
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

// ── Single-page renderer ──────────────────────────────────────────────

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
      const result = renderSectionHtml(section, theme);
      if (!result.startsWith('<!--')) {
        console.log(`✅ RENDERER: Rendered ${section.template}`);
      }
      return result;
    })
    .join('\n\n');

  return buildPageHtml(sectionsHtml, theme, meta);
}

// ── Multi-page renderer ───────────────────────────────────────────────
// Schema shape:
//   { multiPage: true, nav: {id,template,content}, footer: {id,template,content},
//     pages: [{ filename, meta, sections: [...] }], theme, meta }
// Returns: { 'index.html': html, 'services.html': html, ... }

function renderMultiPage(pageSchema) {
  console.log('🎨 RENDERER: renderMultiPage called');

  if (!pageSchema.multiPage || !pageSchema.pages) {
    console.error('❌ RENDERER: renderMultiPage called but schema is not multi-page');
    return {};
  }

  const theme = pageSchema.theme || {};
  const baseMeta = pageSchema.meta || {};
  const result = {};

  for (const page of pageSchema.pages) {
    const filename = page.filename || 'index.html';
    const pageMeta = Object.assign({}, baseMeta, page.meta || {});

    console.log(`🎨 RENDERER: Rendering page: ${filename}`);

    const htmlParts = [];

    // Inject shared nav at the top of every page
    if (pageSchema.nav) {
      htmlParts.push(renderSectionHtml(pageSchema.nav, theme));
    }

    // Page-specific sections
    for (const section of (page.sections || [])) {
      console.log(`🎨 RENDERER: [${filename}] template: ${section.template}`);
      htmlParts.push(renderSectionHtml(section, theme));
    }

    // Inject shared footer at the bottom of every page
    if (pageSchema.footer) {
      htmlParts.push(renderSectionHtml(pageSchema.footer, theme));
    }

    result[filename] = buildPageHtml(htmlParts.join('\n\n'), theme, pageMeta);
    console.log(`✅ RENDERER: ${filename} rendered, ${result[filename].length} chars`);
  }

  return result;
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

module.exports = { renderPage, renderMultiPage };
