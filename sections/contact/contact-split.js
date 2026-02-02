// ============================================
// CONTACT - Split (Form + Info Cards)
// Extracted from: auto-detailing-template/contact.html
// ============================================

module.exports = {
  id: 'contact-split',
  name: 'Contact - Split Layout',
  category: 'contact',
  description: 'Two-column layout with contact form on left and info cards on right',

  contentSchema: {
    formTitle: { type: 'text', label: 'Form Title' },
    formSubtitle: { type: 'text', label: 'Form Subtitle' },
    submitText: { type: 'text', label: 'Submit Button Text' },
    phone: { type: 'text', label: 'Phone Number' },
    phoneClean: { type: 'text', label: 'Phone (digits only)' },
    email: { type: 'text', label: 'Email Address' },
    hours: { type: 'textarea', label: 'Business Hours' },
    serviceArea: { type: 'text', label: 'Service Area' },
    businessName: { type: 'text', label: 'Business Name (for SMS consent)' },
    highlights: {
      type: 'array',
      label: 'Why Choose Us (bullet points)',
      itemSchema: {
        text: { type: 'text', label: 'Point' },
      }
    }
  },

  render(content, theme) {
    const highlights = (content.highlights || []).map(h =>
      `<li>${h.text}</li>`
    ).join('\n');

    const highlightsHtml = highlights ? `
      <div class="ct-why">
        <h4>Why Choose Us?</h4>
        <ul>${highlights}</ul>
      </div>` : '';

    return `
<section class="contact-section" style="background: ${theme.surfaceColor};">
  <div class="ct-container">
    <div class="ct-form-wrap">
      <h2>${content.formTitle || 'Request Your Free Quote'}</h2>
      <p class="ct-form-sub">${content.formSubtitle || 'Fill out the form and we\'ll get back to you within 24 hours'}</p>
      
      <form id="contact-form" class="ct-form">
        <div class="ct-field">
          <label for="ct-name">Full Name *</label>
          <input type="text" id="ct-name" name="name" required placeholder="John Smith">
        </div>
        <div class="ct-field">
          <label for="ct-email">Email Address *</label>
          <input type="email" id="ct-email" name="email" required placeholder="john@example.com">
        </div>
        <div class="ct-field">
          <label for="ct-phone">Phone Number *</label>
          <input type="tel" id="ct-phone" name="phone" required placeholder="(555) 123-4567">
        </div>
        <div class="ct-field">
          <label for="ct-service">Service Interested In</label>
          <input type="text" id="ct-service" name="service" placeholder="e.g. Full Detail">
        </div>
        <div class="ct-field">
          <label for="ct-message">Additional Details</label>
          <textarea id="ct-message" name="message" rows="4" placeholder="Tell us about your project..."></textarea>
        </div>
        <div class="ct-consent">
          <input type="checkbox" id="sms-consent" name="sms_consent" required>
          <label for="sms-consent">I agree to receive text messages from ${content.businessName || 'this business'}. Message and data rates may apply. Reply STOP to opt out.</label>
        </div>
        <button type="submit" class="ct-submit">${content.submitText || 'Send Message'}</button>
        <div id="form-status" class="ct-status"></div>
      </form>
    </div>

    <div class="ct-info">
      <h3>Get In Touch</h3>

      <div class="ct-info-card">
        <h4>📞 Phone</h4>
        <p><a href="tel:${content.phoneClean || ''}">${content.phone || '(555) 123-4567'}</a></p>
        ${content.hours ? `<p class="ct-hours">${content.hours.replace(/\n/g, '<br>')}</p>` : ''}
      </div>

      <div class="ct-info-card">
        <h4>✉️ Email</h4>
        <p><a href="mailto:${content.email || ''}">${content.email || 'contact@example.com'}</a></p>
        <p class="ct-hours">We respond within 24 hours</p>
      </div>

      ${content.serviceArea ? `
      <div class="ct-info-card">
        <h4>📍 Service Area</h4>
        <p>${content.serviceArea}</p>
      </div>` : ''}

      ${highlightsHtml}
    </div>
  </div>
</section>

<script>
document.getElementById('contact-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  const statusEl = document.getElementById('form-status');

  if (!formData.get('sms_consent')) {
    statusEl.textContent = '⚠️ Please agree to receive text messages to continue.';
    statusEl.className = 'ct-status ct-status-warn';
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
      statusEl.className = 'ct-status ct-status-success';
      statusEl.style.display = 'block';
      form.reset();
    } else { throw new Error('Failed'); }
  } catch (error) {
    statusEl.textContent = '❌ Something went wrong. Please call us directly.';
    statusEl.className = 'ct-status ct-status-error';
    statusEl.style.display = 'block';
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
});
</script>

<style>
  .contact-section { padding: 8rem 3rem; }
  .ct-container {
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5rem;
  }
  .ct-form-wrap {
    background: ${theme.bgColor};
    padding: 3rem;
    border-radius: 25px;
    border: 1px solid ${theme.borderAccent};
  }
  .ct-form-wrap h2 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 2.5rem;
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: ${theme.textColor};
  }
  .ct-form-sub {
    color: ${theme.textMuted};
    margin-bottom: 2rem;
    font-size: 1.1rem;
  }
  .ct-field { margin-bottom: 1.5rem; }
  .ct-field label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.9rem;
    letter-spacing: 1px;
    color: ${theme.textColor};
  }
  .ct-field input, .ct-field textarea {
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
  .ct-field input:focus, .ct-field textarea:focus {
    outline: none;
    border-color: ${theme.primaryColor};
  }
  .ct-consent {
    display: flex;
    align-items: start;
    gap: 12px;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: ${theme.surfaceColor};
    border-radius: 8px;
    border: 1px solid ${theme.borderAccent};
  }
  .ct-consent input[type="checkbox"] {
    width: 20px;
    height: 20px;
    margin-top: 2px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .ct-consent label {
    font-size: 0.85rem;
    line-height: 1.5;
    color: ${theme.textMuted};
    cursor: pointer;
  }
  .ct-submit {
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
  .ct-submit:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 30px ${theme.borderAccentHover};
  }
  .ct-status { display: none; margin-top: 1rem; padding: 1rem; border-radius: 8px; text-align: center; font-weight: 600; }
  .ct-status-success { background: #d1fae5; color: #065f46; }
  .ct-status-error { background: #fee2e2; color: #991b1b; }
  .ct-status-warn { background: #fef3c7; color: #92400e; }

  .ct-info h3 {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 2rem;
    margin-bottom: 1.5rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: ${theme.textColor};
  }
  .ct-info-card {
    background: ${theme.bgColor};
    padding: 2rem;
    border-radius: 20px;
    margin-bottom: 1.5rem;
    border: 1px solid ${theme.borderAccent};
  }
  .ct-info-card h4 {
    color: ${theme.primaryColor};
    font-size: 1.2rem;
    margin-bottom: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .ct-info-card p { color: ${theme.textMuted}; font-size: 1.05rem; line-height: 1.8; }
  .ct-info-card a { color: ${theme.textColor}; text-decoration: none; font-weight: 600; }
  .ct-info-card a:hover { color: ${theme.primaryColor}; }
  .ct-hours { font-size: 0.95rem; margin-top: 0.5rem; }

  .ct-why {
    background: ${theme.bgColor};
    padding: 2rem;
    border-radius: 20px;
    margin-top: 2rem;
    border: 1px solid ${theme.borderAccent};
  }
  .ct-why h4 {
    color: ${theme.primaryColor};
    font-size: 1.3rem;
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .ct-why ul { list-style: none; padding: 0; }
  .ct-why li {
    padding: 0.5rem 0 0.5rem 1.5rem;
    position: relative;
    color: ${theme.textMuted};
  }
  .ct-why li::before {
    content: "✓";
    position: absolute;
    left: 0;
    color: ${theme.primaryColor};
    font-weight: bold;
  }

  @media (max-width: 768px) {
    .ct-container { grid-template-columns: 1fr; gap: 3rem; }
  }
</style>`;
  }
};
