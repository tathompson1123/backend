// ============================================
// FEATURES - Icon Row
// Extracted from: auto-detailing-template/index.html
// ============================================

module.exports = {
  id: 'features-icon-row',
  name: 'Features - Icon Row',
  category: 'features',
  description: '4-column icon feature bar with animated slide-in',

  contentSchema: {
    features: {
      type: 'array',
      label: 'Features',
      itemSchema: {
        icon: { type: 'text', label: 'Icon (emoji)' },
        title: { type: 'text', label: 'Title' },
        text: { type: 'text', label: 'Description' },
      }
    }
  },

  render(content, theme) {
    const features = content.features || [
      { icon: '✓', title: 'Quality', text: 'Top-tier service' },
      { icon: '⚡', title: 'Fast', text: 'Quick turnaround' },
      { icon: '💎', title: 'Premium', text: 'Best products' },
      { icon: '★', title: 'Guaranteed', text: '100% satisfaction' },
    ];

    const featuresHtml = features.map((f, i) => `
      <div class="feat-item" style="animation-delay: ${0.1 + (i * 0.1)}s">
        <div class="feat-icon">${f.icon}</div>
        <h3>${f.title}</h3>
        <p>${f.text}</p>
      </div>
    `).join('\n');

    return `
<section class="features-row" style="background: ${theme.surfaceColor};">
  <div class="features-grid">
    ${featuresHtml}
  </div>
</section>
<style>
  .features-row {
    padding: 0 3rem;
    position: relative;
    padding-top: 0;
    padding-bottom: 7rem;
  }
  .features-grid {
    max-width: 1400px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 3rem;
  }
  .feat-item {
    text-align: center;
    opacity: 0;
    animation: featSlideIn 0.6s ease-out forwards;
  }
  @keyframes featSlideIn {
    from { opacity: 0; transform: translateX(-80px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .feat-icon {
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
  .feat-item h3 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1.4rem;
    margin-bottom: 0.75rem;
    color: ${theme.primaryColor};
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .feat-item p {
    font-size: 1rem;
    color: ${theme.textMuted};
  }

  .features-row::after {
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
    .features-grid { grid-template-columns: repeat(2, 1fr); gap: 2rem; }
  }
</style>`;
  }
};
