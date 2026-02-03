// ============================================
// TESTIMONIALS - 3 Column Cards
// Premium testimonial cards with ratings
// ============================================

module.exports = {
  id: 'testimonials-3col',
  name: 'Testimonials - 3 Column',
  category: 'testimonials',
  description: 'Three column testimonial cards with star ratings and author info',

  suitability: {
    autoDetailing: 0.9, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.95, fitness: 0.9, dental: 0.95, restaurant: 0.9,
    realEstate: 0.85, photography: 0.85, legal: 0.8, renovation: 0.9, petGrooming: 0.9,
  },
  mood: ['trustworthy', 'social-proof', 'credible'],

  contentSchema: {
    title: { type: 'text', label: 'Section Title', default: 'What Our Clients Say' },
    testimonials: {
      type: 'array',
      label: 'Testimonials',
      itemSchema: {
        quote: { type: 'textarea', label: 'Quote' },
        author: { type: 'text', label: 'Author Name' },
        role: { type: 'text', label: 'Role/Title' },
        avatar: { type: 'image', label: 'Avatar URL' },
        rating: { type: 'number', label: 'Rating (1-5)' },
      },
    },
  },

  render(content, theme, sectionId = 'testimonials') {
    const s = `section-${sectionId}`;
    const testimonials = content.testimonials || [];

    const testimonialsHtml = testimonials.map((t, i) => {
      const stars = '★'.repeat(t.rating || 5) + '☆'.repeat(5 - (t.rating || 5));
      const initials = (t.author || 'A').split(' ').map(n => n[0]).join('').toUpperCase();
      
      return `
        <div class="${s}-card" style="animation-delay: ${0.1 + i * 0.15}s">
          <div class="${s}-card-header">
            <div class="${s}-stars">${stars}</div>
            <svg class="${s}-quote-icon" width="32" height="32" viewBox="0 0 24 24" fill="${theme.primaryColor}20">
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
            </svg>
          </div>
          <blockquote class="${s}-quote">"${t.quote || 'Great service!'}"</blockquote>
          <div class="${s}-author">
            <div class="${s}-avatar">
              ${t.avatar 
                ? `<img src="${t.avatar}" alt="${t.author}">` 
                : `<span>${initials}</span>`
              }
            </div>
            <div class="${s}-author-info">
              <span class="${s}-author-name">${t.author || 'Happy Customer'}</span>
              ${t.role ? `<span class="${s}-author-role">${t.role}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
<section class="${s}" id="reviews" style="background: ${theme.surfaceColor || '#f9fafb'};">
  <div class="${s}-container">
    <div class="${s}-header">
      <span class="${s}-label">Testimonials</span>
      <h2 class="${s}-title">${content.title || 'What Our Clients Say'}</h2>
    </div>
    
    <div class="${s}-grid">
      ${testimonialsHtml}
    </div>
  </div>
</section>
<style>
  .${s} {
    padding: 6rem 2rem;
    position: relative;
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
    gap: 2rem;
  }
  
  .${s}-card {
    background: ${theme.bgColor || '#ffffff'};
    padding: 2rem;
    border-radius: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0;
    animation: ${s}-cardIn 0.6s ease-out forwards;
    border: 1px solid ${theme.borderAccent || 'rgba(0,0,0,0.05)'};
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  
  .${s}-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.12);
  }
  
  @keyframes ${s}-cardIn {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .${s}-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.25rem;
  }
  
  .${s}-stars {
    color: #fbbf24;
    font-size: 1.1rem;
    letter-spacing: 2px;
  }
  
  .${s}-quote-icon {
    opacity: 0.5;
  }
  
  .${s}-quote {
    font-size: 1.05rem;
    line-height: 1.8;
    color: ${theme.textColor || '#374151'};
    font-style: italic;
    margin-bottom: 1.5rem;
    flex-grow: 1;
  }
  
  .${s}-author {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-top: 1.25rem;
    border-top: 1px solid ${theme.borderAccent || 'rgba(0,0,0,0.08)'};
  }
  
  .${s}-avatar {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    overflow: hidden;
    background: linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor || theme.primaryColor});
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  
  .${s}-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .${s}-avatar span {
    color: #ffffff;
    font-weight: 700;
    font-size: 1.1rem;
  }
  
  .${s}-author-info {
    display: flex;
    flex-direction: column;
  }
  
  .${s}-author-name {
    font-weight: 700;
    color: ${theme.textColor || '#1f2937'};
    font-size: 1rem;
  }
  
  .${s}-author-role {
    font-size: 0.85rem;
    color: ${theme.textMuted || '#6b7280'};
    margin-top: 0.15rem;
  }
  
  @media (max-width: 1024px) {
    .${s}-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  
  @media (max-width: 640px) {
    .${s} {
      padding: 4rem 1.5rem;
    }
    
    .${s}-grid {
      grid-template-columns: 1fr;
    }
    
    .${s}-card {
      padding: 1.5rem;
    }
  }
</style>`;
  }
};
