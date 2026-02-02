// ============================================
// GALLERY - Mixed Grid
// Extracted from: auto-detailing-template/index.html
// ============================================

module.exports = {
  id: 'gallery-mixed-grid',
  name: 'Gallery - Mixed Grid',
  category: 'gallery',
  description: 'Mixed-size image grid with large and small items, overlay captions',

  contentSchema: {
    title: { type: 'text', label: 'Section Title' },
    items: {
      type: 'array',
      label: 'Gallery Items',
      itemSchema: {
        image: { type: 'image', label: 'Image' },
        title: { type: 'text', label: 'Title' },
        caption: { type: 'text', label: 'Caption' },
        large: { type: 'boolean', label: 'Large (spans 2 columns)', default: false },
      }
    }
  },

  render(content, theme) {
    const items = content.items || [];

    const itemsHtml = items.map((item, i) => `
      <div class="gal-item${item.large ? ' gal-large' : ''}" style="animation-delay: ${0.1 + (i * 0.1)}s">
        <img src="${item.image || 'https://images.unsplash.com/photo-1552519507-22b3bf9e3b05?w=800'}" alt="${item.title || ''}" loading="lazy">
        <div class="gal-overlay">
          <h4>${item.title || ''}</h4>
          ${item.caption ? `<p>${item.caption}</p>` : ''}
        </div>
      </div>
    `).join('\n');

    return `
<section class="gallery-section" style="background: ${theme.surfaceColor};">
  <div class="gal-header">
    <h2>${content.title || 'Recent Work'}</h2>
  </div>
  <div class="gal-grid">
    ${itemsHtml}
  </div>
</section>
<style>
  .gallery-section {
    padding: 6rem 3rem 8rem;
    position: relative;
  }
  .gal-header { text-align: center; margin-bottom: 4rem; }
  .gal-header h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 3.5rem;
    font-weight: 800;
    color: ${theme.textColor};
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .gal-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }
  .gal-item {
    position: relative;
    border-radius: ${theme.borderRadius};
    overflow: hidden;
    aspect-ratio: 1;
    cursor: pointer;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    opacity: 0;
    animation: galFadeIn 0.6s ease-out forwards;
  }
  @keyframes galFadeIn {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
  }
  .gal-item:hover {
    transform: scale(1.05);
    box-shadow: 0 15px 50px ${theme.borderAccentHover};
  }
  .gal-large {
    grid-column: span 2;
    aspect-ratio: 4/3;
  }
  .gal-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease;
  }
  .gal-item:hover img { transform: scale(1.1); }
  .gal-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to top, rgba(10,10,10,0.95), transparent);
    padding: 2rem 1.5rem 1.5rem;
    color: #ffffff;
  }
  .gal-overlay h4 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1.2rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .gal-overlay p { font-size: 0.9rem; color: rgba(255,255,255,0.7); margin-top: 0.25rem; }

  .gallery-section::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0; right: 0;
    width: 100%;
    height: 80px;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 80' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'%3E%3Cdefs%3E%3ClinearGradient id='galGrad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:${encodeURIComponent(theme.primaryColor)};stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:${encodeURIComponent(theme.accentColor)};stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M 0,35 Q 250,5 600,35 T 1200,35 L 1200,80 L 0,80 Z' fill='url(%23galGrad)'/%3E%3C/svg%3E");
    background-size: 100% 100%;
    background-repeat: no-repeat;
  }

  @media (max-width: 768px) {
    .gal-grid { grid-template-columns: 1fr; }
    .gal-large { grid-column: span 1; }
    .gal-header h2 { font-size: 2.5rem; }
  }
</style>`;
  }
};
