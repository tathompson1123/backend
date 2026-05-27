/* ============================================================
 * SORCE Embed Forms — inline form renderer
 * Usage:
 *   <div data-sorce-form="PUBLIC_ID"></div>
 *   <script src="https://YOUR-BACKEND/forms.js" async></script>
 * Renders every [data-sorce-form] on the page, posts submissions to the
 * leads pipeline, and shows the form's success message.
 * ============================================================ */
(function () {
  if (window.__sorceFormsLoaded) return;
  window.__sorceFormsLoaded = true;

  // Derive the backend origin from this script's own URL.
  var BASE = (function () {
    var s = document.currentScript;
    if (!s) {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf('forms.js') > -1) { s = all[i]; break; }
      }
    }
    if (!s || !s.src) return '';
    return s.src.replace(/\/forms\.js(\?.*)?$/, '');
  })();

  function injectStyles() {
    if (document.getElementById('scf-styles')) return;
    var st = document.createElement('style');
    st.id = 'scf-styles';
    st.textContent = [
      '.scf-form{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1f2937;}',
      '.scf-form *{box-sizing:border-box;}',
      '.scf-title{font-size:1.4rem;font-weight:700;margin:0 0 6px;}',
      '.scf-desc{font-size:.9rem;color:#6b7280;margin:0 0 18px;line-height:1.5;}',
      '.scf-field{margin-bottom:14px;}',
      '.scf-label{display:block;font-size:.8rem;font-weight:600;margin-bottom:5px;color:#374151;}',
      '.scf-req{color:#ef4444;margin-left:2px;}',
      '.scf-input,.scf-textarea,.scf-select{width:100%;padding:10px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:.92rem;background:#fff;color:#1f2937;}',
      '.scf-textarea{resize:vertical;min-height:84px;}',
      '.scf-input:focus,.scf-textarea:focus,.scf-select:focus{outline:none;border-color:var(--scf-accent,#d97706);}',
      '.scf-check{display:flex;align-items:flex-start;gap:8px;font-size:.78rem;color:#6b7280;margin-bottom:14px;line-height:1.4;}',
      '.scf-check input{margin-top:3px;flex-shrink:0;width:16px;height:16px;}',
      '.scf-btn{width:100%;padding:12px;border:none;border-radius:8px;color:#fff;font-weight:700;font-size:.95rem;cursor:pointer;background:var(--scf-accent,#d97706);transition:opacity .2s;}',
      '.scf-btn:hover{opacity:.9;}',
      '.scf-btn:disabled{opacity:.6;cursor:not-allowed;}',
      '.scf-error{color:#ef4444;font-size:.82rem;margin-top:10px;text-align:center;}',
      '.scf-success{text-align:center;padding:30px 16px;}',
      '.scf-success-ic{width:54px;height:54px;border-radius:50%;background:var(--scf-accent,#d97706);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 14px;}',
      '.scf-success-msg{font-size:1rem;color:#374151;line-height:1.5;}'
    ].join('');
    document.head.appendChild(st);
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); }
    if (text != null) e.textContent = text;
    return e;
  }

  function buildField(f) {
    var wrap = el('div', { class: 'scf-field' });

    if (f.type === 'checkbox') {
      var lbl = el('label', { class: 'scf-check' });
      var cb = el('input', { type: 'checkbox', 'data-key': f.key });
      if (f.required) cb.required = true;
      lbl.appendChild(cb);
      lbl.appendChild(el('span', null, f.label + (f.required ? ' *' : '')));
      wrap.appendChild(lbl);
      return wrap;
    }

    var label = el('label', { class: 'scf-label' }, f.label);
    if (f.required) { var r = el('span', { class: 'scf-req' }, '*'); label.appendChild(r); }
    wrap.appendChild(label);

    var input;
    if (f.type === 'textarea') {
      input = el('textarea', { class: 'scf-textarea', 'data-key': f.key, placeholder: f.placeholder || '' });
    } else if (f.type === 'select') {
      input = el('select', { class: 'scf-select', 'data-key': f.key });
      input.appendChild(el('option', { value: '' }, f.placeholder || 'Select…'));
      (f.options || []).forEach(function (o) { input.appendChild(el('option', { value: o }, o)); });
    } else {
      var t = (f.type === 'email' || f.type === 'tel') ? f.type : 'text';
      input = el('input', { type: t, class: 'scf-input', 'data-key': f.key, placeholder: f.placeholder || '' });
    }
    if (f.required) input.required = true;
    wrap.appendChild(input);
    return wrap;
  }

  function render(container, publicId, cfg) {
    container.innerHTML = '';
    var form = el('form', { class: 'scf-form', novalidate: 'true' });
    form.style.setProperty('--scf-accent', cfg.themeColor || '#d97706');

    if (cfg.title) form.appendChild(el('h3', { class: 'scf-title' }, cfg.title));
    if (cfg.description) form.appendChild(el('p', { class: 'scf-desc' }, cfg.description));

    var fields = Array.isArray(cfg.fields) ? cfg.fields : [];
    fields.forEach(function (f) { form.appendChild(buildField(f)); });

    // SMS consent (required) when the form is set to auto follow up by text.
    var consent = null;
    if (cfg.smsFollowup) {
      var clabel = el('label', { class: 'scf-check' });
      consent = el('input', { type: 'checkbox' });
      consent.required = true;
      clabel.appendChild(consent);
      clabel.appendChild(el('span', null,
        'I consent to receive text messages from ' + (cfg.businessName || 'us') +
        ' about my inquiry. Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out.'));
      form.appendChild(clabel);
    }

    var btn = el('button', { type: 'submit', class: 'scf-btn' }, cfg.submitText || 'Submit');
    form.appendChild(btn);
    var errEl = el('div', { class: 'scf-error' });
    errEl.style.display = 'none';
    form.appendChild(errEl);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      errEl.style.display = 'none';
      if (!form.checkValidity()) { form.reportValidity(); return; }

      var payload = {};
      form.querySelectorAll('[data-key]').forEach(function (node) {
        var key = node.getAttribute('data-key');
        payload[key] = (node.type === 'checkbox') ? node.checked : node.value;
      });
      if (consent) payload.sms_consent = consent.checked;

      btn.disabled = true;
      var original = btn.textContent;
      btn.textContent = 'Sending…';

      fetch(BASE + '/api/embed-forms/public/' + encodeURIComponent(publicId) + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.d && res.d.error ? res.d.error : 'Submission failed');
          var done = el('div', { class: 'scf-success' });
          done.appendChild(el('div', { class: 'scf-success-ic' }, '✓'));
          done.appendChild(el('div', { class: 'scf-success-msg' }, res.d.message || "Thanks! We'll be in touch shortly."));
          done.style.setProperty('--scf-accent', cfg.themeColor || '#d97706');
          container.innerHTML = '';
          container.appendChild(done);
        })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = original;
          errEl.textContent = e.message || 'Something went wrong. Please try again.';
          errEl.style.display = 'block';
        });
    });

    container.appendChild(form);
  }

  function load(container, publicId) {
    fetch(BASE + '/api/embed-forms/public/' + encodeURIComponent(publicId))
      .then(function (r) { return r.json(); })
      .then(function (cfg) { if (cfg && !cfg.error) render(container, publicId, cfg); })
      .catch(function () { /* leave container empty on failure */ });
  }

  function initAll() {
    injectStyles();
    var nodes = document.querySelectorAll('[data-sorce-form]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.getAttribute('data-scf-init')) continue;
      var id = node.getAttribute('data-sorce-form');
      if (!id) continue;
      node.setAttribute('data-scf-init', '1');
      load(node, id);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
  window.SorceForms = { refresh: initAll };
})();
