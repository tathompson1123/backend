// ============================================
// CTA - Full Width Gradient
// Premium call-to-action section
// ============================================

module.exports = {
  id: 'cta-gradient-full',
  name: 'CTA - Full Width Gradient',
  category: 'cta',
  description: 'Full width call-to-action with gradient background',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.95, cleaning: 0.95, hvac: 0.95,
    salonSpa: 0.9, fitness: 0.95, dental: 0.9, restaurant: 0.9,
    realEstate: 0.9, photography: 0.85, legal: 0.85, renovation: 0.95, petGrooming: 0.95,
  },
  mood: ['urgent', 'action-oriented', 'bold'],

  render(content, theme, sectionId = 'cta') {
    const s = `section-${sectionId}`;
    const features = content.features || [];
    const featuresHtml = features.map(f => `
      <div class="${s}-feature">✓ ${f.text}</div>
    `).join('');

    return `
<section class="${s}">
  <div class="${s}-bg"></div>
  <div class="${s}-content">
    ${content.badge ? `<div class="${s}-badge">${content.badge}</div>` : ''}
    <h2 class="${s}-headline">${content.headline || 'Ready to Get Started?'}</h2>
    <p class="${s}-subtitle">${content.subtitle || 'Take the first step today.'}</p>
    <div class="${s}-buttons">
      <a href="${content.ctaLink || '#contact'}" class="${s}-btn-primary">${content.ctaText || 'Get Started'}</a>
      ${content.ctaText2 ? `<a href="${content.ctaLink2 || '#'}" class="${s}-btn-secondary">${content.ctaText2}</a>` : ''}
    </div>
    ${features.length > 0 ? `<div class="${s}-features">${featuresHtml}</div>` : ''}
  </div>
</section>
<style>
  .${s} {
    position: relative;
    padding: 6rem 2rem;
    overflow: hidden;
  }
  
  .${s}-bg {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, ${theme.primaryColor} 0%, ${theme.accentColor || theme.primaryColor} 100%);
    z-index: 0;
  }
  
  .${s}-bg::before {
    content: '';
    position: absolute;
    inset: 0;
    background: 
      radial-gradient(circle at 20% 80%, rgba(255,255,255,0.1) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(255,255,255,0.1) 0%, transparent 50%);
  }
  
  .${s}-content {
    position: relative;
    z-index: 1;
    max-width: 800px;
    margin: 0 auto;
    text-align: center;
    color: #ffffff;
  }
  
  .${s}-badge {
    display: inline-block;
    padding: 0.5rem 1.25rem;
    background: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(10px);
    border-radius: 50px;
    font-size: 0.85rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 1.5rem;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }
  
  .${s}-headline {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 800;
    margin-bottom: 1rem;
    line-height: 1.2;
  }
  
  .${s}-subtitle {
    font-size: 1.25rem;
    opacity: 0.95;
    margin-bottom: 2rem;
    line-height: 1.6;
  }
  
  .${s}-buttons {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 2rem;
  }
  
  .${s}-btn-primary {
    display: inline-flex;
    align-items: center;
    padding: 1rem 2.5rem;
    background: #ffffff;
    color: ${theme.primaryColor};
    font-weight: 700;
    font-size: 1rem;
    text-decoration: none;
    border-radius: ${theme.buttonRadius || '8px'};
    transition: all 0.3s ease;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  }
  
  .${s}-btn-primary:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
  }
  
  .${s}-btn-secondary {
    display: inline-flex;
    align-items: center;
    padding: 1rem 2rem;
    background: transparent;
    color: #ffffff;
    font-weight: 600;
    font-size: 1rem;
    text-decoration: none;
    border: 2px solid rgba(255, 255, 255, 0.5);
    border-radius: ${theme.buttonRadius || '8px'};
    transition: all 0.3s ease;
  }
  
  .${s}-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: #ffffff;
    transform: translateY(-3px);
  }
  
  .${s}-features {
    display: flex;
    gap: 2rem;
    justify-content: center;
    flex-wrap: wrap;
    padding-top: 1rem;
  }
  
  .${s}-feature {
    font-size: 0.95rem;
    font-weight: 600;
    opacity: 0.95;
  }
  
  @media (max-width: 640px) {
    .${s} {
      padding: 4rem 1.5rem;
    }
    
    .${s}-buttons {
      flex-direction: column;
      align-items: center;
    }
    
    .${s}-btn-primary,
    .${s}-btn-secondary {
      width: 100%;
      max-width: 280px;
      justify-content: center;
    }
    
    .${s}-features {
      flex-direction: column;
      gap: 0.75rem;
    }
  }
</style>`;
  }
};
