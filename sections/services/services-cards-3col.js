// ============================================
// SERVICES - 3 Column Cards with Images
// ============================================

module.exports = {
  id: 'services-cards-3col',
  name: 'Service Cards - 3 Column',
  category: 'services',
  description: '3-column service cards with images, descriptions, and pricing',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.9, cleaning: 0.85, hvac: 0.85,
    salonSpa: 0.9, fitness: 0.8, dental: 0.85, restaurant: 0.75,
    realEstate: 0.7, photography: 0.85, legal: 0.65, renovation: 0.9, petGrooming: 0.9,
  },
  mood: ['bold', 'luxury', 'clean'],

  contentSchema: {
    title: { type: 'text', label: 'Section Title', default: 'Our Services' },
    ctaText: { type: 'text', label: 'CTA Button Text (below cards)', default: 'View All Services' },
    ctaLink: { type: 'url', label: 'CTA Button Link', default: '#contact' },
    services: {
      type: 'array',
      label: 'Services',
      itemSchema: {
        name: { type: 'text', label: 'Service Name', default: 'Service' },
        description: { type: 'textarea', label: 'Description', default: 'Professional service description.' },
        price: { type: 'text', label: 'Price (e.g. "From $299")', default: 'Contact for pricing' },
        image: { type: 'image', label: 'Image', default: 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=600' },
        link: { type: 'url', label: 'Link', default: '#contact' },
      }
    }
  },

  render(content, theme, sectionId = 'svc') {
    const s = `section-${sectionId}`;
    const services = content.services || [];

    const cardsHtml = services.map((svc, i) => `
      <div class="${s}-card" style="animation-delay: ${0.1 + (i * 0.2)}s">
        <div class="${s}-image">
          <img src="${svc.image || 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=600'}" alt="${svc.name}" loading="lazy">
        </div>
        <div class="${s}-body">
          <h3>${svc.name}</h3>
          <p>${svc.description || ''}</p>
          <div class="${s}-price"><a href="${svc.link || '#'}">${svc.price || 'Contact for pricing'}</a></div>
        </div>
      </div>
    `).join('\n');

    const ctaHtml = content.ctaText ? `
      <div class="${s}-cta-wrap">
        <a href="${content.ctaLink || '#'}" class="${s}-cta-btn">${content.ctaText}</a>
      </div>` : '';

    return `
<section class="${s}" style="background: ${theme.bgColor};">
  <div class="${s}-header">
    <h2>${content.title || 'Our Services'}</h2>
  </div>
  <div class="${s}-grid">
    ${cardsHtml}
  </div>
  ${ctaHtml}
</section>
<style>
  .${s} {
    padding: 6rem 3rem;
    position: relative;
    padding-top: 1rem;
    padding-bottom: 6rem;
  }
  .${s}-header { text-align: center; margin-bottom: 3.5rem; }
  .${s}-header h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 3.5rem;
    font-weight: 800;
    color: ${theme.textColor};
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .${s}-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }
  .${s}-card {
    background: ${theme.surfaceColor};
    border-radius: ${theme.borderRadius};
    overflow: hidden;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    border: 1px solid ${theme.borderAccent};
    opacity: 0;
    animation: ${s}-cardIn 0.8s ease-out forwards;
  }
  @keyframes ${s}-cardIn {
    from { opacity: 0; transform: translateY(50px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .${s}-card:hover {
    transform: translateY(-10px);
    box-shadow: 0 20px 60px ${theme.borderAccentHover};
  }
  .${s}-image {
    height: 250px;
    overflow: hidden;
    position: relative;
  }
  .${s}-image::after {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: linear-gradient(to bottom, transparent, ${theme.bgColor}cc);
  }
  .${s}-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease;
  }
  .${s}-card:hover .${s}-image img { transform: scale(1.05); }
  .${s}-body { padding: 2.5rem; }
  .${s}-body h3 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1.8rem;
    color: ${theme.textColor};
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .${s}-body p {
    margin-bottom: 1.5rem;
    color: ${theme.textMuted};
  }
  .${s}-price {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1.8rem;
    font-weight: 700;
    color: ${theme.primaryColor};
  }
  .${s}-price a {
    color: ${theme.primaryColor};
    text-decoration: none;
    transition: color 0.3s, transform 0.3s;
    display: inline-block;
  }
  .${s}-price a:hover { color: ${theme.textColor}; transform: scale(1.05); }

  .${s}-cta-wrap { text-align: center; margin-top: 4rem; }
  .${s}-cta-btn {
    background: ${theme.primaryColor};
    color: #ffffff;
    padding: 1.25rem 3rem;
    border-radius: ${theme.buttonRadius};
    text-decoration: none;
    font-weight: 800;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    display: inline-block;
    transition: transform 0.3s, box-shadow 0.3s;
    animation: ${s}-pulse 2s ease-in-out infinite;
  }
  @keyframes ${s}-pulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 ${theme.borderAccentHover}; }
    50% { transform: scale(1.05); box-shadow: 0 0 0 15px transparent; }
  }

  @media (max-width: 768px) {
    .${s}-grid { grid-template-columns: 1fr; }
    .${s}-header h2 { font-size: 2.5rem; }
  }
</style>`;
  }
};
