// ============================================
// GALLERY - Filtered
// Filterable grid gallery with lightbox
// ============================================

module.exports = {
  id: 'gallery-filtered',
  name: 'Gallery Filtered',
  category: 'gallery',
  description: 'Category-filterable image grid with full-screen lightbox on click',

  suitability: {
    autoDetailing: 0.98, landscaping: 0.92, cleaning: 0.75, hvac: 0.6,
    salonSpa: 0.95, fitness: 0.85, dental: 0.7, restaurant: 0.9,
    realEstate: 0.95, photography: 0.98, legal: 0.4, renovation: 0.92, petGrooming: 0.88,
  },
  mood: ['visual', 'portfolio', 'interactive'],

  contentSchema: {
    title:      { type: 'text', label: 'Title',      default: 'Our Work' },
    subtitle:   { type: 'text', label: 'Subtitle',   default: '' },
    highlight:  { type: 'text', label: 'Highlight Word (in title)', default: '' },
    categories: { type: 'array', label: 'Categories', itemSchema: { type: 'text' } },
    items: {
      type: 'array', label: 'Gallery Items',
      itemSchema: {
        url:      { type: 'url',  label: 'Image URL', default: '' },
        title:    { type: 'text', label: 'Title',     default: 'Image' },
        category: { type: 'text', label: 'Category',  default: 'All' },
      }
    },
  },

  render(content, theme, sectionId = 'galfilter') {
    const s = `section-${sectionId}`;
    const uid = sectionId.replace(/[^a-zA-Z0-9]/g, '');
    const categories = content.categories || ['All'];
    const items = content.items || [];
    const highlight = content.highlight || '';

    // Build title with optional highlight word
    let titleHtml;
    if (highlight && (content.title || '').includes(highlight)) {
      titleHtml = (content.title || 'Our Work').replace(highlight, `<span class="${s}-highlight">${highlight}</span>`);
    } else {
      titleHtml = content.title || 'Our Work';
    }

    const filterBtns = categories.map((cat, i) => `
      <button class="${s}-filter ${i === 0 ? 'active' : ''}" data-cat="${cat}">${cat}</button>
    `).join('');

    const gridItems = items.map((item, i) => `
      <div class="${s}-item reveal" style="transition-delay:${Math.min(i, 5) * 0.08}s;" data-category="${item.category || 'All'}" onclick="window.${uid}Lightbox(${i})">
        <img src="${item.url || ''}" alt="${item.title || 'Gallery image'}" loading="lazy">
        <div class="${s}-item-overlay">
          <span class="${s}-item-cat">${item.category || ''}</span>
          <span class="${s}-item-title">${item.title || ''}</span>
        </div>
      </div>
    `).join('');

    return `
<section class="${s}" style="background:${theme.bgColor || '#020617'};">
  <div class="${s}-container">
    <div class="${s}-header reveal">
      <h2 class="${s}-heading">${titleHtml}</h2>
      ${content.subtitle ? `<p class="${s}-sub">${content.subtitle}</p>` : ''}
      <div class="${s}-filters">
        ${filterBtns}
      </div>
    </div>
    <div class="${s}-grid" id="${s}-grid">
      ${gridItems}
    </div>
  </div>
</section>
<!-- Lightbox -->
<div class="${s}-lightbox" id="${s}-lightbox" onclick="window.${uid}LightboxClose(event)">
  <button class="${s}-lb-close" onclick="window.${uid}LightboxClose()">&times;</button>
  <img class="${s}-lb-img" id="${s}-lb-img" src="" alt="Lightbox image">
</div>
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
    margin-bottom: 3rem;
  }
  .${s}-heading {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 800;
    color: ${theme.textColor || '#ffffff'};
    margin-bottom: 0.75rem;
  }
  .${s}-highlight {
    color: ${theme.primaryColor};
  }
  .${s}-sub {
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    font-size: 1rem;
    margin-bottom: 1.75rem;
  }
  .${s}-filters {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.6rem;
  }
  .${s}-filter {
    padding: 0.5rem 1.25rem;
    border-radius: 50px;
    border: 1px solid rgba(255,255,255,0.2);
    background: transparent;
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s;
  }
  .${s}-filter:hover {
    border-color: #fff;
    color: #fff;
  }
  .${s}-filter.active {
    background: ${theme.primaryColor};
    border-color: ${theme.primaryColor};
    color: #fff;
  }
  .${s}-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-auto-rows: 300px;
    gap: 1rem;
  }
  .${s}-item {
    position: relative;
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
  }
  .${s}-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease;
  }
  .${s}-item:hover img {
    transform: scale(1.05);
  }
  .${s}-item-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 55%);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 1.5rem;
    opacity: 0;
    transition: opacity 0.35s;
  }
  .${s}-item:hover .${s}-item-overlay {
    opacity: 1;
  }
  .${s}-item-cat {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: ${theme.primaryColor};
    margin-bottom: 0.2rem;
  }
  .${s}-item-title {
    font-size: 1rem;
    font-weight: 700;
    color: #fff;
  }
  .${s}-item.hidden {
    display: none;
  }
  /* Lightbox */
  .${s}-lightbox {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(8px);
    z-index: 9999;
    align-items: center;
    justify-content: center;
  }
  .${s}-lightbox.open {
    display: flex;
  }
  .${s}-lb-close {
    position: absolute;
    top: 1.5rem;
    right: 2rem;
    background: none;
    border: none;
    color: #fff;
    font-size: 2.5rem;
    cursor: pointer;
    z-index: 10000;
    line-height: 1;
    transition: color 0.2s;
  }
  .${s}-lb-close:hover {
    color: ${theme.primaryColor};
  }
  .${s}-lb-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  @media (max-width: 768px) {
    .${s}-grid {
      grid-template-columns: repeat(2, 1fr);
      grid-auto-rows: 220px;
    }
  }
  @media (max-width: 500px) {
    .${s}-grid {
      grid-template-columns: 1fr;
      grid-auto-rows: 260px;
    }
  }
</style>
<script>
(function(){
  var uid = '${uid}';
  var s = '${s}';
  var items = document.querySelectorAll('.' + s + '-item');
  var filters = document.querySelectorAll('.' + s + '-filter');
  var lightbox = document.getElementById(s + '-lightbox');
  var lbImg = document.getElementById(s + '-lb-img');
  var allImages = [];
  items.forEach(function(item) {
    allImages.push(item.querySelector('img').getAttribute('src'));
  });

  filters.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var cat = this.getAttribute('data-cat');
      filters.forEach(function(f){ f.classList.remove('active'); });
      this.classList.add('active');
      items.forEach(function(item) {
        if (cat === 'All' || item.getAttribute('data-category') === cat) {
          item.classList.remove('hidden');
        } else {
          item.classList.add('hidden');
        }
      });
    });
  });

  window[uid + 'Lightbox'] = function(idx) {
    lbImg.src = allImages[idx];
    lightbox.classList.add('open');
  };

  window[uid + 'LightboxClose'] = function(e) {
    if (!e || e.target === lightbox || e.target === lightbox.querySelector('button')) {
      lightbox.classList.remove('open');
    }
  };

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') lightbox.classList.remove('open');
  });
})();
</script>`;
  }
};
