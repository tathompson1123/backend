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
    ctaText: { type: 'text', label: 'CTA Button Text', default: 'Book Online' },
    ctaLink: { type: 'url', label: 'CTA Button Link', default: '#book-online' },
  },

  render(content, theme, sectionId = 'nav') {
    const s = `section-${sectionId}`;
    const links = content.links || [];
    const linksHtml = links.map(l =>
      `<a href="${l.url || '#'}">${l.text}</a>`
    ).join('\n');
    const logoContent = content.logoImage
      ? `<img src="${content.logoImage}" alt="${content.logo || 'Logo'}" class="${s}-logo-img" />`
      : (content.logo || 'Business Name');

    return `
<nav class="${s}">
  <div class="${s}-container">
    <a href="#" class="${s}-logo">${logoContent}</a>
    <div class="${s}-links">
      ${linksHtml}
      <a href="${content.ctaLink || '#book-online'}" class="${s}-cta">${content.ctaText || 'Book Online'}</a>
    </div>
    <button class="${s}-mobile" onclick="document.querySelector('.${s}-links').classList.toggle('${s}-open')">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
<style>
  .${s} { background: transparent; padding: 1.5rem 0; position: fixed; top: 0; left: 0; right: 0; z-index: 1000; transition: background 0.4s, backdrop-filter 0.4s, border-color 0.4s, box-shadow 0.4s; border-bottom: 1px solid transparent; }
  .${s}.scrolled { background: ${theme.bgColor ? theme.bgColor + 'f5' : 'rgba(10,10,10,0.95)'}; backdrop-filter: blur(12px); border-bottom-color: ${theme.borderAccent}; box-shadow: 0 1px 16px rgba(0,0,0,0.08); }
  .${s}-container { max-width: 1400px; margin: 0 auto; padding: 0 3rem; display: flex; justify-content: space-between; align-items: center; }
  .${s}-logo { font-family: '${theme.headingFont}', sans-serif; font-size: 1.8rem; font-weight: 800; color: #ffffff; text-transform: uppercase; letter-spacing: 2px; text-decoration: none; transition: color 0.4s; }
  .${s}.scrolled .${s}-logo { color: ${content.logoColor || theme.primaryColor}; }
  .${s}-logo-img { height: ${content.logoHeight || 40}px; max-width: 180px; object-fit: contain; display: block; }
  .${s}-links { display: flex; gap: 3rem; align-items: center; }
  .${s}-links a { color: #ffffff; text-decoration: none; font-weight: 600; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 1px; transition: color 0.3s; }
  .${s}.scrolled .${s}-links a { color: ${theme.textColor || '#1f2937'}; }
  .${s}-links a:hover { color: ${theme.primaryColor}; }
  .${s}.scrolled .${s}-links a:hover { color: ${theme.primaryColor}; }
  .${s}-cta { background: ${theme.primaryColor} !important; color: #ffffff !important; padding: 0.875rem 2rem !important; border-radius: ${theme.buttonRadius}; font-weight: 700 !important; transition: transform 0.3s, box-shadow 0.3s !important; }
  .${s}-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 25px ${theme.primaryColor}40; }
  .${s}-mobile { display: none; background: none; border: none; cursor: pointer; padding: 0.5rem; flex-direction: column; gap: 5px; }
  .${s}-mobile span { display: block; width: 25px; height: 2px; background: #ffffff; transition: background 0.4s; }
  .${s}.scrolled .${s}-mobile span { background: ${theme.textColor || '#1f2937'}; }

  @media (max-width: 768px) {
    .${s} { padding: 0.875rem 0; background: linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%); }
    .${s}.scrolled { background: ${theme.bgColor ? theme.bgColor + 'f5' : 'rgba(10,10,10,0.95)'}; }
    .${s}-container { padding: 0 1.25rem; min-height: 56px; overflow: hidden; }
    .${s}-logo { font-size: 1.15rem; letter-spacing: 1px; flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 0.75rem; }
    .${s}-mobile { display: flex; flex-shrink: 0; }
    .${s}-links { display: none; position: absolute; top: 100%; left: 0; right: 0; background: ${theme.bgColor ? theme.bgColor + 'fa' : 'rgba(10,10,10,0.98)'}; flex-direction: column; padding: 2rem; gap: 1.5rem; border-bottom: 2px solid ${theme.primaryColor}; }
    .${s}-links.${s}-open { display: flex; }
    .${s}-cta { text-align: center; }
  }
</style>
<script>
(function(){
  var nav = document.querySelector('.${s}');
  // If no hero section on this page, start in scrolled mode so text is visible on light backgrounds
  var hasHero = !!document.querySelector('[class*="hero"]');
  function onScroll() { nav.classList.toggle('scrolled', !hasHero || window.scrollY > 80); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  // Book Online handler: open Sorce booking widget if available
  nav.addEventListener('click', function(e) {
    var a = e.target.closest('a[href="#book-online"]');
    if (a) {
      e.preventDefault();
      if (window.__sorceOpenBooking) { window.__sorceOpenBooking(); }
      else if (document.querySelector('.sorce-chat-fab')) { document.querySelector('.sorce-chat-fab').click(); }
      else { var c = document.getElementById('contact'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }
    }
  });
})();
</script>`;
  }
};
