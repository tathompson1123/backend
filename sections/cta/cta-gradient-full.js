// ============================================
// CTA - Full Width Gradient
// ============================================

module.exports = {
  id: 'cta-gradient-full',
  name: 'CTA - Full Width Gradient',
  category: 'cta',
  description: 'Full-width gradient CTA with badge, headline, buttons, and feature pills',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.85, fitness: 0.9, dental: 0.85, restaurant: 0.8,
    realEstate: 0.8, photography: 0.7, legal: 0.75, renovation: 0.9, petGrooming: 0.85,
  },
  mood: ['bold', 'friendly', 'clean'],

  contentSchema: {
    badge: { type: 'text', label: 'Badge Text (optional)', default: '' },
    headline: { type: 'text', label: 'Headline', default: 'Ready to Get Started?' },
    subtitle: { type: 'textarea', label: 'Subtitle', default: 'Contact us today for a free estimate.' },
    ctaText: { type: 'text', label: 'Primary Button Text', default: 'Get Started' },
    ctaLink: { type: 'url', label: 'Primary Button Link', default: '#contact' },
    ctaText2: { type: 'text', label: 'Secondary Button Text (optional)', default: '' },
    ctaLink2: { type: 'url', label: 'Secondary Button Link (optional)', default: '' },
    features: {
      type: 'array',
      label: 'Feature Pills (optional)',
      itemSchema: {
        text: { type: 'text', label: 'Feature Text', default: 'Feature' },
      }
    }
  },

  render(content, theme, sectionId = 'cta') {
    const s = `section-${sectionId}`;
    const badge = content.badge ? `<div class="${s}-badge">${content.badge}</div>` : '';
    const btn2 = content.ctaText2 ? `<a href="${content.ctaLink2 || '#'}" class="${s}-btn-secondary">${content.ctaText2}</a>` : '';
    const features = (content.features || []).map(f =>
      `<div class="${s}-feature">✓ ${f.text}</div>`
    ).join('\n');
    const featuresHtml = features ? `<div class="${s}-features">${features}</div>` : '';

    return `
<section class="${s}">
  ${badge}
  <h2>${content.headline || 'Ready to Get Started?'}</h2>
  <p class="${s}-subtitle">${content.subtitle || ''}</p>
  <div class="${s}-buttons">
    <a href="${content.ctaLink || '#'}" class="${s}-btn-primary">${content.ctaText || 'Get Started'}</a>
    ${btn2}
  </div>
  ${featuresHtml}
</section>
<style>
  .${s} {
    padding: 6rem 3rem;
    background: linear-gradient(135deg, ${theme.primaryColor} 0%, ${theme.accentColor} 100%);
    text-align: center;
    color: #ffffff;
    position: relative;
    padding-bottom: 6rem;
  }
  .${s}-badge {
    display: inline-block;
    background: rgba(255,255,255,0.2);
    padding: 0.5rem 1.5rem;
    border-radius: 50px;
    font-weight: 700;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 1.5rem;
  }
  .${s} h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 4rem;
    margin-bottom: 1.5rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .${s}-subtitle {
    font-size: 1.5rem;
    margin-bottom: 2rem;
    opacity: 0.95;
    max-width: 700px;
    margin-left: auto;
    margin-right: auto;
  }
  .${s}-buttons {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 2rem;
  }
  .${s}-btn-primary {
    background: #ffffff;
    color: ${theme.primaryColor};
    padding: 1.5rem 3.5rem;
    border-radius: ${theme.buttonRadius};
    text-decoration: none;
    font-weight: 800;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    display: inline-block;
    transition: transform 0.3s, box-shadow 0.3s;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  }
  .${s}-btn-primary:hover { transform: translateY(-3px); box-shadow: 0 15px 40px rgba(0,0,0,0.4); }
  .${s}-btn-secondary {
    color: #ffffff;
    padding: 1.5rem 3rem;
    border: 2px solid #ffffff;
    border-radius: ${theme.buttonRadius};
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    display: inline-block;
    transition: background 0.3s, transform 0.3s;
  }
  .${s}-btn-secondary:hover { background: rgba(255,255,255,0.1); transform: translateY(-3px); }
  .${s}-features {
    display: flex;
    gap: 3rem;
    justify-content: center;
    margin-top: 3rem;
    font-size: 1rem;
    opacity: 0.9;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    flex-wrap: wrap;
  }
  .${s}-feature { display: flex; align-items: center; gap: 0.5rem; }

  .${s}::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0; right: 0;
    width: 100%;
    height: 80px;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 80' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'%3E%3Cpath d='M 0,45 Q 300,15 600,45 T 1200,45 L 1200,80 L 0,80 Z' fill='${encodeURIComponent(theme.bgColor)}'/%3E%3C/svg%3E");
    background-size: 100% 100%;
    background-repeat: no-repeat;
  }

  @media (max-width: 768px) {
    .${s} h2 { font-size: 2.5rem; }
    .${s}-features { flex-direction: column; gap: 1rem; }
  }
</style>`;
  }
};
