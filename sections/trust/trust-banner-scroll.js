// ============================================
// TRUST BANNER - Scrolling Reviews
// Extracted from: auto-detailing-template
// ============================================

module.exports = {
  id: 'trust-banner-scroll',
  name: 'Scrolling Review Banner',
  category: 'trust',
  description: 'Animated scrolling banner showing customer reviews',

  contentSchema: {
    reviews: {
      type: 'array',
      label: 'Reviews',
      itemSchema: {
        text: { type: 'text', label: 'Review Text' },
        author: { type: 'text', label: 'Author Name' },
        rating: { type: 'number', label: 'Rating (1-5)', default: 5 },
      }
    }
  },

  render(content, theme) {
    const reviews = content.reviews || [
      { text: 'Great service!', author: 'Customer', rating: 5 },
    ];

    // Duplicate reviews for seamless scroll loop
    const allReviews = [...reviews, ...reviews];
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

    const reviewsHtml = allReviews.map(r =>
      `<div class="review-item"><span class="review-text">"${r.text}" - ${r.author}</span><span class="stars">${stars(r.rating || 5)}</span></div>`
    ).join('\n');

    return `
<div class="trust-banner">
  <div class="reviews-track">
    ${reviewsHtml}
  </div>
</div>
<style>
  .trust-banner { background: ${theme.primaryColor}; color: #ffffff; padding: 1rem 0; overflow: hidden; position: relative; z-index: 100; }
  .reviews-track { display: flex; animation: trustScroll 40s linear infinite; width: max-content; }
  @keyframes trustScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  .review-item { display: flex; align-items: center; gap: 0.5rem; padding: 0 1.5rem; font-size: 0.9rem; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
  .stars { color: #FFD700; font-size: 0.85rem; letter-spacing: 1px; }
</style>`;
  }
};
