// ============================================
// LEAD MAGNET — Landscape Design Estimator
// Multi-step interactive tool: captures project
// details then collects contact info → submits
// to /api/leads/public/:userId
// ============================================

module.exports = {
  id: 'lead-magnet-landscaping',
  name: 'Landscape Design Estimator',
  category: 'lead-magnet',
  description: 'Interactive 5-step estimator that collects project details, generates a personalized price range, and captures the lead.',

  suitability: {
    landscaping: 1.0, renovation: 0.7, cleaning: 0.3,
  },

  contentSchema: {
    headline:    { type: 'text', label: 'Headline',    default: 'Get Your Free Landscape Estimate' },
    subheadline: { type: 'text', label: 'Subheadline', default: 'Answer 4 quick questions and we\'ll send you a personalized estimate in seconds.' },
    ctaText:     { type: 'text', label: 'CTA Button',  default: 'Get My Free Estimate' },
  },

  render(content, theme, sectionId = 'lm-landscaping') {
    const s = `section-${sectionId}`;
    const primary   = theme.primaryColor   || '#2E7D32';
    const accent    = theme.accentColor    || '#66BB6A';
    const text      = theme.textColor      || '#1f2937';
    const bg        = theme.bgColor        || '#ffffff';
    const headFont  = theme.headingFont       || 'Inter';

    const headline    = content.headline    || 'Get Your Free Landscape Estimate';
    const subheadline = content.subheadline || 'Answer 4 quick questions and we\'ll send you a personalized estimate in seconds.';
    const ctaText     = content.ctaText     || 'Get My Free Estimate';

    return `
<section class="${s}">
  <div class="${s}-wrap">

    <!-- Progress bar -->
    <div class="${s}-progress-bar"><div class="${s}-progress-fill" id="${s}-fill"></div></div>

    <!-- Step 0: Intro -->
    <div class="${s}-step active" data-step="0">
      <div class="${s}-icon">🌿</div>
      <h2 class="${s}-h2">${headline}</h2>
      <p class="${s}-sub">${subheadline}</p>
      <button class="${s}-btn" onclick="${s}Next()">Start Free Estimate →</button>
    </div>

    <!-- Step 1: Project type -->
    <div class="${s}-step" data-step="1">
      <p class="${s}-q">What type of project are you looking for?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Lawn Maintenance')">🌱 Lawn Maintenance</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Garden Design')">🌸 Garden Design</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Hardscaping')">🪨 Hardscaping / Patio</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'type','Full Landscape Renovation')">🏡 Full Landscape Renovation</div>
      </div>
    </div>

    <!-- Step 2: Property size -->
    <div class="${s}-step" data-step="2">
      <p class="${s}-q">How large is the area being worked on?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'size','Small (under ¼ acre)')">🏠 Small (under ¼ acre)</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'size','Medium (¼ – ½ acre)')">🏡 Medium (¼–½ acre)</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'size','Large (½ – 1 acre)')">🌳 Large (½–1 acre)</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'size','Estate (1+ acre)')">🏰 Estate (1+ acre)</div>
      </div>
    </div>

    <!-- Step 3: Timeline -->
    <div class="${s}-step" data-step="3">
      <p class="${s}-q">When are you looking to get started?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','ASAP')">⚡ ASAP</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','Within 1 Month')">📅 Within 1 Month</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','1–3 Months')">🗓 1–3 Months</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'timeline','Just Planning')">💭 Just Planning</div>
      </div>
    </div>

    <!-- Step 4: Budget -->
    <div class="${s}-step" data-step="4">
      <p class="${s}-q">What is your approximate budget?</p>
      <div class="${s}-choices">
        <div class="${s}-choice" onclick="${s}Pick(this,'budget','Under $1,000')">💵 Under $1,000</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'budget','$1,000 – $5,000')">💰 $1,000–$5,000</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'budget','$5,000 – $15,000')">💎 $5,000–$15,000</div>
        <div class="${s}-choice" onclick="${s}Pick(this,'budget','$15,000+')">🏆 $15,000+</div>
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
        <label class="${s}-consent"><input type="checkbox" name="sms_consent" required /> I consent to receive text messages about my estimate. Message &amp; data rates may apply. Text STOP to opt out.</label>
        <button class="${s}-btn" type="submit">${ctaText}</button>
        <p class="${s}-fine">No spam. We'll only contact you about your estimate.</p>
      </form>
    </div>

    <!-- Result -->
    <div class="${s}-step" data-step="result">
      <div class="${s}-icon">✅</div>
      <h2 class="${s}-h2">Your Estimate is Ready!</h2>
      <div class="${s}-result-box" id="${s}-result-text"></div>
      <p class="${s}-sub">We'll follow up shortly with more details and to schedule your free on-site consultation.</p>
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
    'Lawn Maintenance':          { 'Small (under ¼ acre)': '$75–$150/visit',   'Medium (¼ – ½ acre)': '$120–$250/visit', 'Large (½ – 1 acre)': '$200–$400/visit',  'Estate (1+ acre)': '$350–$700/visit' },
    'Garden Design':             { 'Small (under ¼ acre)': '$800–$2,500',       'Medium (¼ – ½ acre)': '$2,000–$6,000',  'Large (½ – 1 acre)': '$5,000–$12,000',   'Estate (1+ acre)': '$10,000–$25,000' },
    'Hardscaping':               { 'Small (under ¼ acre)': '$2,000–$8,000',     'Medium (¼ – ½ acre)': '$6,000–$18,000', 'Large (½ – 1 acre)': '$14,000–$35,000',  'Estate (1+ acre)': '$30,000–$70,000' },
    'Full Landscape Renovation': { 'Small (under ¼ acre)': '$5,000–$15,000',    'Medium (¼ – ½ acre)': '$12,000–$30,000','Large (½ – 1 acre)': '$25,000–$60,000',  'Estate (1+ acre)': '$50,000–$120,000' },
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
    var message = 'Project: ' + (_state.answers.type || '') +
                  ' | Size: ' + (_state.answers.size || '') +
                  ' | Timeline: ' + (_state.answers.timeline || '') +
                  ' | Budget: ' + (_state.answers.budget || '');

    fetch('/api/leads/public/' + userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phone,
        service: _state.answers.type || 'Landscaping',
        message: message,
        sms_consent: true
      })
    })
    .then(function(r) {
      var box = document.getElementById('${s}-result-text');
      if (box) {
        box.innerHTML = 'Estimated range for your <strong>' + (_state.answers.type || 'project') +
          '</strong> on a <strong>' + (_state.answers.size || '') + '</strong> property:<br><br>' +
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
