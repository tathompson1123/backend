// ============================================
// CONTACT - Split Layout with Form
// Premium contact section with form and info
// ============================================

module.exports = {
  id: 'contact-split',
  name: 'Contact - Split Layout',
  category: 'contact',
  description: 'Split layout with contact form and business info',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.95, cleaning: 0.95, hvac: 0.95,
    salonSpa: 0.9, fitness: 0.9, dental: 0.9, restaurant: 0.85,
    realEstate: 0.9, photography: 0.9, legal: 0.9, renovation: 0.95, petGrooming: 0.95,
  },
  mood: ['professional', 'accessible', 'trustworthy'],

  contentSchema: {
    formTitle: { type: 'text', label: 'Form Title', default: 'Get Your Free Quote' },
    formSubtitle: { type: 'textarea', label: 'Form Subtitle', default: '' },
    submitText: { type: 'text', label: 'Submit Button Text', default: 'Send Message' },
    phone: { type: 'text', label: 'Phone Number', default: '(555) 555-5555' },
    phoneClean: { type: 'text', label: 'Phone (digits only)', default: '5555555555' },
    email: { type: 'text', label: 'Email', default: 'info@business.com' },
    hours: { type: 'textarea', label: 'Business Hours', default: 'Mon-Fri: 9AM-5PM' },
    serviceArea: { type: 'text', label: 'Service Area', default: 'Local area' },
    businessName: { type: 'text', label: 'Business Name', default: 'Business' },
    highlights: {
      type: 'array',
      label: 'Highlights',
      itemSchema: {
        text: { type: 'text', label: 'Highlight Text' },
      },
    },
  },

  render(content, theme, sectionId = 'contact') {
    const s = `section-${sectionId}`;
    const highlights = content.highlights || [];
    const highlightsHtml = highlights.map(h => `<li>${h.text}</li>`).join('');

    return `
<section class="${s}" id="contact" style="background: ${theme.surfaceColor || '#f9fafb'};">
  <div class="${s}-container">
    <div class="${s}-form-wrap">
      <div class="${s}-form-header">
        <h2 class="${s}-form-title">${content.formTitle || 'Get Your Free Quote'}</h2>
        ${content.formSubtitle ? `<p class="${s}-form-subtitle">${content.formSubtitle}</p>` : ''}
      </div>
      
      <form id="${s}-form" class="${s}-form">
        <div class="${s}-field">
          <label for="${s}-name">Full Name *</label>
          <input type="text" id="${s}-name" name="name" required placeholder="John Smith">
        </div>
        <div class="${s}-row">
          <div class="${s}-field">
            <label for="${s}-email">Email Address *</label>
            <input type="email" id="${s}-email" name="email" required placeholder="john@example.com">
          </div>
          <div class="${s}-field">
            <label for="${s}-phone">Phone Number *</label>
            <input type="tel" id="${s}-phone" name="phone" required placeholder="(555) 123-4567">
          </div>
        </div>
        <div class="${s}-field">
          <label for="${s}-service">Service Interested In</label>
          <input type="text" id="${s}-service" name="service" placeholder="Which service are you interested in?">
        </div>
        <div class="${s}-field">
          <label for="${s}-message">Tell Us About Your Project</label>
          <textarea id="${s}-message" name="message" rows="4" placeholder="Describe what you need..."></textarea>
        </div>
        <div class="${s}-consent">
          <input type="checkbox" id="${s}-sms" name="sms_consent" required>
          <label for="${s}-sms">I consent to receive text messages from ${content.businessName || 'our team'} about services I'm interested in. Message &amp; data rates may apply. Message frequency may vary. Reply STOP to unsubscribe.</label>
        </div>
        <button type="submit" class="${s}-submit">${content.submitText || 'Send Message'}</button>
        <div id="${s}-status" class="${s}-status"></div>
      </form>
    </div>

    <div class="${s}-info">
      <div class="${s}-info-header">
        <h3>Get In Touch</h3>
        <p>We'd love to hear from you. Reach out anytime!</p>
      </div>

      <div class="${s}-info-cards">
        <a href="tel:${content.phoneClean || ''}" class="${s}-info-card">
          <div class="${s}-info-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </div>
          <div class="${s}-info-text">
            <span class="${s}-info-label">Phone</span>
            <span class="${s}-info-value">${content.phone || '(555) 555-5555'}</span>
          </div>
        </a>

        <a href="mailto:${content.email || ''}" class="${s}-info-card">
          <div class="${s}-info-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
          </div>
          <div class="${s}-info-text">
            <span class="${s}-info-label">Email</span>
            <span class="${s}-info-value">${content.email || 'info@business.com'}</span>
          </div>
        </a>

        <div class="${s}-info-card">
          <div class="${s}-info-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12,6 12,12 16,14"/>
            </svg>
          </div>
          <div class="${s}-info-text">
            <span class="${s}-info-label">Hours</span>
            <span class="${s}-info-value">${(content.hours || 'Mon-Fri: 9AM-5PM').replace(/\\n/g, '<br>')}</span>
          </div>
        </div>

        ${content.serviceArea ? `
        <div class="${s}-info-card">
          <div class="${s}-info-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div class="${s}-info-text">
            <span class="${s}-info-label">Service Area</span>
            <span class="${s}-info-value">${content.serviceArea}</span>
          </div>
        </div>
        ` : ''}
      </div>

      ${highlights.length > 0 ? `
      <div class="${s}-highlights">
        <h4>Why Choose Us?</h4>
        <ul>${highlightsHtml}</ul>
      </div>
      ` : ''}
    </div>
  </div>
</section>

<script>
document.getElementById('${s}-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  const statusEl = document.getElementById('${s}-status');

  if (!formData.get('sms_consent')) {
    statusEl.textContent = '⚠️ Please agree to receive text messages to continue.';
    statusEl.className = '${s}-status ${s}-status-warn';
    statusEl.style.display = 'block';
    return;
  }

  const originalText = button.textContent;
  button.textContent = 'Sending...';
  button.disabled = true;

  try {
    const userId = document.querySelector('meta[name="user-id"]')?.content;
    if (!userId) throw new Error('Configuration error');

    const response = await fetch('https://backend-production-ab50.up.railway.app/api/leads/public/' + userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.get('name') || '',
        email: formData.get('email') || '',
        phone: formData.get('phone') || '',
        service: formData.get('service') || '',
        message: formData.get('message') || '',
        sms_consent: true,
        source: 'website_form'
      })
    });

    if (response.ok) {
      statusEl.textContent = '✅ Thanks! We\\'ll be in touch soon.';
      statusEl.className = '${s}-status ${s}-status-success';
      statusEl.style.display = 'block';
      form.reset();
    } else { throw new Error('Failed'); }
  } catch (error) {
    statusEl.textContent = '❌ Something went wrong. Please call us directly.';
    statusEl.className = '${s}-status ${s}-status-error';
    statusEl.style.display = 'block';
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
});
</script>

<style>
  .${s} {
    padding: 6rem 2rem;
  }
  
  .${s}-container {
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4rem;
    align-items: start;
  }
  
  .${s}-form-wrap {
    background: ${theme.bgColor || '#ffffff'};
    padding: 2.5rem;
    border-radius: 24px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
    border: 1px solid ${theme.borderAccent || 'rgba(0,0,0,0.05)'};
  }
  
  .${s}-form-header {
    margin-bottom: 2rem;
  }
  
  .${s}-form-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.75rem;
    font-weight: 800;
    color: ${theme.textColor || '#1f2937'};
    margin-bottom: 0.5rem;
  }
  
  .${s}-form-subtitle {
    color: ${theme.textMuted || '#6b7280'};
    font-size: 1rem;
  }
  
  .${s}-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  
  .${s}-field {
    margin-bottom: 1.25rem;
  }
  
  .${s}-field label {
    display: block;
    font-size: 0.9rem;
    font-weight: 600;
    color: ${theme.textColor || '#374151'};
    margin-bottom: 0.5rem;
  }
  
  .${s}-field input,
  .${s}-field textarea {
    width: 100%;
    padding: 0.875rem 1rem;
    border: 2px solid ${theme.borderAccent || '#e5e7eb'};
    border-radius: 12px;
    font-size: 1rem;
    font-family: inherit;
    background: ${theme.bgColor || '#ffffff'};
    color: ${theme.textColor || '#1f2937'};
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  
  .${s}-field input:focus,
  .${s}-field textarea:focus {
    outline: none;
    border-color: ${theme.primaryColor};
    box-shadow: 0 0 0 3px ${theme.primaryColor}20;
  }
  
  .${s}-field input::placeholder,
  .${s}-field textarea::placeholder {
    color: ${theme.textMuted || '#9ca3af'};
  }
  
  .${s}-consent {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: ${theme.surfaceColor || '#f9fafb'};
    border-radius: 12px;
    border: 1px solid ${theme.borderAccent || '#e5e7eb'};
  }
  
  .${s}-consent input[type="checkbox"] {
    width: 20px;
    height: 20px;
    margin-top: 2px;
    flex-shrink: 0;
    cursor: pointer;
    accent-color: ${theme.primaryColor};
  }
  
  .${s}-consent label {
    font-size: 0.85rem;
    line-height: 1.5;
    color: ${theme.textMuted || '#6b7280'};
    cursor: pointer;
  }
  
  .${s}-submit {
    width: 100%;
    padding: 1rem 2rem;
    background: linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor || theme.primaryColor});
    color: #ffffff;
    font-size: 1.1rem;
    font-weight: 700;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    font-family: inherit;
  }
  
  .${s}-submit:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px ${theme.primaryColor}40;
  }
  
  .${s}-submit:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
  }
  
  .${s}-status {
    display: none;
    margin-top: 1rem;
    padding: 1rem;
    border-radius: 12px;
    text-align: center;
    font-weight: 600;
  }
  
  .${s}-status-success { background: #d1fae5; color: #065f46; }
  .${s}-status-error { background: #fee2e2; color: #991b1b; }
  .${s}-status-warn { background: #fef3c7; color: #92400e; }
  
  .${s}-info {
    padding-top: 1rem;
  }
  
  .${s}-info-header {
    margin-bottom: 2rem;
  }
  
  .${s}-info-header h3 {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.75rem;
    font-weight: 800;
    color: ${theme.textColor || '#1f2937'};
    margin-bottom: 0.5rem;
  }
  
  .${s}-info-header p {
    color: ${theme.textMuted || '#6b7280'};
  }
  
  .${s}-info-cards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 2rem;
  }
  
  .${s}-info-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: ${theme.bgColor || '#ffffff'};
    border-radius: 16px;
    text-decoration: none;
    color: inherit;
    transition: all 0.3s ease;
    border: 1px solid ${theme.borderAccent || 'rgba(0,0,0,0.05)'};
  }
  
  a.${s}-info-card:hover {
    transform: translateX(5px);
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.08);
    border-color: ${theme.primaryColor}40;
  }
  
  .${s}-info-icon {
    width: 50px;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${theme.primaryColor}15;
    border-radius: 12px;
    color: ${theme.primaryColor};
    flex-shrink: 0;
  }
  
  .${s}-info-text {
    display: flex;
    flex-direction: column;
  }
  
  .${s}-info-label {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: ${theme.textMuted || '#6b7280'};
    margin-bottom: 0.25rem;
  }
  
  .${s}-info-value {
    font-size: 1rem;
    font-weight: 600;
    color: ${theme.textColor || '#1f2937'};
  }
  
  .${s}-highlights {
    background: ${theme.bgColor || '#ffffff'};
    padding: 1.5rem;
    border-radius: 16px;
    border: 1px solid ${theme.borderAccent || 'rgba(0,0,0,0.05)'};
  }
  
  .${s}-highlights h4 {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: 1.1rem;
    font-weight: 700;
    color: ${theme.textColor || '#1f2937'};
    margin-bottom: 1rem;
  }
  
  .${s}-highlights ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  
  .${s}-highlights li {
    position: relative;
    padding: 0.5rem 0 0.5rem 1.75rem;
    color: ${theme.textMuted || '#6b7280'};
    font-size: 0.95rem;
  }
  
  .${s}-highlights li::before {
    content: "✓";
    position: absolute;
    left: 0;
    color: ${theme.primaryColor};
    font-weight: bold;
  }
  
  @media (max-width: 900px) {
    .${s}-container {
      grid-template-columns: 1fr;
      gap: 3rem;
    }
    
    .${s}-row {
      grid-template-columns: 1fr;
    }
  }
  
  @media (max-width: 640px) {
    .${s} {
      padding: 4rem 1.5rem;
    }
    
    .${s}-form-wrap {
      padding: 1.5rem;
    }
  }
</style>`;
  }
};
