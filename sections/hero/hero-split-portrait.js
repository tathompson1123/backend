// ============================================
// HERO - Split Portrait
// Two-column hero: text left, asymmetric portrait right
// Optional full-bleed background image at low opacity
// ============================================

module.exports = {
  id: 'hero-split-portrait',
  name: 'Hero - Split Portrait',
  category: 'hero',
  description: 'Two-column hero with text content left and organic blob-shaped portrait image right',

  suitability: {
    landscaping: 0.95, salonSpa: 0.85, restaurant: 0.75, realEstate: 0.8,
    photography: 0.9, legal: 0.6, autoDetailing: 0.5, fitness: 0.45,
    dental: 0.6, cleaning: 0.55, hvac: 0.5, renovation: 0.7, petGrooming: 0.6,
  },
  mood: ['organic', 'elegant', 'warm', 'natural'],

  contentSchema: {
    badge:          { type: 'text',     label: 'Badge Text (above headline)',    default: '' },
    headline:       { type: 'text',     label: 'Headline',                       default: 'Crafting Beautiful' },
    highlightText:  { type: 'text',     label: 'Highlight Word (italic color)',  default: 'Landscapes' },
    subtitle:       { type: 'textarea', label: 'Subtitle',                       default: 'We transform outdoor spaces into living works of art.' },
    ctaText:        { type: 'text',     label: 'Primary CTA',                    default: 'Get a Free Quote' },
    ctaLink:        { type: 'url',      label: 'Primary CTA Link',              default: '#contact' },
    ctaText2:       { type: 'text',     label: 'Secondary CTA',                 default: 'View Our Work' },
    ctaLink2:       { type: 'url',      label: 'Secondary CTA Link',            default: '#gallery' },
    portraitImage:  { type: 'image',    label: 'Portrait Image',                default: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800' },
    bgImage:        { type: 'image',    label: 'Background Image (low opacity overlay)', default: '' },
    floatBadge:     { type: 'text',     label: 'Floating Badge Number (e.g. "25+")', default: '' },
    floatBadgeLabel:{ type: 'text',     label: 'Floating Badge Label',          default: 'Years Experience' },
  },

  render(content, theme, sectionId = 'hero') {
    const s = `section-${sectionId}`;
    const hasBg = !!content.bgImage;
    const hasFloat = !!content.floatBadge;

    return `
<section class="${s}">
  ${hasBg ? `<div class="${s}-bg"><img src="${content.bgImage}" alt="" class="${s}-bg-img"></div>` : ''}
  <div class="${s}-overlay"></div>
  <div class="${s}-container">
    <div class="${s}-content">
      ${content.badge ? `<span class="${s}-badge">${content.badge}</span>` : ''}
      <h1 class="${s}-headline">
        ${content.headline || 'Crafting Beautiful'}<br>
        <span class="${s}-highlight">${content.highlightText || 'Landscapes'}</span>
      </h1>
      <p class="${s}-subtitle">${content.subtitle || ''}</p>
      <div class="${s}-buttons">
        <a href="${content.ctaLink || '#contact'}" class="${s}-btn-primary">${content.ctaText || 'Get a Free Quote'}</a>
        ${content.ctaText2 ? `<a href="${content.ctaLink2 || '#'}" class="${s}-btn-secondary">${content.ctaText2}</a>` : ''}
      </div>
    </div>
    <div class="${s}-portrait-wrap">
      <img src="${content.portraitImage || ''}" alt="" class="${s}-portrait" loading="lazy">
      ${hasFloat ? `
      <div class="${s}-float-badge">
        <span class="${s}-float-num">${content.floatBadge}</span>
        <span class="${s}-float-label">${content.floatBadgeLabel || 'Years'}</span>
      </div>` : ''}
    </div>
  </div>
</section>
<style>
  .${s} {
    position: relative;
    min-height: 100vh;
    background: ${theme.bgColor || '#faf8f5'};
    overflow: hidden;
    display: flex;
    align-items: center;
  }
  .${s}-bg {
    position: absolute;
    inset: 0;
    opacity: 0.25;
    z-index: 0;
    overflow: hidden;
  }
  .${s}-bg-img {
    width: 100%;
    height: 100% !important;
    object-fit: cover;
  }
  .${s}-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, ${theme.bgColor || '#faf8f5'}70 0%, transparent 65%);
    z-index: 1;
  }
  .${s}-container {
    position: relative;
    z-index: 2;
    max-width: 1200px;
    margin: 0 auto;
    padding: 7rem 2rem 6rem;
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 4rem;
    align-items: center;
    width: 100%;
  }
  .${s}-badge {
    display: inline-block;
    padding: 0.45rem 1.1rem;
    background: ${theme.primaryColor || '#6b8f5e'}18;
    border: 1px solid ${theme.primaryColor || '#6b8f5e'}30;
    color: ${theme.primaryColor || '#6b8f5e'};
    border-radius: 50px;
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 1.5rem;
  }
  .${s}-headline {
    font-family: '${theme.headingFont || 'Cormorant Garamond'}', serif;
    font-size: clamp(2.8rem, 6vw, 4.2rem);
    font-weight: 700;
    line-height: 1.1;
    color: ${theme.textColor || '#1b2216'};
    margin-bottom: 1.25rem;
  }
  .${s}-highlight {
    color: ${theme.primaryColor || '#6b8f5e'};
    font-style: italic;
  }
  .${s}-subtitle {
    font-size: 1.1rem;
    line-height: 1.75;
    color: ${theme.textMuted || 'rgba(27,34,22,0.65)'};
    max-width: 480px;
    margin-bottom: 2.25rem;
  }
  .${s}-buttons {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .${s}-btn-primary {
    padding: 0.85rem 2rem;
    background: ${theme.primaryColor || '#6b8f5e'};
    color: #fff;
    border-radius: 50px;
    font-size: 0.95rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s;
    letter-spacing: 0.3px;
  }
  .${s}-btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px ${theme.primaryColor || '#6b8f5e'}40;
  }
  .${s}-btn-secondary {
    padding: 0.85rem 2rem;
    border: 2px solid ${theme.textColor || '#1b2216'};
    color: ${theme.textColor || '#1b2216'};
    border-radius: 50px;
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .${s}-btn-secondary:hover {
    background: ${theme.textColor || '#1b2216'};
    color: #fff;
  }
  .${s}-portrait-wrap {
    position: relative;
  }
  .${s}-portrait {
    width: 100%;
    aspect-ratio: 4 / 5;
    object-fit: cover;
    border-radius: 60% 40% 55% 45% / 50% 60% 40% 50%;
    box-shadow: 0 30px 60px rgba(27, 34, 22, 0.15);
  }
  .${s}-float-badge {
    position: absolute;
    bottom: 8%;
    left: -8%;
    background: #fff;
    border-radius: 16px;
    padding: 1rem 1.25rem;
    box-shadow: 0 8px 30px rgba(27, 34, 22, 0.15);
    text-align: center;
    min-width: 110px;
  }
  .${s}-float-num {
    display: block;
    font-family: '${theme.headingFont || 'Cormorant Garamond'}', serif;
    font-size: 2rem;
    font-weight: 700;
    color: ${theme.primaryColor || '#6b8f5e'};
    line-height: 1;
  }
  .${s}-float-label {
    display: block;
    font-size: 0.78rem;
    color: ${theme.textMuted || 'rgba(27,34,22,0.65)'};
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 0.3rem;
  }
  @media (max-width: 900px) {
    .${s}-container {
      grid-template-columns: 1fr;
      text-align: center;
      padding: 7rem 2rem 5rem;
    }
    .${s}-content { order: 1; }
    .${s}-portrait-wrap { order: 2; max-width: 380px; margin: 0 auto; }
    .${s}-subtitle { max-width: 100%; }
    .${s}-buttons { justify-content: center; }
  }
  @media (max-width: 600px) {
    .${s}-container { padding: 8rem 1.5rem 4rem; }
    .${s}-float-badge { position: relative; bottom: auto; left: auto; margin: 1rem auto 0; }
  }
</style>`;
  }
};
