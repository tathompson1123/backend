// ============================================
// BENEFITS - Numbered List
// Premium numbered benefits section
// ============================================

module.exports = {
  id: 'benefits-numbered',
  name: 'Benefits - Numbered',
  category: 'benefits',
  description: 'Numbered benefits list with clean layout',

  suitability: {
    autoDetailing: 0.9, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.85, fitness: 0.9, dental: 0.9, restaurant: 0.8,
    realEstate: 0.9, photography: 0.85, legal: 0.9, renovation: 0.9, petGrooming: 0.85,
  },
  mood: ['professional', 'organized', 'clear'],

  render(content, theme, sectionId = 'benefits') {
    const s = `section-${sectionId}`;
    const benefits = content.benefits || [];

    const benefitsHtml = benefits.map((b, i) => `
      <div class="${s}-item" style="animation-delay: ${0.1 + i * 0.15}s">
        <div class="${s}-number">0${i + 1}</div>
        <div class="${s}-content">
          <h3 class="${s}-title">${b.title || 'Benefit'}</h3>
          <p class="${s}-desc">${b.description || 'Description'}</p>
        </div>
      </div>
    `).join('');

    return `
<section class="${s}" style="background: ${theme.bgColor || '#ffffff'};">
  <div class="${s}-container">
    <div class="${s}-header">
      <span class="${s}-label">Why Choose Us</span>
      <h2 class="${s}-heading">${content.title || 'Our Benefits'}</h2>
    </div>
    
    <div class="${s}-grid">
      ${benefitsHtml}
    </div>
  </div>
</section>
<style>
  .${s} {
    padding: 6rem 2rem;
    position: relative;
  }
  
  .${s}-container {
    max-width: 1000px;
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
  
  .${s}-heading {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 800;
    color: ${theme.textColor || '#1f2937'};
  }
  
  .${s}-grid {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  
  .${s}-item {
    display: flex;
    gap: 2rem;
    align-items: flex-start;
    padding: 2rem;
    background: ${theme.surfaceColor || '#f9fafb'};
    border-radius: 20px;
    border: 1px solid ${theme.borderAccent || 'rgba(0,0,0,0.05)'};
    opacity: 0;
    animation: ${s}-slideIn 0.6s ease-out forwards;
    transition: all 0.3s ease;
  }
  
  .${s}-item:hover {
    transform: translateX(10px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
    border-color: ${theme.primaryColor}30;
  }
  
  @keyframes ${s}-slideIn {
    from { opacity: 0; transform: translateX(-30px); }
    to { opacity: 1; transform: translateX(0); }
  }
  
  .${s}-number {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 3rem;
    font-weight: 800;
    color: ${theme.primaryColor};
    line-height: 1;
    flex-shrink: 0;
    opacity: 0.9;
  }
  
  .${s}-content {
    flex: 1;
  }
  
  .${s}-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.35rem;
    font-weight: 700;
    color: ${theme.textColor || '#1f2937'};
    margin-bottom: 0.5rem;
  }
  
  .${s}-desc {
    font-size: 1rem;
    color: ${theme.textMuted || '#6b7280'};
    line-height: 1.7;
  }
  
  @media (max-width: 640px) {
    .${s} {
      padding: 4rem 1.5rem;
    }
    
    .${s}-item {
      flex-direction: column;
      gap: 1rem;
      padding: 1.5rem;
    }
    
    .${s}-number {
      font-size: 2.5rem;
    }
  }
</style>`;
  }
};
