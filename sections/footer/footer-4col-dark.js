// ============================================
// FOOTER - 4 Column Dark
// Extracted from: auto-detailing-template
// ============================================

module.exports = {
  id: 'footer-4col-dark',
  name: 'Footer - 4 Column Dark',
  category: 'footer',
  description: 'Dark 4-column footer with logo, services, contact, and hours',

  contentSchema: {
    logo: { type: 'text', label: 'Logo/Brand Name' },
    tagline: { type: 'text', label: 'Tagline' },
    services: {
      type: 'array',
      label: 'Services List',
      itemSchema: {
        text: { type: 'text', label: 'Service Name' },
      }
    },
    phone: { type: 'text', label: 'Phone Number' },
    email: { type: 'text', label: 'Email Address' },
    hours: { type: 'textarea', label: 'Business Hours' },
  },

  render(content, theme) {
    const services = (content.services || []).map(s => s.text).join('<br>');

    return `
<footer class="site-footer" style="background: ${theme.bgColor};">
  <div class="ft-content">
    <div>
      <div class="ft-brand">${content.logo || 'Business Name'}</div>
      <p class="ft-tagline">${content.tagline || 'Professional services you can trust'}</p>
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
  <div class="ft-bottom">
    <p>© ${new Date().getFullYear()} ${content.logo || 'Business Name'}. All rights reserved.</p>
  </div>
</footer>
<style>
  .site-footer {
    color: ${theme.textColor};
    padding: 5rem 3rem 2rem;
    border-top: 1px solid ${theme.borderAccent};
  }
  .ft-content {
    max-width: 1400px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4rem;
  }
  .ft-brand {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 2rem;
    font-weight: 800;
    color: ${theme.primaryColor};
    text-transform: uppercase;
    letter-spacing: 2px;
  }
  .ft-tagline {
    color: ${theme.textMuted};
    margin-top: 1rem;
  }
  .ft-content h4 {
    color: ${theme.primaryColor};
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-family: '${theme.headingFont}', sans-serif;
  }
  .ft-content p {
    color: ${theme.textMuted};
    line-height: 2;
  }
  .ft-bottom {
    max-width: 1400px;
    margin: 3rem auto 0;
    padding-top: 2rem;
    border-top: 1px solid ${theme.borderAccent};
    text-align: center;
  }
  .ft-bottom p {
    color: ${theme.textMuted};
    font-size: 0.9rem;
  }

  @media (max-width: 768px) {
    .ft-content { grid-template-columns: 1fr; gap: 2rem; }
  }
</style>`;
  }
}
