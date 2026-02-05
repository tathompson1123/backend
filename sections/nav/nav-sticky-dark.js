// ============================================
// NAV - Sticky Dark
// ============================================

module.exports = {
  id: 'nav-sticky-dark',
  name: 'Sticky Dark Navigation',
  category: 'nav',
  description: 'Dark sticky navigation with logo, links, and CTA button',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.7, cleaning: 0.7, hvac: 0.8,
    salonSpa: 0.6, fitness: 0.95, dental: 0.6, restaurant: 0.7,
    realEstate: 0.65, photography: 0.8, legal: 0.6, renovation: 0.85, petGrooming: 0.6,
  },
  mood: ['bold', 'luxury', 'rugged'],

  contentSchema: {
    logo: { type: 'text', label: 'Logo Text', default: 'Business Name' },
    links: {
      type: 'array',
      label: 'Nav Links',
      itemSchema: {
        text: { type: 'text', label: 'Link Text', default: 'Link' },
        url: { type: 'url', label: 'Link URL', default: '#' },
      }
    },
    ctaText: { type: 'text', label: 'CTA Button Text', default: 'Book Now' },
    ctaLink: { type: 'url', label: 'CTA Button Link', default: '#contact' },
  },

  render(content, theme, sectionId = 'nav') {
    const s = `section-${sectionId}`;
    const links = content.links || [];
    const linksHtml = links.map(l =>
      `<a href="${l.url || '#'}">${l.text}</a>`
    ).join('\n');

    return `
<nav class="${s}">
  <div class="${s}-container">
    <a href="#" class="${s}-logo">${content.logo || 'Business Name'}</a>
    <div class="${s}-links">
      ${linksHtml}
      <a href="${content.ctaLink || '#'}" class="${s}-cta">${content.ctaText || 'Book Now'}</a>
    </div>
    <button class="${s}-mobile" onclick="document.querySelector('.${s}-links').classList.toggle('${s}-open')">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
<style>
  .${s} { background: transparent; padding: 1.5rem 0; position: fixed; top: 0; left: 0; right: 0; z-index: 1000; transition: background 0.4s, backdrop-filter 0.4s, border-color 0.4s; border-bottom: 1px solid transparent; }
  .${s}.scrolled { background: rgba(10, 10, 10, 0.95); backdrop-filter: blur(10px); border-bottom-color: ${theme.borderAccent}; }
  .${s}-container { max-width: 1400px; margin: 0 auto; padding: 0 3rem; display: flex; justify-content: space-between; align-items: center; }
  .${s}-logo { font-family: '${theme.headingFont}', sans-serif; font-size: 1.8rem; font-weight: 800; color: ${theme.primaryColor}; text-transform: uppercase; letter-spacing: 2px; text-decoration: none; }
  .${s}-links { display: flex; gap: 3rem; align-items: center; }
  .${s}-links a { color: #ffffff; text-decoration: none; font-weight: 600; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 1px; transition: color 0.3s; }
  .${s}-links a:hover { color: ${theme.primaryColor}; }
  .${s}-cta { background: ${theme.primaryColor} !important; color: #ffffff !important; padding: 0.875rem 2rem !important; border-radius: ${theme.buttonRadius}; font-weight: 700 !important; transition: transform 0.3s, box-shadow 0.3s !important; }
  .${s}-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 25px ${theme.primaryColor}40; }
  .${s}-mobile { display: none; background: none; border: none; cursor: pointer; padding: 0.5rem; flex-direction: column; gap: 5px; }
  .${s}-mobile span { display: block; width: 25px; height: 2px; background: #ffffff; transition: 0.3s; }

  @media (max-width: 768px) {
    .${s}-container { padding: 0 1.5rem; }
    .${s}-mobile { display: flex; }
    .${s}-links { display: none; position: absolute; top: 100%; left: 0; right: 0; background: rgba(10,10,10,0.98); flex-direction: column; padding: 2rem; gap: 1.5rem; border-bottom: 2px solid ${theme.primaryColor}; }
    .${s}-links.${s}-open { display: flex; }
    .${s}-cta { text-align: center; }
  }
</style>
<script>
(function(){
  var nav = document.querySelector('.${s}');
  function onScroll() { nav.classList.toggle('scrolled', window.scrollY > 80); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
</script>`;
  }
};
