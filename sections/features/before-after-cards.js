// ============================================
// FEATURES - Before & After Cards
// Click-toggle transformation cards showing before/after states
// ============================================

module.exports = {
  id: 'before-after-cards',
  name: 'Before & After Cards',
  category: 'features',
  description: 'Three-column grid of click-toggle cards revealing before and after states',

  suitability: {
    landscaping: 0.98, renovation: 0.98, cleaning: 0.8, salonSpa: 0.7,
    restaurant: 0.4, autoDetailing: 0.85, fitness: 0.3, dental: 0.35,
    realEstate: 0.75, photography: 0.6, legal: 0.15, hvac: 0.6, petGrooming: 0.5,
  },
  mood: ['visual', 'interactive', 'transformative'],

  contentSchema: {
    title:    { type: 'text', label: 'Section Title', default: 'Our Transformations' },
    subtitle: { type: 'text', label: 'Subtitle',      default: 'Click each card to reveal the transformation' },
    cards: {
      type: 'array',
      label: 'Transformation Cards',
      itemSchema: {
        title:       { type: 'text',  label: 'Card Title',   default: 'Backyard' },
        description: { type: 'text',  label: 'Description',  default: '' },
        beforeImage: { type: 'image', label: 'Before Image', default: '' },
        afterImage:  { type: 'image', label: 'After Image',  default: '' },
      }
    },
  },

  render(content, theme, sectionId = 'beforeafter') {
    const s = `section-${sectionId}`;
    const cards = content.cards || [];

    const cardsHtml = cards.map((card, i) => `
      <div class="${s}-card" onclick="this.classList.toggle('${s}-flipped')" data-index="${i}">
        <div class="${s}-before">
          <img src="${card.beforeImage || ''}" alt="Before - ${card.title || ''}" loading="lazy">
          <span class="${s}-label ${s}-label-before">Before</span>
        </div>
        <div class="${s}-after">
          <img src="${card.afterImage || ''}" alt="After - ${card.title || ''}" loading="lazy">
          <span class="${s}-label ${s}-label-after">After</span>
        </div>
        <div class="${s}-card-info">
          <h3 class="${s}-card-title">${card.title || ''}</h3>
          ${card.description ? `<p class="${s}-card-desc">${card.description}</p>` : ''}
        </div>
        <span class="${s}-tap-hint">Tap to reveal</span>
      </div>
    `).join('');

    return `
<section class="${s}" style="background:${theme.bgColor || '#faf8f5'};">
  <div class="${s}-container">
    <div class="${s}-header reveal">
      <h2 class="${s}-heading">${content.title || 'Our Transformations'}</h2>
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
  }
  .${s}-container {
    max-width: 1100px;
    margin: 0 auto;
  }
  .${s}-header {
    text-align: center;
    margin-bottom: 3rem;
  }
  .${s}-heading {
    font-family: '${theme.headingFont || 'Cormorant Garamond'}', serif;
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 700;
    color: ${theme.textColor || '#1b2216'};
    margin-bottom: 0.75rem;
  }
  .${s}-sub {
    color: ${theme.textMuted || 'rgba(27,34,22,0.65)'};
    font-size: 1rem;
  }
  .${s}-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
  }
  .${s}-card {
    position: relative;
    border-radius: 18px;
    overflow: hidden;
    cursor: pointer;
    aspect-ratio: 3 / 4;
    box-shadow: 0 6px 24px rgba(27, 34, 22, 0.12);
    transition: transform 0.3s, box-shadow 0.3s;
  }
  .${s}-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 36px rgba(27, 34, 22, 0.18);
  }
  .${s}-before,
  .${s}-after {
    position: absolute;
    inset: 0;
    transition: opacity 0.5s ease;
  }
  .${s}-before img,
  .${s}-after img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .${s}-after {
    opacity: 0;
  }
  .${s}-card.${s}-flipped .${s}-before { opacity: 0; }
  .${s}-card.${s}-flipped .${s}-after  { opacity: 1; }
  .${s}-label {
    position: absolute;
    top: 14px;
    left: 14px;
    padding: 0.35rem 0.85rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    border-radius: 50px;
    color: #fff;
    z-index: 2;
    transition: opacity 0.4s;
  }
  .${s}-label-before {
    background: rgba(27, 34, 22, 0.7);
  }
  .${s}-label-after {
    background: ${theme.primaryColor || '#6b8f5e'};
    opacity: 0;
  }
  .${s}-card.${s}-flipped .${s}-label-before { opacity: 0; }
  .${s}-card.${s}-flipped .${s}-label-after  { opacity: 1; }
  .${s}-card-info {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 1.5rem 1.25rem 1rem;
    background: linear-gradient(to top, rgba(27, 34, 22, 0.85) 0%, transparent 100%);
    z-index: 2;
  }
  .${s}-card-title {
    font-family: '${theme.headingFont || 'Cormorant Garamond'}', serif;
    font-size: 1.2rem;
    font-weight: 700;
    color: #fff;
    margin: 0 0 0.2rem;
  }
  .${s}-card-desc {
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.75);
    margin: 0;
    line-height: 1.4;
  }
  .${s}-tap-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(255, 255, 255, 0.92);
    color: ${theme.textColor || '#1b2216'};
    padding: 0.5rem 1rem;
    border-radius: 50px;
    font-size: 0.78rem;
    font-weight: 600;
    z-index: 3;
    opacity: 1;
    transition: opacity 0.4s;
    pointer-events: none;
    letter-spacing: 0.3px;
  }
  .${s}-card.${s}-flipped .${s}-tap-hint { opacity: 0; }
  .${s}-card:hover .${s}-tap-hint { opacity: 0; }
  @media (max-width: 768px) {
    .${s}-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }
  }
  @media (max-width: 500px) {
    .${s}-grid {
      grid-template-columns: 1fr;
      max-width: 380px;
      margin: 0 auto;
    }
  }
</style>`;
  }
};
