// ============================================
// TESTIMONIALS - 3 Column Cards
// ============================================

module.exports = {
  id: 'testimonials-3col',
  name: 'Testimonials - 3 Column',
  category: 'testimonials',
  description: '3-column testimonial cards with stars, quote, author',

  suitability: {
    autoDetailing: 0.9, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.9, fitness: 0.85, dental: 0.9, restaurant: 0.85,
    realEstate: 0.9, photography: 0.8, legal: 0.85, renovation: 0.9, petGrooming: 0.9,
  },
  mood: ['bold', 'clean', 'friendly', 'luxury'],

  contentSchema: {
    title: { type: 'text', label: 'Section Title', default: 'What Our Customers Say' },
    testimonials: {
      type: 'array',
      label: 'Testimonials',
      itemSchema: {
        quote: { type: 'textarea', label: 'Quote', default: 'Great experience!' },
        author: { type: 'text', label: 'Author Name', default: 'Customer' },
        role: { type: 'text', label: 'Role/Title (e.g. Homeowner)', default: 'Customer' },
        rating: { type: 'number', label: 'Rating (1-5)', default: 5 },
      }
    }
  },

  render(content, theme, sectionId = 'test') {
    const s = `section-${sectionId}`;
    const testimonials = content.testimonials || [];
    const stars = (n) => '★'.repeat(n || 5);

    const cardsHtml = testimonials.map((t, i) => `
      <div class="${s}-card" style="animation-delay: ${0.1 + (i * 0.15)}s">
        <div class="${s}-stars">${stars(t.rating)}</div>
        <blockquote>"${t.quote}"</blockquote>
        <div class="${s}-author">
          <div class="${s}-avatar">${(t.author || 'A')[0].toUpperCase()}</div>
          <div>
            <div class="${s}-name">${t.author || 'Customer'}</div>
            ${t.role ? `<div class="${s}-role">${t.role}</div>` : ''}
          </div>
        </div>
      </div>
    `).join('\n');

    return `
<section class="${s}" style="background: ${theme.surfaceColor};">
  <div class="${s}-header">
    <h2>${content.title || 'What Our Customers Say'}</h2>
  </div>
  <div class="${s}-grid">
    ${cardsHtml}
  </div>
</section>
<style>
  .${s} {
    padding: 6rem 3rem 8rem;
    position: relative;
  }
  .${s}-header { text-align: center; margin-bottom: 4rem; }
  .${s}-header h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 3.5rem;
    font-weight: 800;
    color: ${theme.textColor};
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .${s}-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }
  .${s}-card {
    background: ${theme.bgColor};
    padding: 2.5rem;
    border-radius: ${theme.borderRadius};
    border: 1px solid ${theme.borderAccent};
    transition: transform 0.3s, box-shadow 0.3s;
    opacity: 0;
    animation: ${s}-fadeIn 0.8s ease-out forwards;
  }
  @keyframes ${s}-fadeIn {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .${s}-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 15px 40px ${theme.borderAccentHover};
  }
  .${s}-stars {
    color: #FFD700;
    font-size: 1.4rem;
    margin-bottom: 1.5rem;
    letter-spacing: 2px;
  }
  .${s}-card blockquote {
    color: ${theme.textMuted};
    font-size: 1.1rem;
    line-height: 1.8;
    font-style: italic;
    margin-bottom: 2rem;
  }
  .${s}-author {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .${s}-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor});
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-weight: 700;
    font-size: 1.2rem;
    flex-shrink: 0;
  }
  .${s}-name {
    font-weight: 700;
    color: ${theme.textColor};
    font-size: 1rem;
  }
  .${s}-role {
    font-size: 0.85rem;
    color: ${theme.textMuted};
    margin-top: 0.15rem;
  }

  @media (max-width: 768px) {
    .${s}-grid { grid-template-columns: 1fr; }
    .${s}-header h2 { font-size: 2.5rem; }
  }
</style>`;
  }
};
