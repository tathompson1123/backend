// ============================================
// BENEFITS - Numbered 3 Column
// Extracted from: auto-detailing-template/index.html
// ============================================

module.exports = {
  id: 'benefits-numbered',
  name: 'Benefits - Numbered',
  category: 'benefits',
  description: '3-column numbered benefits with large numbers (01, 02, 03)',

  contentSchema: {
    title: { type: 'text', label: 'Section Title' },
    benefits: {
      type: 'array',
      label: 'Benefits',
      itemSchema: {
        title: { type: 'text', label: 'Title' },
        description: { type: 'textarea', label: 'Description' },
      }
    }
  },

  render(content, theme) {
    const benefits = content.benefits || [];

    const benefitsHtml = benefits.map((b, i) => `
      <div class="ben-item" style="animation-delay: ${0.1 + (i * 0.2)}s">
        <div class="ben-number">${String(i + 1).padStart(2, '0')}</div>
        <h3>${b.title}</h3>
        <p>${b.description}</p>
      </div>
    `).join('\n');

    return `
<section class="benefits-section" style="background: ${theme.bgColor};">
  <div class="ben-header">
    <h2>${content.title || 'Why Choose Us?'}</h2>
  </div>
  <div class="ben-grid">
    ${benefitsHtml}
  </div>
</section>
<style>
  .benefits-section {
    padding: 4rem 3rem 8rem;
    position: relative;
  }
  .ben-header { text-align: center; margin-bottom: 3.5rem; }
  .ben-header h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 3.5rem;
    font-weight: 800;
    color: ${theme.textColor};
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .ben-grid {
    max-width: 1400px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4rem;
  }
  .ben-item {
    text-align: left;
    opacity: 0;
    animation: benFadeIn 0.8s ease-out forwards;
  }
  @keyframes benFadeIn {
    from { opacity: 0; transform: translateY(50px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ben-number {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 4rem;
    font-weight: 800;
    color: ${theme.primaryColor};
    line-height: 1;
    margin-bottom: 1rem;
  }
  .ben-item h3 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1.8rem;
    color: ${theme.textColor};
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .ben-item p {
    color: ${theme.textMuted};
    line-height: 1.8;
    font-size: 1.05rem;
  }

  .benefits-section::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0; right: 0;
    width: 100%;
    height: 80px;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 80' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'%3E%3Cpath d='M 0,40 Q 300,10 600,40 T 1200,40 L 1200,80 L 0,80 Z' fill='${encodeURIComponent(theme.surfaceColor)}'/%3E%3C/svg%3E");
    background-size: 100% 100%;
    background-repeat: no-repeat;
  }

  @media (max-width: 768px) {
    .ben-grid { grid-template-columns: 1fr; gap: 3rem; }
    .ben-header h2 { font-size: 2.5rem; }
  }
</style>`;
  }
};
