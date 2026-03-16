// ============================================
// HERO - Cleaning Split
// Dark background image left with text, staggered images right:
// one large main image + one smaller overlapping inset + years badge
// ============================================

module.exports = {
  id: 'hero-cleaning-split',
  name: 'Hero - Cleaning Split',
  category: 'hero',
  description: 'Two-column hero with dark overlay text left and staggered portrait images right, floating years badge',

  suitability: {
    cleaning: 1.0, janitorial: 0.9, maid: 0.9, housekeeping: 0.8, carpetCleaning: 0.9,
  },
  mood: ['professional', 'clean', 'trustworthy'],

  contentSchema: {
    badge:          { type: 'text',     label: 'Badge Text (above headline)',        default: 'Professional Cleaning' },
    headline:       { type: 'text',     label: 'Headline',                           default: 'Sparkling Clean' },
    highlightText:  { type: 'text',     label: 'Highlight Word (colored)',           default: 'Every Time' },
    subtitle:       { type: 'textarea', label: 'Subtitle',                           default: 'Trusted by hundreds of local families for spotless homes and offices.' },
    ctaText:        { type: 'text',     label: 'Primary CTA',                        default: 'Get a Free Quote' },
    ctaLink:        { type: 'url',      label: 'Primary CTA Link',                  default: '#contact' },
    ctaText2:       { type: 'text',     label: 'Secondary CTA',                     default: 'Call Us Now' },
    ctaLink2:       { type: 'url',      label: 'Secondary CTA Link',                default: 'tel:' },
    backgroundImage:{ type: 'image',    label: 'Background Image (full section)',    default: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1920&q=80' },
    heroImage1:     { type: 'image',    label: 'Main Side Image (large)',           default: 'https://images.unsplash.com/photo-1556909211-36987daf7b4d?w=600&q=80' },
    heroImage2:     { type: 'image',    label: 'Inset Side Image (smaller)',        default: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80' },
    yearsText:      { type: 'text',     label: 'Years Badge (e.g. "12+ Years")',    default: '10+ Years' },
    locationText:   { type: 'text',     label: 'Location for Badge',                default: 'Serving Your Area' },
  },

  render(content, theme, sectionId = 'hero') {
    const s = `section-${sectionId}`;
    const bgImage = content.backgroundImage || '';
    const img1 = content.heroImage1 || '';
    const img2 = content.heroImage2 || '';
    const overlayVal = content.overlayOpacity !== undefined ? Math.min(Math.max(Number(content.overlayOpacity), 0), 100) / 100 : 1;
    const years = content.yearsText || '10+ Years';
    const location = content.locationText || 'Serving Your Area';

    return `
<section class="${s}" id="hero">
  ${bgImage ? `<img class="${s}-bgimg" src="${bgImage}" alt="" aria-hidden="true">` : ''}
  <div class="${s}-overlay"></div>
  <div class="${s}-container">

    <div class="${s}-content">
      ${content.badge ? `<span class="${s}-badge">${content.badge}</span>` : ''}
      <h1 class="${s}-headline">
        ${content.headline || 'Sparkling Clean'}
        <span class="${s}-highlight">${content.highlightText || 'Every Time'}</span>
      </h1>
      <p class="${s}-subtitle">${content.subtitle || ''}</p>
      ${(content.ctaText !== '' || content.ctaText2) ? `<div class="${s}-buttons">
        ${content.ctaText !== '' ? `<a href="${content.ctaLink || '#contact'}" class="${s}-btn-primary">
          <span>${content.ctaText || 'Get a Free Quote'}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>` : ''}
        ${content.ctaText2 ? `<a href="${content.ctaLink2 || '#'}" class="${s}-btn-secondary">${content.ctaText2}</a>` : ''}
      </div>` : ''}
      <div class="${s}-trust">
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${theme.primaryColor || '#2563eb'}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Licensed &amp; Insured</div>
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${theme.primaryColor || '#2563eb'}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Eco-Friendly Products</div>
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${theme.primaryColor || '#2563eb'}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Satisfaction Guaranteed</div>
      </div>
    </div>

    <!-- Staggered image column -->
    <div class="${s}-images">
      <!-- Large main image -->
      <div class="${s}-img-main">
        ${img1 ? `<img src="${img1}" alt="Professional cleaning" class="${s}-img" loading="eager">` : ''}
      </div>
      <!-- Smaller inset image overlapping bottom-left of main -->
      <div class="${s}-img-inset">
        ${img2 ? `<img src="${img2}" alt="Clean home result" class="${s}-img" loading="lazy">` : ''}
      </div>
      <!-- Years badge tucked at bottom-right of images column -->
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
    background: linear-gradient(135deg, #0d1b2a 0%, #1a2f4a 100%);
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
      rgba(10, 20, 40, 0.93) 0%,
      rgba(10, 20, 40, 0.82) 45%,
      rgba(10, 20, 40, 0.35) 100%
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
    background: ${theme.primaryColor || '#2563eb'}25;
    border: 1px solid ${theme.primaryColor || '#2563eb'}50;
    color: ${theme.primaryColor || '#7eb3ff'};
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
    background: linear-gradient(135deg, ${theme.primaryColor || '#3b82f6'}, ${theme.accentColor || theme.primaryColor || '#60a5fa'});
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
    color: rgba(255,255,255,0.8);
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
    background: linear-gradient(135deg, ${theme.primaryColor || '#2563eb'}, ${theme.accentColor || theme.primaryColor || '#3b82f6'});
    color: #fff;
    font-weight: 700;
    font-size: 0.95rem;
    text-decoration: none;
    border-radius: ${theme.buttonRadius || '8px'};
    box-shadow: 0 4px 18px ${theme.primaryColor || '#2563eb'}45;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .${s}-btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 28px ${theme.primaryColor || '#2563eb'}65;
  }
  .${s}-btn-secondary {
    display: inline-flex;
    align-items: center;
    padding: 1rem 1.75rem;
    background: rgba(255,255,255,0.1);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.3);
    color: #fff;
    font-weight: 600;
    font-size: 0.95rem;
    text-decoration: none;
    border-radius: ${theme.buttonRadius || '8px'};
    transition: background 0.2s, border-color 0.2s;
  }
  .${s}-btn-secondary:hover { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.5); }
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
    color: rgba(255,255,255,0.75);
    font-weight: 500;
  }

  /* ── Staggered image column ─────────────────── */
  .${s}-images {
    position: relative;
    height: 540px;
  }
  /* Main large image: fills upper ~80% of column */
  .${s}-img-main {
    position: absolute;
    top: 0;
    left: 5%;
    right: 0;
    bottom: 18%;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,0.55);
  }
  /* Smaller inset: bottom-left, overlaps main by ~40px */
  .${s}-img-inset {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 58%;
    height: 48%;
    border-radius: 16px;
    overflow: hidden;
    border: 4px solid rgba(255,255,255,0.18);
    box-shadow: 0 16px 40px rgba(0,0,0,0.5);
    /* sits in front of main */
    z-index: 2;
  }
  .${s}-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  /* Years badge: bottom-right, distinct from both images */
  .${s}-float-badge {
    position: absolute;
    bottom: 0.5rem;
    right: 0;
    background: linear-gradient(135deg, ${theme.primaryColor || '#2563eb'}, ${theme.accentColor || theme.primaryColor || '#3b82f6'});
    border-radius: 14px;
    padding: 0.9rem 1.2rem;
    box-shadow: 0 6px 24px ${theme.primaryColor || '#2563eb'}50;
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
    color: #fff;
    line-height: 1;
  }
  .${s}-float-loc {
    font-size: 0.78rem;
    color: rgba(255,255,255,0.85);
    font-weight: 600;
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
