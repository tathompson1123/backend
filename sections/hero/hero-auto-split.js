// ============================================
// HERO - Auto Detailing Split
// Dark overlay text left, staggered car images right
// Styled for auto detailing: amber/gold accents, zinc dark tones
// ============================================

module.exports = {
  id: 'hero-auto-split',
  name: 'Hero - Auto Detailing Split',
  category: 'hero',
  description: 'Two-column hero with dark overlay text left and staggered car images right, floating years/trust badge',

  suitability: {
    'auto-detailing': 1.0, 'auto-wrap': 0.9, 'automotive': 0.8, 'car-wash': 0.7,
  },
  mood: ['premium', 'bold', 'professional'],

  contentSchema: {
    badge:          { type: 'text',     label: 'Badge Text (above headline)',        default: 'Premium Auto Detailing' },
    headline:       { type: 'text',     label: 'Headline',                           default: 'Your Car, Perfectly' },
    highlightText:  { type: 'text',     label: 'Highlight Word (colored)',           default: 'Detailed' },
    subtitle:       { type: 'textarea', label: 'Subtitle',                           default: 'Trusted by car enthusiasts and everyday drivers for showroom-quality results.' },
    ctaText:        { type: 'text',     label: 'Primary CTA',                        default: 'Book Your Detail' },
    ctaLink:        { type: 'url',      label: 'Primary CTA Link',                  default: '#contact' },
    ctaText2:       { type: 'text',     label: 'Secondary CTA',                     default: 'View Our Work' },
    ctaLink2:       { type: 'url',      label: 'Secondary CTA Link',                default: '#gallery' },
    backgroundImage:{ type: 'image',    label: 'Background Image (full section)',    default: 'https://images.unsplash.com/photo-1552519507-da3b142a6f3e?w=1920&q=80' },
    heroImage1:     { type: 'image',    label: 'Main Side Image (large)',           default: 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=600&q=80' },
    heroImage2:     { type: 'image',    label: 'Inset Side Image (smaller)',        default: 'https://images.unsplash.com/photo-1616455579100-2ceaa4eb2d37?w=600&q=80' },
    yearsText:      { type: 'text',     label: 'Years Badge (e.g. "12+ Years")',    default: '10+ Years' },
    locationText:   { type: 'text',     label: 'Location for Badge',                default: 'Serving Your Area' },
  },

  render(content, theme, sectionId = 'hero') {
    const s = `section-${sectionId}`;
    const primary = theme.primaryColor || '#d97706';
    const accent  = theme.accentColor  || primary;
    const bgImage = content.backgroundImage || '';
    const img1    = content.heroImage1 || '';
    const img2    = content.heroImage2 || '';
    const overlayVal = content.overlayOpacity !== undefined ? Math.min(Math.max(Number(content.overlayOpacity), 0), 100) / 100 : 1;
    const years   = content.yearsText   || '10+ Years';
    const location = content.locationText || 'Serving Your Area';

    return `
<section class="${s}" id="hero">
  ${bgImage ? `<img class="${s}-bgimg" src="${bgImage}" alt="" aria-hidden="true">` : ''}
  <div class="${s}-overlay"></div>
  <div class="${s}-container">

    <div class="${s}-content">
      ${content.badge ? `<span class="${s}-badge">${content.badge}</span>` : ''}
      <h1 class="${s}-headline">
        ${content.headline || 'Your Car, Perfectly'}
        <span class="${s}-highlight">${content.highlightText || 'Detailed'}</span>
      </h1>
      <p class="${s}-subtitle">${content.subtitle || ''}</p>
      ${(content.ctaText !== '' || content.ctaText2) ? `<div class="${s}-buttons">
        ${content.ctaText !== '' ? `<a href="${content.ctaLink || '#contact'}" class="${s}-btn-primary">
          <span>${content.ctaText || 'Book Your Detail'}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>` : ''}
        ${content.ctaText2 ? `<a href="${content.ctaLink2 || '#'}" class="${s}-btn-secondary">${content.ctaText2}</a>` : ''}
      </div>` : ''}
      <div class="${s}-trust">
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${primary}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Certified Detailers</div>
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${primary}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Premium Products</div>
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${primary}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> 100% Satisfaction</div>
      </div>
    </div>

    <!-- Staggered image column -->
    <div class="${s}-images">
      <div class="${s}-img-main">
        ${img1 ? `<img src="${img1}" alt="Auto detailing" class="${s}-img" loading="eager">` : ''}
      </div>
      <div class="${s}-img-inset">
        ${img2 ? `<img src="${img2}" alt="Detailing result" class="${s}-img" loading="lazy">` : ''}
      </div>
      <div class="${s}-float-badge">
        <span class="${s}-float-years">${years}</span>
        <span class="${s}-float-loc">${location}</span>
      </div>
    </div>

  </div>
</section>
<style>
  .${s} {
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: center;
    background: linear-gradient(135deg, #09090b 0%, #18181b 100%);
    overflow: hidden;
  }
  .${s}-bgimg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100% !important;
    max-width: none !important;
    object-fit: cover;
    object-position: center;
    z-index: 0;
    pointer-events: none;
  }
  .${s}-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to right,
      rgba(9, 9, 11, 0.95) 0%,
      rgba(9, 9, 11, 0.85) 45%,
      rgba(9, 9, 11, 0.4) 100%
    );
    opacity: ${overlayVal};
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
  .${s}-content { color: #fff; }
  .${s}-badge {
    display: inline-block;
    padding: 0.45rem 1.2rem;
    background: ${primary}25;
    border: 1px solid ${primary}55;
    color: ${primary};
    border-radius: 50px;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 1.5rem;
    backdrop-filter: blur(8px);
  }
  .${s}-headline {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2.6rem, 5.5vw, 4.2rem);
    font-weight: 800;
    line-height: 1.08;
    margin-bottom: 1.25rem;
    color: #fff;
  }
  .${s}-highlight {
    display: block;
    background: linear-gradient(135deg, ${primary}, ${accent});
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
    padding-bottom: 0.1em;
  }
  .${s}-subtitle {
    font-size: 1.1rem;
    line-height: 1.75;
    color: rgba(255,255,255,0.75);
    max-width: 500px;
    margin-bottom: 2.25rem;
  }
  .${s}-buttons {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 2rem;
  }
  .${s}-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 1.75rem;
    background: linear-gradient(135deg, ${primary}, ${accent});
    color: #09090b;
    font-weight: 700;
    font-size: 0.95rem;
    text-decoration: none;
    border-radius: ${theme.buttonRadius || '8px'};
    box-shadow: 0 4px 18px ${primary}50;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .${s}-btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 28px ${primary}70;
  }
  .${s}-btn-secondary {
    display: inline-flex;
    align-items: center;
    padding: 1rem 1.75rem;
    background: rgba(255,255,255,0.08);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.2);
    color: #fff;
    font-weight: 600;
    font-size: 0.95rem;
    text-decoration: none;
    border-radius: ${theme.buttonRadius || '8px'};
    transition: background 0.2s, border-color 0.2s;
  }
  .${s}-btn-secondary:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.4); }
  .${s}-trust {
    display: flex;
    gap: 1.25rem;
    flex-wrap: wrap;
  }
  .${s}-trust-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: rgba(255,255,255,0.7);
    font-weight: 500;
  }

  /* ── Staggered image column ─────────────────── */
  .${s}-images {
    position: relative;
    height: 540px;
  }
  .${s}-img-main {
    position: absolute;
    top: 0;
    left: 5%;
    right: 0;
    bottom: 18%;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06);
  }
  .${s}-img-inset {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 58%;
    height: 48%;
    border-radius: 16px;
    overflow: hidden;
    border: 3px solid rgba(255,255,255,0.12);
    box-shadow: 0 16px 40px rgba(0,0,0,0.6);
    z-index: 2;
  }
  .${s}-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .${s}-float-badge {
    position: absolute;
    bottom: 0.5rem;
    right: 0;
    background: linear-gradient(135deg, ${primary}, ${accent});
    border-radius: 14px;
    padding: 0.9rem 1.2rem;
    box-shadow: 0 6px 24px ${primary}55;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    z-index: 3;
    min-width: 130px;
  }
  .${s}-float-years {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.5rem;
    font-weight: 800;
    color: #09090b;
    line-height: 1;
  }
  .${s}-float-loc {
    font-size: 0.78rem;
    color: rgba(9,9,11,0.75);
    font-weight: 700;
    margin-top: 0.25rem;
    line-height: 1.3;
  }

  @media (max-width: 900px) {
    .${s}-container {
      grid-template-columns: 1fr;
      padding: 8rem 1.5rem 5rem;
      gap: 3rem;
    }
    .${s}-images { height: 360px; }
    .${s}-img-inset { width: 52%; height: 50%; }
  }
  @media (max-width: 600px) {
    .${s}-images { height: 280px; }
    .${s}-trust { flex-direction: column; gap: 0.6rem; }
    .${s}-buttons { flex-direction: column; }
    .${s}-btn-primary, .${s}-btn-secondary { width: 100%; max-width: 280px; justify-content: center; }
  }
</style>`;
  }
};
