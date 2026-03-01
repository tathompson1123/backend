// ============================================
// HERO - Cleaning Split
// Dark background image left with text, two stacked images right
// "X+ years serving [location]" float badge
// ============================================

module.exports = {
  id: 'hero-cleaning-split',
  name: 'Hero - Cleaning Split',
  category: 'hero',
  description: 'Two-column hero with dark overlay text left and two stacked portrait images right, floating years badge',

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
    heroImage1:     { type: 'image',    label: 'Side Image 1 (top)',                default: 'https://images.unsplash.com/photo-1556909211-36987daf7b4d?w=600&q=80' },
    heroImage2:     { type: 'image',    label: 'Side Image 2 (bottom)',             default: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80' },
    yearsText:      { type: 'text',     label: 'Years Badge (e.g. "12+ Years")',    default: '10+ Years' },
    locationText:   { type: 'text',     label: 'Location for Badge',                default: 'Serving Your Area' },
  },

  render(content, theme, sectionId = 'hero') {
    const s = `section-${sectionId}`;
    const bgImage = content.backgroundImage || '';
    const img1 = content.heroImage1 || '';
    const img2 = content.heroImage2 || '';
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
      <div class="${s}-buttons">
        <a href="${content.ctaLink || '#contact'}" class="${s}-btn-primary">
          <span>${content.ctaText || 'Get a Free Quote'}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
        ${content.ctaText2 ? `<a href="${content.ctaLink2 || '#'}" class="${s}-btn-secondary">${content.ctaText2}</a>` : ''}
      </div>
      <div class="${s}-trust">
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${theme.primaryColor || '#2563eb'}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Licensed &amp; Insured</div>
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${theme.primaryColor || '#2563eb'}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Eco-Friendly Products</div>
        <div class="${s}-trust-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="${theme.primaryColor || '#2563eb'}" stroke="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Satisfaction Guaranteed</div>
      </div>
    </div>

    <div class="${s}-images">
      <div class="${s}-img-top">
        ${img1 ? `<img src="${img1}" alt="Professional cleaning" class="${s}-img" loading="eager">` : ''}
      </div>
      <div class="${s}-img-bottom">
        ${img2 ? `<img src="${img2}" alt="Clean home result" class="${s}-img" loading="lazy">` : ''}
        <div class="${s}-float-badge">
          <span class="${s}-float-years">${years}</span>
          <span class="${s}-float-loc">${location}</span>
        </div>
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
  .${s}-content {
    color: #fff;
  }
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
  .${s}-btn-secondary:hover {
    background: rgba(255,255,255,0.18);
    border-color: rgba(255,255,255,0.5);
  }
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
  /* Right column: two stacked images */
  .${s}-images {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 580px;
  }
  .${s}-img-top {
    flex: 1.15;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.45);
  }
  .${s}-img-bottom {
    flex: 0.85;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    box-shadow: 0 20px 50px rgba(0,0,0,0.45);
  }
  .${s}-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .${s}-float-badge {
    position: absolute;
    bottom: 1.25rem;
    left: 1.25rem;
    background: rgba(255,255,255,0.95);
    backdrop-filter: blur(10px);
    border-radius: 12px;
    padding: 0.75rem 1.1rem;
    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .${s}-float-years {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.4rem;
    font-weight: 800;
    color: ${theme.primaryColor || '#2563eb'};
    line-height: 1;
  }
  .${s}-float-loc {
    font-size: 0.78rem;
    color: #374151;
    font-weight: 600;
    margin-top: 0.2rem;
  }
  @media (max-width: 900px) {
    .${s}-container {
      grid-template-columns: 1fr;
      padding: 8rem 1.5rem 5rem;
      gap: 3rem;
    }
    .${s}-images {
      height: 380px;
      flex-direction: row;
    }
    .${s}-img-top, .${s}-img-bottom { flex: 1; }
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
