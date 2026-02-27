// ============================================
// GALLERY - Masonry Full Width
// CSS columns masonry layout with hover caption pills
// Designed for photography portfolios — no lightbox, pure visual impact
// ============================================

module.exports = {
  id: 'gallery-masonry-full-width',
  name: 'Gallery Masonry (Full Width)',
  category: 'gallery',
  description: 'Full-width CSS columns masonry gallery with hover caption pills — editorial photography style',

  suitability: {
    photography: 0.99, salonSpa: 0.82, restaurant: 0.78, realEstate: 0.72,
    autoDetailing: 0.6, landscaping: 0.7, cleaning: 0.3, hvac: 0.2,
    fitness: 0.62, dental: 0.38, legal: 0.2, renovation: 0.65, petGrooming: 0.6,
  },
  mood: ['editorial', 'visual', 'luxury'],

  contentSchema: {
    eyebrow: { type: 'text',  label: 'Eyebrow Label (e.g. Portfolio)',  default: 'Portfolio' },
    title:   { type: 'text',  label: 'Section Title',                   default: 'Recent Work' },
    ctaText: { type: 'text',  label: 'CTA Button Text (leave blank to hide)', default: 'View Full Portfolio' },
    ctaLink: { type: 'url',   label: 'CTA Button Link',                 default: '/portfolio' },
    items: {
      type: 'array', label: 'Gallery Items',
      itemSchema: {
        url:     { type: 'url',  label: 'Image URL', default: '' },
        caption: { type: 'text', label: 'Caption',   default: 'Photo' },
      }
    },
  },

  render(content, theme, sectionId = 'masonry') {
    const s = `section-${sectionId}`;
    const items = content.items || [];

    const itemsHtml = items.map((item) => `
      <div class="${s}-item">
        <img src="${item.url || ''}" alt="${item.caption || 'Gallery image'}" loading="lazy">
        <div class="${s}-hover">
          <span class="${s}-caption">${item.caption || ''}</span>
        </div>
      </div>`).join('');

    const ctaHtml = content.ctaText
      ? `<div class="${s}-footer reveal">
          <a href="${content.ctaLink || '/portfolio'}" class="${s}-cta">${content.ctaText}</a>
        </div>`
      : '';

    return `
<section class="${s}">
  <div class="${s}-header reveal">
    <span class="${s}-eyebrow">${content.eyebrow || 'Portfolio'}</span>
    <h2 class="${s}-title">${content.title || 'Recent Work'}</h2>
  </div>
  <div class="${s}-grid">
    ${itemsHtml}
  </div>
  ${ctaHtml}
</section>
<style>
  .${s} {
    padding: 6rem 0;
    background: ${theme.bgColor || '#faf9f6'};
  }
  .${s}-header {
    text-align: center;
    margin-bottom: 4rem;
    padding: 0 1.5rem;
  }
  .${s}-eyebrow {
    display: block;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: ${theme.textMuted || 'rgba(28,25,23,0.5)'};
    margin-bottom: 0.75rem;
  }
  .${s}-title {
    font-family: '${theme.headingFont || 'Cormorant Garamond'}', serif;
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: 400;
    color: ${theme.textColor || '#1c1917'};
    margin: 0;
  }
  .${s}-grid {
    column-count: 4;
    column-gap: 1rem;
    padding: 0 1rem;
  }
  .${s}-item {
    position: relative;
    break-inside: avoid;
    margin-bottom: 1rem;
    overflow: hidden;
    background: ${theme.surfaceColor || '#e8e6e1'};
    cursor: pointer;
  }
  .${s}-item img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: cover;
    transition: transform 1s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .${s}-item:hover img {
    transform: scale(1.05);
  }
  .${s}-hover {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: background 0.5s ease, opacity 0.5s ease;
  }
  .${s}-item:hover .${s}-hover {
    background: rgba(255, 255, 255, 0.2);
    opacity: 1;
  }
  .${s}-caption {
    background: rgba(255, 255, 255, 0.92);
    color: ${theme.textColor || '#1c1917'};
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.68rem;
    padding: 0.6rem 1.5rem;
    border-radius: 50px;
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.1);
    transform: translateY(14px);
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
    white-space: nowrap;
  }
  .${s}-item:hover .${s}-caption {
    transform: translateY(0);
  }
  .${s}-footer {
    text-align: center;
    margin-top: 5rem;
    padding: 0 1.5rem;
  }
  .${s}-cta {
    display: inline-block;
    padding: 1.1rem 2.75rem;
    border: 1px solid ${theme.borderAccent || 'rgba(28,25,23,0.3)'};
    color: ${theme.textColor || '#1c1917'};
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    text-decoration: none;
    transition: background 0.25s ease, color 0.25s ease;
    border-radius: ${theme.buttonRadius || '0px'};
  }
  .${s}-cta:hover {
    background: ${theme.textColor || '#1c1917'};
    color: ${theme.bgColor || '#faf9f6'};
  }
  @media (max-width: 1200px) {
    .${s}-grid { column-count: 3; }
  }
  @media (max-width: 768px) {
    .${s}-grid { column-count: 2; column-gap: 0.75rem; padding: 0 0.75rem; }
    .${s}-item { margin-bottom: 0.75rem; }
  }
  @media (max-width: 480px) {
    .${s}-grid { column-count: 2; column-gap: 0.5rem; padding: 0 0.5rem; }
    .${s}-item { margin-bottom: 0.5rem; }
  }
</style>`;
  }
};
