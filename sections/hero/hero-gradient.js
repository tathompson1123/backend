// ============================================
// HERO - Gradient Banner
// Extracted from: auto-detailing-template/contact.html
// ============================================

module.exports = {
  id: 'hero-gradient',
  name: 'Hero - Gradient Banner',
  category: 'hero',
  description: 'Gradient background hero with badge, headline, subtitle, and feature pills',

  contentSchema: {
    badge: { type: 'text', label: 'Badge Text (optional)' },
    headline: { type: 'text', label: 'Headline' },
    subtitle: { type: 'textarea', label: 'Subtitle' },
    features: {
      type: 'array',
      label: 'Feature Pills',
      itemSchema: {
        text: { type: 'text', label: 'Feature Text' },
      }
    }
  },

  render(content, theme) {
    const badge = content.badge ? `<div class="hero-grad-badge">${content.badge}</div>` : '';
    const features = (content.features || []).map(f =>
      `<div class="hero-grad-feature">✓ ${f.text}</div>`
    ).join('\n');
    const featuresHtml = features ? `<div class="hero-grad-features">${features}</div>` : '';

    return `
<section class="hero-gradient">
  ${badge}
  <h1>${content.headline || 'Page Title'}</h1>
  <p>${content.subtitle || ''}</p>
  ${featuresHtml}
</section>
<style>
  .hero-gradient {
    background: linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor});
    padding: 6rem 3rem 4rem;
    text-align: center;
    color: #ffffff;
    position: relative;
  }
  .hero-grad-badge {
    display: inline-block;
    background: rgba(255,255,255,0.2);
    padding: 0.5rem 1.5rem;
    border-radius: 50px;
    font-weight: 700;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 1.5rem;
  }
  .hero-gradient h1 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 4.5rem;
    font-weight: 800;
    margin-bottom: 1.5rem;
    text-transform: uppercase;
    letter-spacing: 3px;
  }
  .hero-gradient p {
    font-size: 1.4rem;
    max-width: 700px;
    margin: 0 auto 2rem;
    opacity: 0.95;
  }
  .hero-grad-features {
    display: flex;
    gap: 3rem;
    justify-content: center;
    margin-top: 3rem;
    font-size: 1.1rem;
    font-weight: 600;
    flex-wrap: wrap;
  }
  .hero-grad-feature { display: flex; align-items: center; gap: 0.5rem; }

  @media (max-width: 768px) {
    .hero-gradient {
      padding-top: 8rem;
    }
    .hero-gradient h1 { font-size: 3rem; }
    .hero-grad-features { flex-direction: column; gap: 1rem; }
  }
</style>`;
  }
};
