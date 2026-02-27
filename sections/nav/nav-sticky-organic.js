// ============================================
// NAV - Sticky Organic
// Light cream nav with moss accents, scroll-aware backdrop blur
// ============================================

module.exports = {
  id: 'nav-sticky-organic',
  name: 'Sticky Organic Navigation',
  category: 'nav',
  description: 'Light cream navigation with moss green accents and scroll-aware backdrop blur',

  suitability: {
    landscaping: 0.95, salonSpa: 0.7, restaurant: 0.6, realEstate: 0.65,
    photography: 0.6, legal: 0.55, autoDetailing: 0.3, fitness: 0.3,
    dental: 0.5, cleaning: 0.5, hvac: 0.4, renovation: 0.6, petGrooming: 0.5,
  },
  mood: ['organic', 'elegant', 'natural'],

  contentSchema: {
    logo: { type: 'text', label: 'Logo Text', default: 'Business Name' },
    links: {
      type: 'array',
      label: 'Nav Links',
      itemSchema: {
        text: { type: 'text', label: 'Link Text', default: 'Link' },
        url:  { type: 'url',  label: 'Link URL',  default: '#' },
      }
    },
    ctaText: { type: 'text', label: 'CTA Button Text', default: 'Get a Quote' },
    ctaLink: { type: 'url',  label: 'CTA Button Link', default: '#contact' },
  },

  render(content, theme, sectionId = 'nav') {
    const s = `section-${sectionId}`;
    const links = content.links || [];
    const linksHtml = links.map(l =>
      `<a href="${l.url || '#'}" class="${s}-link">${l.text || 'Link'}</a>`
    ).join('\n      ');

    return `
<nav class="${s}">
  <div class="${s}-inner">
    <a href="#" class="${s}-logo">${content.logo || 'Business Name'}</a>
    <div class="${s}-links" id="${s}-links">
      ${linksHtml}
      <a href="${content.ctaLink || '#contact'}" class="${s}-cta">${content.ctaText || 'Get a Quote'}</a>
    </div>
    <button class="${s}-burger" onclick="document.getElementById('${s}-links').classList.toggle('${s}-open')" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
<style>
  .${s} {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    padding: 1.25rem 0;
    transition: background 0.4s, box-shadow 0.4s, padding 0.4s;
    background: transparent;
  }
  .${s}.scrolled {
    background: rgba(250, 248, 245, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 1px 12px rgba(27, 34, 22, 0.08);
    padding: 0.75rem 0;
  }
  .${s}-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .${s}-logo {
    font-family: '${theme.headingFont || 'Cormorant Garamond'}', serif;
    font-size: 1.7rem;
    font-weight: 700;
    color: ${theme.textColor || '#1b2216'};
    text-decoration: none;
    letter-spacing: 0.5px;
  }
  .${s}-links {
    display: flex;
    align-items: center;
    gap: 2rem;
  }
  .${s}-link {
    font-size: 0.9rem;
    font-weight: 600;
    color: ${theme.textColor || '#1b2216'};
    text-decoration: none;
    letter-spacing: 0.3px;
    transition: color 0.25s;
    position: relative;
  }
  .${s}-link::after {
    content: '';
    position: absolute;
    bottom: -3px;
    left: 0;
    right: 0;
    height: 2px;
    background: ${theme.primaryColor || '#6b8f5e'};
    transform: scaleX(0);
    transition: transform 0.25s;
    border-radius: 1px;
  }
  .${s}-link:hover { color: ${theme.primaryColor || '#6b8f5e'}; }
  .${s}-link:hover::after { transform: scaleX(1); }
  .${s}-cta {
    padding: 0.6rem 1.6rem;
    background: ${theme.primaryColor || '#6b8f5e'};
    color: #fff;
    border-radius: 50px;
    font-size: 0.88rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s;
    letter-spacing: 0.3px;
  }
  .${s}-cta:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 16px ${theme.primaryColor || '#6b8f5e'}40;
  }
  .${s}-burger {
    display: none;
    flex-direction: column;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.5rem;
  }
  .${s}-burger span {
    display: block;
    width: 24px;
    height: 2px;
    background: ${theme.textColor || '#1b2216'};
    border-radius: 1px;
    transition: 0.3s;
  }
  @media (max-width: 768px) {
    .${s} { padding: 0.875rem 0; }
    .${s}-inner { padding: 0 1.25rem; min-height: 56px; }
    .${s}-logo { font-size: 1.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: calc(100vw - 80px); }
    .${s}-burger { display: flex; }
    .${s}-links {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: rgba(250, 248, 245, 0.97);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      flex-direction: column;
      padding: 1.5rem 2rem;
      gap: 1rem;
      box-shadow: 0 8px 24px rgba(27, 34, 22, 0.1);
      align-items: flex-start;
    }
    .${s}-links.${s}-open { display: flex; }
    .${s}-cta { margin-top: 0.25rem; }
  }
</style>
<script>
(function(){
  var nav = document.querySelector('.${s}');
  function onScroll() { nav.classList.toggle('scrolled', window.scrollY > 60); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
</script>`;
  }
};
