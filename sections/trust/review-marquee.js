// ============================================
// TRUST - Review Marquee
// Google-style scrolling review cards
// ============================================

module.exports = {
  id: 'review-marquee',
  name: 'Review Marquee',
  category: 'trust',
  description: 'Horizontally scrolling Google-style review cards on a semi-transparent bar',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.85, cleaning: 0.85, hvac: 0.8,
    salonSpa: 0.9, fitness: 0.85, dental: 0.8, restaurant: 0.9,
    realEstate: 0.75, photography: 0.7, legal: 0.7, renovation: 0.8, petGrooming: 0.85,
  },
  mood: ['social', 'trust', 'dynamic'],

  contentSchema: {
    reviews: {
      type: 'array',
      label: 'Reviews',
      itemSchema: {
        name:        { type: 'text',   label: 'Reviewer Name',  default: 'Customer' },
        date:        { type: 'text',   label: 'Date',           default: '1 week ago' },
        text:        { type: 'text',   label: 'Review Text',    default: 'Great service!' },
        stars:       { type: 'number', label: 'Stars (1-5)',    default: 5 },
        avatarColor: { type: 'text',   label: 'Avatar Color',   default: '#d97706' },
      }
    },
  },

  render(content, theme, sectionId = 'reviews') {
    const s = `section-${sectionId}`;
    const reviews = content.reviews || [];

    // Triple the reviews for seamless infinite scroll
    const tripled = [...reviews, ...reviews, ...reviews];

    const cardsHtml = tripled.map((r, i) => {
      const stars = Math.min(Math.max(Math.round(r.stars || 5), 1), 5);
      const starsHtml = '★'.repeat(stars) + '☆'.repeat(5 - stars);
      const initial = (r.name || 'C')[0].toUpperCase();
      const avatarBg = r.avatarColor || theme.primaryColor;
      return `
        <div class="${s}-card">
          <div class="${s}-card-header">
            <div class="${s}-avatar" style="background:${avatarBg};">${initial}</div>
            <div class="${s}-card-info">
              <div class="${s}-name">${r.name || 'Customer'}</div>
              <div class="${s}-stars">${starsHtml}</div>
            </div>
            <svg class="${s}-google-g" width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          </div>
          <p class="${s}-text">${r.text || ''}</p>
          <div class="${s}-date">${r.date || ''}</div>
        </div>`;
    }).join('');

    const trackWidth = reviews.length * 340; // 320px card + 20px gap

    return `
<div class="${s} reveal">
  <div class="${s}-track-wrap">
    <div class="${s}-track" style="width:${trackWidth * 3}px;">
      ${cardsHtml}
    </div>
  </div>
</div>
<style>
  .${s} {
    background: ${theme.surfaceColor || 'rgba(255,255,255,0.05)'};
    padding: 4.5rem 0;
    /* Pull up into the section above and down into the section below */
    margin: -2.5rem 0;
    position: relative;
    z-index: 5;
    /* Fade edges so cards softly disappear rather than hard-cut */
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%);
    mask-image: linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%);
  }
  .${s}-track-wrap {
    overflow: hidden;
  }
  .${s}-track {
    display: flex;
    gap: 1.25rem;
    animation: ${s}-scroll ${reviews.length * 3}s linear infinite;
  }
  .${s}-track:hover {
    animation-play-state: paused;
  }
  @keyframes ${s}-scroll {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-33.333%); }
  }
  .${s}-card {
    flex-shrink: 0;
    width: 320px;
    background: #ffffff;
    border-radius: 12px;
    padding: 1.25rem;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .${s}-card-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    position: relative;
  }
  .${s}-avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 700;
    font-size: 1.1rem;
    flex-shrink: 0;
  }
  .${s}-card-info {
    flex: 1;
  }
  .${s}-name {
    font-weight: 700;
    font-size: 0.95rem;
    color: #1f2937;
  }
  .${s}-stars {
    color: #f59e0b;
    font-size: 0.85rem;
    letter-spacing: 1px;
  }
  .${s}-google-g {
    flex-shrink: 0;
    margin-left: auto;
  }
  .${s}-text {
    font-size: 0.88rem;
    color: #4b5563;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
  }
  .${s}-date {
    font-size: 0.78rem;
    color: #9ca3af;
  }
</style>`;
  }
};
