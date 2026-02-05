// ============================================
// FEATURES - Split Image CTA
// Full-width 2-col: image with overlay left, content + checklist right
// ============================================

module.exports = {
  id: 'split-image-cta',
  name: 'Split Image CTA',
  category: 'features',
  description: 'Two-column split: full-bleed image with color overlay on left, checklist and CTA on right',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.85, cleaning: 0.8, hvac: 0.8,
    salonSpa: 0.85, fitness: 0.85, dental: 0.75, restaurant: 0.75,
    realEstate: 0.9, photography: 0.88, legal: 0.7, renovation: 0.88, petGrooming: 0.75,
  },
  mood: ['action', 'premium', 'conversion'],

  contentSchema: {
    image:       { type: 'url',  label: 'Image URL',     default: '' },
    imageAlt:    { type: 'text', label: 'Image Alt',     default: 'Featured image' },
    headline:    { type: 'text', label: 'Headline',      default: 'Restore Factory Glory' },
    body:        { type: 'text', label: 'Body Text',     default: '' },
    checkpoints: { type: 'array', label: 'Checkpoints',  itemSchema: { type: 'text' } },
    ctaText:     { type: 'text', label: 'CTA Button',    default: 'Book Now' },
    ctaLink:     { type: 'url',  label: 'CTA Link',      default: '#contact' },
  },

  render(content, theme, sectionId = 'splitcta') {
    const s = `section-${sectionId}`;
    const checkpoints = content.checkpoints || [];

    const checksHtml = checkpoints.map(cp => `
      <div class="${s}-checkpoint">
        <span class="${s}-cp-icon">✓</span>
        <span class="${s}-cp-text">${cp}</span>
      </div>
    `).join('');

    return `
<section class="${s}">
  <div class="${s}-grid">
    <div class="${s}-image-wrap reveal">
      <img src="${content.image || ''}" alt="${content.imageAlt || 'Featured image'}" class="${s}-img" loading="lazy">
      <div class="${s}-overlay"></div>
    </div>
    <div class="${s}-content reveal" style="background:${theme.surfaceColor || '#0f172a'}; transition-delay:0.15s;">
      <h2 class="${s}-headline">${content.headline || 'Restore Factory Glory'}</h2>
      ${content.body ? `<p class="${s}-body">${content.body}</p>` : ''}
      <div class="${s}-checkpoints">
        ${checksHtml}
      </div>
      <a href="${content.ctaLink || '#contact'}" class="${s}-cta">${content.ctaText || 'Book Now'}</a>
    </div>
  </div>
</section>
<style>
  .${s} {
    width: 100%;
  }
  .${s}-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: 600px;
  }
  .${s}-image-wrap {
    position: relative;
    overflow: hidden;
  }
  .${s}-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .${s}-overlay {
    position: absolute;
    inset: 0;
    background: ${theme.primaryColor}33;
    mix-blend-mode: multiply;
    pointer-events: none;
  }
  .${s}-content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 5rem 4rem;
  }
  .${s}-headline {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 3.5vw, 2.75rem);
    font-weight: 900;
    color: ${theme.textColor || '#ffffff'};
    line-height: 1.15;
    margin-bottom: 1.25rem;
  }
  .${s}-body {
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    font-size: 1rem;
    line-height: 1.7;
    margin-bottom: 1.75rem;
  }
  .${s}-checkpoints {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    margin-bottom: 2.25rem;
  }
  .${s}-checkpoint {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .${s}-cp-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: ${theme.primaryColor}20;
    border: 2px solid ${theme.primaryColor};
    color: ${theme.primaryColor};
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.85rem;
    flex-shrink: 0;
  }
  .${s}-cp-text {
    color: ${theme.textColor || '#ffffff'};
    font-size: 0.95rem;
    font-weight: 500;
  }
  .${s}-cta {
    display: inline-block;
    align-self: flex-start;
    padding: 0.9rem 2.25rem;
    border: 2px solid ${theme.primaryColor};
    color: ${theme.primaryColor};
    border-radius: ${theme.buttonRadius || '50px'};
    font-weight: 700;
    font-size: 0.95rem;
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 1px;
    transition: background 0.3s, color 0.3s;
  }
  .${s}-cta:hover {
    background: ${theme.primaryColor};
    color: #ffffff;
  }
  @media (max-width: 900px) {
    .${s}-grid {
      grid-template-columns: 1fr;
    }
    .${s}-image-wrap {
      min-height: 350px;
    }
    .${s}-content {
      padding: 3rem 2rem;
    }
  }
</style>`;
  }
};
