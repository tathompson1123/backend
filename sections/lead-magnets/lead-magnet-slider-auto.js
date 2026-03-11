module.exports = {
  id: 'lead-magnet-slider-auto',
  name: 'Paint Health Analyzer',
  category: 'lead-magnet',
  description: 'Interactive slider showing paint degradation over time with urgency discount',
  suitability: { 'auto-detailing': 1.0, 'auto-wrap': 0.9, automotive: 0.8 },
  contentSchema: {
    headline: { type: 'text', label: 'Headline', default: "What's Happening to Your Paint?" },
    subheadline: { type: 'text', label: 'Subheadline', default: 'Pollen, grime, and UV rays attack your clear coat every day. Move the slider to see the damage.' },
    ctaText: { type: 'text', label: 'CTA Button', default: 'Lock In My Discount' },
    image: { type: 'image', label: 'Vehicle Image', default: 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?w=1200&auto=format&fit=crop&q=80' },
  },
  render(content, theme, sectionId = 'lm-slider-auto') {
    const s = `section-${sectionId}`;
    const accent = theme.primaryColor || '#f59e0b';
    const headFont = theme.headingFont || 'Inter';

    const headline = content.headline || "What's Happening to Your Paint?";
    const sub = content.subheadline || 'Pollen, grime, and UV rays attack your clear coat every day. Move the slider to see the damage.';
    const ctaText = content.ctaText || 'Lock In My Discount';
    const image = content.image || 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?w=1200&auto=format&fit=crop&q=80';

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

    /* Header */
    .${s}-header {
      text-align: center;
      max-width: 720px;
      margin: 0 auto 48px;
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

    /* Two-column layout */
    .${s}-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 48px;
      align-items: start;
    }

    /* Card shared */
    .${s}-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 24px;
      padding: 32px;
    }

    /* Slider label */
    .${s}-slider-label {
      font-size: 14px;
      font-weight: 700;
      color: #d4d4d8;
      margin-bottom: 16px;
      display: block;
    }
    .${s}-slider-val {
      font-size: 20px;
      margin-left: 8px;
      font-weight: 800;
      transition: color 0.3s;
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
      margin-bottom: 32px;
      cursor: pointer;
    }
    .${s}-range::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: ${accent};
      cursor: pointer;
      border: 3px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .${s}-range::-moz-range-thumb {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: ${accent};
      cursor: pointer;
      border: 3px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }

    /* Image container */
    .${s}-img-wrap {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      aspect-ratio: 16/9;
      background: #27272a;
      margin-bottom: 24px;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.1);
    }
    .${s}-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: filter 0.7s ease;
    }
    .${s}-img-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 60%);
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 20px;
    }
    .${s}-img-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .${s}-img-label {
      font-size: 11px;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .${s}-health-text {
      font-size: 22px;
      font-weight: 900;
      text-transform: uppercase;
      transition: color 0.3s;
    }
    .${s}-discount-text {
      font-size: 22px;
      font-weight: 900;
      color: ${accent};
      text-align: right;
    }

    /* Stat bars */
    .${s}-stats { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
    .${s}-stat-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 4px;
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
      transition: width 0.7s ease, background 0.3s;
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

    /* ---- Right column: Form ---- */
    .${s}-form-card {
      background: rgba(24,24,27,0.5);
      border: 1px solid #27272a;
      border-radius: 24px;
      padding: 32px 36px;
    }
    .${s}-form-title {
      font-size: 28px;
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

    /* Discount callout */
    .${s}-discount-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-radius: 16px;
      border: 1px solid;
      margin-bottom: 28px;
      transition: background 0.3s, border-color 0.3s;
    }
    .${s}-discount-label {
      font-size: 14px;
      font-weight: 600;
      color: #d4d4d8;
    }
    .${s}-discount-sub {
      font-size: 12px;
      color: #71717a;
      margin-top: 2px;
    }
    .${s}-discount-big {
      font-size: 36px;
      font-weight: 900;
      transition: color 0.3s;
    }
    .${s}-discount-big span {
      font-size: 18px;
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

    /* Submit button */
    .${s}-btn {
      width: 100%;
      padding: 16px;
      background: ${accent};
      color: #09090b;
      border: none;
      border-radius: 12px;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.15s;
      box-shadow: 0 4px 20px ${accent}55;
      font-family: inherit;
      margin-top: 4px;
    }
    .${s}-btn:hover { opacity: 0.92; transform: translateY(-1px); }
    .${s}-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

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

    /* ---- Success screen ---- */
    .${s}-success {
      display: none;
      text-align: center;
      padding: 20px 0;
    }
    .${s}-success-icon {
      width: 56px;
      height: 56px;
      color: ${accent};
      margin: 0 auto 20px;
    }
    .${s}-success h3 {
      font-size: 24px;
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
      border-radius: 12px;
      padding: 16px;
      text-align: left;
      margin-bottom: 20px;
      border: 1px solid;
      transition: background 0.3s, border-color 0.3s;
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
    .${s}-success .note {
      font-size: 13px;
      color: #71717a;
      margin: 0;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .${s}-grid {
        grid-template-columns: 1fr;
        gap: 32px;
      }
      .${s}-card { padding: 24px; }
      .${s}-form-card { padding: 24px; }
      .${s}-form-title { font-size: 24px; }
      .${s}-discount-big { font-size: 28px; }
    }
  </style>

  <div class="${s}-inner">

    <!-- Header -->
    <div class="${s}-header">
      <div class="${s}-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Paint Health Analyzer
      </div>
      <h2 class="${s}-headline">${headline}</h2>
      <p class="${s}-sub">${sub}</p>
    </div>

    <div class="${s}-grid">

      <!-- Left: Interactive Visualizer -->
      <div class="${s}-card">
        <label class="${s}-slider-label">
          Months since last professional detail:
          <span class="${s}-slider-val" id="${s}-months-val">8</span>
        </label>
        <input type="range" min="1" max="24" value="8" class="${s}-range" id="${s}-range"
               oninput="window['${s}Update'](this.value)">

        <div class="${s}-img-wrap">
          <img src="${image}" alt="Vehicle paint condition" class="${s}-img" id="${s}-img">
          <div class="${s}-img-overlay">
            <div class="${s}-img-row">
              <div>
                <p class="${s}-img-label">Paint Health</p>
                <p class="${s}-health-text" id="${s}-health-label">Caution</p>
              </div>
              <div>
                <p class="${s}-img-label">Your Discount</p>
                <p class="${s}-discount-text" id="${s}-img-discount">40% OFF</p>
              </div>
            </div>
          </div>
        </div>

        <div class="${s}-stats">
          <div>
            <div class="${s}-stat-header">
              <span class="${s}-stat-name">Pollen &amp; Grime Coverage</span>
              <span class="${s}-stat-pct" id="${s}-pollen-pct">35%</span>
            </div>
            <div class="${s}-stat-track">
              <div class="${s}-stat-fill" id="${s}-pollen-bar" style="width:35%;background:#f59e0b;"></div>
            </div>
          </div>
          <div>
            <div class="${s}-stat-header">
              <span class="${s}-stat-name">UV Damage Severity</span>
              <span class="${s}-stat-pct" id="${s}-uv-pct">25%</span>
            </div>
            <div class="${s}-stat-track">
              <div class="${s}-stat-fill" id="${s}-uv-bar" style="width:25%;background:#10b981;"></div>
            </div>
          </div>
          <div>
            <div class="${s}-stat-header">
              <span class="${s}-stat-name">Clear Coat Oxidation</span>
              <span class="${s}-stat-pct" id="${s}-ox-pct">20%</span>
            </div>
            <div class="${s}-stat-track">
              <div class="${s}-stat-fill" id="${s}-ox-bar" style="width:20%;background:#10b981;"></div>
            </div>
          </div>
        </div>

        <div class="${s}-info" id="${s}-info"
             style="background:rgba(234,179,8,0.1);border-color:rgba(234,179,8,0.2);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span id="${s}-info-text">At 8 months, pollen acid and UV rays have begun visibly dulling your clear coat.</span>
        </div>
      </div>

      <!-- Right: Lead Capture Form -->
      <div>
        <div class="${s}-form-card" id="${s}-form-card">
          <h3 class="${s}-form-title" id="${s}-form-title">Claim Your 40% Discount</h3>
          <p class="${s}-form-subtitle" id="${s}-form-subtitle" style="color:#eab308;">
            Paint Status: Caution &middot; 8 months since last detail
          </p>

          <div class="${s}-discount-box" id="${s}-discount-box"
               style="background:rgba(234,179,8,0.1);border-color:rgba(234,179,8,0.2);">
            <div>
              <div class="${s}-discount-label">Your urgency discount</div>
              <div class="${s}-discount-sub">Based on 8 months unprotected</div>
            </div>
            <div class="${s}-discount-big" id="${s}-discount-big" style="color:#eab308;">40%<span> OFF</span></div>
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
              <input type="checkbox" id="${s}-sms" checked>
              By submitting, you consent to receive SMS updates about your appointment. Message &amp; data rates may apply.
            </label>

            <p class="${s}-error" id="${s}-error"></p>

            <button type="submit" class="${s}-btn" id="${s}-btn">${ctaText} &rarr;</button>
          </form>

          <p class="${s}-fine">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            No commitment &middot; Free inspection included
          </p>
        </div>

        <!-- Success Screen -->
        <div class="${s}-success" id="${s}-success">
          <div class="${s}-card" style="padding:40px 32px;">
            <svg class="${s}-success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <h3>Your Paint Report is Ready!</h3>
            <p>We'll reach out to <strong id="${s}-success-name"></strong> within a few hours.</p>
            <div class="${s}-summary-box" id="${s}-summary-box" style="background:rgba(234,179,8,0.1);border-color:rgba(234,179,8,0.2);">
              <div class="${s}-summary-row">
                <span class="label">Paint Health</span>
                <span class="value" id="${s}-sum-health" style="color:#eab308;">Caution</span>
              </div>
              <div class="${s}-summary-row">
                <span class="label">Months unprotected</span>
                <span class="value" id="${s}-sum-months">8 months</span>
              </div>
              <div class="${s}-summary-row">
                <span class="label">Pollen / Grime</span>
                <span class="value" id="${s}-sum-pollen">35% coverage</span>
              </div>
              <div class="${s}-summary-row">
                <span class="label">UV Damage</span>
                <span class="value" id="${s}-sum-uv">25%</span>
              </div>
              <hr class="${s}-summary-divider">
              <div class="${s}-summary-row">
                <span class="label" style="color:#fff;font-weight:700;">Urgency Discount</span>
                <span class="value" id="${s}-sum-discount" style="font-size:22px;font-weight:900;color:${accent};">40% OFF</span>
              </div>
            </div>
            <p class="note" style="font-size:13px;color:#71717a;">Expect a call or text to confirm your booking. No obligation.</p>
          </div>
        </div>
      </div>

    </div>
  </div>

  <script>
    (function() {
      var HEALTH = [
        { max: 3,  label: 'Good',     color: '#10b981', pollen: 10, uv: 5,  ox: 5,  discount: 20 },
        { max: 9,  label: 'Caution',  color: '#eab308', pollen: 35, uv: 25, ox: 20, discount: 40 },
        { max: 18, label: 'Warning',  color: '#f97316', pollen: 65, uv: 55, ox: 45, discount: 60 },
        { max: 99, label: 'Critical', color: '#ef4444', pollen: 90, uv: 85, ox: 75, discount: 80 }
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

      /* Cache DOM refs */
      var monthsVal    = document.getElementById('${s}-months-val');
      var img          = document.getElementById('${s}-img');
      var healthLabel  = document.getElementById('${s}-health-label');
      var imgDiscount  = document.getElementById('${s}-img-discount');
      var pollenPct    = document.getElementById('${s}-pollen-pct');
      var pollenBar    = document.getElementById('${s}-pollen-bar');
      var uvPct        = document.getElementById('${s}-uv-pct');
      var uvBar        = document.getElementById('${s}-uv-bar');
      var oxPct        = document.getElementById('${s}-ox-pct');
      var oxBar        = document.getElementById('${s}-ox-bar');
      var infoBox      = document.getElementById('${s}-info');
      var infoText     = document.getElementById('${s}-info-text');
      var formTitle    = document.getElementById('${s}-form-title');
      var formSubtitle = document.getElementById('${s}-form-subtitle');
      var discountBox  = document.getElementById('${s}-discount-box');
      var discountBig  = document.getElementById('${s}-discount-big');

      window['${s}Update'] = function(val) {
        var m = parseInt(val);
        var h = getHealth(m);
        var d = Math.min(m / 24, 1);

        /* Slider value */
        monthsVal.textContent = m + (m === 24 ? '+' : '');
        monthsVal.style.color = h.color;

        /* Image filter */
        img.style.filter = 'brightness(' + (1 - d*0.3) + ') saturate(' + (1 - d*0.55) + ') sepia(' + (d*0.35) + ') contrast(' + (1 + d*0.15) + ')';

        /* Health label on image */
        healthLabel.textContent = h.label;
        healthLabel.style.color = h.color;

        /* Discount on image */
        imgDiscount.textContent = h.discount + '% OFF';

        /* Stat bars */
        pollenPct.textContent = h.pollen + '%';
        pollenPct.style.color = h.color;
        pollenBar.style.width = h.pollen + '%';
        pollenBar.style.background = barColor(h.pollen);

        uvPct.textContent = h.uv + '%';
        uvPct.style.color = h.color;
        uvBar.style.width = h.uv + '%';
        uvBar.style.background = barColor(h.uv);

        oxPct.textContent = h.ox + '%';
        oxPct.style.color = h.color;
        oxBar.style.width = h.ox + '%';
        oxBar.style.background = barColor(h.ox);

        /* Info box */
        var bgA = hexToRgba(h.color, 0.1);
        var bdA = hexToRgba(h.color, 0.2);
        infoBox.style.background = bgA;
        infoBox.style.borderColor = bdA;

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

        /* Form title & subtitle */
        formTitle.textContent = 'Claim Your ' + h.discount + '% Discount';
        formSubtitle.innerHTML = 'Paint Status: ' + h.label + ' &middot; ' + m + ' month' + (m !== 1 ? 's' : '') + ' since last detail';
        formSubtitle.style.color = h.color;

        /* Discount callout box */
        discountBox.style.background = bgA;
        discountBox.style.borderColor = bdA;
        discountBox.querySelector('.${s}-discount-sub').textContent = 'Based on ' + m + ' months unprotected';
        discountBig.innerHTML = h.discount + '%<span> OFF</span>';
        discountBig.style.color = h.color;
      };

      /* ---- Form Submission ---- */
      window['${s}Submit'] = function(e) {
        e.preventDefault();
        var btn = document.getElementById('${s}-btn');
        var errEl = document.getElementById('${s}-error');
        errEl.style.display = 'none';

        var name  = document.getElementById('${s}-name').value;
        var email = document.getElementById('${s}-email').value;
        var phone = document.getElementById('${s}-phone').value;
        var sms   = document.getElementById('${s}-sms').checked;

        var m = parseInt(document.getElementById('${s}-range').value);
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
          btn.innerHTML = '${ctaText} &rarr;';
          return;
        }

        var message = 'Paint health: ' + h.label
          + ' | Months since detail: ' + m
          + ' | Pollen: ' + h.pollen + '%'
          + ' | UV Damage: ' + h.uv + '%'
          + ' | Oxidation: ' + h.ox + '%'
          + ' | Discount: ' + h.discount + '% off';

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
          document.getElementById('${s}-sum-pollen').textContent = h.pollen + '% coverage';
          document.getElementById('${s}-sum-uv').textContent = h.uv + '%';
          document.getElementById('${s}-sum-discount').textContent = h.discount + '% OFF';
          var sumBox = document.getElementById('${s}-summary-box');
          sumBox.style.background = bgA;
          sumBox.style.borderColor = bdA;

          /* Swap views */
          document.getElementById('${s}-form-card').style.display = 'none';
          document.getElementById('${s}-success').style.display = 'block';
        })
        .catch(function() {
          errEl.textContent = 'Something went wrong. Please try again.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.innerHTML = '${ctaText} &rarr;';
        });
      };
    })();
  </script>
</section>
`;
  }
};
