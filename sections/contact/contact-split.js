// ============================================
// CONTACT - Split (Form + Info Cards)
// ============================================

module.exports = {
  id: 'contact-split',
  name: 'Contact - Split Layout',
  category: 'contact',
  description: 'Two-column layout with contact form on left and info cards on right',

  suitability: {
    autoDetailing: 0.95, landscaping: 0.9, cleaning: 0.9, hvac: 0.9,
    salonSpa: 0.85, fitness: 0.8, dental: 0.85, restaurant: 0.75,
    realEstate: 0.85, photography: 0.8, legal: 0.9, renovation: 0.9, petGrooming: 0.85,
  },
  mood: ['bold', 'clean', 'friendly', 'luxury', 'rugged'],

  contentSchema: {
    formTitle: { type: 'text', label: 'Form Title', default: 'Request Your Free Quote' },
    formSubtitle: { type: 'text', label: 'Form Subtitle', default: "Fill out the form and we'll get back to you within 24 hours" },
    submitText: { type: 'text', label: 'Submit Button Text', default: 'Send Message' },
    phone: { type: 'text', label: 'Phone Number', default: '(555) 123-4567' },
    phoneClean: { type: 'text', label: 'Phone (digits only)', default: '5551234567' },
    email: { type: 'text', label: 'Email Address', default: 'contact@example.com' },
    hours: { type: 'textarea', label: 'Business Hours', default: 'Mon-Fri: 8AM-6PM\nSat: 9AM-4PM\nSun: Closed' },
    serviceArea: { type: 'text', label: 'Service Area', default: '' },
    businessName: { type: 'text', label: 'Business Name (for SMS consent)', default: 'our business' },
    highlights: {
      type: 'array',
      label: 'Why Choose Us (bullet points)',
      itemSchema: {
        text: { type: 'text', label: 'Point', default: 'Quality service' },
      }
    }
  },

  render(content, theme, sectionId = 'contact') {
    const s = `section-${sectionId}`;
    const highlights = (content.highlights || []).map(h =>
      `<li>${h.text}</li>`
    ).join('\n');

    const highlightsHtml = highlights ? `
      <div class="${s}-why">
        <h4>Why Choose Us?</h4>
        <ul>${highlights}</ul>
      </div>` : '';

    return `
<section class="${s}" style="background: ${theme.surfaceColor};">
  <div class="${s}-container">
    <div class="${s}-form-wrap">
      <h2>${content.formTitle || 'Request Your Free Quote'}</h2>
      <p class="${s}-form-sub">${content.formSubtitle || "Fill out the form and we'll get back to you within 24 hours"}</p>
      
      <form id="${s}-form" class="${s}-form">
        <div class="${s}-field">
          <label for="${s}-name">Full Name *</label>
          <input type="text" id="${s}-name" name="name" required placeholder="John Smith">
        </div>
        <div class="${s}-field">
          <label for="${s}-email">Email Address *</label>
          <input type="email" id="${s}-email" name="email" required placeholder="john@example.com">
        </div>
        <div class="${s}-field">
          <label for="${s}-phone">Phone Number *</label>
          <input type="tel" id="${s}-phone" name="phone" required placeholder="(555) 123-4567">
        </div>
        <div class="${s}-field">
          <label for="${s}-service">Service Interested In</label>
          <input type="text" id="${s}-service" name="service" placeholder="e.g. Full Detail">
        </div>
        <div class="${s}-field">
          <label for="${s}-message">Additional Details</label>
          <textarea id="${s}-message" name="message" rows="4" placeholder="Tell us about your project..."></textarea>
        </div>
        <div class="${s}-consent">
          <input type="checkbox" id="${s}-sms" name="sms_consent" required>
          <label for="${s}-sms">I agree to receive text messages from ${content.businessName || 'our business'}. Message and data rates may apply. Reply STOP to opt out.</label>
        </div>
        <button type="submit" class="${s}-submit">${content.submitText || 'Send Message'}</button>
        <div id="${s}-status" class="${s}-status"></div>
      </form>
    </div>

    <div class="${s}-info">
      <h3>Get In Touch</h3>

      <div class="${s}-info-card">
        <h4>📞 Phone</h4>
        <p><a href="tel:${content.phoneClean || ''}">${content.phone || '(555) 123-4567'}</a></p>
        ${content.hours ? `<p class="${s}-hours">${content.hours.replace(/\n/g, '<br>')}</p>` : ''}
      </div>

      <div class="${s}-info-card">
        <h4>✉️ Email</h4>
        <p><a href="mailto:${content.email || ''}">${content.email || 'contact@example.com'}</a></p>
        <p class="${s}-hours">We respond within 24 hours</p>
      </div>

      ${content.serviceArea ? `
      <div class="${s}-info-card">
        <h4>📍 Service Area</h4>
        <p>${content.serviceArea}</p>
      </div>` : ''}

      ${highlightsHtml}
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
  .${s} { padding: 8rem 3rem; }
  .${s}-container {
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5rem;
  }
  .${s}-form-wrap {
    background: ${theme.bgColor};
    padding: 3rem;
    border-radius: 25px;
    border: 1px solid ${theme.borderAccent};
  }
  .${s}-form-wrap h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 2.5rem;
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: ${theme.textColor};
  }
  .${s}-form-sub {
    color: ${theme.textMuted};
    margin-bottom: 2rem;
    font-size: 1.1rem;
  }
  .${s}-field { margin-bottom: 1.5rem; }
  .${s}-field label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.9rem;
    letter-spacing: 1px;
    color: ${theme.textColor};
  }
  .${s}-field input, .${s}-field textarea {
    width: 100%;
    padding: 1rem 1.25rem;
    border: 2px solid ${theme.borderAccent};
    border-radius: 12px;
    font-size: 1rem;
    background: ${theme.surfaceColor};
    color: ${theme.textColor};
    transition: border-color 0.3s;
    font-family: '${theme.bodyFont}', sans-serif;
  }
  .${s}-field input:focus, .${s}-field textarea:focus {
    outline: none;
    border-color: ${theme.primaryColor};
  }
  .${s}-consent {
    display: flex;
    align-items: start;
    gap: 12px;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: ${theme.surfaceColor};
    border-radius: 8px;
    border: 1px solid ${theme.borderAccent};
  }
  .${s}-consent input[type="checkbox"] {
    width: 20px;
    height: 20px;
    margin-top: 2px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .${s}-consent label {
    font-size: 0.85rem;
    line-height: 1.5;
    color: ${theme.textMuted};
    cursor: pointer;
  }
  .${s}-submit {
    width: 100%;
    background: ${theme.primaryColor};
    color: #ffffff;
    padding: 1.25rem 2rem;
    border: none;
    border-radius: ${theme.buttonRadius};
    font-size: 1.1rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1px;
    cursor: pointer;
    transition: transform 0.3s, box-shadow 0.3s;
    font-family: '${theme.bodyFont}', sans-serif;
  }
  .${s}-submit:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 30px ${theme.borderAccentHover};
  }
  .${s}-status { display: none; margin-top: 1rem; padding: 1rem; border-radius: 8px; text-align: center; font-weight: 600; }
  .${s}-status-success { background: #d1fae5; color: #065f46; }
  .${s}-status-error { background: #fee2e2; color: #991b1b; }
  .${s}-status-warn { background: #fef3c7; color: #92400e; }

  .${s}-info h3 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 2rem;
    margin-bottom: 1.5rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: ${theme.textColor};
  }
  .${s}-info-card {
    background: ${theme.bgColor};
    padding: 2rem;
    border-radius: 20px;
    margin-bottom: 1.5rem;
    border: 1px solid ${theme.borderAccent};
  }
  .${s}-info-card h4 {
    color: ${theme.primaryColor};
    font-size: 1.2rem;
    margin-bottom: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .${s}-info-card p { color: ${theme.textMuted}; font-size: 1.05rem; line-height: 1.8; }
  .${s}-info-card a { color: ${theme.textColor}; text-decoration: none; font-weight: 600; }
  .${s}-info-card a:hover { color: ${theme.primaryColor}; }
  .${s}-hours { font-size: 0.95rem; margin-top: 0.5rem; }

  .${s}-why {
    background: ${theme.bgColor};
    padding: 2rem;
    border-radius: 20px;
    margin-top: 2rem;
    border: 1px solid ${theme.borderAccent};
  }
  .${s}-why h4 {
    color: ${theme.primaryColor};
    font-size: 1.3rem;
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .${s}-why ul { list-style: none; padding: 0; }
  .${s}-why li {
    padding: 0.5rem 0 0.5rem 1.5rem;
    position: relative;
    color: ${theme.textMuted};
  }
  .${s}-why li::before {
    content: "✓";
    position: absolute;
    left: 0;
    color: ${theme.primaryColor};
    font-weight: bold;
  }

  @media (max-width: 768px) {
    .${s}-container { grid-template-columns: 1fr; gap: 3rem; }
  }
</style>`;
  }
};
