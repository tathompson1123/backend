// ============================================
// SERVICES - 3 Column Cards with Images
// Premium card design with hover effects
// ============================================

module.exports = {
  id: 'services-cards-3col',
  name: 'Services Cards - 3 Column',
  category: 'services',
  description: 'Three column service cards with images, descriptions, and pricing',

  suitability: {
    autoDetailing: 0.9, landscaping: 0.9, cleaning: 0.9, hvac: 0.85,
    salonSpa: 0.9, fitness: 0.85, dental: 0.8, restaurant: 0.75,
    realEstate: 0.7, photography: 0.85, legal: 0.7, renovation: 0.9, petGrooming: 0.9,
  },
  mood: ['professional', 'clean', 'organized'],

  contentSchema: {
    title: { type: 'text', label: 'Section Title', default: 'Our Services' },
    subtitle: { type: 'textarea', label: 'Section Subtitle', default: '' },
    ctaText: { type: 'text', label: 'CTA Button Text', default: 'View All Services' },
    ctaLink: { type: 'url', label: 'CTA Button Link', default: '#contact' },
    services: {
      type: 'array',
      label: 'Services',
      itemSchema: {
        name: { type: 'text', label: 'Service Name' },
        description: { type: 'textarea', label: 'Description' },
        price: { type: 'text', label: 'Price' },
        image: { type: 'image', label: 'Image URL' },
        link: { type: 'url', label: 'Link' },
      },
    },
  },

  render(content, theme, sectionId = 'services') {
    const s = `section-${sectionId}`;
    const services = content.services || [];

    const servicesHtml = services.map((service, i) => `
      <div class="${s}-card" style="animation-delay: ${0.1 + i * 0.15}s">
        <div class="${s}-card-image">
          <img src="${service.image || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800'}" alt="${service.name}" loading="lazy">
          <div class="${s}-card-overlay"></div>
          ${service.price ? `<div class="${s}-card-price">${service.price}</div>` : ''}
        </div>
        <div class="${s}-card-content">
          <h3 class="${s}-card-title">${service.name || 'Service'}</h3>
          <p class="${s}-card-desc">${service.description || 'Description of this service.'}</p>
          <a href="${service.link || '#contact'}" class="${s}-card-link">
            Learn More
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
      </div>
    `).join('');

    return `
<section class="${s}" id="services" style="background: ${theme.bgColor || '#ffffff'};">
  <div class="${s}-container">
    <div class="${s}-header">
      <span class="${s}-label">What We Offer</span>
      <h2 class="${s}-title">${content.title || 'Our Services'}</h2>
      ${content.subtitle ? `<p class="${s}-subtitle">${content.subtitle}</p>` : ''}
    </div>
    
    <div class="${s}-grid">
      ${servicesHtml}
    </div>
    
    ${content.ctaText ? `
    <div class="${s}-cta">
      <a href="${content.ctaLink || '#contact'}" class="${s}-cta-btn">${content.ctaText}</a>
    </div>
    ` : ''}
  </div>
</section>
<style>
  .${s} {
    padding: 6rem 2rem;
    position: relative;
    overflow: hidden;
  }
  
  .${s}::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, ${theme.primaryColor}30, transparent);
  }
  
  .${s}-container {
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .${s}-header {
    text-align: center;
    margin-bottom: 4rem;
  }
  
  .${s}-label {
    display: inline-block;
    padding: 0.5rem 1rem;
    background: ${theme.primaryColor}15;
    color: ${theme.primaryColor};
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    border-radius: 50px;
    margin-bottom: 1rem;
  }
  
  .${s}-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 800;
    color: ${theme.textColor || '#1f2937'};
    margin-bottom: 1rem;
  }
  
  .${s}-subtitle {
    font-size: 1.125rem;
    color: ${theme.textMuted || '#6b7280'};
    max-width: 600px;
    margin: 0 auto;
    line-height: 1.7;
  }
  
  .${s}-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2rem;
  }
  
  .${s}-card {
    background: ${theme.surfaceColor || '#ffffff'};
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0;
    animation: ${s}-cardIn 0.6s ease-out forwards;
    border: 1px solid ${theme.borderAccent || 'rgba(0,0,0,0.05)'};
  }
  
  .${s}-card:hover {
    transform: translateY(-8px);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  }
  
  @keyframes ${s}-cardIn {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .${s}-card-image {
    position: relative;
    height: 220px;
    overflow: hidden;
  }
  
  .${s}-card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.6s ease;
  }
  
  .${s}-card:hover .${s}-card-image img {
    transform: scale(1.08);
  }
  
  .${s}-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 60%);
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .${s}-card:hover .${s}-card-overlay {
    opacity: 1;
  }
  
  .${s}-card-price {
    position: absolute;
    top: 1rem;
    right: 1rem;
    padding: 0.5rem 1rem;
    background: ${theme.primaryColor};
    color: #ffffff;
    font-weight: 700;
    font-size: 0.9rem;
    border-radius: 50px;
    box-shadow: 0 4px 15px ${theme.primaryColor}40;
  }
  
  .${s}-card-content {
    padding: 1.75rem;
  }
  
  .${s}-card-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.35rem;
    font-weight: 700;
    color: ${theme.textColor || '#1f2937'};
    margin-bottom: 0.75rem;
  }
  
  .${s}-card-desc {
    font-size: 0.95rem;
    color: ${theme.textMuted || '#6b7280'};
    line-height: 1.7;
    margin-bottom: 1.25rem;
  }
  
  .${s}-card-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: ${theme.primaryColor};
    font-weight: 600;
    font-size: 0.95rem;
    text-decoration: none;
    transition: gap 0.3s ease;
  }
  
  .${s}-card-link:hover {
    gap: 0.75rem;
  }
  
  .${s}-card-link svg {
    transition: transform 0.3s ease;
  }
  
  .${s}-card-link:hover svg {
    transform: translateX(4px);
  }
  
  .${s}-cta {
    text-align: center;
    margin-top: 3rem;
  }
  
  .${s}-cta-btn {
    display: inline-flex;
    align-items: center;
    padding: 1rem 2.5rem;
    background: linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor || theme.primaryColor});
    color: #ffffff;
    font-weight: 700;
    font-size: 1rem;
    text-decoration: none;
    border-radius: ${theme.buttonRadius || '8px'};
    transition: all 0.3s ease;
    box-shadow: 0 4px 20px ${theme.primaryColor}30;
  }
  
  .${s}-cta-btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 30px ${theme.primaryColor}50;
  }
  
  @media (max-width: 1024px) {
    .${s}-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  
  @media (max-width: 640px) {
    .${s} {
      padding: 4rem 1.5rem;
    }
    
    .${s}-grid {
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }
    
    .${s}-card-image {
      height: 200px;
    }
  }
</style>`;
  }
};
