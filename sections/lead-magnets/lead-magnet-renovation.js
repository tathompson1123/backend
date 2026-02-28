// ============================================
// LEAD MAGNET — Renovation Project Estimator
// Multi-step interactive tool: captures project
// details then collects contact info → submits
// to /api/leads/public/:userId
// ============================================

module.exports = {
  id: 'lead-magnet-renovation',
  name: 'Renovation Project Estimator',
  category: 'lead-magnet',
  description: 'Interactive 5-step estimator that captures renovation project details, generates a personalized price range, and captures the lead.',

  suitability: {
    renovation: 1.0, handyman: 0.9, remodeling: 0.9, construction: 0.7, contractor: 0.8,
  },

  contentSchema: {
    headline:    { type: 'text', label: 'Headline',    default: 'What Will Your Project Cost?' },
    subheadline: { type: 'text', label: 'Subheadline', default: 'Answer 4 quick questions and get a free project estimate.' },
    ctaText:     { type: 'text', label: 'CTA Button',  default: 'Get My Free Estimate' },
  },

  render(content, theme, sectionId = 'lm-renovation') {
    const s = `section-${sectionId}`;
    const primary   = theme.primaryColor   || '#EA580C';
    const accent    = theme.accentColor    || '#F97316';
    const text      = theme.textColor      || '#1f2937';
    const bg        = theme.bgColor        || '#ffffff';
    const headFont  = theme.headFont       || 'Inter';

    const headline    = content.headline    || 'What Will Your Project Cost?';
    const subheadline = content.subheadline || 'Answer 4 quick questions and get a free project estimate.';
    const ctaText     = content.ctaText     || 'Get My Free Estimate';

    return `
<section class="${s}">
  <div class="${s}-wrap">

    <!-- Progress bar -->
    <div class="${s}-progress-bar"><div class="${s}-progress-fill" id="${s}-fill"></div></div>

    <!-- Step 0: Intro -->
    <div class="${s}-step active" data-step="0">
      <div class="${s}-icon">🔨</div>
      <h2 class="${s}-h2">${headline}</h2>
      <p class="${s}-sub">${subheadline}</p>
      <button class="${s}-btn" onclick="${s}Next()">Start Free Estimate →</button>
    </div>

    <!-- Step 1: Project type -->
    <div class="${s}-step" data-step="1">
      <p class="${s}-q">What type of project are you planning?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Kitchen Remodel')">🍳 Kitchen Remodel</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Bathroom Remodel')">🚿 Bathroom Remodel</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Full Home Renovation')">🏠 Full Home Renovation</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Outdoor / Deck')">🌿 Outdoor / Deck</div>
      </div>
    </div>

    <!-- Step 2: Scope -->
    <div class="${s}-step" data-step="2">
      <p class="${s}-q">What is the scope of work?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'scope','Minor Update')">🔧 Minor Update / Refresh</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'scope','Full Renovation')">🏗 Full Renovation</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'scope','Addition')">➕ Addition / Expansion</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'scope','Complete Gut')">💥 Complete Gut / Rebuild</div>
      </div>
    </div>

    <!-- Step 3: Timeline -->
    <div class="${s}-step" data-step="3">
      <p class="${s}-q">When are you looking to start?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','ASAP')">⚡ ASAP</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','1–3 Months')">📅 1–3 Months</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','3–6 Months')">🗓 3–6 Months</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','Just Planning')">💭 Just Planning</div>
      </div>
    </div>

    <!-- Step 4: Budget -->
    <div class="${s}-step" data-step="4">
      <p class="${s}-q">What is your approximate budget?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'budget','Under $10K')">💵 Under $10,000</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'budget','$10K–$30K')">💰 $10,000–$30,000</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'budget','$30K–$75K')">💎 $30,000–$75,000</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'budget','$75K+')">🏆 $75,000+</div>
      </div>
    </div>

    <!-- Step 5: Contact -->
    <div class="${s}-step" data-step="5">
      <div class="${s}-icon">📋</div>
      <p class="${s}-q">Where should we send your estimate?</p>
      <form class="${s}-form" onsubmit="${s}Submit(event)">
        <input class="${s}-input" type="text"  name="name"  placeholder="Your Name"  required />
        <input class="${s}-input" type="email" name="email" placeholder="Email Address" required />
        <input class="${s}-input" type="tel"   name="phone" placeholder="Phone Number (optional)" />
        <button class="${s}-btn" type="submit">${ctaText}</button>
        <p class="${s}-fine">No spam. We'll only contact you about your estimate.</p>
      </form>
    </div>

    <!-- Result -->
    <div class="${s}-step" data-step="result">
      <div class="${s}-icon">✅</div>
      <h2 class="${s}-h2">Your Estimate is Ready!</h2>
      <div class="${s}-result-box" id="${s}-result-text"></div>
      <p class="${s}-sub">We'll follow up shortly to schedule your free on-site consultation.</p>
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
}
.${s}-input:focus { border-color: ${primary}; }
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
    'Kitchen Remodel': {
      'Minor Update': '$8K–$20K',       'Full Renovation': '$25K–$60K',
      'Addition': '$50K–$100K',         'Complete Gut': '$60K–$130K'
    },
    'Bathroom Remodel': {
      'Minor Update': '$4K–$10K',       'Full Renovation': '$12K–$30K',
      'Addition': '$25K–$60K',          'Complete Gut': '$30K–$70K'
    },
    'Full Home Renovation': {
      'Minor Update': '$15K–$40K',      'Full Renovation': '$60K–$150K',
      'Addition': '$100K–$250K',        'Complete Gut': '$150K–$400K'
    },
    'Outdoor / Deck': {
      'Minor Update': '$3K–$8K',        'Full Renovation': '$10K–$30K',
      'Addition': '$20K–$50K',          'Complete Gut': '$25K–$60K'
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

    var estimate = (ESTIMATE_MAP[_state.answers.type] || {})[_state.answers.scope] || 'Custom estimate';
    var message = 'Project: ' + (_state.answers.type || '') +
                  ' | Scope: ' + (_state.answers.scope || '') +
                  ' | Timeline: ' + (_state.answers.timeline || '') +
                  ' | Budget: ' + (_state.answers.budget || '');

    fetch('/api/leads/public/' + userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phone,
        service: _state.answers.type || 'Renovation',
        message: message,
        sms_consent: true
      })
    })
    .then(function(r) {
      var box = document.getElementById('${s}-result-text');
      if (box) {
        box.innerHTML = 'Estimated range for a <strong>' + (_state.answers.scope || '') +
          '</strong> <strong>' + (_state.answers.type || 'project') + '</strong>:<br><br>' +
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
