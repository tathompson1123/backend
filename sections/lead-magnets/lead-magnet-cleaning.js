// ============================================
// LEAD MAGNET — Cleaning Quote Estimator
// Multi-step interactive tool: captures service
// details then collects contact info → submits
// to /api/leads/public/:userId
// ============================================

module.exports = {
  id: 'lead-magnet-cleaning',
  name: 'Cleaning Quote Estimator',
  category: 'lead-magnet',
  description: 'Interactive 5-step estimator that captures cleaning service details, generates a personalized price range, and captures the lead.',

  suitability: {
    cleaning: 1.0, janitorial: 0.8, maid: 0.8, 'carpet cleaning': 0.9,
  },

  contentSchema: {
    headline:    { type: 'text', label: 'Headline',    default: 'Get an Instant Cleaning Quote' },
    subheadline: { type: 'text', label: 'Subheadline', default: 'Answer 4 quick questions and see your price range in seconds.' },
    ctaText:     { type: 'text', label: 'CTA Button',  default: 'Get My Free Quote' },
  },

  render(content, theme, sectionId = 'lm-cleaning') {
    const s = `section-${sectionId}`;
    const primary   = theme.primaryColor   || '#38BDF8';
    const accent    = theme.accentColor    || '#0EA5E9';
    const text      = theme.textColor      || '#1f2937';
    const bg        = theme.bgColor        || '#ffffff';
    const headFont  = theme.headingFont       || 'Inter';

    const headline    = content.headline    || 'Get an Instant Cleaning Quote';
    const subheadline = content.subheadline || 'Answer 4 quick questions and see your price range in seconds.';
    const ctaText     = content.ctaText     || 'Get My Free Quote';

    return `
<section class="${s}">
  <div class="${s}-wrap">

    <!-- Progress bar -->
    <div class="${s}-progress-bar"><div class="${s}-progress-fill" id="${s}-fill"></div></div>

    <!-- Step 0: Intro -->
    <div class="${s}-step active" data-step="0">
      <div class="${s}-icon">🧹</div>
      <h2 class="${s}-h2">${headline}</h2>
      <p class="${s}-sub">${subheadline}</p>
      <button class="${s}-btn" onclick="${s}Next()">Start Free Quote →</button>
    </div>

    <!-- Step 1: Service type -->
    <div class="${s}-step" data-step="1">
      <p class="${s}-q">What type of cleaning do you need?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Carpet Cleaning')">🟫 Carpet Cleaning</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','House Cleaning')">🏠 House Cleaning</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Deep Clean')">✨ Deep Clean</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Commercial')">🏢 Commercial / Office</div>
      </div>
    </div>

    <!-- Step 2: Property size -->
    <div class="${s}-step" data-step="2">
      <p class="${s}-q">How large is the space?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'size','Studio / 1BR')">🛏 Studio or 1 Bedroom</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'size','2–3 Bedrooms')">🏡 2–3 Bedrooms</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'size','4–5 Bedrooms')">🏘 4–5 Bedrooms</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'size','Commercial Space')">🏗 Commercial Space</div>
      </div>
    </div>

    <!-- Step 3: Frequency -->
    <div class="${s}-step" data-step="3">
      <p class="${s}-q">How often would you like service?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'frequency','One-Time')">1️⃣ One-Time</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'frequency','Weekly')">📅 Weekly</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'frequency','Bi-Weekly')">🗓 Every 2 Weeks</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'frequency','Monthly')">📆 Monthly</div>
      </div>
    </div>

    <!-- Step 4: Timeline -->
    <div class="${s}-step" data-step="4">
      <p class="${s}-q">When do you need it done?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','ASAP')">⚡ ASAP</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','This Week')">📅 This Week</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','This Month')">🗓 This Month</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','Just Exploring')">💭 Just Exploring</div>
      </div>
    </div>

    <!-- Step 5: Contact -->
    <div class="${s}-step" data-step="5">
      <div class="${s}-icon">📋</div>
      <p class="${s}-q">Where should we send your quote?</p>
      <form class="${s}-form" onsubmit="${s}Submit(event)">
        <input class="${s}-input" type="text"  name="name"  placeholder="Your Name"  required />
        <input class="${s}-input" type="email" name="email" placeholder="Email Address" required />
        <input class="${s}-input" type="tel"   name="phone" placeholder="Phone Number (optional)" />
        <label class="${s}-consent"><input type="checkbox" name="sms_consent" required /> I consent to receive text messages about my quote. Message &amp; data rates may apply. Text STOP to opt out.</label>
        <button class="${s}-btn" type="submit">${ctaText}</button>
        <p class="${s}-fine">No spam. We'll only contact you about your quote.</p>
      </form>
    </div>

    <!-- Result -->
    <div class="${s}-step" data-step="result">
      <div class="${s}-icon">✅</div>
      <h2 class="${s}-h2">Your Quote is Ready!</h2>
      <div class="${s}-result-box" id="${s}-result-text"></div>
      <p class="${s}-sub">We'll reach out shortly to confirm details and schedule your appointment.</p>
    </div>

    <!-- Error -->
    <div class="${s}-step" data-step="error">
      <div class="${s}-icon">⚠️</div>
      <p class="${s}-q">Something went wrong. Please try again.</p>
      <button class="${s}-btn" onclick="${s}GoTo(5)">Try Again</button>
    </div>

  </div>
</section>

<style>
.${s} {
  background: ${bg};
  padding: 80px 20px;
  font-family: '${headFont}', sans-serif;
}
.${s}-wrap {
  max-width: 560px;
  margin: 0 auto;
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.10);
  overflow: hidden;
}
.${s}-progress-bar {
  height: 5px;
  background: #e5e7eb;
}
.${s}-progress-fill {
  height: 100%;
  background: ${primary};
  width: 0%;
  transition: width 0.4s ease;
}
.${s}-step {
  display: none;
  padding: 48px 40px;
  animation: ${s}FadeIn 0.3s ease;
}
@keyframes ${s}FadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
.${s}-step.active { display: block; }
.${s}-icon { font-size: 2.5rem; margin-bottom: 16px; }
.${s}-h2 { font-size: 1.6rem; font-weight: 800; color: ${text}; margin-bottom: 12px; line-height: 1.3; }
.${s}-sub { color: #6b7280; font-size: 0.95rem; margin-bottom: 28px; line-height: 1.6; }
.${s}-q { font-size: 1.15rem; font-weight: 700; color: ${text}; margin-bottom: 20px; }
.${s}-choices { display: grid; gap: 12px; }
.${s}-choice {
  padding: 16px 20px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 600;
  color: ${text};
  transition: all 0.2s;
  user-select: none;
}
.${s}-choice:hover { border-color: ${primary}; background: ${primary}11; }
.${s}-choice.selected { border-color: ${primary}; background: ${primary}18; color: ${primary}; }
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
  margin-top: 24px;
}
.${s}-btn:hover { background: ${accent}; transform: translateY(-1px); }
.${s}-btn:active { transform: translateY(0); }
.${s}-form { display: flex; flex-direction: column; gap: 14px; }
.${s}-input {
  padding: 14px 16px;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  font-size: 0.95rem;
  outline: none;
  transition: border 0.2s;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}
.${s}-input:focus { border-color: ${primary}; }
.${s}-consent { display: flex; align-items: flex-start; gap: 0.6rem; font-size: 0.82rem; color: #6b7280; line-height: 1.4; cursor: pointer; }
.${s}-consent input[type="checkbox"] { width: 18px; height: 18px; margin-top: 2px; flex-shrink: 0; accent-color: ${primary}; cursor: pointer; }
.${s}-fine { font-size: 0.75rem; color: #9ca3af; text-align: center; margin-top: -8px; }
.${s}-result-box {
  background: ${primary}14;
  border: 2px solid ${primary}40;
  border-radius: 14px;
  padding: 20px 24px;
  font-size: 1.05rem;
  font-weight: 600;
  color: ${primary};
  margin: 16px 0 20px;
  line-height: 1.6;
}
@media (max-width: 480px) {
  .${s}-step { padding: 32px 24px; }
  .${s}-h2 { font-size: 1.35rem; }
}
</style>

<script>
(function() {
  var _state = { step: 0, answers: {} };
  var TOTAL_STEPS = 5;

  var ESTIMATE_MAP = {
    'Carpet Cleaning': {
      'Studio / 1BR': '$80–$140',      '2–3 Bedrooms': '$140–$220',
      '4–5 Bedrooms': '$220–$320',     'Commercial Space': '$300–$600'
    },
    'House Cleaning': {
      'Studio / 1BR': '$100–$160',     '2–3 Bedrooms': '$160–$240',
      '4–5 Bedrooms': '$240–$360',     'Commercial Space': '$350–$700'
    },
    'Deep Clean': {
      'Studio / 1BR': '$150–$220',     '2–3 Bedrooms': '$220–$320',
      '4–5 Bedrooms': '$320–$480',     'Commercial Space': '$500–$900'
    },
    'Commercial': {
      'Studio / 1BR': '$300–$500',     '2–3 Bedrooms': '$400–$650',
      '4–5 Bedrooms': '$550–$800',     'Commercial Space': '$600–$1,200'
    },
  };

  function updateProgress(step) {
    var pct = step === 0 ? 0 : Math.round((step / TOTAL_STEPS) * 100);
    var fill = document.getElementById('${s}-fill');
    if (fill) fill.style.width = pct + '%';
  }

  window.${s}GoTo = function(step) {
    document.querySelectorAll('.${s}-step').forEach(function(el) { el.classList.remove('active'); });
    var target = document.querySelector('.${s}-step[data-step="' + step + '"]');
    if (target) { target.classList.add('active'); _state.step = step; }
    updateProgress(typeof step === 'number' ? step : TOTAL_STEPS);
  };

  window.${s}Next = function() { window.${s}GoTo(_state.step + 1); };

  window.${s}Pick = function(el, key, value) {
    var parent = el.closest('.${s}-choices');
    if (parent) parent.querySelectorAll('.${s}-choice').forEach(function(c) { c.classList.remove('selected'); });
    el.classList.add('selected');
    _state.answers[key] = value;
    setTimeout(function() { window.${s}GoTo(_state.step + 1); }, 350);
  };

  window.${s}Submit = function(e) {
    e.preventDefault();
    var form = e.target;
    var name  = form.name.value.trim();
    var email = form.email.value.trim();
    var phone = form.phone ? form.phone.value.trim() : '';
    var userId = window.__SORCE_USER_ID__;
    if (!userId) { window.${s}GoTo('error'); return; }

    var estimate = (ESTIMATE_MAP[_state.answers.type] || {})[_state.answers.size] || 'Custom estimate';
    var message = 'Service: ' + (_state.answers.type || '') +
                  ' | Size: ' + (_state.answers.size || '') +
                  ' | Frequency: ' + (_state.answers.frequency || '') +
                  ' | Timeline: ' + (_state.answers.timeline || '');

    fetch('/api/leads/public/' + userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phone,
        service: _state.answers.type || 'Cleaning',
        message: message,
        sms_consent: true
      })
    })
    .then(function(r) {
      var box = document.getElementById('${s}-result-text');
      if (box) {
        box.innerHTML = 'Estimated range for <strong>' + (_state.answers.type || 'your service') +
          '</strong> in a <strong>' + (_state.answers.size || '') + '</strong> space:<br><br>' +
          '<span style="font-size:1.4rem">' + estimate + '</span>';
      }
      window.${s}GoTo('result');
    })
    .catch(function() { window.${s}GoTo('error'); });
  };
})();
</script>
`;
  }
};
