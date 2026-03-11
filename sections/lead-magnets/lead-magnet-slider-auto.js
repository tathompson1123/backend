module.exports = {
  id: 'lead-magnet-slider-auto',
  name: 'Paint Health Analyzer',
  category: 'lead-magnet',
  description: 'Multi-step paint health analyzer with slider, damage report, and service selection',
  suitability: { 'auto-detailing': 1.0, 'auto-wrap': 0.9, automotive: 0.8 },
  contentSchema: {
    headline: { type: 'text', label: 'Headline', default: "What's Happening to Your Paint?" },
    subheadline: { type: 'text', label: 'Subheadline', default: 'Pollen, grime, and UV rays attack your clear coat every day. Move the slider to see the damage.' },
    ctaText: { type: 'text', label: 'Analyze Button', default: 'Analyze My Paint' },
    submitText: { type: 'text', label: 'Submit Button', default: 'Get My Free Assessment' },
    services: { type: 'text', label: 'Services (comma-separated)', default: 'Full Detail, Paint Correction, Ceramic Coating, Interior Detail, Engine Bay Clean' },
    image: { type: 'image', label: 'Vehicle Image', default: 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?w=1200&auto=format&fit=crop&q=80' },
  },
  render(content, theme, sectionId = 'lm-slider-auto') {
    const s = `section-${sectionId}`;
    const accent = theme.primaryColor || '#f59e0b';
    const headFont = theme.headingFont || 'Inter';

    const headline = content.headline || "What's Happening to Your Paint?";
    const sub = content.subheadline || 'Pollen, grime, and UV rays attack your clear coat every day. Move the slider to see the damage.';
    const ctaText = content.ctaText || 'Analyze My Paint';
    const submitText = content.submitText || 'Get My Free Assessment';
    const image = content.image || 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?w=1200&auto=format&fit=crop&q=80';

    const services = (content.services || 'Full Detail, Paint Correction, Ceramic Coating, Interior Detail, Engine Bay Clean').split(',').map(sv => sv.trim()).filter(Boolean);

    const servicesHtml = services.map((sv, i) =>
      `<label class="${s}-svc-label">
        <input type="checkbox" name="services" value="${sv}"${i === 0 ? ' checked' : ''} class="${s}-svc-cb">
        <span class="${s}-svc-box">
          <span class="${s}-svc-check">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          <span class="${s}-svc-text">${sv}</span>
        </span>
      </label>`
    ).join('\n              ');

    return `
<section class="${s}-wrap">
  <style>
    .${s}-wrap {
      background: #09090b;
      padding: 80px 20px;
      font-family: ${headFont}, system-ui, -apple-system, sans-serif;
      color: #fff;
      box-sizing: border-box;
    }
    .${s}-wrap *, .${s}-wrap *::before, .${s}-wrap *::after { box-sizing: border-box; }
    .${s}-inner {
      max-width: 700px;
      margin: 0 auto;
    }

    /* ---- Header ---- */
    .${s}-header {
      text-align: center;
      margin: 0 auto 40px;
    }
    .${s}-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 999px;
      background: ${accent}1a;
      border: 1px solid ${accent}33;
      color: ${accent};
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.5px;
      margin-bottom: 20px;
    }
    .${s}-badge svg { width: 16px; height: 16px; flex-shrink: 0; }
    .${s}-headline {
      font-size: clamp(28px, 5vw, 44px);
      font-weight: 800;
      color: #fff;
      line-height: 1.15;
      margin: 0 0 14px;
      letter-spacing: -0.02em;
    }
    .${s}-sub {
      font-size: 17px;
      color: #a1a1aa;
      line-height: 1.6;
      margin: 0;
    }

    /* ---- Steps visibility ---- */
    .${s}-step { display: none; }
    .${s}-step.${s}-active { display: block; }

    /* Fade-in animation */
    @keyframes ${s}-fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .${s}-fade-in {
      animation: ${s}-fadeIn 0.45s ease forwards;
    }

    /* ---- Step 1: Slider Card ---- */
    .${s}-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 24px;
      padding: 32px;
    }

    /* Image container */
    .${s}-img-wrap {
      position: relative;
      border-radius: 14px;
      overflow: hidden;
      aspect-ratio: 16/9;
      background: #27272a;
      margin-bottom: 28px;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.08);
    }
    .${s}-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: filter 0.5s ease;
    }

    /* Month display */
    .${s}-month-display {
      display: flex;
      align-items: baseline;
      gap: 0;
      margin-bottom: 20px;
      justify-content: center;
    }
    .${s}-months-big {
      font-size: 56px;
      font-weight: 900;
      line-height: 1;
      transition: color 0.3s;
      color: #eab308;
    }
    .${s}-sep {
      font-size: 24px;
      color: #52525b;
      margin: 0 12px;
    }
    .${s}-months-text {
      font-size: 16px;
      color: #a1a1aa;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Range slider */
    .${s}-range {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 8px;
      background: #27272a;
      border-radius: 4px;
      outline: none;
      margin-bottom: 28px;
      cursor: pointer;
    }
    .${s}-range::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: ${accent};
      cursor: pointer;
      border: 3px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .${s}-range::-moz-range-thumb {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: ${accent};
      cursor: pointer;
      border: 3px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }

    /* CTA button */
    .${s}-btn {
      width: 100%;
      padding: 16px;
      background: ${accent};
      color: #09090b;
      border: none;
      border-radius: 16px;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.15s;
      box-shadow: 0 4px 20px ${accent}55;
      font-family: inherit;
    }
    .${s}-btn:hover { opacity: 0.92; transform: translateY(-1px); }
    .${s}-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

    /* ---- Step 2: Two-Column Grid ---- */
    .${s}-step2-inner {
      max-width: 1100px;
      margin: 0 auto;
    }
    .${s}-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      align-items: start;
    }

    /* Analysis card (left) */
    .${s}-analysis-img-wrap {
      position: relative;
      border-radius: 14px;
      overflow: hidden;
      aspect-ratio: 16/9;
      background: #27272a;
      margin-bottom: 24px;
    }
    .${s}-analysis-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .${s}-health-badge {
      position: absolute;
      top: 14px;
      left: 14px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #fff;
      backdrop-filter: blur(8px);
    }

    /* Stat bars */
    .${s}-stats { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
    .${s}-stat-header {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 5px;
    }
    .${s}-stat-name { color: #a1a1aa; }
    .${s}-stat-pct { font-weight: 700; transition: color 0.3s; }
    .${s}-stat-track {
      height: 6px;
      background: #27272a;
      border-radius: 3px;
      overflow: hidden;
    }
    .${s}-stat-fill {
      height: 100%;
      border-radius: 3px;
      width: 0%;
      transition: width 0.8s ease 0.2s, background 0.3s;
    }

    /* Info box */
    .${s}-info {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid;
      font-size: 14px;
      line-height: 1.5;
      color: #d4d4d8;
    }
    .${s}-info svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    /* ---- Form Card (right) ---- */
    .${s}-form-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 24px;
      padding: 32px;
    }
    .${s}-form-title {
      font-size: 26px;
      font-weight: 700;
      color: #fff;
      margin: 0 0 8px;
      line-height: 1.2;
    }
    .${s}-form-subtitle {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 24px;
      transition: color 0.3s;
    }

    /* Service checkboxes */
    .${s}-svc-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 22px;
    }
    .${s}-svc-label {
      cursor: pointer;
      display: block;
    }
    .${s}-svc-cb {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
      pointer-events: none;
    }
    .${s}-svc-box {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid #27272a;
      background: #09090b;
      transition: border-color 0.2s, background 0.2s;
      font-size: 13px;
      color: #a1a1aa;
    }
    .${s}-svc-check {
      width: 20px;
      height: 20px;
      border-radius: 5px;
      border: 2px solid #3f3f46;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s, border-color 0.2s;
    }
    .${s}-svc-check svg {
      opacity: 0;
      transition: opacity 0.15s;
      color: #09090b;
    }
    .${s}-svc-cb:checked + .${s}-svc-box {
      border-color: ${accent};
      background: ${accent}0d;
    }
    .${s}-svc-cb:checked + .${s}-svc-box .${s}-svc-check {
      background: ${accent};
      border-color: ${accent};
    }
    .${s}-svc-cb:checked + .${s}-svc-box .${s}-svc-check svg {
      opacity: 1;
    }
    .${s}-svc-cb:checked + .${s}-svc-box .${s}-svc-text {
      color: #fff;
    }

    /* Form inputs */
    .${s}-form { display: flex; flex-direction: column; gap: 14px; }
    .${s}-field {
      position: relative;
    }
    .${s}-field-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: #52525b;
      pointer-events: none;
      line-height: 1;
      display: flex;
      align-items: center;
    }
    .${s}-input {
      width: 100%;
      padding: 14px 16px 14px 42px;
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 12px;
      color: #fff;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      font-family: inherit;
      box-sizing: border-box;
    }
    .${s}-input::placeholder { color: #52525b; }
    .${s}-input:focus {
      border-color: ${accent};
      box-shadow: 0 0 0 3px ${accent}33;
    }

    /* SMS Consent */
    .${s}-consent {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      color: #52525b;
      line-height: 1.4;
      cursor: pointer;
    }
    .${s}-consent input[type="checkbox"] {
      width: 18px;
      height: 18px;
      margin-top: 1px;
      flex-shrink: 0;
      accent-color: ${accent};
      cursor: pointer;
    }

    /* Error message */
    .${s}-error {
      color: #ef4444;
      font-size: 14px;
      display: none;
    }

    /* Fine print */
    .${s}-fine {
      font-size: 12px;
      color: #52525b;
      text-align: center;
      margin-top: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .${s}-fine svg { width: 14px; height: 14px; }

    /* ---- Step 3: Success ---- */
    .${s}-success-card {
      max-width: 560px;
      margin: 0 auto;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 24px;
      padding: 48px 36px;
      text-align: center;
    }
    .${s}-success-icon {
      width: 56px;
      height: 56px;
      color: ${accent};
      margin: 0 auto 20px;
    }
    .${s}-success-card h3 {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      margin: 0 0 8px;
    }
    .${s}-success-card .${s}-success-msg {
      color: #a1a1aa;
      font-size: 15px;
      margin: 0 0 24px;
      line-height: 1.5;
    }
    .${s}-summary-box {
      border-radius: 12px;
      padding: 16px;
      text-align: left;
      margin-bottom: 20px;
      border: 1px solid;
    }
    .${s}-summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      padding: 4px 0;
    }
    .${s}-summary-row .label { color: #a1a1aa; }
    .${s}-summary-row .value { color: #fff; font-weight: 600; }
    .${s}-summary-divider {
      border: none;
      border-top: 1px solid #3f3f46;
      margin: 10px 0;
    }
    .${s}-note {
      font-size: 13px;
      color: #71717a;
      margin: 0;
    }

    /* ---- Responsive ---- */
    @media (max-width: 768px) {
      .${s}-wrap { padding: 60px 16px; }
      .${s}-grid {
        grid-template-columns: 1fr;
        gap: 24px;
      }
      .${s}-step2-inner { max-width: 100%; }
      .${s}-card { padding: 24px; }
      .${s}-form-card { padding: 24px; }
      .${s}-form-title { font-size: 22px; }
      .${s}-months-big { font-size: 44px; }
      .${s}-svc-grid { grid-template-columns: 1fr; }
      .${s}-success-card { padding: 32px 20px; }
    }
  </style>

  <div class="${s}-inner">

    <!-- Header -->
    <div class="${s}-header">
      <div class="${s}-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Paint Health Analyzer
      </div>
      <h2 class="${s}-headline" data-edit="headline">${headline}</h2>
      <p class="${s}-sub" data-edit="subheadline">${sub}</p>
    </div>

    <!-- ========== STEP 1: Slider ========== -->
    <div class="${s}-step ${s}-active" id="${s}-step1">
      <div class="${s}-card">
        <div class="${s}-img-wrap">
          <img src="${image}" alt="Vehicle paint condition" class="${s}-img" id="${s}-img" data-edit="image">
        </div>

        <div class="${s}-month-display">
          <span class="${s}-months-big" id="${s}-months-big">8</span>
          <span class="${s}-sep">&mdash;</span>
          <span class="${s}-months-text">Since Last Detailed</span>
        </div>

        <input type="range" min="1" max="24" value="8" class="${s}-range" id="${s}-range"
               oninput="window['${s}Update'](this.value)">

        <button type="button" class="${s}-btn" onclick="window['${s}Next']()" data-edit="ctaText">${ctaText} &rarr;</button>
      </div>
    </div>

    <!-- ========== STEP 2: Results + Form ========== -->
    <div class="${s}-step" id="${s}-step2">
      <div class="${s}-step2-inner">
        <div class="${s}-grid">

          <!-- Left: Analysis -->
          <div class="${s}-card">
            <div class="${s}-analysis-img-wrap">
              <img src="${image}" alt="Paint analysis" class="${s}-analysis-img" id="${s}-analysis-img">
              <span class="${s}-health-badge" id="${s}-health-badge">Caution</span>
            </div>

            <div class="${s}-stats">
              <div>
                <div class="${s}-stat-header">
                  <span class="${s}-stat-name">Pollen &amp; Grime</span>
                  <span class="${s}-stat-pct" id="${s}-pollen-pct">35%</span>
                </div>
                <div class="${s}-stat-track">
                  <div class="${s}-stat-fill" id="${s}-pollen-bar"></div>
                </div>
              </div>
              <div>
                <div class="${s}-stat-header">
                  <span class="${s}-stat-name">UV Damage</span>
                  <span class="${s}-stat-pct" id="${s}-uv-pct">25%</span>
                </div>
                <div class="${s}-stat-track">
                  <div class="${s}-stat-fill" id="${s}-uv-bar"></div>
                </div>
              </div>
              <div>
                <div class="${s}-stat-header">
                  <span class="${s}-stat-name">Clear Coat Oxidation</span>
                  <span class="${s}-stat-pct" id="${s}-ox-pct">20%</span>
                </div>
                <div class="${s}-stat-track">
                  <div class="${s}-stat-fill" id="${s}-ox-bar"></div>
                </div>
              </div>
            </div>

            <div class="${s}-info" id="${s}-info">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span id="${s}-info-text"></span>
            </div>
          </div>

          <!-- Right: Form -->
          <div class="${s}-form-card" id="${s}-form-card">
            <h3 class="${s}-form-title">Get Your Free Assessment</h3>
            <p class="${s}-form-subtitle" id="${s}-form-subtitle">Paint Status: Caution &middot; 8 months since last detail</p>

            <div class="${s}-svc-grid">
              ${servicesHtml}
            </div>

            <form class="${s}-form" onsubmit="window['${s}Submit'](event)">
              <div class="${s}-field">
                <span class="${s}-field-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
                <input type="text" class="${s}-input" id="${s}-name" placeholder="Your Name" required>
              </div>
              <div class="${s}-field">
                <span class="${s}-field-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </span>
                <input type="email" class="${s}-input" id="${s}-email" placeholder="Email Address" required>
              </div>
              <div class="${s}-field">
                <span class="${s}-field-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                </span>
                <input type="tel" class="${s}-input" id="${s}-phone" placeholder="Phone Number" required>
              </div>

              <label class="${s}-consent">
                <input type="checkbox" id="${s}-sms" name="sms_consent" required>
                I consent to receive text messages about services I'm interested in. Message &amp; data rates may apply. Text STOP to opt out.
              </label>

              <p class="${s}-error" id="${s}-error"></p>

              <button type="submit" class="${s}-btn" id="${s}-btn" data-edit="submitText">${submitText} &rarr;</button>
            </form>

            <p class="${s}-fine">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              No commitment &middot; Free inspection included
            </p>
          </div>

        </div>
      </div>
    </div>

    <!-- ========== STEP 3: Success ========== -->
    <div class="${s}-step" id="${s}-step3">
      <div class="${s}-success-card">
        <svg class="${s}-success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <h3>Your Paint Report is Ready!</h3>
        <p class="${s}-success-msg">We'll reach out to <strong id="${s}-success-name"></strong> within a few hours.</p>
        <div class="${s}-summary-box" id="${s}-summary-box">
          <div class="${s}-summary-row">
            <span class="label">Paint Health</span>
            <span class="value" id="${s}-sum-health">Caution</span>
          </div>
          <div class="${s}-summary-row">
            <span class="label">Months unprotected</span>
            <span class="value" id="${s}-sum-months">8 months</span>
          </div>
          <div class="${s}-summary-row">
            <span class="label">Pollen / Grime</span>
            <span class="value" id="${s}-sum-pollen">35%</span>
          </div>
          <div class="${s}-summary-row">
            <span class="label">UV Damage</span>
            <span class="value" id="${s}-sum-uv">25%</span>
          </div>
          <hr class="${s}-summary-divider">
          <div class="${s}-summary-row">
            <span class="label">Services requested</span>
            <span class="value" id="${s}-sum-services"></span>
          </div>
        </div>
        <p class="${s}-note">Expect a call or text to confirm your appointment. No obligation.</p>
      </div>
    </div>

  </div>

  <script>
    (function() {
      var HEALTH = [
        { max: 3,  label: 'Good',     color: '#10b981', pollen: 10, uv: 5,  ox: 5  },
        { max: 9,  label: 'Caution',  color: '#eab308', pollen: 35, uv: 25, ox: 20 },
        { max: 18, label: 'Warning',  color: '#f97316', pollen: 65, uv: 55, ox: 45 },
        { max: 99, label: 'Critical', color: '#ef4444', pollen: 90, uv: 85, ox: 75 }
      ];

      function getHealth(m) {
        for (var i = 0; i < HEALTH.length; i++) {
          if (m <= HEALTH[i].max) return HEALTH[i];
        }
        return HEALTH[HEALTH.length - 1];
      }

      function barColor(pct) {
        return pct < 30 ? '#10b981' : pct < 60 ? '#f59e0b' : '#ef4444';
      }

      function hexToRgba(hex, a) {
        var r = parseInt(hex.slice(1,3),16);
        var g = parseInt(hex.slice(3,5),16);
        var b = parseInt(hex.slice(5,7),16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
      }

      /* Step 1 DOM refs */
      var monthsBig = document.getElementById('${s}-months-big');
      var imgEl     = document.getElementById('${s}-img');
      var rangeEl   = document.getElementById('${s}-range');

      /* Step 2 DOM refs */
      var analysisImg   = document.getElementById('${s}-analysis-img');
      var healthBadge   = document.getElementById('${s}-health-badge');
      var pollenPct     = document.getElementById('${s}-pollen-pct');
      var pollenBar     = document.getElementById('${s}-pollen-bar');
      var uvPct         = document.getElementById('${s}-uv-pct');
      var uvBar         = document.getElementById('${s}-uv-bar');
      var oxPct         = document.getElementById('${s}-ox-pct');
      var oxBar         = document.getElementById('${s}-ox-bar');
      var infoBox       = document.getElementById('${s}-info');
      var infoText      = document.getElementById('${s}-info-text');
      var formSubtitle  = document.getElementById('${s}-form-subtitle');

      /* Step refs */
      var step1 = document.getElementById('${s}-step1');
      var step2 = document.getElementById('${s}-step2');
      var step3 = document.getElementById('${s}-step3');

      function computeFilter(m) {
        var d = Math.min(m / 24, 1);
        return 'brightness(' + (1 - d*0.3) + ') saturate(' + (1 - d*0.55) + ') sepia(' + (d*0.35) + ') contrast(' + (1 + d*0.15) + ')';
      }

      /* ---- Step 1: Slider update ---- */
      window['${s}Update'] = function(val) {
        var m = parseInt(val);
        var h = getHealth(m);

        monthsBig.textContent = m + (m === 24 ? '+' : '');
        monthsBig.style.color = h.color;

        imgEl.style.filter = computeFilter(m);
      };

      /* ---- Transition to Step 2 ---- */
      window['${s}Next'] = function() {
        var m = parseInt(rangeEl.value);
        var h = getHealth(m);
        var filterVal = computeFilter(m);

        /* Populate analysis image */
        analysisImg.style.filter = filterVal;

        /* Health badge */
        healthBadge.textContent = h.label;
        healthBadge.style.background = hexToRgba(h.color, 0.85);

        /* Stat bars */
        pollenPct.textContent = h.pollen + '%';
        pollenPct.style.color = barColor(h.pollen);
        pollenBar.style.width = h.pollen + '%';
        pollenBar.style.background = barColor(h.pollen);

        uvPct.textContent = h.uv + '%';
        uvPct.style.color = barColor(h.uv);
        uvBar.style.width = h.uv + '%';
        uvBar.style.background = barColor(h.uv);

        oxPct.textContent = h.ox + '%';
        oxPct.style.color = barColor(h.ox);
        oxBar.style.width = h.ox + '%';
        oxBar.style.background = barColor(h.ox);

        /* Info box */
        var bgA = hexToRgba(h.color, 0.1);
        var bdA = hexToRgba(h.color, 0.2);
        infoBox.style.background = bgA;
        infoBox.style.borderColor = bdA;
        infoBox.querySelector('svg').style.color = h.color;

        var infoMsg = 'At ' + m + ' month' + (m > 1 ? 's' : '') + ', pollen acid and UV rays have begun ';
        if (m > 18) {
          infoMsg += 'permanently etching your clear coat. Without treatment, this damage becomes irreversible.';
        } else if (m > 9) {
          infoMsg += 'visibly dulling your clear coat. Without treatment, this damage becomes irreversible.';
        } else if (m > 3) {
          infoMsg += 'visibly dulling your clear coat.';
        } else {
          infoMsg += 'lightly affecting your clear coat.';
        }
        infoText.textContent = infoMsg;

        /* Form subtitle */
        formSubtitle.innerHTML = 'Paint Status: <span style="color:' + h.color + ';">' + h.label + '</span> &middot; ' + m + ' month' + (m !== 1 ? 's' : '') + ' since last detail';
        formSubtitle.style.color = '#a1a1aa';

        /* Swap steps */
        step1.classList.remove('${s}-active');
        step2.classList.add('${s}-active');
        step2.classList.add('${s}-fade-in');

        /* Widen the inner container for the two-column layout */
        step2.closest('.${s}-inner').style.maxWidth = '1100px';
      };

      /* ---- Step 3: Form submission ---- */
      window['${s}Submit'] = function(e) {
        e.preventDefault();
        var btn   = document.getElementById('${s}-btn');
        var errEl = document.getElementById('${s}-error');
        errEl.style.display = 'none';

        var name  = document.getElementById('${s}-name').value;
        var email = document.getElementById('${s}-email').value;
        var phone = document.getElementById('${s}-phone').value;
        var sms   = document.getElementById('${s}-sms').checked;

        /* Gather selected services */
        var checkboxes = document.querySelectorAll('.${s}-svc-cb:checked');
        var selectedServices = [];
        for (var i = 0; i < checkboxes.length; i++) {
          selectedServices.push(checkboxes[i].value);
        }

        var m = parseInt(rangeEl.value);
        var h = getHealth(m);

        btn.disabled = true;
        btn.textContent = 'Sending...';

        var userId = window.__SORCE_USER_ID__;
        if (!userId) {
          var meta = document.querySelector('meta[name="user-id"]');
          if (meta) userId = meta.content;
        }
        if (!userId) {
          errEl.textContent = 'Configuration error. Please try again later.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.innerHTML = '${submitText} &rarr;';
          return;
        }

        var message = 'Paint health: ' + h.label
          + ' | Months: ' + m
          + ' | Pollen: ' + h.pollen + '%'
          + ' | UV: ' + h.uv + '%'
          + ' | Oxidation: ' + h.ox + '%'
          + ' | Services: ' + selectedServices.join(', ');

        fetch('/api/leads/public/' + userId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            email: email,
            phone: phone,
            service: 'Auto Detailing',
            message: message,
            sms_consent: sms
          })
        })
        .then(function(res) {
          if (!res.ok) throw new Error('Submission failed');

          /* Populate success screen */
          var bgA = hexToRgba(h.color, 0.1);
          var bdA = hexToRgba(h.color, 0.2);
          document.getElementById('${s}-success-name').textContent = name;
          document.getElementById('${s}-sum-health').textContent = h.label;
          document.getElementById('${s}-sum-health').style.color = h.color;
          document.getElementById('${s}-sum-months').textContent = m + ' months';
          document.getElementById('${s}-sum-pollen').textContent = h.pollen + '%';
          document.getElementById('${s}-sum-uv').textContent = h.uv + '%';
          document.getElementById('${s}-sum-services').textContent = selectedServices.join(', ') || 'None selected';
          var sumBox = document.getElementById('${s}-summary-box');
          sumBox.style.background = bgA;
          sumBox.style.borderColor = bdA;

          /* Swap to step 3 */
          step2.classList.remove('${s}-active');
          step3.classList.add('${s}-active');
          step3.classList.add('${s}-fade-in');

          /* Reset inner width for centered success card */
          step3.closest('.${s}-inner').style.maxWidth = '700px';
        })
        .catch(function() {
          errEl.textContent = 'Something went wrong. Please try again.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.innerHTML = '${submitText} &rarr;';
        });
      };

      /* Initialize: run update once for default value */
      window['${s}Update'](rangeEl.value);
    })();
  </script>
</section>
`;
  }
};
