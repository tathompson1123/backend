// ============================================
// TRUST BANNER - Scrolling Reviews
// ============================================

module.exports = {
  id: 'trust-banner-scroll',
  name: 'Scrolling Review Banner',
  category: 'trust',
  description: 'Animated scrolling banner showing customer reviews',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.9, cleaning: 0.9, hvac: 0.85,
    salonSpa: 0.8, fitness: 0.85, dental: 0.8, restaurant: 0.75,
    realEstate: 0.7, photography: 0.6, legal: 0.6, renovation: 0.85, petGrooming: 0.85,
  },
  mood: ['bold', 'friendly', 'clean'],

  contentSchema: {
    reviews: {
      type: 'array',
      label: 'Reviews',
      itemSchema: {
        text: { type: 'text', label: 'Review Text', default: 'Great service!' },
        author: { type: 'text', label: 'Author Name', default: 'Happy Customer' },
        rating: { type: 'number', label: 'Rating (1-5)', default: 5 },
      }
    }
  },

  render(content, theme, sectionId = 'trust') {
    const s = `section-${sectionId}`;
    const reviews = content.reviews || [
      { text: 'Great service!', author: 'Customer', rating: 5 },
    ];

    const allReviews = [...reviews, ...reviews];
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

    const reviewsHtml = allReviews.map(r =>
      `<div class="${s}-item"><span class="${s}-text">"${r.text}" - ${r.author}</span><span class="${s}-stars">${stars(r.rating || 5)}</span></div>`
    ).join('\n');

    return `
<div class="${s}">
  <div class="${s}-track">
    ${reviewsHtml}
  </div>
</div>
<style>
  .${s} { background: ${theme.primaryColor}; color: #ffffff; padding: 1rem 0; overflow: hidden; position: relative; z-index: 100; }
  .${s}-track { display: flex; animation: ${s}-scroll 40s linear infinite; width: max-content; }
  @keyframes ${s}-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  .${s}-item { display: flex; align-items: center; gap: 0.5rem; padding: 0 1.5rem; font-size: 0.9rem; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
  .${s}-stars { color: #FFD700; font-size: 0.85rem; letter-spacing: 1px; }
</style>`;
  }
};
