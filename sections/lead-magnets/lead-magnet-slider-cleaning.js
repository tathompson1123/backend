// ============================================
// LEAD MAGNET — Carpet Health Analyzer
// Multi-step carpet health analyzer with slider,
// contamination report, and service selection.
// Dark theme matching auto detailing style.
// Submits to /api/leads/public/:userId
// ============================================

module.exports = {
  id: 'lead-magnet-slider-cleaning',
  name: 'Carpet Health Analyzer',
  category: 'lead-magnet',
  description: 'Multi-step carpet health analyzer with slider, contamination report, and service selection',
  suitability: { cleaning: 1.0, janitorial: 0.8, maid: 0.8, 'carpet cleaning': 0.9 },

  contentSchema: {
    headline:    { type: 'text',  label: 'Headline',                    default: "What's Hiding in Your Carpet?" },
    subheadline: { type: 'text',  label: 'Subheadline',                 default: 'Dust mites, bacteria, and allergens multiply every day. Move the slider to see the contamination.' },
    ctaText:     { type: 'text',  label: 'Analyze Button',              default: 'Check My Carpet' },
    submitText:  { type: 'text',  label: 'Submit Button',               default: 'Get My Free Assessment' },
    services:    { type: 'text',  label: 'Services (comma-separated)',   default: 'Deep Carpet Clean, Stain Removal, Pet Odor Treatment, Upholstery Cleaning, Move-Out Clean' },
    image:       { type: 'image', label: 'Carpet Image',                default: 'https://images.unsplash.com/photo-1558618047-f18c8def4765?w=800&q=80' },
  },

  render(content, theme, sectionId = 'lm-slider-cleaning') {
    const s = `section-${sectionId}`;
    const accent   = theme.primaryColor || '#9333ea';
    const headFont = theme.headingFont  || 'Inter';

    const headline    = content.headline    || "What's Hiding in Your Carpet?";
    const subheadline = content.subheadline || 'Dust mites, bacteria, and allergens multiply every day. Move the slider to see the contamination.';
    const ctaText     = content.ctaText     || 'Check My Carpet';
    const submitText  = content.submitText  || 'Get My Free Assessment';
    const image       = content.image       || 'https://images.unsplash.com/photo-1558618047-f18c8def4765?w=800&q=80';

    const servicesList = (content.services || 'Deep Carpet Clean, Stain Removal, Pet Odor Treatment, Upholstery Cleaning, Move-Out Clean')
      .split(',').map(sv => sv.trim()).filter(Boolean);

    const serviceCheckboxesHTML = servicesList.map((svc, i) =>
      `<label class="${s}-svc-label">
        <input type="checkbox" name="service_${i}" value="${svc}" class="${s}-svc-cb"${i === 0 ? ' checked' : ''}>
        <span class="${s}-svc-check">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
        <span class="${s}-svc-text">${svc}</span>
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
      max-width: 1280px;
      margin: 0 auto;
    }

    /* ---- Fade transition ---- */
    .${s}-fade-in {
      animation: ${s}FadeIn 0.45s ease both;
    }
    @keyframes ${s}FadeIn {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: none; }
    }

    /* ============ STEP 1 — Slider ============ */
    .${s}-step1-center {
      max-width: 700px;
      margin: 0 auto;
      text-align: center;
    }

    /* Header */
    .${s}-header {
      text-align: center;
      margin-bottom: 40px;
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
      font-size: clamp(28px, 5vw, 48px);
      font-weight: 800;
      color: #fff;
      line-height: 1.15;
      margin: 0 0 16px;
      letter-spacing: -0.02em;
    }
    .${s}-sub {
      font-size: 18px;
      color: #a1a1aa;
      line-height: 1.6;
      margin: 0;
    }

    /* Card shared */
    .${s}-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 24px;
      padding: 32px;
      text-align: left;
    }

    /* Image container */
    .${s}-img-wrap {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      aspect-ratio: 16/9;
      background: #27272a;
      margin-bottom: 28px;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.1);
    }
    .${s}-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: filter 0.7s ease;
    }

    /* Month display */
    .${s}-months-display {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 0;
      margin-bottom: 20px;
    }
    .${s}-months-big {
      font-size: 56px;
      font-weight: 900;
      line-height: 1;
      transition: color 0.3s;
    }
    .${s}-months-sep {
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

    /* Range input */
    .${s}-range {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 8px;
      background: #27272a;
      border-radius: 4px;
      outline: none;
      margin-bottom: 8px;
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
    .${s}-scale {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #52525b;
      margin-bottom: 32px;
    }

    /* CTA button */
    .${s}-btn {
      width: 100%;
      padding: 18px;
      background: ${accent};
      color: #fff;
      border: none;
      border-radius: 16px;
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.15s;
      box-shadow: 0 4px 20px ${accent}55;
      font-family: inherit;
    }
    .${s}-btn:hover { opacity: 0.92; transform: translateY(-1px); }
    .${s}-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

    /* ============ STEP 2 — Results + Form ============ */
    .${s}-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      align-items: start;
    }

    /* Health badge overlay on image */
    .${s}-health-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      border: 1px solid;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .${s}-health-badge svg { width: 14px; height: 14px; flex-shrink: 0; }

    /* Stat bars */
    .${s}-stats { display: flex; flex-direction: column; gap: 14px; margin-bottom: 24px; }
    .${s}-stat-header {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 5px;
    }
    .${s}-stat-name { color: #a1a1aa; font-weight: 500; }
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
      transition: width 0.8s ease, background 0.3s;
    }

    /* Info box */
    .${s}-info {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid;
      font-size: 14px;
      line-height: 1.5;
      color: #d4d4d8;
      transition: background 0.3s, border-color 0.3s;
    }
    .${s}-info svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      margin-top: 2px;
      color: ${accent};
    }

    /* ---- Form card ---- */
    .${s}-form-card {
      background: rgba(24,24,27,0.5);
      border: 1px solid #27272a;
      border-radius: 24px;
      padding: 32px 36px;
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
      margin-bottom: 24px;
    }
    .${s}-svc-label {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid #27272a;
      background: #09090b;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .${s}-svc-label:hover {
      border-color: #3f3f46;
    }
    .${s}-svc-cb {
      display: none;
    }
    .${s}-svc-check {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 2px solid #3f3f46;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s, border-color 0.2s;
    }
    .${s}-svc-check svg {
      opacity: 0;
      transition: opacity 0.15s;
      color: #fff;
    }
    .${s}-svc-cb:checked + .${s}-svc-check {
      background: ${accent};
      border-color: ${accent};
    }
    .${s}-svc-cb:checked + .${s}-svc-check svg {
      opacity: 1;
    }
    .${s}-svc-cb:checked ~ .${s}-svc-text {
      color: #fff;
    }
    .${s}-svc-text {
      font-size: 14px;
      color: #a1a1aa;
      font-weight: 500;
      transition: color 0.2s;
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
      font-size: 16px;
      color: #52525b;
      pointer-events: none;
      line-height: 1;
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

    /* Consent */
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

    /* ============ STEP 3 — Success ============ */
    .${s}-success {
      max-width: 560px;
      margin: 0 auto;
      text-align: center;
    }
    .${s}-success-icon {
      width: 56px;
      height: 56px;
      color: ${accent};
      margin: 0 auto 20px;
    }
    .${s}-success h3 {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      margin: 0 0 8px;
    }
    .${s}-success p {
      color: #a1a1aa;
      font-size: 15px;
      margin: 0 0 24px;
      line-height: 1.5;
    }
    .${s}-summary-box {
      border-radius: 16px;
      padding: 20px;
      text-align: left;
      margin-bottom: 20px;
      border: 1px solid;
      background: rgba(24,24,27,0.6);
      border-color: #27272a;
    }
    .${s}-summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      padding: 5px 0;
    }
    .${s}-summary-row .label { color: #a1a1aa; }
    .${s}-summary-row .value { color: #fff; font-weight: 600; }
    .${s}-summary-divider {
      border: none;
      border-top: 1px solid #3f3f46;
      margin: 10px 0;
    }
    .${s}-success .note {
      font-size: 13px;
      color: #71717a;
      margin: 0;
    }

    /* ============ Responsive ============ */
    @media (max-width: 768px) {
      .${s}-wrap { padding: 48px 16px; }
      .${s}-grid {
        grid-template-columns: 1fr;
        gap: 28px;
      }
      .${s}-card { padding: 24px; }
      .${s}-form-card { padding: 24px; }
      .${s}-form-title { font-size: 22px; }
      .${s}-months-big { font-size: 44px; }
      .${s}-months-sep { font-size: 20px; margin: 0 8px; }
      .${s}-months-text { font-size: 14px; }
      .${s}-svc-grid {
        grid-template-columns: 1fr;
      }
      .${s}-headline {
        font-size: clamp(24px, 6vw, 36px);
      }
      .${s}-sub { font-size: 16px; }
    }
  </style>

  <div class="${s}-inner">

    <!-- ====== STEP 1 — Slider ====== -->
    <div id="${s}-step1" class="${s}-fade-in">
      <div class="${s}-step1-center">

        <div class="${s}-header">
          <div class="${s}-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Carpet Health Analyzer
          </div>
          <h2 class="${s}-headline">${headline}</h2>
          <p class="${s}-sub">${subheadline}</p>
        </div>

        <div class="${s}-card">
          <div class="${s}-img-wrap">
            <img src="${image}" alt="Carpet condition" class="${s}-img" id="${s}-img">
          </div>

          <div class="${s}-months-display">
            <span class="${s}-months-big" id="${s}-months-big" style="color:#eab308;">12</span>
            <span class="${s}-months-sep">&mdash;</span>
            <span class="${s}-months-text">Since Last Cleaned</span>
          </div>

          <input type="range" min="1" max="36" value="12" class="${s}-range" id="${s}-range"
                 oninput="window['${s}Update'](this.value)">
          <div class="${s}-scale">
            <span>1 month</span>
            <span>3 years</span>
          </div>

          <button type="button" class="${s}-btn" onclick="window['${s}Next']()">${ctaText} &rarr;</button>
        </div>

      </div>
    </div>

    <!-- ====== STEP 2 — Results + Form ====== -->
    <div id="${s}-step2" style="display:none;">
      <div class="${s}-header" style="margin-bottom:32px;">
        <h2 class="${s}-headline" style="font-size:clamp(24px,4vw,36px);">Your Carpet Analysis</h2>
        <p class="${s}-sub" id="${s}-step2-subtitle">Here is the contamination breakdown for your carpet.</p>
      </div>

      <div class="${s}-grid">

        <!-- Left: Analysis Card -->
        <div class="${s}-card">
          <div class="${s}-img-wrap" style="margin-bottom:24px;">
            <img src="${image}" alt="Carpet condition" class="${s}-img" id="${s}-img2">
            <div class="${s}-health-badge" id="${s}-health-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span id="${s}-health-label">Moderate</span>
            </div>
          </div>

          <div class="${s}-stats">
            <div>
              <div class="${s}-stat-header">
                <span class="${s}-stat-name">Dust Mite Density</span>
                <span class="${s}-stat-pct" id="${s}-dust-pct">35%</span>
              </div>
              <div class="${s}-stat-track">
                <div class="${s}-stat-fill" id="${s}-dust-bar"></div>
              </div>
            </div>
            <div>
              <div class="${s}-stat-header">
                <span class="${s}-stat-name">Bacteria Level</span>
                <span class="${s}-stat-pct" id="${s}-bact-pct">30%</span>
              </div>
              <div class="${s}-stat-track">
                <div class="${s}-stat-fill" id="${s}-bact-bar"></div>
              </div>
            </div>
            <div>
              <div class="${s}-stat-header">
                <span class="${s}-stat-name">Allergen Concentration</span>
                <span class="${s}-stat-pct" id="${s}-allerg-pct">25%</span>
              </div>
              <div class="${s}-stat-track">
                <div class="${s}-stat-fill" id="${s}-allerg-bar"></div>
              </div>
            </div>
          </div>

          <div class="${s}-info" id="${s}-info"
               style="background:rgba(234,179,8,0.1);border-color:rgba(234,179,8,0.2);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <span id="${s}-info-text">At 12 months, contaminants are visibly affecting your carpet fibers and air quality.</span>
          </div>
        </div>

        <!-- Right: Form Card -->
        <div class="${s}-form-card" id="${s}-form-card">
          <h3 class="${s}-form-title">Get Your Free Assessment</h3>
          <p class="${s}-form-subtitle" id="${s}-form-subtitle" style="color:#eab308;">
            Carpet Status: Moderate &middot; 12 months since last cleaning
          </p>

          <div class="${s}-svc-grid">
            ${serviceCheckboxesHTML}
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
              <input type="checkbox" name="sms_consent" id="${s}-sms" required>
              I consent to receive text messages about my carpet cleaning services. Message &amp; data rates may apply. Text STOP to opt out.
            </label>

            <p class="${s}-error" id="${s}-error"></p>

            <button type="submit" class="${s}-btn" id="${s}-btn">${submitText} &rarr;</button>
          </form>

          <p class="${s}-fine">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            No commitment &middot; 100% free assessment
          </p>
        </div>

      </div>
    </div>

    <!-- ====== STEP 3 — Success ====== -->
    <div id="${s}-step3" style="display:none;">
      <div class="${s}-success ${s}-fade-in">
        <svg class="${s}-success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <h3>Your Carpet Report is Ready!</h3>
        <p>We'll reach out to <strong id="${s}-success-name"></strong> within a few hours to schedule your assessment.</p>

        <div class="${s}-summary-box" id="${s}-summary-box">
          <div class="${s}-summary-row">
            <span class="label">Health</span>
            <span class="value" id="${s}-sum-health" style="color:#eab308;">Moderate</span>
          </div>
          <div class="${s}-summary-row">
            <span class="label">Months since cleaning</span>
            <span class="value" id="${s}-sum-months">12 months</span>
          </div>
          <hr class="${s}-summary-divider">
          <div class="${s}-summary-row">
            <span class="label">Dust Mites</span>
            <span class="value" id="${s}-sum-dust">35%</span>
          </div>
          <div class="${s}-summary-row">
            <span class="label">Bacteria</span>
            <span class="value" id="${s}-sum-bact">30%</span>
          </div>
          <div class="${s}-summary-row">
            <span class="label">Allergens</span>
            <span class="value" id="${s}-sum-allerg">25%</span>
          </div>
          <hr class="${s}-summary-divider">
          <div class="${s}-summary-row">
            <span class="label">Services Requested</span>
            <span class="value" id="${s}-sum-services" style="text-align:right;max-width:60%;">—</span>
          </div>
        </div>

        <p class="note">Expect a call or text within a few hours to confirm your appointment. No obligation.</p>
      </div>
    </div>

  </div>

  <script>
    (function() {
      var HEALTH = [
        { max: 5,  label: 'Good',     color: '#10b981', dust: 10, bacteria: 8,  allergen: 5,  filterIntensity: 0   },
        { max: 11, label: 'Moderate',  color: '#eab308', dust: 35, bacteria: 30, allergen: 25, filterIntensity: 0.3 },
        { max: 23, label: 'Warning',   color: '#f97316', dust: 65, bacteria: 55, allergen: 50, filterIntensity: 0.6 },
        { max: 99, label: 'Critical',  color: '#ef4444', dust: 90, bacteria: 85, allergen: 80, filterIntensity: 1   }
      ];

      function getHealth(m) {
        for (var i = 0; i < HEALTH.length; i++) {
          if (m <= HEALTH[i].max) return HEALTH[i];
        }
        return HEALTH[HEALTH.length - 1];
      }

      function barColor(pct) {
        return pct < 25 ? '#10b981' : pct < 50 ? '#eab308' : pct < 70 ? '#f97316' : '#ef4444';
      }

      function hexToRgba(hex, a) {
        var r = parseInt(hex.slice(1,3),16);
        var g = parseInt(hex.slice(3,5),16);
        var b = parseInt(hex.slice(5,7),16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
      }

      /* Cache Step 1 DOM refs */
      var monthsBig = document.getElementById('${s}-months-big');
      var img1      = document.getElementById('${s}-img');

      /* --- Step 1: Slider update --- */
      window['${s}Update'] = function(val) {
        var m = parseInt(val, 10);
        var h = getHealth(m);

        /* Month number display */
        monthsBig.textContent = m;
        monthsBig.style.color = h.color;

        /* Image filter */
        var fi = h.filterIntensity;
        img1.style.filter = 'sepia(' + (fi * 60) + '%) brightness(' + (1 - fi * 0.35) + ') saturate(' + (1 - fi * 0.5) + ')';
      };

      /* Initial update */
      window['${s}Update'](12);

      /* --- Step 1 -> Step 2 --- */
      window['${s}Next'] = function() {
        var m = parseInt(document.getElementById('${s}-range').value, 10);
        var h = getHealth(m);
        var fi = h.filterIntensity;
        var bgA = hexToRgba(h.color, 0.1);
        var bdA = hexToRgba(h.color, 0.2);

        /* Freeze image filter on step2 image */
        var img2 = document.getElementById('${s}-img2');
        img2.style.filter = 'sepia(' + (fi * 60) + '%) brightness(' + (1 - fi * 0.35) + ') saturate(' + (1 - fi * 0.5) + ')';

        /* Health badge */
        var badge = document.getElementById('${s}-health-badge');
        badge.style.background = hexToRgba(h.color, 0.15);
        badge.style.borderColor = hexToRgba(h.color, 0.3);
        badge.style.color = h.color;
        document.getElementById('${s}-health-label').textContent = h.label;

        /* Stat bars — animate after a small delay for visual effect */
        setTimeout(function() {
          var dustBar = document.getElementById('${s}-dust-bar');
          var bactBar = document.getElementById('${s}-bact-bar');
          var allergBar = document.getElementById('${s}-allerg-bar');

          dustBar.style.width = h.dust + '%';
          dustBar.style.background = barColor(h.dust);
          document.getElementById('${s}-dust-pct').textContent = h.dust + '%';
          document.getElementById('${s}-dust-pct').style.color = h.color;

          bactBar.style.width = h.bacteria + '%';
          bactBar.style.background = barColor(h.bacteria);
          document.getElementById('${s}-bact-pct').textContent = h.bacteria + '%';
          document.getElementById('${s}-bact-pct').style.color = h.color;

          allergBar.style.width = h.allergen + '%';
          allergBar.style.background = barColor(h.allergen);
          document.getElementById('${s}-allerg-pct').textContent = h.allergen + '%';
          document.getElementById('${s}-allerg-pct').style.color = h.color;
        }, 100);

        /* Info box */
        var infoBox = document.getElementById('${s}-info');
        infoBox.style.background = bgA;
        infoBox.style.borderColor = bdA;

        var infoMsg = 'At ' + m + ' month' + (m > 1 ? 's' : '') + ', contaminants are ';
        if (m <= 5) {
          infoMsg += 'lightly affecting your indoor air quality.';
        } else if (m <= 11) {
          infoMsg += 'visibly affecting your carpet fibers and air quality.';
        } else if (m <= 23) {
          infoMsg += 'significantly contaminating your home environment. Professional cleaning is strongly recommended.';
        } else {
          infoMsg += 'critically contaminating your living space with dangerous allergen levels. Immediate professional cleaning is needed.';
        }
        document.getElementById('${s}-info-text').textContent = infoMsg;

        /* Form subtitle */
        document.getElementById('${s}-form-subtitle').innerHTML = 'Carpet Status: ' + h.label + ' &middot; ' + m + ' month' + (m !== 1 ? 's' : '') + ' since last cleaning';
        document.getElementById('${s}-form-subtitle').style.color = h.color;

        /* Swap step1 -> step2 */
        document.getElementById('${s}-step1').style.display = 'none';
        var step2 = document.getElementById('${s}-step2');
        step2.style.display = 'block';
        step2.classList.add('${s}-fade-in');
      };

      /* --- Step 2: Form submit --- */
      window['${s}Submit'] = function(e) {
        e.preventDefault();
        var btn = document.getElementById('${s}-btn');
        var errEl = document.getElementById('${s}-error');
        errEl.style.display = 'none';

        var name  = document.getElementById('${s}-name').value.trim();
        var email = document.getElementById('${s}-email').value.trim();
        var phone = document.getElementById('${s}-phone').value.trim();
        var smsConsent = document.getElementById('${s}-sms').checked;

        var m = parseInt(document.getElementById('${s}-range').value, 10);
        var h = getHealth(m);

        /* Collect selected services */
        var checkboxes = document.querySelectorAll('.${s}-svc-cb:checked');
        var selectedServices = [];
        for (var i = 0; i < checkboxes.length; i++) {
          selectedServices.push(checkboxes[i].value);
        }

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

        var message = 'Carpet health: ' + h.label
          + ' | Months: ' + m
          + ' | Dust Mites: ' + h.dust + '%'
          + ' | Bacteria: ' + h.bacteria + '%'
          + ' | Allergen: ' + h.allergen + '%'
          + ' | Services: ' + selectedServices.join(', ');

        fetch('/api/leads/public/' + userId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            email: email,
            phone: phone,
            service: 'Carpet Cleaning',
            message: message,
            sms_consent: smsConsent
          })
        })
        .then(function(res) {
          if (!res.ok) throw new Error('Submission failed');

          /* Populate success screen */
          document.getElementById('${s}-success-name').textContent = name;
          document.getElementById('${s}-sum-health').textContent = h.label;
          document.getElementById('${s}-sum-health').style.color = h.color;
          document.getElementById('${s}-sum-months').textContent = m + ' months';
          document.getElementById('${s}-sum-dust').textContent = h.dust + '%';
          document.getElementById('${s}-sum-bact').textContent = h.bacteria + '%';
          document.getElementById('${s}-sum-allerg').textContent = h.allergen + '%';
          document.getElementById('${s}-sum-services').textContent = selectedServices.length > 0 ? selectedServices.join(', ') : 'None selected';

          /* Swap step2 -> step3 */
          document.getElementById('${s}-step2').style.display = 'none';
          var step3 = document.getElementById('${s}-step3');
          step3.style.display = 'block';
          step3.querySelector('.${s}-success').classList.add('${s}-fade-in');
        })
        .catch(function() {
          errEl.textContent = 'Something went wrong. Please try again.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.innerHTML = '${submitText} &rarr;';
        });
      };
    })();
  </script>
</section>
`;
  }
};
