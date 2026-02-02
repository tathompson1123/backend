// ============================================
// TESTIMONIALS - 3 Column Cards
// ============================================

module.exports = {
  id: 'testimonials-3col',
  name: 'Testimonials - 3 Column',
  category: 'testimonials',
  description: '3-column testimonial cards with stars, quote, author',

  contentSchema: {
    title: { type: 'text', label: 'Section Title' },
    testimonials: {
      type: 'array',
      label: 'Testimonials',
      itemSchema: {
        quote: { type: 'textarea', label: 'Quote' },
        author: { type: 'text', label: 'Author Name' },
        role: { type: 'text', label: 'Role/Title (e.g. Homeowner)' },
        rating: { type: 'number', label: 'Rating (1-5)', default: 5 },
      }
    }
  },

  render(content, theme) {
    const testimonials = content.testimonials || [];
    const stars = (n) => '★'.repeat(n || 5);

    const cardsHtml = testimonials.map((t, i) => `
      <div class="test-card" style="animation-delay: ${0.1 + (i * 0.15)}s">
        <div class="test-stars">${stars(t.rating)}</div>
        <blockquote>"${t.quote}"</blockquote>
        <div class="test-author">
          <div class="test-avatar">${(t.author || 'A')[0].toUpperCase()}</div>
          <div>
            <div class="test-name">${t.author || 'Customer'}</div>
            ${t.role ? `<div class="test-role">${t.role}</div>` : ''}
          </div>
        </div>
      </div>
    `).join('\n');

    return `
<section class="testimonials-section" style="background: ${theme.surfaceColor};">
  <div class="test-header">
    <h2>${content.title || 'What Our Customers Say'}</h2>
  </div>
  <div class="test-grid">
    ${cardsHtml}
  </div>
</section>
<style>
  .testimonials-section {
    padding: 6rem 3rem 8rem;
    position: relative;
  }
  .test-header { text-align: center; margin-bottom: 4rem; }
  .test-header h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 3.5rem;
    font-weight: 800;
    color: ${theme.textColor};
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .test-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }
  .test-card {
    background: ${theme.bgColor};
    padding: 2.5rem;
    border-radius: ${theme.borderRadius};
    border: 1px solid ${theme.borderAccent};
    transition: transform 0.3s, box-shadow 0.3s;
    opacity: 0;
    animation: testFadeIn 0.8s ease-out forwards;
  }
  @keyframes testFadeIn {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .test-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 15px 40px ${theme.borderAccentHover};
  }
  .test-stars {
    color: #FFD700;
    font-size: 1.4rem;
    margin-bottom: 1.5rem;
    letter-spacing: 2px;
  }
  .test-card blockquote {
    color: ${theme.textMuted};
    font-size: 1.1rem;
    line-height: 1.8;
    font-style: italic;
    margin-bottom: 2rem;
  }
  .test-author {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .test-avatar {
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
  .test-name {
    font-weight: 700;
    color: ${theme.textColor};
    font-size: 1rem;
  }
  .test-role {
    font-size: 0.85rem;
    color: ${theme.textMuted};
    margin-top: 0.15rem;
  }

  @media (max-width: 768px) {
    .test-grid { grid-template-columns: 1fr; }
    .test-header h2 { font-size: 2.5rem; }
  }
</style>`;
  }
};
