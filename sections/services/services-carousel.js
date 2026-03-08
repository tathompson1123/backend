// ============================================
// SERVICES - Carousel
// 3-card carousel with center focus, arrows, and badge
// ============================================

module.exports = {
  id: 'services-carousel',
  name: 'Services Carousel',
  category: 'services',
  description: 'Carousel of service cards — center card is large, sides are scaled down',

  suitability: {
    autoDetailing: 0.98, landscaping: 0.85, cleaning: 0.85, hvac: 0.9,
    salonSpa: 0.9, fitness: 0.88, dental: 0.85, restaurant: 0.8,
    realEstate: 0.7, photography: 0.75, legal: 0.7, renovation: 0.85, petGrooming: 0.8,
  },
  mood: ['interactive', 'showcase', 'premium'],

  contentSchema: {
    title:    { type: 'text',     label: 'Section Title',    default: 'Our Services' },
    subtitle: { type: 'textarea', label: 'Section Subtitle', default: '' },
    services: {
      type: 'array', label: 'Service Packages',
      itemSchema: {
        title:       { type: 'text',   label: 'Service Name',  default: 'Service' },
        category:    { type: 'text',   label: 'Category',      default: 'General' },
        price:       { type: 'text',   label: 'Price',         default: '$199' },
        image:       { type: 'url',    label: 'Image URL',     default: '' },
        features:    { type: 'array',  label: 'Features',      itemSchema: { type: 'text' } },
        recommended: { type: 'boolean', label: 'Best Value?',  default: false },
      }
    },
  },

  render(content, theme, sectionId = 'carousel') {
    const s = `section-${sectionId}`;
    const services = content.services || [];
    const uid = sectionId.replace(/[^a-zA-Z0-9]/g, '');

    const cardsHtml = services.map((svc, i) => {
      const featuresHtml = (svc.features || []).map(f =>
        `<li class="${s}-feature"><span class="${s}-check">✓</span>${f}</li>`
      ).join('');

      return `
        <div class="${s}-card" data-index="${i}">
          ${svc.recommended ? `<div class="${s}-badge">Best Value</div>` : ''}
          <div class="${s}-card-image">
            <img src="${svc.image || ''}" alt="${svc.title || 'Service'}" loading="lazy">
            <div class="${s}-card-overlay">
              <span class="${s}-category">${svc.category || ''}</span>
              <h3 class="${s}-card-title">${svc.title || 'Service'}</h3>
            </div>
          </div>
          <div class="${s}-card-body">
            <div class="${s}-price">${svc.price || ''}</div>
            <ul class="${s}-features">${featuresHtml}</ul>
            <a href="#contact" class="${s}-cta">Book Now</a>
          </div>
        </div>`;
    }).join('');

    return `
<section class="${s}" style="background:${theme.bgColor || '#020617'};">
  <div class="${s}-header reveal">
    <h2 class="${s}-title">${content.title || 'Our Services'}</h2>
    ${content.subtitle ? `<p class="${s}-subtitle">${content.subtitle}</p>` : ''}
  </div>
  <div class="${s}-viewport">
    <div class="${s}-track">
      ${cardsHtml}
    </div>
    <button class="${s}-arrow ${s}-arrow-left" onclick="window.${uid}Carousel(-1)">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="${s}-arrow ${s}-arrow-right" onclick="window.${uid}Carousel(1)">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
    </button>
  </div>
  <div class="${s}-dots" id="${s}-dots"></div>
</section>
<style>
  .${s} {
    padding: 6rem 0;
    overflow: hidden;
  }
  .${s}-header {
    text-align: center;
    margin-bottom: 3rem;
    padding: 0 2rem;
  }
  .${s}-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 800;
    color: ${theme.textColor || '#ffffff'};
    margin-bottom: 0.75rem;
  }
  .${s}-subtitle {
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    font-size: 1.05rem;
    line-height: 1.6;
    max-width: 540px;
    margin: 0 auto;
  }
  .${s}-viewport {
    position: relative;
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
    height: 580px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .${s}-track {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .${s}-card {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 380px;
    max-width: 90vw;
    background: ${theme.surfaceColor || '#0f172a'};
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    overflow: hidden;
    transition: transform 0.6s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.6s cubic-bezier(0.32, 0.72, 0, 1), z-index 0s 0.3s;
    transform: translate(-50%, -50%) scale(0.7);
    opacity: 0;
    z-index: 0;
    pointer-events: none;
  }
  .${s}-card.${s}-card.carousel-center {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
    z-index: 10;
    pointer-events: auto;
  }
  .${s}-card.carousel-left {
    transform: translate(calc(-50% - 85%), -50%) scale(0.95);
    opacity: 0.8;
    z-index: 5;
  }
  .${s}-card.carousel-right {
    transform: translate(calc(-50% + 85%), -50%) scale(0.95);
    opacity: 0.8;
    z-index: 5;
  }
  .${s}-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 2;
    background: ${theme.primaryColor};
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 0.35rem 0.8rem;
    border-radius: 50px;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .${s}-card.carousel-center .${s}-badge {
    opacity: 1;
  }
  .${s}-card-image {
    position: relative;
    height: 192px;
    overflow: hidden;
  }
  .${s}-card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .${s}-card-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 1.5rem 1.25rem 1rem;
    background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%);
  }
  .${s}-category {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: ${theme.primaryColor};
    margin-bottom: 0.25rem;
  }
  .${s}-card-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.25rem;
    font-weight: 700;
    color: #fff;
    margin: 0;
  }
  .${s}-card-body {
    padding: 1.25rem;
  }
  .${s}-price {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.6rem;
    font-weight: 800;
    color: ${theme.primaryColor};
    margin-bottom: 0.75rem;
  }
  .${s}-features {
    list-style: none;
    margin: 0 0 1.25rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .${s}-feature {
    font-size: 0.88rem;
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .${s}-check {
    color: ${theme.primaryColor};
    font-weight: 700;
    font-size: 0.95rem;
  }
  .${s}-cta {
    display: block;
    width: 100%;
    text-align: center;
    padding: 0.8rem;
    border-radius: 50px;
    font-weight: 700;
    font-size: 0.9rem;
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 1px;
    background: rgba(255,255,255,0.08);
    color: ${theme.textMuted || 'rgba(255,255,255,0.6)'};
    border: 1px solid rgba(255,255,255,0.15);
    pointer-events: none;
    transition: background 0.3s, color 0.3s, box-shadow 0.3s;
  }
  .${s}-card.carousel-center .${s}-cta {
    background: ${theme.primaryColor};
    color: #fff;
    border-color: ${theme.primaryColor};
    pointer-events: auto;
    box-shadow: 0 4px 20px ${theme.primaryColor}40;
  }
  .${s}-card.carousel-center .${s}-cta:hover {
    box-shadow: 0 6px 28px ${theme.primaryColor}60;
  }
  .${s}-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: ${theme.surfaceColor || '#0f172a'};
    border: 2px solid ${theme.primaryColor}50;
    color: ${theme.textColor || '#fff'};
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20;
    transition: background 0.3s, border-color 0.3s, color 0.3s;
    box-shadow: 0 2px 12px rgba(0,0,0,0.18);
  }
  .${s}-arrow:hover {
    background: ${theme.primaryColor};
    border-color: ${theme.primaryColor};
    color: #fff;
  }
  .${s}-arrow-left  { left: 1rem; }
  .${s}-arrow-right { right: 1rem; }
  .${s}-dots {
    display: flex;
    justify-content: center;
    gap: 0.6rem;
    margin-top: 2rem;
  }
  .${s}-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.2);
    cursor: pointer;
    transition: background 0.3s;
  }
  .${s}-dot.active {
    background: ${theme.primaryColor};
  }
  @media (max-width: 768px) {
    .${s}-viewport {
      height: 520px;
    }
    .${s}-card {
      width: 85vw;
    }
    .${s}-card.carousel-left,
    .${s}-card.carousel-right {
      opacity: 0;
    }
    .${s}-arrow-left  { left: 0.5rem; }
    .${s}-arrow-right { right: 0.5rem; }
  }
</style>
<script>
(function(){
  var cards = document.querySelectorAll('.${s}-card');
  var total = cards.length;
  var current = ${services.indexOf(services.find(s => s.recommended)) >= 0 ? services.indexOf(services.find(s => s.recommended)) : 0};
  var dotsContainer = document.getElementById('${s}-dots');

  // Build dots
  for (var i = 0; i < total; i++) {
    var dot = document.createElement('div');
    dot.className = '${s}-dot' + (i === current ? ' active' : '');
    dot.setAttribute('data-idx', i);
    dot.addEventListener('click', function(){ update(parseInt(this.getAttribute('data-idx'))); });
    dotsContainer.appendChild(dot);
  }

  function update(idx) {
    current = ((idx % total) + total) % total;
    var prev = ((current - 1) % total + total) % total;
    var next = (current + 1) % total;
    cards.forEach(function(c, i) {
      c.classList.remove('carousel-center', 'carousel-left', 'carousel-right');
      if (i === current) c.classList.add('carousel-center');
      else if (i === prev) c.classList.add('carousel-left');
      else if (i === next) c.classList.add('carousel-right');
    });
    var dots = dotsContainer.querySelectorAll('.${s}-dot');
    dots.forEach(function(d, i) { d.classList.toggle('active', i === current); });
  }

  window.${uid}Carousel = function(dir) { update(current + dir); };
  update(current);
})();
</script>`;
  }
};
