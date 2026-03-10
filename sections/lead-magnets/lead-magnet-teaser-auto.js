module.exports = {
  id: 'lead-magnet-teaser-auto',
  name: 'Auto Detailing Quote Teaser',
  category: 'lead-magnet',
  description: 'CTA section that launches the interactive auto detailing hotspot quote tool.',
  suitability: { 'auto-detailing': 1.0, 'auto-wrap': 0.8, 'automotive': 0.7 },
  contentSchema: {
    badge:       { type: 'text',  label: 'Badge Text',    default: 'Free Instant Quote' },
    headline:    { type: 'text',  label: 'Headline',      default: 'See Exactly What Your Detail Will Cost' },
    subheadline: { type: 'text',  label: 'Subheadline',   default: 'Click the areas of your vehicle you want detailed — get an itemized price breakdown in seconds.' },
    ctaText:     { type: 'text',  label: 'Button Label',  default: 'Build My Custom Quote' },
    features:    { type: 'array', label: 'Feature Pills', default: ['Paint Correction', 'Ceramic Coating', 'Interior Detail', 'Wheel Service'] },
    magnetType:  { type: 'hidden', default: 'auto-detailing' },
  },
  render(content, theme, sectionId = 'lmt-auto') {
    const s = `section-${sectionId}`;
    const primary  = theme.primaryColor  || '#1d4ed8';
    const accent   = theme.accentColor   || '#dbeafe';
    const headFont = theme.headingFont   || 'Inter';

    const badge    = content.badge       || 'Free Instant Quote';
    const headline = content.headline    || 'See Exactly What Your Detail Will Cost';
    const sub      = content.subheadline || 'Click the areas of your vehicle you want detailed — get an itemized price breakdown in seconds.';
    const ctaText  = content.ctaText     || 'Build My Custom Quote';
    const features = Array.isArray(content.features) ? content.features : ['Paint Correction', 'Ceramic Coating', 'Interior Detail', 'Wheel Service'];
    const magType  = content.magnetType  || 'auto-detailing';

    const featurePills = features.map(f =>
      `<span class="${s}-pill">${f}</span>`
    ).join('');

    return `
<section class="${s}-wrap" style="background:#0f172a; padding:80px 20px; position:relative; overflow:hidden;">
  <style>
    .${s}-wrap { font-family: ${headFont}, sans-serif; }
    .${s}-bg {
      position:absolute; inset:0;
      background: url('https://images.unsplash.com/photo-1552519507-da3b142a6f3e?w=1600&auto=format&fit=crop') center/cover no-repeat;
      opacity:0.18;
    }
    .${s}-inner {
      position:relative; z-index:1;
      max-width:720px; margin:0 auto; text-align:center;
    }
    .${s}-badge {
      display:inline-block; padding:6px 16px; border-radius:999px;
      background:${primary}22; border:1px solid ${primary}55;
      color:#93c5fd; font-size:13px; font-weight:600; letter-spacing:.5px;
      text-transform:uppercase; margin-bottom:24px;
    }
    .${s}-h {
      font-size:clamp(28px,4vw,44px); font-weight:800; color:#fff;
      line-height:1.2; margin-bottom:18px;
    }
    .${s}-sub {
      font-size:17px; color:#94a3b8; line-height:1.6;
      max-width:560px; margin:0 auto 32px;
    }
    .${s}-pills { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:36px; }
    .${s}-pill {
      padding:7px 16px; border-radius:999px;
      background:#1e293b; border:1px solid #334155;
      color:#cbd5e1; font-size:14px; font-weight:500;
    }
    .${s}-btn {
      display:inline-flex; align-items:center; gap:10px;
      padding:16px 36px; border-radius:12px; border:none; cursor:pointer;
      background:${primary}; color:#fff; font-size:17px; font-weight:700;
      transition:opacity .2s, transform .15s; box-shadow:0 4px 20px ${primary}55;
      text-decoration:none;
    }
    .${s}-btn:hover { opacity:.92; transform:translateY(-1px); }
    .${s}-btn svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }
    .${s}-note { margin-top:16px; color:#64748b; font-size:13px; }
    /* Modal overlay */
    .${s}-modal {
      display:none; position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,.85); backdrop-filter:blur(4px);
      align-items:center; justify-content:center;
    }
    .${s}-modal.open { display:flex; }
    .${s}-modal-inner {
      position:relative; width:100%; max-width:960px; height:90vh;
      border-radius:16px; overflow:hidden; box-shadow:0 30px 80px rgba(0,0,0,.5);
    }
    .${s}-modal-close {
      position:absolute; top:12px; right:12px; z-index:10;
      width:36px; height:36px; border-radius:50%; border:none; cursor:pointer;
      background:#1e293b; color:#fff; font-size:20px; line-height:1;
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,.4);
    }
    .${s}-modal iframe { width:100%; height:100%; border:0; }
    @media(max-width:600px){
      .${s}-modal-inner { height:100vh; border-radius:0; }
    }
  </style>

  <div class="${s}-bg"></div>

  <div class="${s}-inner">
    <span class="${s}-badge">${badge}</span>
    <h2 class="${s}-h">${headline}</h2>
    <p class="${s}-sub">${sub}</p>
    <div class="${s}-pills">${featurePills}</div>
    <button class="${s}-btn" onclick="window['${s}Open']()">
      ${ctaText}
      <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
    <p class="${s}-note">No commitment — get your estimate in under 2 minutes</p>
  </div>

  <!-- Modal -->
  <div class="${s}-modal" id="${s}-modal">
    <div class="${s}-modal-inner">
      <button class="${s}-modal-close" onclick="window['${s}Close']()" title="Close">✕</button>
      <iframe id="${s}-iframe" src="" title="Get Your Quote" allow="forms"></iframe>
    </div>
  </div>

  <script>
    (function() {
      window['${s}Open'] = function() {
        var userId = window.__SORCE_USER_ID__;
        var appUrl = window.__SORCE_APP_URL__ || 'https://app.sorce.ai';
        if (!userId) return;
        var iframe = document.getElementById('${s}-iframe');
        if (iframe.src === '') iframe.src = appUrl + '/lead/' + userId + '/${magType}';
        document.getElementById('${s}-modal').classList.add('open');
        document.body.style.overflow = 'hidden';
      };
      window['${s}Close'] = function() {
        document.getElementById('${s}-modal').classList.remove('open');
        document.body.style.overflow = '';
      };
      document.getElementById('${s}-modal').addEventListener('click', function(e) {
        if (e.target === this) window['${s}Close']();
      });
    })();
  </script>
</section>
`;
  }
};
