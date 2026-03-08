// ============================================
// HERO - Page Banner
// Full-width header banner for inner pages (services, gallery, contact)
// Dark gradient background with optional image overlay
// ============================================

module.exports = {
  id: 'hero-page-banner',
  name: 'Page Banner Header',
  category: 'hero',
  description: 'Full-width page header banner for inner pages with title and optional background image',

  suitability: {
    landscaping: 0.95, salonSpa: 0.85, restaurant: 0.75, realEstate: 0.8,
    photography: 0.8, legal: 0.7, autoDetailing: 0.7, fitness: 0.65,
    dental: 0.7, cleaning: 0.7, hvac: 0.7, renovation: 0.8, petGrooming: 0.75,
  },
  mood: ['clean', 'structured', 'professional'],

  contentSchema: {
    title:    { type: 'text',  label: 'Page Title',                        default: 'Our Services' },
    subtitle: { type: 'text',  label: 'Subtitle',                          default: '' },
    bgImage:  { type: 'image', label: 'Background Image (optional)',       default: '' },
  },

  render(content, theme, sectionId = 'pagebanner') {
    const s = `section-${sectionId}`;
    const hasBg = !!content.bgImage;

    return `
<section class="${s}">
  ${hasBg ? `<div class="${s}-bg"><img src="${content.bgImage}" alt="" class="${s}-bg-img"></div>` : ''}
  <div class="${s}-overlay"></div>
  <div class="${s}-content">
    <h1 class="${s}-title">${content.title || 'Our Services'}</h1>
    ${content.subtitle ? `<p class="${s}-subtitle">${content.subtitle}</p>` : ''}
  </div>
</section>
<style>
  .${s} {
    position: relative;
    padding: 5rem 2rem 4rem;
    min-height: 280px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: linear-gradient(135deg, ${theme.textColor || '#1b2216'} 0%, ${theme.primaryColor || '#3d4f39'} 100%);
  }
  .${s}-bg {
    position: absolute;
    inset: 0;
    opacity: 0.2;
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
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.45) 100%);
    z-index: 1;
  }
  .${s}-content {
    position: relative;
    z-index: 2;
    text-align: center;
    max-width: 700px;
  }
  .${s}-title {
    font-family: '${theme.headingFont || 'Cormorant Garamond'}', serif;
    font-size: clamp(2.5rem, 5vw, 3.8rem);
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.75rem;
    line-height: 1.15;
  }
  .${s}-subtitle {
    font-size: 1.05rem;
    color: rgba(255, 255, 255, 0.8);
    line-height: 1.6;
    margin: 0;
  }
  @media (max-width: 600px) {
    .${s} {
      padding: 7rem 1.5rem 3rem;
      min-height: 220px;
    }
  }
</style>`;
  }
};
