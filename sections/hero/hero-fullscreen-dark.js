// ============================================
// HERO - Fullscreen Dark with Background Image
// Premium design with glassmorphism and animations
// ============================================

module.exports = {
  id: 'hero-fullscreen-dark',
  name: 'Fullscreen Hero - Dark',
  category: 'hero',
  description: 'Full viewport hero with dark overlay, background image, and animated elements',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.85, cleaning: 0.8, hvac: 0.75,
    salonSpa: 0.8, fitness: 0.9, dental: 0.6, restaurant: 0.8,
    realEstate: 0.75, photography: 0.9, legal: 0.5, renovation: 0.85, petGrooming: 0.65,
  },
  mood: ['bold', 'luxury', 'professional'],

  contentSchema: {
    headline: { type: 'text', label: 'Headline', default: 'Professional' },
    highlightText: { type: 'text', label: 'Highlight Word (colored)', default: 'Services' },
    subtitle: { type: 'textarea', label: 'Subtitle', default: 'Quality you can trust.' },
    ctaText: { type: 'text', label: 'Primary Button Text', default: 'Get Started' },
    ctaLink: { type: 'url', label: 'Primary Button Link', default: '#contact' },
    ctaText2: { type: 'text', label: 'Secondary Button Text (optional)', default: '' },
    ctaLink2: { type: 'url', label: 'Secondary Button Link (optional)', default: '#services' },
    backgroundImage: { type: 'image', label: 'Background Image', default: 'https://images.unsplash.com/photo-1619405399517-d7fce0f13302?w=1920' },
  },

  render(content, theme, sectionId = 'hero') {
    const s = `section-${sectionId}`;
    const bgImage = content.backgroundImage || '';
    const btn2 = content.ctaText2 
      ? `<a href="${content.ctaLink2 || '#'}" class="${s}-btn-secondary">${content.ctaText2}</a>` 
      : '';

    return `
<section class="${s}" id="hero">
  ${bgImage ? `<img class="${s}-bgimg" src="${bgImage}" alt="" aria-hidden="true">` : ''}
  <div class="${s}-overlay"></div>
  <div class="${s}-particles"></div>
  <div class="${s}-content">
    <div class="${s}-badge">${content.badge || `Professional ${theme.name || 'Services'}`}</div>
    <h1 class="${s}-title">
      ${content.headline || 'Professional'}
      <span class="${s}-highlight">${content.highlightText || 'Services'}</span>
    </h1>
    <p class="${s}-subtitle">${content.subtitle || 'Quality you can trust.'}</p>
    <div class="${s}-buttons">
      <a href="${content.ctaLink || '#contact'}" class="${s}-btn-primary">
        <span>${content.ctaText || 'Get Started'}</span>
        <svg class="${s}-btn-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
      ${btn2}
    </div>
    <div class="${s}-stats">
      <div class="${s}-stat">
        <span class="${s}-stat-number">500+</span>
        <span class="${s}-stat-label">Happy Clients</span>
      </div>
      <div class="${s}-stat-divider"></div>
      <div class="${s}-stat">
        <span class="${s}-stat-number">10+</span>
        <span class="${s}-stat-label">Years Experience</span>
      </div>
      <div class="${s}-stat-divider"></div>
      <div class="${s}-stat">
        <span class="${s}-stat-number">100%</span>
        <span class="${s}-stat-label">Satisfaction</span>
      </div>
    </div>
  </div>
  <div class="${s}-scroll-indicator">
    <span>Scroll to explore</span>
    <div class="${s}-scroll-line"></div>
  </div>
</section>
<style>
  .${s} {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    background: linear-gradient(135deg, ${theme.bgColor || '#0a0a0a'} 0%, ${theme.primaryColor || '#1a1a2e'}22 100%);
    color: #ffffff;
    position: relative;
    overflow: hidden;
  }
  
  .${s}-bgimg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100% !important;
    max-width: none !important;
    object-fit: cover;
    object-position: center;
    z-index: 0;
    display: block;
    pointer-events: none;
  }

  .${s}-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to right,
      rgba(0, 0, 0, 0.9) 0%,
      rgba(0, 0, 0, 0.75) 50%,
      rgba(0, 0, 0, 0.4) 100%
    );
    z-index: 1;
  }
  
  .${s}-particles {
    position: absolute;
    inset: 0;
    background-image: 
      radial-gradient(circle at 20% 80%, ${theme.primaryColor}15 1px, transparent 1px),
      radial-gradient(circle at 80% 20%, ${theme.primaryColor}15 1px, transparent 1px),
      radial-gradient(circle at 40% 40%, ${theme.primaryColor}10 1px, transparent 1px);
    background-size: 100px 100px, 150px 150px, 200px 200px;
    animation: ${s}-float 20s ease-in-out infinite;
    z-index: 2;
  }
  
  @keyframes ${s}-float {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-20px) rotate(1deg); }
  }
  
  .${s}-content {
    position: relative;
    z-index: 10;
    max-width: 620px;
    margin: 0;
    padding: 6rem 2rem 6rem 10vw;
    text-align: left;
  }
  
  .${s}-badge {
    display: inline-block;
    padding: 0.5rem 1.5rem;
    background: ${theme.primaryColor}20;
    border: 1px solid ${theme.primaryColor}40;
    border-radius: 50px;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: ${theme.primaryColor};
    margin-bottom: 2rem;
    backdrop-filter: blur(10px);
    animation: ${s}-fadeInDown 0.8s ease-out;
  }
  
  .${s}-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2.5rem, 6vw, 4.5rem);
    font-weight: 800;
    line-height: 1.1;
    margin-bottom: 1.5rem;
    animation: ${s}-fadeInUp 0.8s ease-out 0.2s both;
  }
  
  .${s}-highlight {
    display: block;
    background: linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor || theme.primaryColor});
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .${s}-subtitle {
    font-size: clamp(1rem, 2vw, 1.25rem);
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.85);
    max-width: 520px;
    margin: 0 0 2.5rem;
    animation: ${s}-fadeInUp 0.8s ease-out 0.4s both;
  }
  
  .${s}-buttons {
    display: flex;
    gap: 1rem;
    justify-content: flex-start;
    flex-wrap: wrap;
    margin-bottom: 3rem;
    animation: ${s}-fadeInUp 0.8s ease-out 0.6s both;
  }
  
  .${s}-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 2rem;
    background: linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor || theme.primaryColor});
    color: #ffffff;
    font-weight: 700;
    font-size: 1rem;
    text-decoration: none;
    border-radius: ${theme.buttonRadius || '8px'};
    transition: all 0.3s ease;
    box-shadow: 0 4px 20px ${theme.primaryColor}40;
  }
  
  .${s}-btn-primary:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 30px ${theme.primaryColor}60;
  }
  
  .${s}-btn-arrow {
    transition: transform 0.3s ease;
  }
  
  .${s}-btn-primary:hover .${s}-btn-arrow {
    transform: translateX(4px);
  }
  
  .${s}-btn-secondary {
    display: inline-flex;
    align-items: center;
    padding: 1rem 2rem;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    color: #ffffff;
    font-weight: 600;
    font-size: 1rem;
    text-decoration: none;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: ${theme.buttonRadius || '8px'};
    transition: all 0.3s ease;
  }
  
  .${s}-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.5);
    transform: translateY(-3px);
  }
  
  .${s}-stats {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 2rem;
    padding: 1.5rem 2rem;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    width: fit-content;
    animation: ${s}-fadeInUp 0.8s ease-out 0.8s both;
  }
  
  .${s}-stat {
    text-align: center;
  }
  
  .${s}-stat-number {
    display: block;
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.75rem;
    font-weight: 800;
    color: ${theme.primaryColor};
  }
  
  .${s}-stat-label {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  
  .${s}-stat-divider {
    width: 1px;
    height: 40px;
    background: rgba(255, 255, 255, 0.2);
  }
  
  .${s}-scroll-indicator {
    position: absolute;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    z-index: 10;
    animation: ${s}-fadeIn 1s ease-out 1.2s both;
  }
  
  .${s}-scroll-indicator span {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: rgba(255, 255, 255, 0.5);
  }
  
  .${s}-scroll-line {
    width: 1px;
    height: 40px;
    background: linear-gradient(to bottom, ${theme.primaryColor}, transparent);
    animation: ${s}-scrollPulse 2s ease-in-out infinite;
  }
  
  @keyframes ${s}-scrollPulse {
    0%, 100% { opacity: 1; transform: scaleY(1); }
    50% { opacity: 0.5; transform: scaleY(0.8); }
  }
  
  @keyframes ${s}-fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes ${s}-fadeInUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes ${s}-fadeInDown {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @media (max-width: 768px) {
    .${s}-content {
      padding: 8rem 1.5rem 4rem;
      max-width: 100%;
    }

    .${s}-stats {
      flex-direction: column;
      gap: 1rem;
      padding: 1.5rem;
      width: 100%;
    }

    .${s}-stat-divider {
      width: 60px;
      height: 1px;
    }

    .${s}-buttons {
      flex-direction: column;
      align-items: flex-start;
    }

    .${s}-btn-primary,
    .${s}-btn-secondary {
      width: 100%;
      max-width: 280px;
      justify-content: center;
    }
  }
</style>`;
  }
};
