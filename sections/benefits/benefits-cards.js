// ============================================
// BENEFITS - Cards
// 3-column grid with watermark icons and gradient icon boxes
// ============================================

module.exports = {
  id: 'benefits-cards',
  name: 'Benefits Cards',
  category: 'benefits',
  description: 'Three-column benefit cards with watermark and gradient icon boxes',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.85, fitness: 0.9, dental: 0.9, restaurant: 0.75,
    realEstate: 0.85, photography: 0.8, legal: 0.85, renovation: 0.9, petGrooming: 0.85,
  },
  mood: ['professional', 'trust', 'clean'],

  contentSchema: {
    title:    { type: 'text', label: 'Section Title',   default: 'Why Choose Us' },
    subtitle: { type: 'text', label: 'Subtitle',        default: '' },
    benefits: {
      type: 'array', label: 'Benefits',
      itemSchema: {
        icon:        { type: 'text', label: 'Icon Emoji',   default: '✓' },
        title:       { type: 'text', label: 'Title',        default: 'Benefit' },
        description: { type: 'text', label: 'Description',  default: 'Description text' },
      }
    },
  },

  render(content, theme, sectionId = 'benefits') {
    const s = `section-${sectionId}`;
    const benefits = content.benefits || [];

    const cardsHtml = benefits.map((b, i) => `
      <div class="${s}-card reveal" style="transition-delay:${i * 0.15}s;">
        <span class="${s}-watermark">${b.icon || '✓'}</span>
        <div class="${s}-icon-box">
          <span class="${s}-icon">${b.icon || '✓'}</span>
        </div>
        <h3 class="${s}-card-title">${b.title || 'Benefit'}</h3>
        <p class="${s}-card-desc">${b.description || ''}</p>
      </div>
    `).join('');

    return `
<section class="${s}" style="background:${theme.bgColor || '#020617'};">
  <div class="${s}-glow-accent"></div>
  <div class="${s}-container">
    <div class="${s}-header reveal">
      <h2 class="${s}-heading">${content.title || 'Why Choose Us'}</h2>
      ${content.subtitle ? `<p class="${s}-sub">${content.subtitle}</p>` : ''}
    </div>
    <div class="${s}-grid">
      ${cardsHtml}
    </div>
  </div>
</section>
<style>
  .${s} {
    padding: 6rem 2rem;
    position: relative;
    overflow: hidden;
  }
  .${s}-glow-accent {
    position: absolute;
    top: -100px;
    right: -100px;
    width: 500px;
    height: 500px;
    background: ${theme.primaryColor}0d;
    filter: blur(80px);
    border-radius: 50%;
    pointer-events: none;
  }
  .${s}-container {
    max-width: 1100px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }
  .${s}-header {
    text-align: center;
    margin-bottom: 3.5rem;
  }
  .${s}-heading {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 800;
    color: ${theme.textColor || '#ffffff'};
  }
  .${s}-sub {
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    font-size: 1.05rem;
    margin-top: 0.75rem;
  }
  .${s}-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
  }
  .${s}-card {
    position: relative;
    background: rgba(255,255,255,0.05);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 20px;
    padding: 2.5rem 2rem 2rem;
    overflow: hidden;
    transition: border-color 0.3s;
  }
  .${s}-card:hover {
    border-color: ${theme.primaryColor}80;
  }
  .${s}-watermark {
    position: absolute;
    top: 12px;
    right: 16px;
    font-size: 100px;
    opacity: 0.05;
    line-height: 1;
    transition: opacity 0.3s;
    pointer-events: none;
  }
  .${s}-card:hover .${s}-watermark {
    opacity: 0.1;
  }
  .${s}-icon-box {
    width: 56px;
    height: 56px;
    background: linear-gradient(135deg, ${theme.primaryColor}33, transparent);
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.25rem;
    transition: transform 0.3s;
  }
  .${s}-card:hover .${s}-icon-box {
    transform: scale(1.1);
  }
  .${s}-icon {
    font-size: 1.75rem;
    color: ${theme.primaryColor};
  }
  .${s}-card-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.25rem;
    font-weight: 800;
    color: ${theme.textColor || '#ffffff'};
    margin-bottom: 0.6rem;
  }
  .${s}-card-desc {
    font-size: 0.92rem;
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    line-height: 1.6;
    margin: 0;
  }
  @media (max-width: 768px) {
    .${s}-grid {
      grid-template-columns: 1fr;
      max-width: 440px;
      margin: 0 auto;
    }
  }
</style>`;
  }
};
