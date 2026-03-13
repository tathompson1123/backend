module.exports = {
  id: 'lead-magnet-teaser-landscaping',
  name: 'Landscaping Design Teaser',
  category: 'lead-magnet',
  description: 'CTA section that launches the interactive AI landscaping design tool.',
  suitability: { landscaping: 1.0, 'lawn-care': 0.9, garden: 0.8 },
  contentSchema: {
    badge:       { type: 'text',  label: 'Badge Text',    default: 'AI Design Preview' },
    headline:    { type: 'text',  label: 'Headline',      default: 'See Your Dream Yard Before We Break Ground' },
    subheadline: { type: 'text',  label: 'Subheadline',   default: 'Enter your address, pick your features, and get an AI-generated design plus instant cost estimate.' },
    ctaText:     { type: 'text',  label: 'Button Label',  default: 'Design My Yard' },
    features:    { type: 'array', label: 'Feature Pills', default: ['Stone Patio', 'Mature Trees', 'Outdoor Lighting', 'Irrigation'] },
    magnetType:  { type: 'hidden', default: 'landscaping' },
  },
  render(content, theme, sectionId = 'lmt-landscape') {
    const s = `section-${sectionId}`;
    const primary  = theme.primaryColor  || '#16a34a';
    const headFont = theme.headingFont   || 'Inter';

    const badge    = content.badge       || 'AI Design Preview';
    const headline = content.headline    || 'See Your Dream Yard Before We Break Ground';
    const sub      = content.subheadline || 'Enter your address, pick your features, and get an AI-generated design plus instant cost estimate.';
    const ctaText  = content.ctaText     || 'Design My Yard';
    const features = Array.isArray(content.features) ? content.features : ['Stone Patio', 'Mature Trees', 'Outdoor Lighting', 'Irrigation'];

    const featurePills = features.map(f =>
      `<span class="${s}-pill">${f}</span>`
    ).join('');

    const featureCheckboxes = features.map(f =>
      `<label class="${s}-feat"><input type="checkbox" value="${f}"><span>${f}</span></label>`
    ).join('');

    return `
<section class="${s}-wrap" style="background:#0c1a0e; padding:80px 20px; position:relative; overflow:hidden;">
  <style>
    .${s}-wrap { font-family: ${headFont}, sans-serif; }
    .${s}-bg {
      position:absolute; inset:0;
      background: url('https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1600&auto=format&fit=crop') center/cover no-repeat;
      opacity:0.2;
    }
    .${s}-inner { position:relative; z-index:1; max-width:720px; margin:0 auto; text-align:center; }
    .${s}-badge {
      display:inline-block; padding:6px 16px; border-radius:999px;
      background:${primary}22; border:1px solid ${primary}55;
      color:#86efac; font-size:13px; font-weight:600; letter-spacing:.5px;
      text-transform:uppercase; margin-bottom:24px;
    }
    .${s}-h { font-size:clamp(28px,4vw,44px); font-weight:800; color:#fff; line-height:1.2; margin-bottom:18px; }
    .${s}-sub { font-size:17px; color:#a3b899; line-height:1.6; max-width:560px; margin:0 auto 32px; }
    .${s}-pills { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:36px; }
    .${s}-pill { padding:7px 16px; border-radius:999px; background:#14261a; border:1px solid #1e4228; color:#86efac; font-size:14px; font-weight:500; }
    .${s}-btn {
      display:inline-flex; align-items:center; gap:10px;
      padding:16px 36px; border-radius:12px; border:none; cursor:pointer;
      background:${primary}; color:#fff; font-size:17px; font-weight:700;
      transition:opacity .2s, transform .15s; box-shadow:0 4px 20px ${primary}55;
    }
    .${s}-btn:hover { opacity:.92; transform:translateY(-1px); }
    .${s}-btn svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }
    .${s}-note { margin-top:16px; color:#4a7c59; font-size:13px; }
    .${s}-modal { display:none; position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.7); backdrop-filter:blur(4px); align-items:center; justify-content:center; }
    .${s}-modal.open { display:flex; }
    .${s}-modal-box { position:relative; width:95%; max-width:480px; max-height:90vh; overflow-y:auto; background:#fff; border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,.4); padding:32px; }
    .${s}-modal-close { position:absolute; top:12px; right:12px; width:32px; height:32px; border-radius:50%; border:none; cursor:pointer; background:#f3f4f6; color:#374151; font-size:18px; display:flex; align-items:center; justify-content:center; }
    .${s}-modal-title { font-size:22px; font-weight:700; color:#111; margin:0 0 4px; }
    .${s}-modal-sub { font-size:14px; color:#6b7280; margin:0 0 20px; }
    .${s}-input { width:100%; padding:12px 14px; border:2px solid #e5e7eb; border-radius:8px; font-size:15px; outline:none; transition:border .15s; box-sizing:border-box; margin-bottom:12px; font-family:inherit; }
    .${s}-input:focus { border-color:${primary}; }
    .${s}-lbl { display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:4px; }
    .${s}-req { color:#ef4444; }
    .${s}-feats { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
    .${s}-feat { display:flex; align-items:center; gap:6px; padding:8px 14px; border:2px solid #e5e7eb; border-radius:8px; cursor:pointer; font-size:14px; color:#374151; transition:border .15s; }
    .${s}-feat:has(input:checked) { border-color:${primary}; background:${primary}0d; }
    .${s}-feat input { display:none; }
    .${s}-submit { width:100%; padding:14px; border:none; border-radius:10px; background:${primary}; color:#fff; font-size:16px; font-weight:600; cursor:pointer; transition:opacity .15s; margin-top:4px; }
    .${s}-submit:hover { opacity:.9; }
    .${s}-submit:disabled { opacity:.5; cursor:not-allowed; }
    .${s}-err { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; padding:10px 14px; border-radius:8px; font-size:14px; margin-bottom:12px; }
    .${s}-ok { text-align:center; padding:20px 0; }
    .${s}-ok-icon { width:56px; height:56px; border-radius:50%; background:#d1fae5; display:flex; align-items:center; justify-content:center; margin:0 auto 12px; }
    .${s}-ok h4 { font-size:20px; font-weight:700; color:#111; margin:0 0 6px; }
    .${s}-ok p { font-size:14px; color:#6b7280; margin:0; }
    .${s}-consent { font-size:12px; color:#9ca3af; margin-top:10px; text-align:center; }
    @keyframes ${s}-slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .${s}-modal-box{animation:${s}-slideUp .25s ease}
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
    <p class="${s}-note">Free concept — no obligation to book</p>
  </div>
</section>
<div class="${s}-modal" id="${s}-modal">
  <div class="${s}-modal-box">
    <button class="${s}-modal-close" id="${s}-close">&times;</button>
    <div id="${s}-form-wrap">
      <h3 class="${s}-modal-title">Design Your Dream Yard</h3>
      <p class="${s}-modal-sub">Tell us what you're envisioning and we'll get back to you with a free design concept.</p>
      <div id="${s}-err"></div>
      <label class="${s}-lbl">Full Name <span class="${s}-req">*</span></label>
      <input class="${s}-input" id="${s}-name" placeholder="John Doe">
      <label class="${s}-lbl">Email <span class="${s}-req">*</span></label>
      <input class="${s}-input" id="${s}-email" type="email" placeholder="john@example.com">
      <label class="${s}-lbl">Phone <span class="${s}-req">*</span></label>
      <input class="${s}-input" id="${s}-phone" type="tel" placeholder="(555) 123-4567">
      <label class="${s}-lbl">Property Address</label>
      <input class="${s}-input" id="${s}-address" placeholder="123 Main St, City, State">
      <label class="${s}-lbl">Features You're Interested In</label>
      <div class="${s}-feats">${featureCheckboxes}</div>
      <button class="${s}-submit" id="${s}-submit">${ctaText}</button>
      <p class="${s}-consent">By submitting, you agree to receive communications about your project. We respect your privacy.</p>
    </div>
    <div id="${s}-success" class="${s}-ok" style="display:none">
      <div class="${s}-ok-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
      <h4>You're All Set!</h4>
      <p>We'll review your details and get back to you with a free design concept soon.</p>
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
      var address=document.getElementById('${s}-address').value.trim();
      var feats=[];modal.querySelectorAll('.${s}-feat input:checked').forEach(function(cb){feats.push(cb.value)});
      errEl.innerHTML='';
      if(!name||!email||!phone){errEl.innerHTML='<div class="${s}-err">Please fill in all required fields.</div>';return}
      var btn=document.getElementById('${s}-submit');btn.disabled=true;btn.textContent='Submitting...';
      var msg='Address: '+(address||'Not provided')+' | Features: '+(feats.join(', ')||'None selected');
      fetch(apiUrl+'/api/leads/public/'+userId,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:name,email:email,phone:phone,service:'Landscaping Design',message:msg,source:'lead_form',smsConsent:true})
      }).then(function(r){return r.json()}).then(function(d){
        if(d.error){errEl.innerHTML='<div class="${s}-err">'+d.error+'</div>';btn.disabled=false;btn.textContent='${ctaText}';return}
        formWrap.style.display='none';successEl.style.display='block';
      }).catch(function(){errEl.innerHTML='<div class="${s}-err">Something went wrong. Please try again.</div>';btn.disabled=false;btn.textContent='${ctaText}'});
    };
  })();
</script>
`;
  }
};
