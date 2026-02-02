// ============================================
// FEATURES - Icon Row
// ============================================

module.exports = {
  id: 'features-icon-row',
  name: 'Features - Icon Row',
  category: 'features',
  description: '4-column icon feature bar with animated slide-in',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.85, fitness: 0.85, dental: 0.9, restaurant: 0.8,
    realEstate: 0.85, photography: 0.7, legal: 0.8, renovation: 0.9, petGrooming: 0.85,
  },
  mood: ['bold', 'clean', 'friendly', 'rugged'],

  contentSchema: {
    features: {
      type: 'array',
      label: 'Features',
      itemSchema: {
        icon: { type: 'text', label: 'Icon (emoji)', default: '✓' },
        title: { type: 'text', label: 'Title', default: 'Feature' },
        text: { type: 'text', label: 'Description', default: 'Description here' },
      }
    }
  },

  render(content, theme, sectionId = 'feat') {
    const s = `section-${sectionId}`;
    const features = content.features || [
      { icon: '✓', title: 'Quality', text: 'Top-tier service' },
      { icon: '⚡', title: 'Fast', text: 'Quick turnaround' },
      { icon: '💎', title: 'Premium', text: 'Best products' },
      { icon: '★', title: 'Guaranteed', text: '100% satisfaction' },
    ];

    const featuresHtml = features.map((f, i) => `
      <div class="${s}-item" style="animation-delay: ${0.1 + (i * 0.1)}s">
        <div class="${s}-icon">${f.icon}</div>
        <h3>${f.title}</h3>
        <p>${f.text}</p>
      </div>
    `).join('\n');

    return `
<section class="${s}" style="background: ${theme.surfaceColor};">
  <div class="${s}-grid">
    ${featuresHtml}
  </div>
</section>
<style>
  .${s} {
    padding: 0 3rem;
    position: relative;
    padding-top: 0;
    padding-bottom: 7rem;
  }
  .${s}-grid {
    max-width: 1400px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 3rem;
  }
  .${s}-item {
    text-align: center;
    opacity: 0;
    animation: ${s}-slideIn 0.6s ease-out forwards;
  }
  @keyframes ${s}-slideIn {
    from { opacity: 0; transform: translateX(-80px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .${s}-icon {
    width: 80px;
    height: 80px;
    background: ${theme.borderAccent};
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 1.5rem;
    font-size: 2rem;
    color: ${theme.primaryColor};
    border: 2px solid ${theme.primaryColor};
  }
  .${s}-item h3 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1.4rem;
    margin-bottom: 0.75rem;
    color: ${theme.primaryColor};
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .${s}-item p {
    font-size: 1rem;
    color: ${theme.textMuted};
  }

  .${s}::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    width: 100%;
    height: 80px;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 80' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'%3E%3Cpath d='M 0,30 Q 200,0 400,30 T 800,30 Q 1000,0 1200,30 L 1200,80 L 0,80 Z' fill='${encodeURIComponent(theme.bgColor)}'/%3E%3C/svg%3E");
    background-size: 100% 100%;
    background-repeat: no-repeat;
  }

  @media (max-width: 768px) {
    .${s}-grid { grid-template-columns: repeat(2, 1fr); gap: 2rem; }
  }
</style>`;
  }
};
