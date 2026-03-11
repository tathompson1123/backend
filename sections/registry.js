// ============================================
// SECTION REGISTRY
// Maps template IDs to render functions.
// Supports static (hand-built) sections AND dynamically
// registered Gemini-generated sections.
// ============================================

const fs   = require('fs');
const path = require('path');

// ── Static sections ──────────────────────────────────────
const sections = {
  // Trust/Social Proof
  'trust-banner-scroll': require('./trust/trust-banner-scroll'),
  'review-marquee':      require('./trust/review-marquee'),

  // Navigation
  'nav-sticky-dark':    require('./nav/nav-sticky-dark'),
  'nav-sticky-organic': require('./nav/nav-sticky-organic'),

  // Heroes
  'hero-fullscreen-dark':  require('./hero/hero-fullscreen-dark'),
  'hero-fullscreen-light': require('./hero/hero-fullscreen-light'),
  'hero-gradient':         require('./hero/hero-gradient'),
  'hero-split-portrait':   require('./hero/hero-split-portrait'),
  'hero-page-banner':      require('./hero/hero-page-banner'),
  'hero-cleaning-split':   require('./hero/hero-cleaning-split'),
  'hero-auto-split':       require('./hero/hero-auto-split'),

  // Features
  'features-icon-row':   require('./features/features-icon-row'),
  'importance-split':    require('./features/importance-split'),
  'split-image-cta':     require('./features/split-image-cta'),
  'before-after-cards':  require('./features/before-after-cards'),

  // Services
  'services-cards-3col': require('./services/services-cards-3col'),
  'services-carousel':   require('./services/services-carousel'),

  // Benefits
  'benefits-numbered': require('./benefits/benefits-numbered'),
  'benefits-cards':    require('./benefits/benefits-cards'),

  // Gallery
  'gallery-mixed-grid':        require('./gallery/gallery-mixed-grid'),
  'gallery-filtered':          require('./gallery/gallery-filtered'),
  'gallery-masonry-full-width': require('./gallery/gallery-masonry-full-width'),

  // Testimonials
  'testimonials-3col': require('./testimonials/testimonials-3col'),

  // CTA
  'cta-gradient-full': require('./cta/cta-gradient-full'),
  'cta-card':          require('./cta/cta-card'),

  // Content
  'content-block': require('./content/content-block'),
  'media-row':     require('./content/media-row'),

  // Contact
  'contact-split': require('./contact/contact-split'),

  // Footer
  'footer-4col-dark': require('./footer/footer-4col-dark'),

  // Lead Magnets
  'lead-magnet-landscaping': require('./lead-magnets/lead-magnet-landscaping'),
  'lead-magnet-auto-wrap':   require('./lead-magnets/lead-magnet-auto-wrap'),
  'lead-magnet-cleaning':    require('./lead-magnets/lead-magnet-cleaning'),
  'lead-magnet-renovation':  require('./lead-magnets/lead-magnet-renovation'),
  'lead-magnet-photography': require('./lead-magnets/lead-magnet-photography'),
  'lead-magnet-slider-auto':     require('./lead-magnets/lead-magnet-slider-auto'),
  'lead-magnet-slider-cleaning': require('./lead-magnets/lead-magnet-slider-cleaning'),
  // Teaser sections — CTA blocks that open interactive lead magnet pages in a modal
  'lead-magnet-teaser-auto':        require('./lead-magnets/lead-magnet-teaser-auto'),
  'lead-magnet-teaser-landscaping': require('./lead-magnets/lead-magnet-teaser-landscaping'),
  'lead-magnet-teaser-cleaning':    require('./lead-magnets/lead-magnet-teaser-cleaning'),
  'lead-magnet-teaser-renovation':  require('./lead-magnets/lead-magnet-teaser-renovation'),

  // Custom / Freeform
  'custom-row': require('./custom/custom-row'),
};

// ── Dynamic sections (Gemini-generated, registered at runtime) ──
const dynamicSections = {};

// Auto-load any previously generated templates from sections/generated/
const generatedDir = path.join(__dirname, 'generated');
if (fs.existsSync(generatedDir)) {
  fs.readdirSync(generatedDir).forEach(file => {
    if (!file.endsWith('.js')) return;
    try {
      const section = require(path.join(generatedDir, file));
      if (section && section.id) {
        dynamicSections[section.id] = section;
        console.log(`✅ Registry: loaded generated template "${section.id}"`);
      }
    } catch (e) {
      console.error(`⚠️ Registry: failed to load generated/${file}:`, e.message);
    }
  });
}

// ── Public API ────────────────────────────────────────────

/** Register a section at runtime (no restart needed) */
function registerSection(section) {
  if (!section || !section.id) throw new Error('Section must have an id');
  dynamicSections[section.id] = section;
}

/** Get a single section template by ID */
function getSection(templateId) {
  return sections[templateId] || dynamicSections[templateId] || null;
}

/** Get all registered sections (static + dynamic) */
function getAllSections() {
  return [...Object.values(sections), ...Object.values(dynamicSections)];
}

/** Get sections filtered by category */
function getSectionsByCategory(category) {
  return getAllSections().filter(s => s.category === category);
}

/** Get the master list of section categories */
function getSectionCategories() {
  return [
    { id: 'trust',        name: 'Trust/Reviews',   icon: '⭐' },
    { id: 'nav',          name: 'Navigation',      icon: '☰' },
    { id: 'hero',         name: 'Hero Banners',    icon: '🎯' },
    { id: 'features',     name: 'Features',        icon: '✨' },
    { id: 'services',     name: 'Services',        icon: '📦' },
    { id: 'benefits',     name: 'Benefits',        icon: '💎' },
    { id: 'gallery',      name: 'Gallery',         icon: '🖼️' },
    { id: 'testimonials', name: 'Testimonials',    icon: '💬' },
    { id: 'cta',          name: 'Call to Action',  icon: '📣' },
    { id: 'content',      name: 'Content',         icon: '📝' },
    { id: 'contact',      name: 'Contact',         icon: '📞' },
    { id: 'footer',       name: 'Footer',          icon: '📍' },
    { id: 'pricing',      name: 'Pricing',         icon: '💰' },
    { id: 'faq',          name: 'FAQ',             icon: '❓' },
    { id: 'stats',        name: 'Stats',           icon: '📊' },
    { id: 'team',         name: 'Team',            icon: '👥' },
  ];
}

module.exports = {
  ...sections,
  getSection,
  getAllSections,
  getSectionsByCategory,
  getSectionCategories,
  registerSection,
};
