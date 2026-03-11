// ============================================
// LEAD MAGNET — Carpet Grime Calculator
// Interactive slider showing carpet contamination
// over time with urgency discount. All-in-one view
// (no step navigation). Submits to /api/leads/public/:userId
// ============================================

module.exports = {
  id: 'lead-magnet-slider-cleaning',
  name: 'Carpet Grime Calculator',
  category: 'lead-magnet',
  description: 'Interactive slider showing carpet contamination over time with urgency discount',
  suitability: { cleaning: 1.0, janitorial: 0.8, maid: 0.8, 'carpet cleaning': 0.9 },

  contentSchema: {
    headline:    { type: 'text',  label: 'Headline',      default: 'Carpet Grime Calculator' },
    subheadline: { type: 'text',  label: 'Subheadline',   default: "See what's hiding in your carpet right now" },
    ctaText:     { type: 'text',  label: 'CTA Button',    default: 'Claim My Discount' },
    image:       { type: 'image', label: 'Carpet Image',  default: 'https://images.unsplash.com/photo-1558618047-f18c8def4765?w=800&q=80' },
  },

  render(content, theme, sectionId = 'lm-slider-cleaning') {
    const s = `section-${sectionId}`;
    const primary  = theme.primaryColor || '#9333ea';
    const bgColor  = theme.bgColor      || '#ffffff';
    const textColor = theme.textColor   || '#1f2937';
    const headFont = theme.headingFont  || 'Inter';

    const headline    = content.headline    || 'Carpet Grime Calculator';
    const subheadline = content.subheadline || "See what's hiding in your carpet right now";
    const ctaText     = content.ctaText     || 'Claim My Discount';
    const image       = content.image       || 'https://images.unsplash.com/photo-1558618047-f18c8def4765?w=800&q=80';

    return `
<section class="${s}" id="${s}">
  <div class="${s}-wrap">

    <!-- Calculator view -->
    <div id="${s}-calculator">

      <!-- Header -->
      <div class="${s}-header">
        <h2 class="${s}-h2">${headline}</h2>
        <p class="${s}-sub">${subheadline}</p>
      </div>

      <!-- Carpet Image -->
      <div class="${s}-img-wrap">
        <img
          id="${s}-img"
          src="${image}"
          alt="Carpet condition"
          class="${s}-img"
          style="filter: sepia(18%) brightness(0.895) saturate(0.85);"
        />
        <div class="${s}-badge" id="${s}-badge">
          <span class="${s}-badge-icon" id="${s}-badge-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </span>
          <span class="${s}-badge-label" id="${s}-badge-label">Moderate</span>
        </div>
      </div>

      <!-- Slider -->
      <div class="${s}-slider-area">
        <div class="${s}-slider-header">
          <label class="${s}-slider-label">Months since last professional cleaning</label>
          <span class="${s}-slider-value" id="${s}-month-display">12</span>
        </div>
        <input
          type="range"
          min="1"
          max="36"
          value="12"
          class="${s}-range"
          id="${s}-slider"
          oninput="window['${s}Update'](this.value)"
        />
        <div class="${s}-scale">
          <span>1 month</span>
          <span>3 years</span>
        </div>
      </div>

      <!-- Stat Cards -->
      <div class="${s}-stats" id="${s}-stats">
        <div class="${s}-stat-card ${s}-stat-health" id="${s}-stat-health">
          <p class="${s}-stat-title">Health Status</p>
          <p class="${s}-stat-value" id="${s}-health-label" style="color:#ca8a04;">Moderate</p>
        </div>
        <div class="${s}-stat-card">
          <p class="${s}-stat-title">Dust Mites</p>
          <p class="${s}-stat-value ${s}-stat-dark" id="${s}-dust-mites">1,800,000</p>
        </div>
        <div class="${s}-stat-card">
          <p class="${s}-stat-title">Dead Skin</p>
          <p class="${s}-stat-value ${s}-stat-dark" id="${s}-dead-skin">6.0 lbs</p>
        </div>
      </div>

      <!-- Discount Callout -->
      <div class="${s}-discount" id="${s}-discount">
        <div>
          <p class="${s}-discount-label">Your urgency discount</p>
          <p class="${s}-discount-hint">Book now to lock in your savings</p>
        </div>
        <div class="${s}-discount-amount" id="${s}-discount-amount">$40 OFF</div>
      </div>

      <!-- Contact Form -->
      <form class="${s}-form" onsubmit="window['${s}Submit'](event)">
        <div class="${s}-form-group">
          <label class="${s}-field-label">Your Name</label>
          <input type="text" id="${s}-name" class="${s}-input" placeholder="Jane Smith" required />
        </div>
        <div class="${s}-form-group">
          <label class="${s}-field-label">Email Address</label>
          <input type="email" id="${s}-email" class="${s}-input" placeholder="you@email.com" required />
        </div>
        <div class="${s}-form-group">
          <label class="${s}-field-label">Phone Number</label>
          <input type="tel" id="${s}-phone" class="${s}-input" placeholder="(555) 000-0000" required />
        </div>
        <label class="${s}-consent">
          <input type="checkbox" name="sms_consent" required />
          I consent to receive text messages about my appointment. Message &amp; data rates may apply. Text STOP to opt out.
        </label>
        <button type="submit" class="${s}-btn" id="${s}-submit-btn">
          ${ctaText} &rarr;
        </button>
        <p class="${s}-fine">No commitment required &middot; Discount applied at booking</p>
      </form>
    </div>

    <!-- Success view -->
    <div id="${s}-result" style="display:none;">
      <div class="${s}-result-inner">
        <div class="${s}-check-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="${primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <h2 class="${s}-h2">Your Carpet Report</h2>
        <p class="${s}-sub" id="${s}-result-reach">We'll reach out shortly to schedule your cleaning.</p>

        <div class="${s}-report-box" id="${s}-report-box">
          <div class="${s}-report-header" id="${s}-report-header">
            <span class="${s}-report-icon" id="${s}-report-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </span>
            <span id="${s}-report-label">Moderate &mdash; Action Required</span>
          </div>
          <ul class="${s}-report-list">
            <li><span>Months since cleaning</span><span id="${s}-r-months" class="${s}-report-val">12 months</span></li>
            <li><span>Estimated dust mites</span><span id="${s}-r-dust" class="${s}-report-val">1,800,000</span></li>
            <li><span>Dead skin buildup</span><span id="${s}-r-skin" class="${s}-report-val">6.0 lbs</span></li>
          </ul>
          <div class="${s}-report-discount">
            <span class="${s}-report-discount-label">Your Discount</span>
            <span class="${s}-report-discount-value" id="${s}-r-discount">$40 OFF</span>
          </div>
          <p class="${s}-report-fine">Applied automatically to your cleaning appointment</p>
        </div>

        <p class="${s}-sub" style="margin-top:16px;">Expect a call or text within a few hours to confirm your booking.</p>
      </div>
    </div>

  </div>
</section>

<style>
/* === Section wrapper === */
.${s} {
  background: ${bgColor};
  padding: 80px 20px;
  font-family: '${headFont}', system-ui, sans-serif;
}
.${s}-wrap {
  max-width: 640px;
  margin: 0 auto;
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.10);
  overflow: hidden;
  padding: 40px 36px;
}

/* === Header === */
.${s}-header {
  text-align: center;
  margin-bottom: 24px;
}
.${s}-h2 {
  font-size: 1.6rem;
  font-weight: 800;
  color: ${textColor};
  margin: 0 0 8px;
  line-height: 1.3;
}
.${s}-sub {
  color: #6b7280;
  font-size: 0.95rem;
  margin: 0;
  line-height: 1.6;
}

/* === Carpet Image === */
.${s}-img-wrap {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 24px;
}
.${s}-img {
  width: 100%;
  max-height: 260px;
  object-fit: cover;
  object-position: center;
  display: block;
  transition: filter 0.7s ease;
}
.${s}-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 0.85rem;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  transition: all 0.3s ease;
  background: #fefce8;
  border: 1px solid #fde68a;
  color: #ca8a04;
}
.${s}-badge-icon {
  display: flex;
  align-items: center;
}
.${s}-badge-label {
  white-space: nowrap;
}

/* === Slider === */
.${s}-slider-area {
  margin-bottom: 24px;
}
.${s}-slider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.${s}-slider-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #374151;
}
.${s}-slider-value {
  font-size: 1.5rem;
  font-weight: 800;
  color: ${primary};
}
.${s}-range {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  border-radius: 3px;
  background: #e5e7eb;
  outline: none;
  cursor: pointer;
}
.${s}-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${primary};
  cursor: pointer;
  border: 3px solid #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}
.${s}-range::-moz-range-thumb {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${primary};
  cursor: pointer;
  border: 3px solid #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}
.${s}-scale {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #9ca3af;
  margin-top: 4px;
}

/* === Stat Cards === */
.${s}-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
.${s}-stat-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  text-align: center;
}
.${s}-stat-health {
  transition: background 0.3s, border-color 0.3s;
}
.${s}-stat-title {
  font-size: 0.75rem;
  color: #6b7280;
  margin: 0 0 4px;
}
.${s}-stat-value {
  font-size: 1rem;
  font-weight: 700;
  margin: 0;
  transition: color 0.3s;
}
.${s}-stat-dark {
  color: #1f2937;
  font-size: 0.875rem;
}

/* === Discount Callout === */
.${s}-discount {
  background: ${primary}12;
  border: 1px solid ${primary}30;
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.${s}-discount-label {
  font-size: 0.875rem;
  font-weight: 700;
  color: ${primary};
  margin: 0;
}
.${s}-discount-hint {
  font-size: 0.75rem;
  color: ${primary};
  opacity: 0.8;
  margin: 2px 0 0;
}
.${s}-discount-amount {
  font-size: 1.75rem;
  font-weight: 900;
  color: ${primary};
  white-space: nowrap;
}

/* === Form === */
.${s}-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.${s}-form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.${s}-field-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: #374151;
}
.${s}-input {
  padding: 12px 16px;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  font-size: 0.95rem;
  outline: none;
  transition: border 0.2s;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}
.${s}-input:focus {
  border-color: ${primary};
}
.${s}-consent {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  font-size: 0.8rem;
  color: #6b7280;
  line-height: 1.4;
  cursor: pointer;
}
.${s}-consent input[type="checkbox"] {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  flex-shrink: 0;
  accent-color: ${primary};
  cursor: pointer;
}
.${s}-btn {
  display: block;
  width: 100%;
  padding: 16px;
  background: ${primary};
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}
.${s}-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
.${s}-btn:active {
  transform: translateY(0);
}
.${s}-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.${s}-fine {
  font-size: 0.75rem;
  color: #9ca3af;
  text-align: center;
  margin: -4px 0 0;
}

/* === Success / Result === */
.${s}-result-inner {
  text-align: center;
  animation: ${s}FadeIn 0.4s ease;
}
@keyframes ${s}FadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: none; }
}
.${s}-check-icon {
  margin-bottom: 16px;
}
.${s}-report-box {
  text-align: left;
  border-radius: 12px;
  padding: 16px 20px;
  margin: 20px 0;
  transition: background 0.3s, border-color 0.3s;
  background: #fefce8;
  border: 1px solid #fde68a;
}
.${s}-report-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 700;
  font-size: 1rem;
  color: #ca8a04;
}
.${s}-report-icon {
  display: flex;
  align-items: center;
}
.${s}-report-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.${s}-report-list li {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  color: #374151;
  padding: 6px 0;
}
.${s}-report-val {
  font-weight: 600;
}
.${s}-report-discount {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #e5e7eb;
  margin-top: 12px;
  padding-top: 12px;
}
.${s}-report-discount-label {
  font-weight: 700;
  color: #111827;
}
.${s}-report-discount-value {
  font-size: 1.5rem;
  font-weight: 900;
  color: ${primary};
}
.${s}-report-fine {
  font-size: 0.75rem;
  color: #6b7280;
  margin: 4px 0 0;
}

/* === Responsive === */
@media (max-width: 480px) {
  .${s}-wrap {
    padding: 28px 20px;
  }
  .${s}-stats {
    grid-template-columns: 1fr;
  }
  .${s}-h2 {
    font-size: 1.35rem;
  }
  .${s}-discount {
    flex-direction: column;
    text-align: center;
    gap: 8px;
  }
}
</style>

<script>
(function() {
  /* --- Health calculation --- */
  function getHealth(months) {
    if (months < 6)  return { label: 'Good',     color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', filterIntensity: 0,   discount: 25, icon: 'shield' };
    if (months < 12) return { label: 'Moderate',  color: '#ca8a04', bg: '#fefce8', border: '#fde68a', filterIntensity: 0.3, discount: 40, icon: 'alert-triangle' };
    if (months < 24) return { label: 'Warning',   color: '#ea580c', bg: '#fff7ed', border: '#fed7aa', filterIntensity: 0.6, discount: 60, icon: 'alert-triangle' };
    return              { label: 'Critical',  color: '#dc2626', bg: '#fef2f2', border: '#fecaca', filterIntensity: 1,   discount: 75, icon: 'alert-circle' };
  }

  var SVG_ICONS = {
    shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    'alert-triangle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'alert-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };

  var SVG_ICONS_LG = {
    shield: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    'alert-triangle': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'alert-circle': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };

  function formatNumber(n) {
    return n.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  }

  /* --- Slider update handler --- */
  window['${s}Update'] = function(val) {
    var months = parseInt(val, 10);
    var h = getHealth(months);

    /* Month display */
    document.getElementById('${s}-month-display').textContent = months;

    /* Image filter */
    var fi = h.filterIntensity;
    var filter = 'sepia(' + (fi * 60) + '%) brightness(' + (1 - fi * 0.35) + ') saturate(' + (1 - fi * 0.5) + ')';
    document.getElementById('${s}-img').style.filter = filter;

    /* Health badge */
    var badge = document.getElementById('${s}-badge');
    badge.style.background = h.bg;
    badge.style.borderColor = h.border;
    badge.style.color = h.color;
    document.getElementById('${s}-badge-icon').innerHTML = SVG_ICONS[h.icon];
    document.getElementById('${s}-badge-label').textContent = h.label;

    /* Stat cards */
    var healthCard = document.getElementById('${s}-stat-health');
    healthCard.style.background = h.bg;
    healthCard.style.borderColor = h.border;
    document.getElementById('${s}-health-label').textContent = h.label;
    document.getElementById('${s}-health-label').style.color = h.color;

    var dustMites = Math.min(months * 150000, 2000000);
    document.getElementById('${s}-dust-mites').textContent = formatNumber(dustMites);

    var deadSkin = (months * 0.5).toFixed(1);
    document.getElementById('${s}-dead-skin').textContent = deadSkin + ' lbs';

    /* Discount callout */
    document.getElementById('${s}-discount-amount').textContent = '$' + h.discount + ' OFF';

    /* Update submit button text */
    var btn = document.getElementById('${s}-submit-btn');
    if (btn && !btn.disabled) {
      btn.innerHTML = 'Claim My $' + h.discount + ' Discount &rarr;';
    }
  };

  /* Run initial update for default value (12) */
  window['${s}Update'](12);

  /* --- Form submit handler --- */
  window['${s}Submit'] = function(e) {
    e.preventDefault();
    var btn = document.getElementById('${s}-submit-btn');
    var originalHTML = btn.innerHTML;
    btn.innerHTML = 'Sending...';
    btn.disabled = true;

    var name  = document.getElementById('${s}-name').value.trim();
    var email = document.getElementById('${s}-email').value.trim();
    var phone = document.getElementById('${s}-phone').value.trim();
    var userId = window.__SORCE_USER_ID__;

    if (!userId) {
      btn.innerHTML = originalHTML;
      btn.disabled = false;
      alert('Configuration error. Please try again later.');
      return;
    }

    var months = parseInt(document.getElementById('${s}-slider').value, 10);
    var h = getHealth(months);
    var dustMites = formatNumber(Math.min(months * 150000, 2000000));
    var deadSkin = (months * 0.5).toFixed(1);
    var message = 'Carpet health: ' + h.label + ' | Months since cleaning: ' + months + ' | Dust mites: ' + dustMites + ' | Dead skin: ' + deadSkin + ' lbs | Discount: $' + h.discount + ' off';

    fetch('/api/leads/public/' + userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phone,
        service: 'Carpet Cleaning',
        message: message,
        sms_consent: true
      })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('Submission failed');

      /* Populate result screen */
      var reportHeader = document.getElementById('${s}-report-header');
      reportHeader.style.color = h.color;
      document.getElementById('${s}-report-icon').innerHTML = SVG_ICONS_LG[h.icon];
      document.getElementById('${s}-report-label').innerHTML = h.label + ' &mdash; Action Required';

      var reportBox = document.getElementById('${s}-report-box');
      reportBox.style.background = h.bg;
      reportBox.style.borderColor = h.border;

      document.getElementById('${s}-r-months').textContent = months + ' months';
      document.getElementById('${s}-r-dust').textContent = dustMites;
      document.getElementById('${s}-r-skin').textContent = deadSkin + ' lbs';
      document.getElementById('${s}-r-discount').textContent = '$' + h.discount + ' OFF';

      document.getElementById('${s}-result-reach').innerHTML = "We'll reach out to <strong>" + name + "</strong> to schedule your cleaning.";

      /* Swap views */
      document.getElementById('${s}-calculator').style.display = 'none';
      document.getElementById('${s}-result').style.display = 'block';
    })
    .catch(function() {
      btn.innerHTML = originalHTML;
      btn.disabled = false;
      alert('Something went wrong. Please try again.');
    });
  };
})();
</script>
`;
  }
};
