// ============================================
// CTA - Card
// Centered rounded card with decorative blur circles and dual CTAs
// ============================================

module.exports = {
  id: 'cta-card',
  name: 'CTA Card',
  category: 'cta',
  description: 'Centered card with decorative glows, headline, and two CTA buttons',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.9, fitness: 0.9, dental: 0.85, restaurant: 0.85,
    realEstate: 0.85, photography: 0.85, legal: 0.8, renovation: 0.88, petGrooming: 0.85,
  },
  mood: ['conversion', 'premium', 'clean'],

  contentSchema: {
    headline:  { type: 'text', label: 'Headline',         default: 'Ready for a Transformation?' },
    subtitle:  { type: 'text', label: 'Subtitle',         default: 'Book your appointment today.' },
    ctaText:   { type: 'text', label: 'Primary CTA',      default: 'Book Now' },
    ctaLink:   { type: 'url',  label: 'Primary CTA Link', default: '#contact' },
    ctaText2:  { type: 'text', label: 'Secondary CTA',    default: 'View Gallery' },
    ctaLink2:  { type: 'url',  label: 'Secondary CTA Link', default: '#gallery' },
  },

  render(content, theme, sectionId = 'ctacard') {
    const s = `section-${sectionId}`;
    // Detect light vs dark theme to pick appropriate card background
    const bg = theme.bgColor || '#020617';
    const isLight = bg.startsWith('#f') || bg.startsWith('#e') || bg === '#ffffff' || bg === '#FFFFFF';
    const sectionBg = isLight ? (theme.surfaceColor || '#f0ece5') : `linear-gradient(180deg, ${bg} 0%, #000 100%)`;
    const cardBg = isLight
      ? `linear-gradient(135deg, ${theme.primaryColor || '#1a3a1a'}, ${theme.accentColor || theme.primaryColor || '#2d5a2d'})`
      : 'linear-gradient(135deg, #111827, #000000)';

    return `
<section class="${s}" style="background: ${sectionBg}; padding: 6rem 2rem;">
  <div class="${s}-container">
    <div class="${s}-card reveal">
      <div class="${s}-glow-tr"></div>
      <div class="${s}-glow-bl"></div>
      <div class="${s}-content">
        <h2 class="${s}-headline">${content.headline || 'Ready for a Transformation?'}</h2>
        <p class="${s}-subtitle">${content.subtitle || ''}</p>
        <div class="${s}-buttons">
          <a href="${content.ctaLink || '#contact'}" class="${s}-btn-primary">${content.ctaText || 'Book Now'}</a>
          <a href="${content.ctaLink2 || '#gallery'}" class="${s}-btn-secondary">${content.ctaText2 || 'View Gallery'}</a>
        </div>
      </div>
    </div>
  </div>
</section>
<style>
  .${s}-container {
    max-width: 800px;
    margin: 0 auto;
  }
  .${s}-card {
    position: relative;
    background: ${cardBg};
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 28px;
    overflow: hidden;
    padding: 4.5rem 3rem;
  }
  .${s}-glow-tr {
    position: absolute;
    top: -60px;
    right: -60px;
    width: 256px;
    height: 256px;
    background: ${theme.primaryColor}1a;
    filter: blur(60px);
    border-radius: 50%;
    pointer-events: none;
  }
  .${s}-glow-bl {
    position: absolute;
    bottom: -60px;
    left: -60px;
    width: 256px;
    height: 256px;
    background: rgba(59,130,246,0.1);
    filter: blur(60px);
    border-radius: 50%;
    pointer-events: none;
  }
  .${s}-content {
    position: relative;
    z-index: 1;
    text-align: center;
  }
  .${s}-headline {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(1.8rem, 3.5vw, 2.75rem);
    font-weight: 900;
    color: ${theme.textColor || '#ffffff'};
    line-height: 1.2;
    margin-bottom: 1rem;
  }
  .${s}-subtitle {
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    font-size: 1.05rem;
    line-height: 1.6;
    margin-bottom: 2.25rem;
    max-width: 520px;
    margin-left: auto;
    margin-right: auto;
  }
  .${s}-buttons {
    display: flex;
    justify-content: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .${s}-btn-primary {
    display: inline-block;
    padding: 0.9rem 2.25rem;
    background: ${theme.primaryColor};
    color: #fff;
    border-radius: ${theme.buttonRadius || '50px'};
    font-weight: 700;
    font-size: 0.95rem;
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 1px;
    box-shadow: 0 4px 20px ${theme.primaryColor}40;
    transition: transform 0.25s, box-shadow 0.25s;
  }
  .${s}-btn-primary:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 28px ${theme.primaryColor}60;
  }
  .${s}-btn-secondary {
    display: inline-block;
    padding: 0.9rem 2.25rem;
    background: transparent;
    color: ${theme.textColor || '#ffffff'};
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: ${theme.buttonRadius || '50px'};
    font-weight: 600;
    font-size: 0.95rem;
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 1px;
    transition: background 0.25s, border-color 0.25s;
  }
  .${s}-btn-secondary:hover {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.4);
  }
  @media (max-width: 600px) {
    .${s}-card {
      padding: 3rem 1.75rem;
    }
    .${s}-buttons {
      flex-direction: column;
      align-items: center;
    }
  }
</style>`;
  }
};
