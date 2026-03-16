// ============================================
// FEATURES - Importance Split
// 2-column: text + highlights left, image with glow right
// ============================================

module.exports = {
  id: 'importance-split',
  name: 'Importance Split',
  category: 'features',
  description: 'Two-column section with text/highlights on left and glowing image on right',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.85, cleaning: 0.8, hvac: 0.75,
    salonSpa: 0.8, fitness: 0.85, dental: 0.7, restaurant: 0.7,
    realEstate: 0.8, photography: 0.85, legal: 0.65, renovation: 0.85, petGrooming: 0.75,
  },
  mood: ['informational', 'trust', 'premium'],

  contentSchema: {
    badge:      { type: 'text', label: 'Badge Text',     default: 'Why It Matters' },
    headline:   { type: 'text', label: 'Headline',       default: 'Protect Your Investment' },
    body1:      { type: 'text', label: 'First Paragraph', default: '' },
    body2:      { type: 'text', label: 'Second Paragraph', default: '' },
    highlights: {
      type: 'array', label: 'Highlight Points',
      itemSchema: {
        icon: { type: 'text', label: 'Icon', default: '✓' },
        text: { type: 'text', label: 'Text', default: 'Highlight' },
      }
    },
    image:      { type: 'url',  label: 'Image URL',      default: '' },
    imageAlt:   { type: 'text', label: 'Image Alt Text', default: 'Feature image' },
  },

  render(content, theme, sectionId = 'importance') {
    const s = `section-${sectionId}`;
    const highlights = content.highlights || [];
    const imgLeft = content.imagePosition === 'left';

    const highlightsHtml = highlights.map(h => `
      <div class="${s}-highlight">
        <span class="${s}-highlight-icon">${h.icon || '✓'}</span>
        <span class="${s}-highlight-text">${h.text || ''}</span>
      </div>
    `).join('');

    const textBlock = `
    <div class="${s}-left reveal">
      <span class="${s}-badge">${content.badge || 'Why It Matters'}</span>
      <h2 class="${s}-headline">${content.headline || 'Protect Your Investment'}</h2>
      ${content.body1 ? `<p class="${s}-body">${content.body1}</p>` : ''}
      ${content.body2 ? `<p class="${s}-body">${content.body2}</p>` : ''}
      <div class="${s}-highlights">
        ${highlightsHtml}
      </div>
    </div>`;

    const imageBlock = `
    <div class="${s}-right reveal" style="transition-delay:0.15s;">
      <div class="${s}-glow"></div>
      <img src="${content.image || ''}" alt="${content.imageAlt || 'Feature image'}" class="${s}-image" loading="lazy">
    </div>`;

    return `
<section class="${s}" style="background:${theme.bgColor || '#020617'};">
  <div class="${s}-container">
    ${imgLeft ? imageBlock + textBlock : textBlock + imageBlock}
  </div>
</section>
<style>
  .${s} {
    padding: 6rem 2rem;
  }
  .${s}-container {
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5rem;
    align-items: center;
  }
  .${s}-badge {
    display: inline-block;
    padding: 0.4rem 1rem;
    background: ${theme.primaryColor}20;
    color: ${theme.primaryColor};
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 3px;
    border-radius: 50px;
    margin-bottom: 1.25rem;
  }
  .${s}-headline {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 900;
    color: ${theme.textColor || '#ffffff'};
    line-height: 1.15;
    margin-bottom: 1.5rem;
  }
  .${s}-body {
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    font-size: 1rem;
    line-height: 1.7;
    margin-bottom: 1rem;
  }
  .${s}-highlights {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-top: 2rem;
  }
  .${s}-highlight {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
  }
  .${s}-highlight-icon {
    font-size: 1.25rem;
    color: ${theme.primaryColor};
    font-weight: 700;
  }
  .${s}-highlight-text {
    color: ${theme.textColor || '#ffffff'};
    font-weight: 600;
    font-size: 0.9rem;
  }
  .${s}-right {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .${s}-glow {
    position: absolute;
    inset: -20px;
    background: ${theme.primaryColor}33;
    filter: blur(40px);
    border-radius: 24px;
    z-index: 0;
  }
  .${s}-image {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 420px;
    object-fit: cover;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 25px 50px rgba(0,0,0,0.4);
  }
  @media (max-width: 900px) {
    .${s}-container {
      grid-template-columns: 1fr;
      gap: 3rem;
    }
    .${s}-right {
      order: -1;
    }
    .${s}-image {
      height: 300px;
    }
  }
  @media (max-width: 600px) {
    .${s} {
      padding: 4rem 1.5rem;
    }
    .${s}-highlights {
      grid-template-columns: 1fr;
    }
  }
</style>`;
  }
};
