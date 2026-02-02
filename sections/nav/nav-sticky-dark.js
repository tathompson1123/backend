// ============================================
// NAV - Sticky Dark
// Extracted from: auto-detailing-template
// ============================================

module.exports = {
  id: 'nav-sticky-dark',
  name: 'Sticky Dark Navigation',
  category: 'nav',
  description: 'Dark sticky navigation with logo, links, and CTA button',

  contentSchema: {
    logo: { type: 'text', label: 'Logo Text' },
    links: {
      type: 'array',
      label: 'Nav Links',
      itemSchema: {
        text: { type: 'text', label: 'Link Text' },
        url: { type: 'url', label: 'Link URL' },
      }
    },
    ctaText: { type: 'text', label: 'CTA Button Text' },
    ctaLink: { type: 'url', label: 'CTA Button Link' },
  },

  render(content, theme) {
    const links = content.links || [];
    const linksHtml = links.map(l =>
      `<a href="${l.url || '#'}">${l.text}</a>`
    ).join('\n');

    return `
<nav class="site-nav">
  <div class="nav-container">
    <a href="#" class="logo">${content.logo || 'Business Name'}</a>
    <div class="nav-links">
      ${linksHtml}
      <a href="${content.ctaLink || '#'}" class="nav-cta">${content.ctaText || 'Book Now'}</a>
    </div>
    <button class="mobile-menu-btn" onclick="document.querySelector('.nav-links').classList.toggle('nav-open')">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
<style>
  .site-nav { background: rgba(10, 10, 10, 0.95); padding: 1.5rem 0; position: sticky; top: 0; z-index: 1000; backdrop-filter: blur(10px); border-bottom: 1px solid ${theme.borderAccent}; }
  .nav-container { max-width: 1400px; margin: 0 auto; padding: 0 3rem; display: flex; justify-content: space-between; align-items: center; }
  .logo { font-family: '${theme.headingFont}', sans-serif; font-size: 1.8rem; font-weight: 800; color: ${theme.primaryColor}; text-transform: uppercase; letter-spacing: 2px; text-decoration: none; }
  .nav-links { display: flex; gap: 3rem; align-items: center; }
  .nav-links a { color: #ffffff; text-decoration: none; font-weight: 600; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 1px; transition: color 0.3s; }
  .nav-links a:hover { color: ${theme.primaryColor}; }
  .nav-cta { background: ${theme.primaryColor} !important; color: #ffffff !important; padding: 0.875rem 2rem !important; border-radius: ${theme.buttonRadius}; font-weight: 700 !important; transition: transform 0.3s, box-shadow 0.3s !important; }
  .nav-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 25px ${theme.borderAccentHover}; }
  .mobile-menu-btn { display: none; background: none; border: none; cursor: pointer; padding: 0.5rem; flex-direction: column; gap: 5px; }
  .mobile-menu-btn span { display: block; width: 25px; height: 2px; background: #ffffff; transition: 0.3s; }

  @media (max-width: 768px) {
    .nav-container { padding: 0 1.5rem; }
    .mobile-menu-btn { display: flex; }
    .nav-links { display: none; position: absolute; top: 100%; left: 0; right: 0; background: rgba(10,10,10,0.98); flex-direction: column; padding: 2rem; gap: 1.5rem; border-bottom: 2px solid ${theme.primaryColor}; }
    .nav-links.nav-open { display: flex; }
    .nav-cta { text-align: center; }
  }
</style>`;
  }
};
