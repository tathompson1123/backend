module.exports = {
  id: 'lead-magnet-teaser-auto',
  name: 'Auto Detailing Quote Teaser',
  category: 'lead-magnet',
  description: 'CTA section that launches the interactive auto detailing hotspot quote tool.',
  suitability: { 'auto-detailing': 1.0, 'auto-wrap': 0.8, 'automotive': 0.7 },
  contentSchema: {
    badge:       { type: 'text',  label: 'Badge Text',    default: 'Free Instant Quote' },
    headline:    { type: 'text',  label: 'Headline',      default: 'See Exactly What Your Detail Will Cost' },
    subheadline: { type: 'text',  label: 'Subheadline',   default: 'Tell us about your vehicle and we\'ll give you an honest price — no pressure.' },
    ctaText:     { type: 'text',  label: 'Button Label',  default: 'Build My Custom Quote' },
    features:    { type: 'array', label: 'Feature Pills', default: ['Paint Correction', 'Ceramic Coating', 'Interior Detail', 'Wheel Service'] },
    magnetType:  { type: 'hidden', default: 'auto-detailing' },
  },
  render(content, theme, sectionId = 'lmt-auto') {
    const s = `section-${sectionId}`;
    const primary  = theme.primaryColor  || '#d97706';
    const headFont = theme.headingFont   || 'Inter';

    const isLight  = theme.bgColor && theme.bgColor !== '#020617' && (theme.bgColor.startsWith('#f') || theme.bgColor === '#ffffff');
    const sectionBg   = isLight ? '#111827'        : '#0f172a';
    const subColor     = '#94a3b8';
    const pillBg       = isLight ? 'rgba(255,255,255,0.08)' : '#1e293b';
    const pillBorder   = isLight ? 'rgba(255,255,255,0.15)' : '#334155';
    const pillColor    = isLight ? '#e2e8f0'        : '#cbd5e1';
    const noteColor    = '#64748b';

    const badge    = content.badge       || 'Free Instant Quote';
    const headline = content.headline    || 'See Exactly What Your Detail Will Cost';
    const sub      = content.subheadline || "Tell us about your vehicle and we'll give you an honest price — no pressure.";
    const ctaText  = content.ctaText     || 'Build My Custom Quote';
    const features = Array.isArray(content.features) ? content.features : ['Paint Correction', 'Ceramic Coating', 'Interior Detail', 'Wheel Service'];

    const featurePills = features.map(f =>
      `<span class="${s}-pill">${f}</span>`
    ).join('');

    const serviceCheckboxes = features.map(f =>
      `<label class="${s}-svc"><input type="checkbox" value="${f}"><span>${f}</span></label>`
    ).join('');

    return `
<section class="${s}-wrap" style="background:${sectionBg}; padding:80px 20px; position:relative; overflow:hidden;">
  <style>
    .${s}-wrap { font-family: ${headFont}, sans-serif; }
    .${s}-bg { position:absolute; inset:0; background: url('https://images.unsplash.com/photo-1552519507-da3b142a6f3e?w=1600&auto=format&fit=crop') center/cover no-repeat; opacity:0.18; }
    .${s}-inner { position:relative; z-index:1; max-width:720px; margin:0 auto; text-align:center; }
    .${s}-badge { display:inline-block; padding:6px 16px; border-radius:999px; background:${primary}33; border:1px solid ${primary}66; color:${primary}; font-size:13px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; margin-bottom:24px; }
    .${s}-h { font-size:clamp(28px,4vw,44px); font-weight:800; color:#fff; line-height:1.2; margin-bottom:18px; }
    .${s}-sub { font-size:17px; color:${subColor}; line-height:1.6; max-width:560px; margin:0 auto 32px; }
    .${s}-pills { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:36px; }
    .${s}-pill { padding:7px 16px; border-radius:999px; background:${pillBg}; border:1px solid ${pillBorder}; color:${pillColor}; font-size:14px; font-weight:500; }
    .${s}-btn { display:inline-flex; align-items:center; gap:10px; padding:16px 36px; border-radius:12px; border:none; cursor:pointer; background:${primary}; color:#fff; font-size:17px; font-weight:700; transition:opacity .2s, transform .15s; box-shadow:0 4px 20px ${primary}55; }
    .${s}-btn:hover { opacity:.92; transform:translateY(-1px); }
    .${s}-btn svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }
    .${s}-note { margin-top:16px; color:${noteColor}; font-size:13px; }
    .${s}-modal { display:none; position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.7); backdrop-filter:blur(4px); align-items:center; justify-content:center; }
    .${s}-modal.open { display:flex; }
    .${s}-modal-box { position:relative; width:95%; max-width:480px; max-height:90vh; overflow-y:auto; background:#fff; border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,.4); padding:32px; animation:${s}-up .25s ease; }
    .${s}-modal-close { position:absolute; top:12px; right:12px; width:32px; height:32px; border-radius:50%; border:none; cursor:pointer; background:#f3f4f6; color:#374151; font-size:18px; display:flex; align-items:center; justify-content:center; }
    .${s}-modal-title { font-size:22px; font-weight:700; color:#111; margin:0 0 4px; }
    .${s}-modal-sub { font-size:14px; color:#6b7280; margin:0 0 20px; }
    .${s}-input { width:100%; padding:12px 14px; border:2px solid #e5e7eb; border-radius:8px; font-size:15px; outline:none; transition:border .15s; box-sizing:border-box; margin-bottom:12px; font-family:inherit; }
    .${s}-input:focus { border-color:${primary}; }
    .${s}-lbl { display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:4px; }
    .${s}-req { color:#ef4444; }
    .${s}-svcs { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
    .${s}-svc { display:flex; align-items:center; gap:6px; padding:8px 14px; border:2px solid #e5e7eb; border-radius:8px; cursor:pointer; font-size:14px; color:#374151; transition:border .15s; }
    .${s}-svc:has(input:checked) { border-color:${primary}; background:${primary}0d; }
    .${s}-svc input { display:none; }
    .${s}-submit { width:100%; padding:14px; border:none; border-radius:10px; background:${primary}; color:#fff; font-size:16px; font-weight:600; cursor:pointer; transition:opacity .15s; margin-top:4px; }
    .${s}-submit:hover { opacity:.9; }
    .${s}-submit:disabled { opacity:.5; cursor:not-allowed; }
    .${s}-err { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; padding:10px 14px; border-radius:8px; font-size:14px; margin-bottom:12px; }
    .${s}-ok { text-align:center; padding:20px 0; }
    .${s}-ok-icon { width:56px; height:56px; border-radius:50%; background:#d1fae5; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; }
    .${s}-ok h4 { font-size:20px; font-weight:700; color:#111; margin:0 0 6px; }
    .${s}-ok p { font-size:14px; color:#6b7280; margin:0; }
    .${s}-consent { font-size:12px; color:#9ca3af; margin-top:10px; text-align:center; }
    @keyframes ${s}-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  </style>
  <div class="${s}-bg"></div>
  <div class="${s}-inner">
    <span class="${s}-badge">${badge}</span>
    <h2 class="${s}-h">${headline}</h2>
    <p class="${s}-sub">${sub}</p>
    <div class="${s}-pills">${featurePills}</div>
    <button class="${s}-btn" id="${s}-open">
      ${ctaText}
      <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
    <p class="${s}-note">No commitment — get your estimate in under 2 minutes</p>
  </div>
  <div class="${s}-modal" id="${s}-modal">
    <div class="${s}-modal-box">
      <button class="${s}-modal-close" id="${s}-close">&times;</button>
      <div id="${s}-form-wrap">
        <h3 class="${s}-modal-title">Get Your Custom Quote</h3>
        <p class="${s}-modal-sub">Select the services you need and we'll get back to you with a personalized price.</p>
        <div id="${s}-err"></div>
        <label class="${s}-lbl">Full Name <span class="${s}-req">*</span></label>
        <input class="${s}-input" id="${s}-name" placeholder="John Doe">
        <label class="${s}-lbl">Email <span class="${s}-req">*</span></label>
        <input class="${s}-input" id="${s}-email" type="email" placeholder="john@example.com">
        <label class="${s}-lbl">Phone <span class="${s}-req">*</span></label>
        <input class="${s}-input" id="${s}-phone" type="tel" placeholder="(555) 123-4567">
        <label class="${s}-lbl">Vehicle (Year, Make, Model)</label>
        <input class="${s}-input" id="${s}-vehicle" placeholder="2023 Tesla Model 3">
        <label class="${s}-lbl">Services Interested In</label>
        <div class="${s}-svcs">${serviceCheckboxes}</div>
        <button class="${s}-submit" id="${s}-submit">${ctaText}</button>
        <p class="${s}-consent">By submitting, you agree to receive communications about your quote.</p>
      </div>
      <div id="${s}-success" class="${s}-ok" style="display:none">
        <div class="${s}-ok-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
        <h4>Quote Request Received!</h4>
        <p>We'll review your details and get back to you with a custom quote shortly.</p>
      </div>
    </div>
  </div>
  <script>
    (function(){
      var apiUrl=window.__SORCE_API_URL__||'';
      var userId=window.__SORCE_USER_ID__||(document.querySelector('meta[name="user-id"]')||{}).content||'';
      var modal=document.getElementById('${s}-modal');
      var formWrap=document.getElementById('${s}-form-wrap');
      var successEl=document.getElementById('${s}-success');
      var errEl=document.getElementById('${s}-err');
      document.getElementById('${s}-open').onclick=function(){modal.classList.add('open');document.body.style.overflow='hidden'};
      document.getElementById('${s}-close').onclick=function(){modal.classList.remove('open');document.body.style.overflow=''};
      modal.addEventListener('click',function(e){if(e.target===modal){modal.classList.remove('open');document.body.style.overflow=''}});
      document.getElementById('${s}-submit').onclick=function(){
        var name=document.getElementById('${s}-name').value.trim();
        var email=document.getElementById('${s}-email').value.trim();
        var phone=document.getElementById('${s}-phone').value.trim();
        var vehicle=document.getElementById('${s}-vehicle').value.trim();
        var svcs=[];modal.querySelectorAll('.${s}-svc input:checked').forEach(function(cb){svcs.push(cb.value)});
        errEl.innerHTML='';
        if(!name||!email||!phone){errEl.innerHTML='<div class="${s}-err">Please fill in all required fields.</div>';return}
        var btn=document.getElementById('${s}-submit');btn.disabled=true;btn.textContent='Submitting...';
        var msg='Vehicle: '+(vehicle||'Not provided')+' | Services: '+(svcs.join(', ')||'None selected');
        fetch(apiUrl+'/api/leads/public/'+userId,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({name:name,email:email,phone:phone,service:'Auto Detailing',message:msg,source:'lead_form',smsConsent:true})
        }).then(function(r){return r.json()}).then(function(d){
          if(d.error){errEl.innerHTML='<div class="${s}-err">'+d.error+'</div>';btn.disabled=false;btn.textContent='${ctaText}';return}
          formWrap.style.display='none';successEl.style.display='block';
        }).catch(function(){errEl.innerHTML='<div class="${s}-err">Something went wrong. Please try again.</div>';btn.disabled=false;btn.textContent='${ctaText}'});
      };
    })();
  </script>
</section>
`;
  }
};
