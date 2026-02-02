// ============================================
// HERO - Fullscreen Dark with Background Image
// ============================================

module.exports = {
  id: 'hero-fullscreen-dark',
  name: 'Fullscreen Hero - Dark',
  category: 'hero',
  description: 'Full viewport hero with dark overlay, background image, and animated fade-in',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.85, cleaning: 0.7, hvac: 0.75,
    salonSpa: 0.7, fitness: 0.9, dental: 0.6, restaurant: 0.8,
    realEstate: 0.75, photography: 0.9, legal: 0.5, renovation: 0.85, petGrooming: 0.65,
  },
  mood: ['bold', 'luxury', 'rugged'],

  contentSchema: {
    headline: { type: 'text', label: 'Headline', default: 'Professional' },
    highlightText: { type: 'text', label: 'Highlight Word (colored)', default: 'Services' },
    subtitle: { type: 'textarea', label: 'Subtitle', default: 'Quality you can trust.' },
    ctaText: { type: 'text', label: 'Primary Button Text', default: 'Get Started' },
    ctaLink: { type: 'url', label: 'Primary Button Link', default: '#contact' },
    ctaText2: { type: 'text', label: 'Secondary Button Text (optional)', default: '' },
    ctaLink2: { type: 'url', label: 'Secondary Button Link (optional)', default: '#services' },
    backgroundImage: { type: 'image', label: 'Background Image', default: 'https://images.unsplash.com/photo-1619405399517-d7fce0f13302?w=1920' },
  },

  render(content, theme, sectionId = 'hero') {
    const s = `section-${sectionId}`;
    const bgImage = content.backgroundImage || 'https://images.unsplash.com/photo-1619405399517-d7fce0f13302?w=1920';
    const btn2 = content.ctaText2 ? `<a href="${content.ctaLink2 || '#'}" class="${s}-btn-secondary">${content.ctaText2}</a>` : '';

    return `
<section class="${s}">
  <div class="${s}-content">
    <h1>${content.headline || 'Professional'}<span class="${s}-highlight">${content.highlightText || 'Services'}</span></h1>
    <p>${content.subtitle || 'Quality you can trust.'}</p>
    <div class="${s}-buttons">
      <a href="${content.ctaLink || '#'}" class="${s}-btn-primary">${content.ctaText || 'Get Started'}</a>
      ${btn2}
    </div>
  </div>
</section>
<style>
  .${s} {
    min-height: 100vh;
    display: flex;
    align-items: center;
    background: linear-gradient(135deg, rgba(10,10,10,0.7), rgba(42,42,42,0.7)), url('${bgImage}') center/cover no-repeat;
    color: #ffffff;
    position: relative;
  }
  .${s}-content {
    max-width: 1400px;
    margin: 0 auto;
    padding: 8rem 3rem 6rem;
    position: relative;
    z-index: 1;
    text-align: center;
    opacity: 0;
    animation: ${s}-fadeIn 1s ease-out 0.3s forwards;
  }
  .${s} h1 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 5rem;
    font-weight: 800;
    line-height: 1.1;
    margin-bottom: 2rem;
    text-transform: uppercase;
    letter-spacing: 3px;
  }
  .${s}-highlight {
    color: ${theme.primaryColor};
    display: block;
  }
  .${s} p {
    font-size: 1.4rem;
    margin-bottom: 3rem;
    max-width: 700px;
    margin-left: auto;
    margin-right: auto;
    opacity: 0.95;
  }
  .${s}-buttons {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .${s}-btn-primary {
    background: ${theme.primaryColor};
    color: #ffffff;
    padding: 1.25rem 3rem;
    border-radius: ${theme.buttonRadius};
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    display: inline-block;
  }
  .${s}-btn-primary:hover { transform: scale(1.05); box-shadow: 0 10px 30px ${theme.borderAccentHover}; }
  .${s}-btn-secondary {
    color: #ffffff;
    padding: 1.25rem 3rem;
    border: 2px solid #ffffff;
    border-radius: ${theme.buttonRadius};
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    transition: background 0.3s, transform 0.3s;
    display: inline-block;
  }
  .${s}-btn-secondary:hover { background: rgba(255,255,255,0.1); transform: translateY(-3px); }

  .${s}::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    width: 100%;
    height: 100px;
    background: ${theme.surfaceColor};
    clip-path: ellipse(150% 100% at 50% 100%);
  }

  @keyframes ${s}-fadeIn {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 768px) {
    .${s} h1 { font-size: 3rem; }
    .${s}-content { padding: 6rem 1.5rem 4rem; }
  }
</style>`;
  }
};
