// ============================================
// FOOTER - 4 Column Dark
// Premium dark footer with multiple columns
// ============================================

module.exports = {
  id: 'footer-4col-dark',
  name: 'Footer - 4 Column Dark',
  category: 'footer',
  description: 'Dark footer with logo, services, hours, and contact',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.95, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.85, fitness: 0.9, dental: 0.85, restaurant: 0.9,
    realEstate: 0.85, photography: 0.9, legal: 0.85, renovation: 0.9, petGrooming: 0.9,
  },
  mood: ['professional', 'complete', 'trustworthy'],

  render(content, theme, sectionId = 'footer') {
    const s = `section-${sectionId}`;
    const services = content.services || [];
    const servicesHtml = services.map(svc => `<li>${svc.text || svc}</li>`).join('');
    const year = new Date().getFullYear();

    return `
<footer class="${s}">
  <div class="${s}-main">
    <div class="${s}-container">
      <div class="${s}-col ${s}-brand">
        <h3 class="${s}-logo">${content.logo || 'Business'}</h3>
        ${content.tagline ? `<p class="${s}-tagline">${content.tagline}</p>` : ''}
        <div class="${s}-social">
          <a href="#" class="${s}-social-link" aria-label="Facebook">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          </a>
          <a href="#" class="${s}-social-link" aria-label="Instagram">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          </a>
          <a href="#" class="${s}-social-link" aria-label="Google">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          </a>
        </div>
      </div>
      
      <div class="${s}-col">
        <h4 class="${s}-heading">Services</h4>
        <ul class="${s}-list">
          ${servicesHtml}
        </ul>
      </div>
      
      <div class="${s}-col">
        <h4 class="${s}-heading">Hours</h4>
        <div class="${s}-hours">${(content.hours || 'Mon-Fri: 9AM-5PM').replace(/\\n/g, '<br>').replace(/,\\s*/g, '<br>')}</div>
      </div>
      
      <div class="${s}-col">
        <h4 class="${s}-heading">Contact</h4>
        <div class="${s}-contact">
          ${content.phone ? `
          <a href="tel:${(content.phone || '').replace(/\\D/g, '')}" class="${s}-contact-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            ${content.phone}
          </a>
          ` : ''}
          ${content.email ? `
          <a href="mailto:${content.email}" class="${s}-contact-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            ${content.email}
          </a>
          ` : ''}
        </div>
      </div>
    </div>
  </div>
  
  <div class="${s}-bottom">
    <div class="${s}-container">
      <p>&copy; ${year} ${content.logo || 'Business'}. All rights reserved.</p>
      <div class="${s}-links">
        <a href="#">Privacy Policy</a>
        <a href="#">Terms of Service</a>
      </div>
    </div>
  </div>
</footer>
<style>
  .${s} {
    background: #0a0a0a;
    color: rgba(255, 255, 255, 0.85);
  }
  
  .${s}-main {
    padding: 4rem 2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .${s}-container {
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .${s}-main .${s}-container {
    display: grid;
    grid-template-columns: 1.5fr 1fr 1fr 1fr;
    gap: 3rem;
  }
  
  .${s}-logo {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.75rem;
    font-weight: 800;
    color: ${theme.primaryColor};
    margin-bottom: 0.75rem;
  }
  
  .${s}-tagline {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.95rem;
    margin-bottom: 1.5rem;
    line-height: 1.6;
  }
  
  .${s}-social {
    display: flex;
    gap: 0.75rem;
  }
  
  .${s}-social-link {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: rgba(255, 255, 255, 0.7);
    transition: all 0.3s ease;
  }
  
  .${s}-social-link:hover {
    background: ${theme.primaryColor};
    color: #ffffff;
    transform: translateY(-3px);
  }
  
  .${s}-heading {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1rem;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 1.25rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  
  .${s}-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  
  .${s}-list li {
    padding: 0.5rem 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.95rem;
    transition: color 0.2s;
  }
  
  .${s}-list li:hover {
    color: ${theme.primaryColor};
  }
  
  .${s}-hours {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.95rem;
    line-height: 1.8;
  }
  
  .${s}-contact {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .${s}-contact-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
    text-decoration: none;
    font-size: 0.95rem;
    transition: color 0.2s;
  }
  
  .${s}-contact-item:hover {
    color: ${theme.primaryColor};
  }
  
  .${s}-contact-item svg {
    flex-shrink: 0;
    color: ${theme.primaryColor};
  }
  
  .${s}-bottom {
    padding: 1.5rem 2rem;
  }
  
  .${s}-bottom .${s}-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .${s}-bottom p {
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.875rem;
  }
  
  .${s}-links {
    display: flex;
    gap: 2rem;
  }
  
  .${s}-links a {
    color: rgba(255, 255, 255, 0.4);
    text-decoration: none;
    font-size: 0.875rem;
    transition: color 0.2s;
  }
  
  .${s}-links a:hover {
    color: rgba(255, 255, 255, 0.7);
  }
  
  @media (max-width: 900px) {
    .${s}-main .${s}-container {
      grid-template-columns: repeat(2, 1fr);
      gap: 2.5rem;
    }
  }
  
  @media (max-width: 600px) {
    .${s}-main {
      padding: 3rem 1.5rem;
    }
    
    .${s}-main .${s}-container {
      grid-template-columns: 1fr;
      gap: 2rem;
    }
    
    .${s}-bottom {
      padding: 1.5rem;
    }
    
    .${s}-bottom .${s}-container {
      flex-direction: column;
      gap: 1rem;
      text-align: center;
    }
    
    .${s}-links {
      gap: 1.5rem;
    }
  }
</style>`;
  }
};
