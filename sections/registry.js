// ============================================
// SECTION REGISTRY
// Maps template IDs to render functions
// ============================================

const sections = {
  // Trust/Social Proof
  'trust-banner-scroll': require('./trust/trust-banner-scroll'),

  // Navigation
  'nav-sticky-dark': require('./nav/nav-sticky-dark'),

  // Heroes
  'hero-fullscreen-dark': require('./hero/hero-fullscreen-dark'),
  'hero-gradient': require('./hero/hero-gradient'),

  // Features
  'features-icon-row': require('./features/features-icon-row'),

  // Services
  'services-cards-3col': require('./services/services-cards-3col'),

  // Benefits
  'benefits-numbered': require('./benefits/benefits-numbered'),

  // Gallery
  'gallery-mixed-grid': require('./gallery/gallery-mixed-grid'),

  // Testimonials
  'testimonials-3col': require('./testimonials/testimonials-3col'),

  // CTA
  'cta-gradient-full': require('./cta/cta-gradient-full'),

  // Contact
  'contact-split': require('./contact/contact-split'),

  // Footer
  'footer-4col-dark': require('./footer/footer-4col-dark'),
};

function getSection(templateId) {
  return sections[templateId] || null;
}

function getAllSections() {
  return Object.values(sections);
}

function getSectionsByCategory(category) {
  return Object.values(sections).filter(s => s.category === category);
}

function getSectionCategories() {
  return [
    { id: 'trust', name: 'Trust/Reviews', icon: '⭐' },
    { id: 'nav', name: 'Navigation', icon: '☰' },
    { id: 'hero', name: 'Hero Banners', icon: '🎯' },
    { id: 'features', name: 'Features', icon: '✨' },
    { id: 'services', name: 'Services', icon: '📦' },
    { id: 'benefits', name: 'Benefits', icon: '💎' },
    { id: 'gallery', name: 'Gallery', icon: '🖼️' },
    { id: 'testimonials', name: 'Testimonials', icon: '💬' },
    { id: 'cta', name: 'Call to Action', icon: '📣' },
    { id: 'contact', name: 'Contact', icon: '📞' },
    { id: 'footer', name: 'Footer', icon: '📍' },
  ];
}

module.exports = {
  ...sections,
  getSection,
  getAllSections,
  getSectionsByCategory,
  getSectionCategories
};
