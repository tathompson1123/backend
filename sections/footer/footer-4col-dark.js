// ============================================
// FOOTER - 4 Column Dark
// ============================================

module.exports = {
  id: 'footer-4col-dark',
  name: 'Footer - 4 Column Dark',
  category: 'footer',
  description: 'Dark 4-column footer with logo, services, contact, and hours',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.85, cleaning: 0.8, hvac: 0.85,
    salonSpa: 0.7, fitness: 0.9, dental: 0.7, restaurant: 0.75,
    realEstate: 0.75, photography: 0.8, legal: 0.7, renovation: 0.85, petGrooming: 0.7,
  },
  mood: ['bold', 'luxury', 'rugged'],

  contentSchema: {
    logo: { type: 'text', label: 'Logo/Brand Name', default: 'Business Name' },
    tagline: { type: 'text', label: 'Tagline', default: 'Professional services you can trust' },
    services: {
      type: 'array',
      label: 'Services List',
      itemSchema: {
        text: { type: 'text', label: 'Service Name', default: 'Service' },
      }
    },
    phone: { type: 'text', label: 'Phone Number', default: '(555) 123-4567' },
    email: { type: 'text', label: 'Email Address', default: 'contact@example.com' },
    hours: { type: 'textarea', label: 'Business Hours', default: 'Mon-Fri: 8AM-6PM\nSat: 9AM-4PM\nSun: Closed' },
  },

  render(content, theme, sectionId = 'footer') {
    const s = `section-${sectionId}`;
    const services = (content.services || []).map(svc => svc.text).join('<br>');

    return `
<footer class="${s}" style="background: ${theme.bgColor};">
  <div class="${s}-content">
    <div>
      <div class="${s}-brand">${content.logo || 'Business Name'}</div>
      <p class="${s}-tagline">${content.tagline || 'Professional services you can trust'}</p>
    </div>
    <div>
      <h4>Services</h4>
      <p>${services || 'Our Services'}</p>
    </div>
    <div>
      <h4>Contact</h4>
      <p>${content.phone || ''}<br>${content.email || ''}</p>
    </div>
    <div>
      <h4>Hours</h4>
      <p>${(content.hours || '').replace(/\n/g, '<br>')}</p>
    </div>
  </div>
  <div class="${s}-bottom">
    <p>© ${new Date().getFullYear()} ${content.logo || 'Business Name'}. All rights reserved.</p>
  </div>
</footer>
<style>
  .${s} {
    color: ${theme.textColor};
    padding: 5rem 3rem 2rem;
    border-top: 1px solid ${theme.borderAccent};
  }
  .${s}-content {
    max-width: 1400px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4rem;
  }
  .${s}-brand {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 2rem;
    font-weight: 800;
    color: ${theme.primaryColor};
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .${s}-tagline {
    color: ${theme.textMuted};
    margin-top: 1rem;
  }
  .${s}-content h4 {
    color: ${theme.primaryColor};
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-family: '${theme.headingFont}', sans-serif;
  }
  .${s}-content p {
    color: ${theme.textMuted};
    line-height: 2;
  }
  .${s}-bottom {
    max-width: 1400px;
    margin: 3rem auto 0;
    padding-top: 2rem;
    border-top: 1px solid ${theme.borderAccent};
    text-align: center;
  }
  .${s}-bottom p {
    color: ${theme.textMuted};
    font-size: 0.9rem;
  }

  @media (max-width: 768px) {
    .${s}-content { grid-template-columns: 1fr; gap: 2rem; }
  }
</style>`;
  }
};
