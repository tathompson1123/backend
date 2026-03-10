module.exports = {
  id: 'lead-magnet-teaser-cleaning',
  name: 'Carpet / Home Cleaning Grime Calculator Teaser',
  category: 'lead-magnet',
  description: 'CTA section that launches the interactive carpet health calculator.',
  suitability: { cleaning: 1.0, 'carpet-cleaning': 1.0, 'house-cleaning': 0.9, 'window-cleaning': 0.7 },
  contentSchema: {
    badge:       { type: 'text',  label: 'Badge Text',    default: 'Home Health Analyzer' },
    headline:    { type: 'text',  label: 'Headline',      default: 'What\'s Hiding in Your Carpet?' },
    subheadline: { type: 'text',  label: 'Subheadline',   default: 'Drag the slider to see how much builds up over time — then claim your exclusive discount.' },
    ctaText:     { type: 'text',  label: 'Button Label',  default: 'Check My Carpet Health' },
    features:    { type: 'array', label: 'Feature Pills', default: ['Instant Health Score', 'Dust Mite Count', 'Custom Discount', 'Free Assessment'] },
    magnetType:  { type: 'hidden', default: 'carpet-cleaning' },
  },
  render(content, theme, sectionId = 'lmt-cleaning') {
    const s = `section-${sectionId}`;
    const primary  = theme.primaryColor  || '#7c3aed';
    const headFont = theme.headingFont   || 'Inter';

    const badge    = content.badge       || 'Home Health Analyzer';
    const headline = content.headline    || "What's Hiding in Your Carpet?";
    const sub      = content.subheadline || 'Drag the slider to see how much builds up over time — then claim your exclusive discount.';
    const ctaText  = content.ctaText     || 'Check My Carpet Health';
    const features = Array.isArray(content.features) ? content.features : ['Instant Health Score', 'Dust Mite Count', 'Custom Discount', 'Free Assessment'];
    const magType  = content.magnetType  || 'carpet-cleaning';

    const featurePills = features.map(f =>
      `<span class="${s}-pill">${f}</span>`
    ).join('');

    return `
<section class="${s}-wrap" style="background:#0d0a1a; padding:80px 20px; position:relative; overflow:hidden;">
  <style>
    .${s}-wrap { font-family: ${headFont}, sans-serif; }
    .${s}-bg { position:absolute; inset:0; background: url('https://images.unsplash.com/photo-1528318269466-69d942c23405?w=1600&auto=format&fit=crop') center/cover no-repeat; opacity:0.15; }
    .${s}-inner { position:relative; z-index:1; max-width:720px; margin:0 auto; text-align:center; }
    .${s}-badge { display:inline-block; padding:6px 16px; border-radius:999px; background:${primary}22; border:1px solid ${primary}55; color:#c4b5fd; font-size:13px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; margin-bottom:24px; }
    .${s}-h { font-size:clamp(28px,4vw,44px); font-weight:800; color:#fff; line-height:1.2; margin-bottom:18px; }
    .${s}-sub { font-size:17px; color:#a09ab8; line-height:1.6; max-width:560px; margin:0 auto 32px; }
    .${s}-pills { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:36px; }
    .${s}-pill { padding:7px 16px; border-radius:999px; background:#1a1430; border:1px solid #2d1f5c; color:#c4b5fd; font-size:14px; font-weight:500; }
    .${s}-btn { display:inline-flex; align-items:center; gap:10px; padding:16px 36px; border-radius:12px; border:none; cursor:pointer; background:${primary}; color:#fff; font-size:17px; font-weight:700; transition:opacity .2s, transform .15s; box-shadow:0 4px 20px ${primary}55; }
    .${s}-btn:hover { opacity:.92; transform:translateY(-1px); }
    .${s}-btn svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }
    .${s}-note { margin-top:16px; color:#4c3a7a; font-size:13px; }
    .${s}-modal { display:none; position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.85); backdrop-filter:blur(4px); align-items:center; justify-content:center; }
    .${s}-modal.open { display:flex; }
    .${s}-modal-inner { position:relative; width:100%; max-width:960px; height:90vh; border-radius:16px; overflow:hidden; box-shadow:0 30px 80px rgba(0,0,0,.5); }
    .${s}-modal-close { position:absolute; top:12px; right:12px; z-index:10; width:36px; height:36px; border-radius:50%; border:none; cursor:pointer; background:#1e293b; color:#fff; font-size:20px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,.4); }
    .${s}-modal iframe { width:100%; height:100%; border:0; }
    @media(max-width:600px){ .${s}-modal-inner { height:100vh; border-radius:0; } }
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
    <p class="${s}-note">Takes 30 seconds — claim your discount instantly</p>
  </div>
  <div class="${s}-modal" id="${s}-modal">
    <div class="${s}-modal-inner">
      <button class="${s}-modal-close" onclick="window['${s}Close']()">✕</button>
      <iframe id="${s}-iframe" src="" title="Check My Carpet Health" allow="forms"></iframe>
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
      document.getElementById('${s}-modal').addEventListener('click', function(e) { if (e.target === this) window['${s}Close'](); });
    })();
  </script>
</section>
`;
  }
};
