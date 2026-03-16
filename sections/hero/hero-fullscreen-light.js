// ============================================
// HERO - Fullscreen Light
// Centered hero with minimal overlay — editorial photography aesthetic
// Full-viewport with large serif headline and narrow uppercase subtitle
// ============================================

module.exports = {
  id: 'hero-fullscreen-light',
  name: 'Fullscreen Hero - Light',
  category: 'hero',
  description: 'Full viewport centered hero with minimal dark overlay and large serif headline — editorial photography aesthetic',

  suitability: {
    photography: 0.98, salonSpa: 0.82, restaurant: 0.78, realEstate: 0.72,
    autoDetailing: 0.45, landscaping: 0.5, cleaning: 0.3, hvac: 0.25,
    fitness: 0.55, dental: 0.4, legal: 0.45, renovation: 0.4, petGrooming: 0.5,
  },
  mood: ['editorial', 'luxury', 'minimal'],

  contentSchema: {
    headline:        { type: 'text',  label: 'Headline (shown uppercase)',       default: 'Photography is Poetry' },
    subtitle:        { type: 'text',  label: 'Subtitle (narrow tracking)',        default: 'Modern Portrait & Wedding Photography' },
    backgroundImage: { type: 'image', label: 'Background Image',                 default: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1920' },
    overlayOpacity:  { type: 'text',  label: 'Overlay opacity (0.0 – 0.5)',      default: '0.12' },
  },

  render(content, theme, sectionId = 'hero') {
    const s = `section-${sectionId}`;
    const rawOverlay = content.overlayOpacity !== undefined ? Number(content.overlayOpacity) : 12;
    const overlay = Math.min(Math.max(rawOverlay > 1 ? rawOverlay / 100 : rawOverlay, 0), 0.5);

    return `
<section class="${s}">
  <div class="${s}-bg">
    <img src="${content.backgroundImage || 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1920'}" alt="" class="${s}-bg-img">
    <div class="${s}-overlay" style="opacity:${overlay};"></div>
  </div>
  <div class="${s}-content">
    <h1 class="${s}-headline">${content.headline || 'Photography is Poetry'}</h1>
    <p class="${s}-subtitle">${content.subtitle || 'Modern Portrait &amp; Wedding Photography'}</p>
  </div>
</section>
<style>
  .${s} {
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .${s}-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
  .${s}-bg-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .${s}-overlay {
    position: absolute;
    inset: 0;
    background: #000;
  }
  .${s}-content {
    position: relative;
    z-index: 10;
    text-align: center;
    padding: 2rem 1.5rem;
    max-width: 900px;
    margin-top: 4rem;
  }
  .${s}-headline {
    font-family: '${theme.headingFont || 'Cormorant Garamond'}', serif;
    font-size: clamp(2.4rem, 7.5vw, 5.5rem);
    font-weight: 300;
    letter-spacing: 0.06em;
    line-height: 1.1;
    margin-bottom: 1.25rem;
    color: #ffffff;
    text-transform: uppercase;
    animation: ${s}-rise 1s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .${s}-subtitle {
    font-size: clamp(0.65rem, 1.4vw, 0.85rem);
    color: rgba(255, 255, 255, 0.9);
    text-transform: uppercase;
    letter-spacing: 0.22em;
    font-weight: 500;
    animation: ${s}-rise 1s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both;
  }
  @keyframes ${s}-rise {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @media (max-width: 600px) {
    .${s}-content {
      margin-top: 5rem;
      padding: 2rem 1.25rem;
    }
  }
</style>`;
  }
};
