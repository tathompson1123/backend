// ============================================
// TRUST BANNER - Scrolling Reviews
// Animated scrolling review banner
// ============================================

module.exports = {
  id: 'trust-banner-scroll',
  name: 'Trust Banner - Scrolling',
  category: 'trust',
  description: 'Scrolling banner with customer reviews',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.9, cleaning: 0.9, hvac: 0.85,
    salonSpa: 0.95, fitness: 0.9, dental: 0.95, restaurant: 0.9,
    realEstate: 0.85, photography: 0.8, legal: 0.75, renovation: 0.9, petGrooming: 0.9,
  },
  mood: ['trustworthy', 'social-proof', 'dynamic'],

  render(content, theme, sectionId = 'trust') {
    const s = `section-${sectionId}`;
    const reviews = content.reviews || [];
    
    // Duplicate reviews for seamless loop
    const reviewsHtml = [...reviews, ...reviews].map(r => `
      <div class="${s}-item">
        <span class="${s}-text">"${r.text}"</span>
        <span class="${s}-author">— ${r.author}</span>
        <span class="${s}-stars">${'★'.repeat(r.rating || 5)}</span>
      </div>
    `).join('');

    return `
<div class="${s}">
  <div class="${s}-track">
    ${reviewsHtml}
  </div>
</div>
<style>
  .${s} {
    background: ${theme.primaryColor};
    color: #ffffff;
    padding: 0.875rem 0;
    overflow: hidden;
    position: relative;
    z-index: 100;
  }
  
  .${s}::before,
  .${s}::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 100px;
    z-index: 2;
    pointer-events: none;
  }
  
  .${s}::before {
    left: 0;
    background: linear-gradient(90deg, ${theme.primaryColor}, transparent);
  }
  
  .${s}::after {
    right: 0;
    background: linear-gradient(-90deg, ${theme.primaryColor}, transparent);
  }
  
  .${s}-track {
    display: flex;
    animation: ${s}-scroll 60s linear infinite;
    width: max-content;
  }
  
  .${s}-track:hover {
    animation-play-state: paused;
  }
  
  @keyframes ${s}-scroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  
  .${s}-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 2rem;
    font-size: 0.9rem;
    white-space: nowrap;
    flex-shrink: 0;
    border-right: 1px solid rgba(255, 255, 255, 0.2);
  }
  
  .${s}-text {
    font-weight: 500;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .${s}-author {
    font-weight: 600;
    opacity: 0.9;
  }
  
  .${s}-stars {
    color: #FFD700;
    font-size: 0.85rem;
    letter-spacing: 1px;
  }
  
  @media (max-width: 768px) {
    .${s}-item {
      padding: 0 1.5rem;
    }
    
    .${s}-text {
      max-width: 200px;
    }
  }
</style>`;
  }
};
