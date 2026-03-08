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

  render(content, theme, sectionId = 'hero-gradient') {
    const s = `section-${sectionId}`;
    const badge = content.badge ? `<div class="${s}-badge">${content.badge}</div>` : '';
    const features = (content.features || []).map(f =>
      `<div class="${s}-feature">✓ ${f.text}</div>`
    ).join('\n');
    const featuresHtml = features ? `<div class="${s}-features">${features}</div>` : '';

    return `
<section class="${s}">
  ${badge}
  <h1 class="${s}-headline">${content.headline || 'Page Title'}</h1>
  <p class="${s}-subtitle">${content.subtitle || ''}</p>
  ${featuresHtml}
</section>
<style>
  .${s} {
    background: linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor || theme.primaryColor});
    padding: 6rem 3rem 4rem;
    text-align: center;
    color: #ffffff;
    position: relative;
  }
  .${s}-badge {
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
  .${s}-headline {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(2.5rem, 6vw, 4.5rem);
    font-weight: 800;
    margin-bottom: 1.5rem;
    text-transform: uppercase;
    letter-spacing: 3px;
    color: #ffffff;
  }
  .${s}-subtitle {
    font-size: clamp(1rem, 2vw, 1.4rem);
    max-width: 700px;
    margin: 0 auto 2rem;
    opacity: 0.95;
    color: rgba(255, 255, 255, 0.95);
  }
  .${s}-features {
    display: flex;
    gap: 3rem;
    justify-content: center;
    margin-top: 3rem;
    font-size: 1.1rem;
    font-weight: 600;
    flex-wrap: wrap;
  }
  .${s}-feature { display: flex; align-items: center; gap: 0.5rem; }

  @media (max-width: 768px) {
    .${s} {
      padding: 8rem 1.5rem 4rem;
    }
    .${s}-features { flex-direction: column; gap: 1rem; }
  }
</style>`;
  }
};
