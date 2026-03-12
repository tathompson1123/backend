module.exports = {
  id: 'lead-magnet-auto-wrap',
  name: 'Vehicle Wrap Designer',
  category: 'lead-magnet',
  description: 'Interactive wizard to estimate vehicle wrap costs based on vehicle type, wrap style, and finish.',
  suitability: { 'auto-wrap': 1.0, 'auto-detailing': 0.8, 'automotive': 0.7 },
  contentSchema: {
    headline: { type: 'text', label: 'Headline', default: 'Design Your Custom Vehicle Wrap' },
    subheadline: { type: 'text', label: 'Subheadline', default: 'Answer 4 quick questions to get a personalized wrap estimate.' },
    ctaText: { type: 'text', label: 'CTA Button', default: 'Start My Design' },
    contactTitle: { type: 'text', label: 'Contact Step Title', default: 'Almost done!' },
    contactSubtitle: { type: 'text', label: 'Contact Step Subtitle', default: 'Where should we send your personalized estimate?' },
    steps: {
      type: 'steps',
      label: 'Quiz Steps',
      default: [
        { question: 'What type of vehicle are you wrapping?', choices: ['Coupe / Sedan', 'SUV / Crossover', 'Truck', 'Van / Commercial'] },
        { question: 'How much of the vehicle are we wrapping?', choices: ['Full Wrap', 'Partial Wrap', 'Roof / Hood Only', 'Chrome Delete / Accents'] },
        { question: 'What kind of finish are you looking for?', choices: ['Gloss / Satin', 'Matte', 'Chrome / Reflective', 'Color Shift'] },
        { question: 'When do you want this done?', choices: ['ASAP', 'Within 1 month', '1-3 months', 'Just exploring'] },
      ]
    }
  },
  render(content, theme, sectionId = 'lm-auto-wrap') {
    const s = `section-${sectionId}`;
    const primary = theme.primaryColor || '#e11d48';
    const accent = theme.accentColor || '#ffe4e6';
    const text = theme.textColor || '#1f2937';
    const bg = theme.bgColor || '#ffffff';
    const headFont = theme.headingFont || 'Inter';

    const defaultSteps = [
      { question: 'What type of vehicle are you wrapping?', choices: ['Coupe / Sedan', 'SUV / Crossover', 'Truck', 'Van / Commercial'] },
      { question: 'How much of the vehicle are we wrapping?', choices: ['Full Wrap', 'Partial Wrap', 'Roof / Hood Only', 'Chrome Delete / Accents'] },
      { question: 'What kind of finish are you looking for?', choices: ['Gloss / Satin', 'Matte', 'Chrome / Reflective', 'Color Shift'] },
      { question: 'When do you want this done?', choices: ['ASAP', 'Within 1 month', '1-3 months', 'Just exploring'] },
    ];
    const steps = (content.steps && content.steps.length > 0) ? content.steps : defaultSteps;
    const contactTitle = content.contactTitle || 'Almost done!';
    const contactSubtitle = content.contactSubtitle || 'Where should we send your personalized estimate?';

    const stepsHtml = steps.map((step, i) => {
      const answerKey = `ans${i}`;
      const choicesHtml = (step.choices || []).map(choice =>
        `<div class="${s}-choice" onclick="window['${s}Pick'](this, '${answerKey}', ${JSON.stringify(choice)})">${choice}</div>`
      ).join('\n              ');
      return `
          <!-- Step ${i + 1} -->
          <div class="${s}-step${i === 0 ? ' active' : ''}" data-step="${i + 1}">
            <p class="${s}-q">${step.question}</p>
            <div class="${s}-grid">
              ${choicesHtml}
            </div>
          </div>`;
    }).join('\n');

    const totalSteps = steps.length + 1; // +1 for contact step

    return `
<section class="${s}-section" style="background:${bg}; padding: 80px 20px;">
      <style>
        .${s}-container {
          font-family: ${headFont}, sans-serif;
          max-width: 560px;
          margin: 0 auto;
          background: ${bg};
          border-radius: 20px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.08);
          overflow: hidden;
          color: ${text};
        }
        .${s}-progress-bar {
          height: 6px;
          background: #f3f4f6;
          width: 100%;
        }
        .${s}-progress-fill {
          height: 100%;
          background: ${primary};
          width: ${Math.round((1 / totalSteps) * 100)}%;
          transition: width 0.4s ease;
        }
        .${s}-body {
          padding: 40px 30px;
        }
        .${s}-step {
          display: none;
          animation: ${s}-fade-in 0.4s ease forwards;
        }
        .${s}-step.active {
          display: block;
        }
        @keyframes ${s}-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .${s}-title {
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 10px;
          text-align: center;
        }
        .${s}-subtitle {
          font-size: 15px;
          color: #6b7280;
          text-align: center;
          margin-bottom: 30px;
        }
        .${s}-q {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 20px;
          text-align: center;
        }
        .${s}-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }
        .${s}-choice {
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          padding: 20px 15px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #fff;
          font-weight: 500;
          font-size: 15px;
        }
        .${s}-choice:hover {
          border-color: ${primary};
          background: ${accent};
        }
        .${s}-choice.selected {
          border-color: ${primary};
          background: ${primary};
          color: #fff;
        }
        .${s}-btn {
          display: block;
          width: 100%;
          padding: 16px;
          background: ${primary};
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s;
          margin-top: 20px;
        }
        .${s}-btn:hover {
          opacity: 0.9;
        }
        .${s}-form-group {
          margin-bottom: 15px;
        }
        .${s}-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 5px;
        }
        .${s}-input {
          width: 100%;
          padding: 12px 15px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 15px;
          box-sizing: border-box;
        }
        .${s}-input:focus {
          outline: none;
          border-color: ${primary};
          box-shadow: 0 0 0 3px ${accent};
        }
        .${s}-consent-label {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12px;
          color: #6b7280;
          line-height: 1.4;
          cursor: pointer;
          margin-top: 10px;
        }
        .${s}-consent-label input[type="checkbox"] {
          width: 18px;
          height: 18px;
          margin-top: 1px;
          flex-shrink: 0;
          accent-color: ${primary};
          cursor: pointer;
        }
        .${s}-fineprint {
          font-size: 12px;
          color: #9ca3af;
          text-align: center;
          margin-top: 15px;
        }
        .${s}-result-box {
          background: ${accent};
          border: 1px solid ${primary}33;
          border-radius: 12px;
          padding: 25px;
          text-align: center;
          margin-bottom: 20px;
        }
        .${s}-price {
          font-size: 32px;
          font-weight: 800;
          color: ${primary};
          margin: 10px 0;
        }
        .${s}-summary {
          font-size: 14px;
          color: #4b5563;
          line-height: 1.5;
        }
        .${s}-error-box {
          background: #fee2e2;
          border: 1px solid #ef4444;
          color: #b91c1c;
          padding: 20px;
          border-radius: 12px;
          text-align: center;
        }
        @media (max-width: 480px) {
          .${s}-grid {
            grid-template-columns: 1fr;
          }
          .${s}-body {
            padding: 30px 20px;
          }
        }
      </style>

      <div class="${s}-container" id="${s}-widget">
        <div class="${s}-progress-bar">
          <div class="${s}-progress-fill" id="${s}-fill"></div>
        </div>
        <div class="${s}-body">

          <!-- Static Header -->
          <h2 class="${s}-title">${content.headline || 'Design Your Custom Vehicle Wrap'}</h2>
          <p class="${s}-subtitle">${content.subheadline || 'Answer 4 quick questions to get a personalized wrap estimate.'}</p>

          ${stepsHtml}

          <!-- Contact Step -->
          <div class="${s}-step" data-step="${totalSteps}">
            <h2 class="${s}-title">${contactTitle}</h2>
            <p class="${s}-subtitle">${contactSubtitle}</p>
            <form onsubmit="window['${s}Submit'](event)">
              <div class="${s}-form-group">
                <label class="${s}-label">Full Name</label>
                <input type="text" id="${s}-name" class="${s}-input" required placeholder="John Doe">
              </div>
              <div class="${s}-form-group">
                <label class="${s}-label">Email Address</label>
                <input type="email" id="${s}-email" class="${s}-input" required placeholder="john@example.com">
              </div>
              <div class="${s}-form-group">
                <label class="${s}-label">Phone Number (Optional)</label>
                <input type="tel" id="${s}-phone" class="${s}-input" placeholder="(555) 123-4567">
              </div>
              <label class="${s}-consent-label"><input type="checkbox" id="${s}-sms-consent" required /> I consent to receive text messages about my wrap estimate. Message &amp; data rates may apply. Text STOP to opt out.</label>
              <button type="submit" class="${s}-btn" id="${s}-submit-btn">Get My Estimate</button>
              <p class="${s}-fineprint">No spam. We'll only contact you about your vehicle wrap design.</p>
            </form>
          </div>

          <!-- Result Screen -->
          <div class="${s}-step" data-step="result">
            <h2 class="${s}-title">Your Estimate is Ready!</h2>
            <div class="${s}-result-box">
              <p style="font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:1px; color:${primary};">Estimated Range</p>
              <div class="${s}-price" id="${s}-price-display">$2,500 - $3,500</div>
              <p class="${s}-summary" id="${s}-summary-display">Based on a Full Wrap for a Coupe / Sedan with a Gloss / Satin finish.</p>
            </div>
            <p style="text-align:center; font-size:15px; color:#4b5563;">We've sent a detailed breakdown to your email. Our team will be in touch shortly to discuss your design!</p>
          </div>

          <!-- Error Screen -->
          <div class="${s}-step" data-step="error">
            <div class="${s}-error-box">
              <h3 style="margin-top:0; font-size:18px;">Oops, something went wrong.</h3>
              <p style="font-size:14px; margin-bottom:0;">We couldn't submit your request. Please try again.</p>
            </div>
            <button class="${s}-btn" onclick="window['${s}GoTo'](${totalSteps})">Try Again</button>
          </div>

        </div>
      </div>

      <script>
        (function() {
          var state = {
            step: 1,
            answers: {}
          };

          var ESTIMATE_MAP = {
            'Coupe / Sedan': {
              'Full Wrap': '$2,500 - $3,500',
              'Partial Wrap': '$1,000 - $1,800',
              'Roof / Hood Only': '$300 - $600',
              'Chrome Delete / Accents': '$400 - $800'
            },
            'SUV / Crossover': {
              'Full Wrap': '$3,000 - $4,200',
              'Partial Wrap': '$1,200 - $2,000',
              'Roof / Hood Only': '$400 - $700',
              'Chrome Delete / Accents': '$500 - $900'
            },
            'Truck': {
              'Full Wrap': '$3,200 - $4,500',
              'Partial Wrap': '$1,500 - $2,500',
              'Roof / Hood Only': '$500 - $800',
              'Chrome Delete / Accents': '$600 - $1,000'
            },
            'Van / Commercial': {
              'Full Wrap': '$3,500 - $5,500',
              'Partial Wrap': '$1,500 - $3,000',
              'Roof / Hood Only': '$600 - $900',
              'Chrome Delete / Accents': '$500 - $900'
            }
          };

          var FINISH_MULTIPLIER = {
            'Gloss / Satin': 1.0,
            'Matte': 1.1,
            'Chrome / Reflective': 1.5,
            'Color Shift': 1.3
          };

          window['${s}GoTo'] = function(step) {
            state.step = step;
            var widget = document.getElementById('${s}-widget');
            if (!widget) return;
            var steps = widget.querySelectorAll('.${s}-step');
            for (var i = 0; i < steps.length; i++) {
              steps[i].classList.remove('active');
            }
            var target = widget.querySelector('.${s}-step[data-step="' + step + '"]');
            if (target) target.classList.add('active');
            var fill = document.getElementById('${s}-fill');
            if (fill) {
              var percent = 0;
              if (typeof step === 'number') {
                percent = (step / ${totalSteps}) * 100;
              } else if (step === 'result') {
                percent = 100;
              }
              fill.style.width = percent + '%';
            }
          };

          window['${s}Pick'] = function(el, key, value) {
            state.answers[key] = value;
            var siblings = el.parentNode.children;
            for (var i = 0; i < siblings.length; i++) {
              siblings[i].classList.remove('selected');
            }
            el.classList.add('selected');
            setTimeout(function() {
              window['${s}GoTo'](state.step + 1);
            }, 350);
          };

          window['${s}Submit'] = function(e) {
            e.preventDefault();
            var btn = document.getElementById('${s}-submit-btn');
            var originalText = btn.innerText;
            btn.innerText = 'Sending...';
            btn.disabled = true;

            var name = document.getElementById('${s}-name').value;
            var email = document.getElementById('${s}-email').value;
            var phone = document.getElementById('${s}-phone').value;
            var userId = window.__SORCE_USER_ID__;
            if (!userId) { window['${s}GoTo']('error'); return; }

            var vehicle = state.answers.ans0 || 'Coupe / Sedan';
            var style = state.answers.ans1 || 'Full Wrap';
            var finish = state.answers.ans2 || 'Gloss / Satin';
            var timeline = state.answers.ans3 || 'ASAP';

            var basePrice = ESTIMATE_MAP[vehicle] && ESTIMATE_MAP[vehicle][style] ? ESTIMATE_MAP[vehicle][style] : 'Custom Quote';
            var finalPrice = basePrice;

            if (basePrice !== 'Custom Quote') {
              var parts = basePrice.replace(/\\$/g, '').replace(/,/g, '').split(' - ');
              var mult = FINISH_MULTIPLIER[finish] || 1.0;
              if (parts.length === 2) {
                var min = Math.round(parseInt(parts[0]) * mult);
                var max = Math.round(parseInt(parts[1]) * mult);
                finalPrice = '$' + min.toLocaleString() + ' - $' + max.toLocaleString();
              }
            }

            var answerParts = Object.keys(state.answers).map(function(k) { return state.answers[k]; });
            var message = answerParts.join(' | ') + ' | Estimated Price: ' + finalPrice;

            var apiUrl = window.__SORCE_API_URL__ || '';
            fetch(apiUrl + '/api/leads/public/' + userId, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: name,
                email: email,
                phone: phone,
                service: 'Auto Wrap',
                message: message,
                sms_consent: true
              })
            })
            .then(function(res) {
              if (!res.ok) throw new Error('Network response was not ok');
              document.getElementById('${s}-price-display').innerText = finalPrice;
              document.getElementById('${s}-summary-display').innerText = 'Based on a ' + style + ' for a ' + vehicle + ' with a ' + finish + ' finish.';
              window['${s}GoTo']('result');
            })
            .catch(function() {
              btn.innerText = originalText;
              btn.disabled = false;
              window['${s}GoTo']('error');
            });
          };
        })();
      </script>
</section>
    `;
  }
};
