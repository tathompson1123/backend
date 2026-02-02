// ============================================
// SERVICES - 3 Column Cards with Images
// Extracted from: auto-detailing-template/index.html
// ============================================

module.exports = {
  id: 'services-cards-3col',
  name: 'Service Cards - 3 Column',
  category: 'services',
  description: '3-column service cards with images, descriptions, and pricing',

  contentSchema: {
    title: { type: 'text', label: 'Section Title' },
    ctaText: { type: 'text', label: 'CTA Button Text (below cards)' },
    ctaLink: { type: 'url', label: 'CTA Button Link' },
    services: {
      type: 'array',
      label: 'Services',
      itemSchema: {
        name: { type: 'text', label: 'Service Name' },
        description: { type: 'textarea', label: 'Description' },
        price: { type: 'text', label: 'Price (e.g. "From $299")' },
        image: { type: 'image', label: 'Image' },
        link: { type: 'url', label: 'Link' },
      }
    }
  },

  render(content, theme) {
    const services = content.services || [];

    const cardsHtml = services.map((s, i) => `
      <div class="svc-card" style="animation-delay: ${0.1 + (i * 0.2)}s">
        <div class="svc-image">
          <img src="${s.image || 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=600'}" alt="${s.name}" loading="lazy">
        </div>
        <div class="svc-content">
          <h3>${s.name}</h3>
          <p>${s.description || ''}</p>
          <div class="svc-price"><a href="${s.link || '#'}">${s.price || 'Contact for pricing'}</a></div>
        </div>
      </div>
    `).join('\n');

    const ctaHtml = content.ctaText ? `
      <div class="svc-cta-wrap">
        <a href="${content.ctaLink || '#'}" class="svc-cta-btn">${content.ctaText}</a>
      </div>` : '';

    return `
<section class="services-section" style="background: ${theme.bgColor};">
  <div class="svc-header">
    <h2>${content.title || 'Our Services'}</h2>
  </div>
  <div class="svc-grid">
    ${cardsHtml}
  </div>
  ${ctaHtml}
</section>
<style>
  .services-section {
    padding: 6rem 3rem;
    position: relative;
    padding-top: 1rem;
    padding-bottom: 6rem;
  }
  .svc-header {
    text-align: center;
    margin-bottom: 3.5rem;
  }
  .svc-header h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 3.5rem;
    font-weight: 800;
    color: ${theme.textColor};
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .svc-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }
  .svc-card {
    background: ${theme.surfaceColor};
    border-radius: ${theme.borderRadius};
    overflow: hidden;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    border: 1px solid ${theme.borderAccent};
    opacity: 0;
    animation: svcCardIn 0.8s ease-out forwards;
  }
  @keyframes svcCardIn {
    from { opacity: 0; transform: translateY(50px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .svc-card:hover {
    transform: translateY(-10px);
    box-shadow: 0 20px 60px ${theme.borderAccentHover};
  }
  .svc-image {
    height: 250px;
    overflow: hidden;
    position: relative;
  }
  .svc-image::after {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: linear-gradient(to bottom, transparent, ${theme.bgColor}cc);
  }
  .svc-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease;
  }
  .svc-card:hover .svc-image img { transform: scale(1.05); }
  .svc-content {
    padding: 2.5rem;
  }
  .svc-content h3 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1.8rem;
    color: ${theme.textColor};
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .svc-content p {
    margin-bottom: 1.5rem;
    color: ${theme.textMuted};
  }
  .svc-price {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1.8rem;
    font-weight: 700;
    color: ${theme.primaryColor};
  }
  .svc-price a {
    color: ${theme.primaryColor};
    text-decoration: none;
    transition: color 0.3s, transform 0.3s;
    display: inline-block;
  }
  .svc-price a:hover { color: ${theme.textColor}; transform: scale(1.05); }

  .svc-cta-wrap {
    text-align: center;
    margin-top: 4rem;
  }
  .svc-cta-btn {
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
    animation: svcPulse 2s ease-in-out infinite;
  }
  @keyframes svcPulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 ${theme.borderAccentHover}; }
    50% { transform: scale(1.05); box-shadow: 0 0 0 15px transparent; }
  }

  @media (max-width: 768px) {
    .svc-grid { grid-template-columns: 1fr; }
    .svc-header h2 { font-size: 2.5rem; }
  }
</style>`;
  }
};
