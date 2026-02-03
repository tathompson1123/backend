// ============================================
// GALLERY - Mixed Grid
// Premium masonry-style gallery
// ============================================

module.exports = {
  id: 'gallery-mixed-grid',
  name: 'Gallery - Mixed Grid',
  category: 'gallery',
  description: 'Mixed size gallery grid with hover effects',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.95, cleaning: 0.8, hvac: 0.6,
    salonSpa: 0.9, fitness: 0.85, dental: 0.75, restaurant: 0.9,
    realEstate: 0.95, photography: 0.98, legal: 0.4, renovation: 0.95, petGrooming: 0.85,
  },
  mood: ['visual', 'portfolio', 'showcase'],

  render(content, theme, sectionId = 'gallery') {
    const s = `section-${sectionId}`;
    const items = content.items || [];

    const itemsHtml = items.map((item, i) => `
      <div class="${s}-item ${item.large ? `${s}-large` : ''}" style="animation-delay: ${0.1 + i * 0.1}s">
        <img src="${item.image || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800'}" alt="${item.title || 'Gallery image'}" loading="lazy">
        <div class="${s}-overlay">
          <h4 class="${s}-item-title">${item.title || ''}</h4>
          ${item.caption ? `<p class="${s}-item-caption">${item.caption}</p>` : ''}
        </div>
      </div>
    `).join('');

    return `
<section class="${s}" id="gallery" style="background: ${theme.surfaceColor || '#f9fafb'};">
  <div class="${s}-container">
    <div class="${s}-header">
      <span class="${s}-label">Portfolio</span>
      <h2 class="${s}-title">${content.title || 'Our Work'}</h2>
    </div>
    
    <div class="${s}-grid">
      ${itemsHtml}
    </div>
  </div>
</section>
<style>
  .${s} {
    padding: 6rem 2rem;
  }
  
  .${s}-container {
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .${s}-header {
    text-align: center;
    margin-bottom: 4rem;
  }
  
  .${s}-label {
    display: inline-block;
    padding: 0.5rem 1rem;
    background: ${theme.primaryColor}15;
    color: ${theme.primaryColor};
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    border-radius: 50px;
    margin-bottom: 1rem;
  }
  
  .${s}-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 800;
    color: ${theme.textColor || '#1f2937'};
  }
  
  .${s}-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
    grid-auto-flow: dense;
  }
  
  .${s}-item {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    aspect-ratio: 4/3;
    opacity: 0;
    animation: ${s}-fadeIn 0.6s ease-out forwards;
    cursor: pointer;
  }
  
  .${s}-large {
    grid-column: span 2;
    grid-row: span 2;
    aspect-ratio: auto;
  }
  
  @keyframes ${s}-fadeIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  
  .${s}-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.6s ease;
  }
  
  .${s}-item:hover img {
    transform: scale(1.1);
  }
  
  .${s}-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 60%);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 1.5rem;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .${s}-item:hover .${s}-overlay {
    opacity: 1;
  }
  
  .${s}-item-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.25rem;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 0.25rem;
    transform: translateY(10px);
    transition: transform 0.3s ease;
  }
  
  .${s}-item:hover .${s}-item-title {
    transform: translateY(0);
  }
  
  .${s}-item-caption {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.85);
    transform: translateY(10px);
    transition: transform 0.3s ease 0.1s;
  }
  
  .${s}-item:hover .${s}-item-caption {
    transform: translateY(0);
  }
  
  @media (max-width: 900px) {
    .${s}-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    
    .${s}-large {
      grid-column: span 2;
      grid-row: span 1;
    }
  }
  
  @media (max-width: 600px) {
    .${s} {
      padding: 4rem 1.5rem;
    }
    
    .${s}-grid {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    
    .${s}-large {
      grid-column: span 1;
    }
    
    .${s}-overlay {
      opacity: 1;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.7) 0%, transparent 50%);
    }
    
    .${s}-item-title,
    .${s}-item-caption {
      transform: translateY(0);
    }
  }
</style>`;
  }
};
