// ============================================
// FEATURES - Icon Row
// Premium feature cards in a row
// ============================================

module.exports = {
  id: 'features-icon-row',
  name: 'Features - Icon Row',
  category: 'features',
  description: 'Horizontal row of feature cards with icons',

  suitability: {
    autoDetailing: 0.9, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.85, fitness: 0.9, dental: 0.85, restaurant: 0.8,
    realEstate: 0.85, photography: 0.8, legal: 0.85, renovation: 0.9, petGrooming: 0.9,
  },
  mood: ['professional', 'trustworthy', 'organized'],

  contentSchema: {
    features: {
      type: 'array',
      label: 'Features',
      itemSchema: {
        icon: { type: 'text', label: 'Icon (emoji)' },
        title: { type: 'text', label: 'Title' },
        text: { type: 'textarea', label: 'Description' },
      },
    },
  },

  render(content, theme, sectionId = 'features') {
    const s = `section-${sectionId}`;
    const features = content.features || [];

    const featuresHtml = features.map((f, i) => `
      <div class="${s}-card" style="animation-delay: ${0.1 + i * 0.1}s">
        <div class="${s}-icon">${f.icon || '⭐'}</div>
        <h3 class="${s}-title">${f.title || 'Feature'}</h3>
        <p class="${s}-text">${f.text || 'Description'}</p>
      </div>
    `).join('');

    return `
<section class="${s}" style="background: ${theme.surfaceColor || '#f9fafb'};">
  <div class="${s}-container">
    <div class="${s}-grid">
      ${featuresHtml}
    </div>
  </div>
</section>
<style>
  .${s} {
    padding: 4rem 2rem;
    position: relative;
  }
  
  .${s}::before,
  .${s}::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, ${theme.primaryColor}20, transparent);
  }
  
  .${s}::before { top: 0; }
  .${s}::after { bottom: 0; }
  
  .${s}-container {
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .${s}-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2rem;
  }
  
  .${s}-card {
    text-align: center;
    padding: 1.5rem;
    opacity: 0;
    animation: ${s}-fadeIn 0.6s ease-out forwards;
  }
  
  @keyframes ${s}-fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .${s}-icon {
    width: 70px;
    height: 70px;
    margin: 0 auto 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    background: linear-gradient(135deg, ${theme.primaryColor}15, ${theme.primaryColor}05);
    border: 2px solid ${theme.primaryColor}30;
    border-radius: 16px;
    transition: all 0.3s ease;
  }
  
  .${s}-card:hover .${s}-icon {
    transform: scale(1.1) rotate(5deg);
    border-color: ${theme.primaryColor};
    background: ${theme.primaryColor}20;
  }
  
  .${s}-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.1rem;
    font-weight: 700;
    color: ${theme.textColor || '#1f2937'};
    margin-bottom: 0.5rem;
  }
  
  .${s}-text {
    font-size: 0.9rem;
    color: ${theme.textMuted || '#6b7280'};
    line-height: 1.6;
  }
  
  @media (max-width: 900px) {
    .${s}-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  
  @media (max-width: 500px) {
    .${s} {
      padding: 3rem 1.5rem;
    }
    
    .${s}-grid {
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }
  }
</style>`;
  }
};
