// ============================================
// LEAD MAGNET — Photography Package Finder
// Multi-step interactive tool: captures session
// details then collects contact info → submits
// to /api/leads/public/:userId
// ============================================

module.exports = {
  id: 'lead-magnet-photography',
  name: 'Photography Package Finder',
  category: 'lead-magnet',
  description: 'Interactive 5-step package finder that captures session details, recommends a price range, and captures the lead.',

  suitability: {
    photography: 1.0, videography: 0.7, events: 0.6,
  },

  contentSchema: {
    headline:    { type: 'text', label: 'Headline',    default: 'Find Your Perfect Package' },
    subheadline: { type: 'text', label: 'Subheadline', default: 'Answer 4 quick questions and discover which package fits your vision.' },
    ctaText:     { type: 'text', label: 'CTA Button',  default: 'Find My Package' },
  },

  render(content, theme, sectionId = 'lm-photography') {
    const s = `section-${sectionId}`;
    const primary   = theme.primaryColor   || '#c2410c';
    const accent    = theme.accentColor    || '#ea580c';
    const text      = theme.textColor      || '#1f2937';
    const bg        = theme.bgColor        || '#fafaf9';
    const headFont  = theme.headingFont       || 'Playfair Display';

    const headline    = content.headline    || 'Find Your Perfect Package';
    const subheadline = content.subheadline || 'Answer 4 quick questions and discover which package fits your vision.';
    const ctaText     = content.ctaText     || 'Find My Package';

    return `
<section class="${s}">
  <div class="${s}-wrap">

    <!-- Progress bar -->
    <div class="${s}-progress-bar"><div class="${s}-progress-fill" id="${s}-fill"></div></div>

    <!-- Step 0: Intro -->
    <div class="${s}-step active" data-step="0">
      <div class="${s}-icon">📸</div>
      <h2 class="${s}-h2">${headline}</h2>
      <p class="${s}-sub">${subheadline}</p>
      <button class="${s}-btn" onclick="${s}Next()">Find My Package →</button>
    </div>

    <!-- Step 1: Session type -->
    <div class="${s}-step" data-step="1">
      <p class="${s}-q">What type of session are you looking for?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Wedding')">💍 Wedding</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Portrait')">🧑‍🎨 Portraits / Headshots</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Family')">👨‍👩‍👧 Family Session</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Commercial')">🏢 Commercial / Branding</div>
      </div>
    </div>

    <!-- Step 2: Location -->
    <div class="${s}-step" data-step="2">
      <p class="${s}-q">Where would you like to shoot?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'location','Studio')">🎬 Studio</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'location','Outdoor')">🌿 Outdoor / Park</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'location','Your Location')">🏠 Your Home / Office</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'location','Venue')">🏛 Venue / Event Space</div>
      </div>
    </div>

    <!-- Step 3: Coverage -->
    <div class="${s}-step" data-step="3">
      <p class="${s}-q">How long do you need coverage?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'coverage','Under 2 Hours')">⏱ Under 2 Hours</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'coverage','Half Day')">☀️ Half Day (4 hrs)</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'coverage','Full Day')">🌅 Full Day (8 hrs)</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'coverage','Multi-Day')">📆 Multi-Day</div>
      </div>
    </div>

    <!-- Step 4: Timeline -->
    <div class="${s}-step" data-step="4">
      <p class="${s}-q">When is your session?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'when','This Month')">⚡ This Month</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'when','1–3 Months')">📅 1–3 Months Out</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'when','3–6 Months')">🗓 3–6 Months Out</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'when','6+ Months')">💭 6+ Months Out</div>
      </div>
    </div>

    <!-- Step 5: Contact -->
    <div class="${s}-step" data-step="5">
      <div class="${s}-icon">📋</div>
      <p class="${s}-q">Where should we send your package recommendation?</p>
      <form class="${s}-form" onsubmit="${s}Submit(event)">
        <input class="${s}-input" type="text"  name="name"  placeholder="Your Name"  required />
        <input class="${s}-input" type="email" name="email" placeholder="Email Address" required />
        <input class="${s}-input" type="tel"   name="phone" placeholder="Phone Number (optional)" />
        <label class="${s}-consent"><input type="checkbox" name="sms_consent" required /> I consent to receive text messages about my package. Message &amp; data rates may apply. Text STOP to opt out.</label>
        <button class="${s}-btn" type="submit">${ctaText}</button>
        <p class="${s}-fine">No spam. We'll only reach out about your package.</p>
      </form>
    </div>

    <!-- Result -->
    <div class="${s}-step" data-step="result">
      <div class="${s}-icon">✨</div>
      <h2 class="${s}-h2">Your Package is Ready!</h2>
      <div class="${s}-result-box" id="${s}-result-text"></div>
      <p class="${s}-sub">We'll be in touch to discuss your vision and secure your date.</p>
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
  font-family: '${headFont}', serif;
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
    'Wedding': {
      'Under 2 Hours': '$800–$1,200',    'Half Day': '$1,500–$2,500',
      'Full Day': '$2,500–$4,500',       'Multi-Day': '$4,000–$8,000'
    },
    'Portrait': {
      'Under 2 Hours': '$200–$400',      'Half Day': '$400–$700',
      'Full Day': '$700–$1,200',         'Multi-Day': '$1,200–$2,000'
    },
    'Family': {
      'Under 2 Hours': '$250–$450',      'Half Day': '$450–$750',
      'Full Day': '$750–$1,300',         'Multi-Day': '$1,300–$2,500'
    },
    'Commercial': {
      'Under 2 Hours': '$400–$800',      'Half Day': '$800–$1,500',
      'Full Day': '$1,500–$3,000',       'Multi-Day': '$3,000–$6,000'
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

    var estimate = (ESTIMATE_MAP[_state.answers.type] || {})[_state.answers.coverage] || 'Custom package';
    var message = 'Session: ' + (_state.answers.type || '') +
                  ' | Location: ' + (_state.answers.location || '') +
                  ' | Coverage: ' + (_state.answers.coverage || '') +
                  ' | When: ' + (_state.answers.when || '');

    fetch('/api/leads/public/' + userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phone,
        service: _state.answers.type || 'Photography',
        message: message,
        sms_consent: true
      })
    })
    .then(function(r) {
      var box = document.getElementById('${s}-result-text');
      if (box) {
        box.innerHTML = 'Recommended package for a <strong>' + (_state.answers.coverage || '') +
          '</strong> <strong>' + (_state.answers.type || 'session') + '</strong>:<br><br>' +
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
