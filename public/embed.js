/**
 * SORCE Embed Script
 * Adds chat widget, booking form, and lead capture to any website.
 * Usage: <script src="https://your-backend.com/embed.js" data-site-key="uuid" async></script>
 */
(function() {
  'use strict';

  // Find our script tag and read the site key
  var scripts = document.getElementsByTagName('script');
  var currentScript = null;
  for (var i = 0; i < scripts.length; i++) {
    if (scripts[i].src && scripts[i].src.indexOf('embed.js') !== -1 && scripts[i].getAttribute('data-site-key')) {
      currentScript = scripts[i];
      break;
    }
  }
  if (!currentScript) { console.warn('SORCE Embed: Missing data-site-key attribute'); return; }

  var SITE_KEY = currentScript.getAttribute('data-site-key');
  var API_BASE = currentScript.src.replace(/\/embed\.js.*$/, '');

  // ── State ──────────────────────────────────────────────
  var config = null;
  var chatConversationId = null;
  var chatOpen = false;
  var leadFormOpen = false;

  // ── Init ───────────────────────────────────────────────
  function init() {
    fetch(API_BASE + '/api/embed/config/' + SITE_KEY)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.enabled) return;
        config = data;
        injectStyles();
        if (config.chatEnabled) injectChatWidget();
        if (config.bookingEnabled) {
          scanBookingButtons(); // Hijack existing "Book Now" / "Book Online" buttons
        }
        if (config.leadFormEnabled) injectLeadForm();
        if (config.leadFormEnabled || config.bookingEnabled) startDOMObserver();
      })
      .catch(function(e) { console.warn('SORCE Embed: Failed to load config', e.message); });
  }

  // ── Styles ─────────────────────────────────────────────
  function injectStyles() {
    var tc = config.themeColor || '#d97706';
    var pos = config.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;';
    var posOpp = config.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;';
    var origin = config.position === 'bottom-left' ? 'bottom left' : 'bottom right';

    var css = '\n' +
      '#sorce-embed-container { position: fixed; bottom: 20px; ' + pos + ' z-index: 99999; display: flex; flex-direction: column; align-items: ' + (config.position === 'bottom-left' ? 'flex-start' : 'flex-end') + '; gap: 12px; }\n' +
      /* Non-chat FABs */
      '.sorce-fab { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.2); transition: transform 0.2s; color: white; font-size: 24px; position: relative; }\n' +
      '.sorce-fab:hover { transform: scale(1.1); }\n' +
      '.sorce-fab-lead { background: #2563eb; }\n' +
      '.sorce-fab-label { position: absolute; ' + (config.position === 'bottom-left' ? 'left: 66px;' : 'right: 66px;') + ' background: #1f2937; color: white; padding: 6px 12px; border-radius: 8px; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.2s; }\n' +
      '.sorce-fab:hover .sorce-fab-label { opacity: 1; }\n' +

      /* Chat bubble (pill shape with avatar + name + status) */
      '.sorce-chat-bubble { display: flex; align-items: center; gap: 10px; background: ' + tc + '; border-radius: 30px; padding: 8px 16px 8px 8px; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.18); transition: transform 0.2s, box-shadow 0.2s; color: white; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; border: none; }\n' +
      '.sorce-chat-bubble:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,0,0,0.25); }\n' +
      '.sorce-chat-avatar { width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; flex-shrink: 0; }\n' +
      '.sorce-chat-bubble-info { display: flex; flex-direction: column; line-height: 1.2; }\n' +
      '.sorce-chat-bubble-name { font-weight: 600; font-size: 14px; }\n' +
      '.sorce-chat-bubble-status { display: flex; align-items: center; gap: 5px; font-size: 12px; opacity: 0.9; }\n' +
      '.sorce-online-dot { width: 7px; height: 7px; background: #34d399; border-radius: 50%; animation: sorceOnlinePulse 2s infinite; }\n' +
      '@keyframes sorceOnlinePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }\n' +

      /* Chat window */
      '.sorce-chat-window { position: fixed; bottom: 90px; ' + posOpp + ' width: 380px; height: 550px; background: white; color: #1f2937; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden; transform: scale(0); transform-origin: ' + origin + '; transition: transform 0.3s ease; z-index: 100000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n' +
      '.sorce-chat-window.open { transform: scale(1); }\n' +
      '.sorce-chat-header { background: ' + tc + '; color: white; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; }\n' +
      '.sorce-chat-header-info { display: flex; align-items: center; gap: 12px; }\n' +
      '.sorce-chat-header-avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; flex-shrink: 0; }\n' +
      '.sorce-chat-header h3 { margin: 0; font-size: 16px; font-weight: 600; }\n' +
      '.sorce-chat-header-status { display: flex; align-items: center; gap: 5px; font-size: 12px; opacity: 0.85; margin-top: 2px; }\n' +
      '.sorce-chat-header-status-dot { width: 6px; height: 6px; background: #34d399; border-radius: 50%; }\n' +
      '.sorce-chat-close { background: none; border: none; color: white; cursor: pointer; font-size: 22px; padding: 0; }\n' +
      '.sorce-chat-messages { flex: 1; overflow-y: auto; padding: 16px; background: #f9fafb; }\n' +
      '.sorce-chat-msg { margin-bottom: 12px; display: flex; }\n' +
      '.sorce-chat-msg.agent .sorce-msg-bubble { background: white; color: #1f2937; border: 1px solid #e5e7eb; }\n' +
      '.sorce-chat-msg.user .sorce-msg-bubble { background: ' + tc + '; color: white; margin-left: auto; }\n' +
      '.sorce-msg-bubble { max-width: 75%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; }\n' +
      '.sorce-chat-input-area { padding: 12px; border-top: 1px solid #e5e7eb; background: white; color: #1f2937; }\n' +
      '.sorce-chat-input { width: 100%; padding: 10px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; resize: none; box-sizing: border-box; font-family: inherit; color: #1f2937; background: white; }\n' +
      '.sorce-chat-input:focus { outline: none; border-color: ' + tc + '; }\n' +
      '.sorce-chat-send { margin-top: 8px; width: 100%; padding: 10px; background: ' + tc + '; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; }\n' +
      '.sorce-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }\n' +
      '.sorce-typing { display: flex; gap: 4px; padding: 10px 14px; }\n' +
      '.sorce-typing-dot { width: 7px; height: 7px; background: #9ca3af; border-radius: 50%; animation: sorceTyping 1.4s infinite; }\n' +
      '.sorce-typing-dot:nth-child(2) { animation-delay: 0.2s; }\n' +
      '.sorce-typing-dot:nth-child(3) { animation-delay: 0.4s; }\n' +
      '@keyframes sorceTyping { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }\n' +

      /* Lead form modal */
      '.sorce-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n' +
      '.sorce-modal { background: white; color: #1f2937; border-radius: 16px; max-width: 480px; width: 90%; max-height: 90vh; overflow-y: auto; padding: 32px; box-shadow: 0 16px 48px rgba(0,0,0,0.2); }\n' +

      /* Replaced form styling — fits into the original form's container */
      '.sorce-replaced-form { max-width: 520px; padding: 24px; background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n' +

      /* Mobile responsive */
      '@media (max-width: 480px) {\n' +
      '  .sorce-chat-window { width: calc(100vw - 40px); height: calc(100vh - 120px); }\n' +
      '  .sorce-modal { max-width: 100%; margin: 0 12px; padding: 24px; }\n' +
      '}\n';

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Chat Widget ────────────────────────────────────────
  function injectChatWidget() {
    var container = getOrCreateContainer();

    // Chat bubble (pill with avatar + name + online status)
    var chatName = escapeHtml(config.chat.agentName || 'Assistant');
    var chatInitial = (config.chat.agentName || 'A').charAt(0).toUpperCase();
    var fab = document.createElement('button');
    fab.className = 'sorce-chat-bubble';
    fab.innerHTML = '<div class="sorce-chat-avatar">' + chatInitial + '</div><div class="sorce-chat-bubble-info"><span class="sorce-chat-bubble-name">' + chatName + '</span><span class="sorce-chat-bubble-status"><span class="sorce-online-dot"></span> Online now</span></div>';
    fab.onclick = toggleChat;
    container.appendChild(fab);

    // Chat window
    var chatWindow = document.createElement('div');
    chatWindow.className = 'sorce-chat-window';
    chatWindow.id = 'sorce-chat-window';
    chatWindow.innerHTML =
      '<div class="sorce-chat-header"><div class="sorce-chat-header-info"><div class="sorce-chat-header-avatar">' + chatInitial + '</div><div><h3>' + chatName + '</h3><div class="sorce-chat-header-status"><span class="sorce-chat-header-status-dot"></span> Online</div></div></div><button class="sorce-chat-close">\u00d7</button></div>' +
      '<div class="sorce-chat-messages" id="sorce-chat-messages"></div>' +
      '<div class="sorce-chat-input-area"><textarea class="sorce-chat-input" id="sorce-chat-input" placeholder="Type your message..." rows="2"></textarea><button class="sorce-chat-send" id="sorce-chat-send">Send Message</button></div>';
    document.body.appendChild(chatWindow);

    // Wire up close button properly
    chatWindow.querySelector('.sorce-chat-close').onclick = function() { toggleChat(); };

    // Wire up input
    document.getElementById('sorce-chat-input').addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
    document.getElementById('sorce-chat-send').addEventListener('click', sendChatMessage);

    // Auto-open after delay
    var delay = (config.chat.autoOpenDelay || 14) * 1000;
    setTimeout(function() {
      if (!chatOpen && !sessionStorage.getItem('sorce-chat-opened')) {
        toggleChat();
        addChatMessage(config.chat.greetingMessage, 'agent');
        sessionStorage.setItem('sorce-chat-opened', 'true');
      }
    }, delay);
  }

  function toggleChat() {
    chatOpen = !chatOpen;
    var win = document.getElementById('sorce-chat-window');
    if (win) {
      if (chatOpen) {
        win.classList.add('open');
        if (!chatConversationId) startChatConversation();
      } else {
        win.classList.remove('open');
      }
    }
  }

  function startChatConversation() {
    fetch(API_BASE + '/api/chat/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: config.userId, source: 'embed' })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) { chatConversationId = data.conversationId; })
    .catch(function() {});
  }

  function sendChatMessage() {
    var input = document.getElementById('sorce-chat-input');
    var msg = input.value.trim();
    if (!msg || !chatConversationId) return;

    addChatMessage(msg, 'user');
    input.value = '';

    // Fetch response in background while we do the initial "reading" delay
    var fetchP = fetch(API_BASE + '/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: config.userId, conversationId: chatConversationId, message: msg })
    });

    // 5 second "reading" delay before typing indicator appears (matches website widget)
    setTimeout(function() {
      showChatTyping();

      fetchP.then(function(r) { return r.json(); })
      .then(function(data) {
        // Human typing delay: 60-80 WPM (150-200ms per char)
        var len = (data.reply || '').length;
        var msPerChar = 150 + Math.random() * 50;
        var typingMs = Math.min(Math.max(len * msPerChar, 2000), 15000);
        setTimeout(function() {
          hideChatTyping();
          addChatMessage(data.reply, 'agent');
        }, typingMs);
      })
      .catch(function() {
        hideChatTyping();
        addChatMessage('Sorry, I had trouble connecting. Please try again.', 'agent');
      });
    }, 5000);
  }

  function addChatMessage(text, type) {
    var msgs = document.getElementById('sorce-chat-messages');
    var div = document.createElement('div');
    div.className = 'sorce-chat-msg ' + type;
    div.innerHTML = '<div class="sorce-msg-bubble">' + escapeHtml(text) + '</div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showChatTyping() {
    var msgs = document.getElementById('sorce-chat-messages');
    if (document.getElementById('sorce-typing')) return;
    var div = document.createElement('div');
    div.id = 'sorce-typing';
    div.className = 'sorce-chat-msg agent';
    div.innerHTML = '<div class="sorce-msg-bubble"><div class="sorce-typing"><div class="sorce-typing-dot"></div><div class="sorce-typing-dot"></div><div class="sorce-typing-dot"></div></div></div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function hideChatTyping() {
    var el = document.getElementById('sorce-typing');
    if (el) el.remove();
  }

  // ── Lead Form ──────────────────────────────────────────
  // Strategy: Find existing <form> elements on the page, hide them,
  // and place our SORCE form right next to them. The original forms
  // are preserved (just hidden) — if the embed is removed, they reappear.
  // If no forms are found, fall back to the FAB + modal approach.

  // Resolve which form config to use based on page URL and page rules
  function resolveFormConfig() {
    var path = window.location.pathname;
    var rules = config.formRules || [];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].urlPattern && path.indexOf(rules[i].urlPattern) === 0) {
        return {
          title: rules[i].formTitle || config.leadFormTitle || 'Get a Free Quote',
          fields: rules[i].formFields || config.leadFormFields || ['name', 'email', 'phone', 'message'],
          submitText: rules[i].submitButtonText || config.submitButtonText || 'Submit'
        };
      }
    }
    // Default fallback
    return {
      title: config.leadFormTitle || 'Get a Free Quote',
      fields: config.leadFormFields || ['name', 'email', 'phone', 'message'],
      submitText: config.submitButtonText || 'Submit'
    };
  }

  // ── Form Detection ────────────────────────────────────

  function isContactForm(form) {
    // Skip forms inside nav, header (search bars, login forms)
    var ancestor = form;
    while (ancestor) {
      var tag = ancestor.tagName;
      if (tag === 'NAV' || tag === 'HEADER') return false;
      var role = ancestor.getAttribute('role');
      if (role === 'navigation' || role === 'banner') return false;
      ancestor = ancestor.parentElement;
    }
    // Must have at least 2 input/textarea fields
    var inputs = form.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea, [role="textbox"]');
    return inputs.length >= 2;
  }

  // Wix/Squarespace often don't use <form> — detect form-like containers
  function isFormLikeContainer(el) {
    if (el.tagName === 'FORM') return false; // already handled
    var inputs = el.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea, [role="textbox"]');
    if (inputs.length < 2) return false;
    var submitBtn = el.querySelector('button[type="submit"], input[type="submit"], button');
    if (!submitBtn) return false;
    // Check it's not inside nav/header
    var ancestor = el;
    while (ancestor) {
      var tag = ancestor.tagName;
      if (tag === 'NAV' || tag === 'HEADER') return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  }

  function sendLeadToAPI(data, source) {
    fetch(API_BASE + '/api/leads/public/' + config.userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        phone: data.phone,
        service: data.service,
        message: data.message,
        sms_consent: data.sms_consent !== undefined ? data.sms_consent : true,
        source: source || 'embed'
      })
    }).catch(function(e) { console.warn('SORCE: lead forward failed', e.message); });
  }

  // ── Form Replacement ─────────────────────────────────
  // Finds existing contact forms on the page, removes them entirely,
  // and drops in a SORCE lead capture form that feeds the dashboard.

  function replaceFormElement(formEl) {
    if (formEl.getAttribute('data-sorce-replaced')) return false;
    formEl.setAttribute('data-sorce-replaced', 'true');

    var formConfig = resolveFormConfig();
    var tc = config.themeColor || '#d97706';

    // Build the replacement form
    var wrapper = document.createElement('div');
    wrapper.className = 'sorce-replaced-form';
    wrapper.setAttribute('data-sorce-form', 'true');
    wrapper.innerHTML = buildLeadFormHTML(formConfig.fields, tc, formConfig.submitText, formConfig.title);

    // Wire up submit
    wrapper.querySelector('[data-sorce-submit]').addEventListener('click', function(e) {
      e.preventDefault();
      submitLeadForm(wrapper);
    });

    // Replace the original form
    formEl.style.display = 'none';
    formEl.parentNode.insertBefore(wrapper, formEl.nextSibling);
    return true;
  }

  var leadFormFabCreated = false;

  function scanAndReplaceForms() {
    var replaced = 0;

    // Standard <form> elements
    var allForms = document.querySelectorAll('form:not([data-sorce-replaced])');
    for (var i = 0; i < allForms.length; i++) {
      if (!isContactForm(allForms[i])) continue;
      if (replaceFormElement(allForms[i])) replaced++;
    }

    // Wix/SPA form-like containers (no <form> tag)
    var divs = document.querySelectorAll('[data-mesh-id], [class*="form"], [class*="contact"], [id*="form"], [id*="contact"]');
    for (var j = 0; j < divs.length; j++) {
      if (divs[j].getAttribute('data-sorce-replaced')) continue;
      if (divs[j].querySelector('[data-sorce-form]')) continue; // already has our form inside
      if (!isFormLikeContainer(divs[j])) continue;
      if (replaceFormElement(divs[j])) replaced++;
    }

    return replaced;
  }

  function injectLeadForm() {
    var replaced = scanAndReplaceForms();

    if (replaced > 0) {
      leadFormFabCreated = true;
      return;
    }

    // Retry — Wix/SPA frameworks hydrate forms after initial load
    var retries = [1000, 3000, 6000, 10000];
    var retryIdx = 0;
    function retryReplace() {
      if (retryIdx >= retries.length) {
        // All retries exhausted — show FAB fallback so they still get a lead form
        if (!leadFormFabCreated) {
          leadFormFabCreated = true;
          var container = getOrCreateContainer();
          var formConfig = resolveFormConfig();
          var fab = document.createElement('button');
          fab.className = 'sorce-fab sorce-fab-lead';
          fab.innerHTML = '<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg><span class="sorce-fab-label">' + escapeHtml(formConfig.title) + '</span>';
          fab.onclick = openLeadForm;
          container.appendChild(fab);
        }
        return;
      }
      setTimeout(function() {
        var found = scanAndReplaceForms();
        if (found > 0) {
          leadFormFabCreated = true;
        } else {
          retryIdx++;
          retryReplace();
        }
      }, retries[retryIdx]);
    }
    retryReplace();
  }

  // ── Booking Button Hijack ───────────────────────────────
  // Finds existing "Book Now", "Book Online", "Schedule" buttons/links
  // and rewires them to open the SORCE booking modal instead.

  var bookingPatterns = /\b(book\s*(now|online|today|here|appointment)?|schedule|make\s*an?\s*appointment|reserve|get\s*started)\b/i;

  function hijackBookingButtons() {
    var candidates = document.querySelectorAll('a, button, [role="button"]');
    var hijacked = 0;

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.getAttribute('data-sorce-hijacked')) continue;
      if (el.closest('#sorce-embed-container') || el.closest('.sorce-modal-overlay')) continue;

      var text = (el.textContent || '').trim();
      if (!text || text.length > 40) continue;
      if (!bookingPatterns.test(text)) continue;

      // Don't hijack nav links that go to separate pages (only anchors or same-page)
      var href = el.getAttribute('href') || '';
      var isExternalPage = href && !href.startsWith('#') && !href.startsWith('tel:') && !href.startsWith('javascript:');

      el.setAttribute('data-sorce-hijacked', 'true');
      (function(element) {
        element.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var bookingUrl = 'https://sorceintegrations.com/book/' + config.userId;
          window.open(bookingUrl, '_blank');
        });
        element.style.cursor = 'pointer';
      })(el);
      hijacked++;
    }
    return hijacked;
  }

  function scanBookingButtons() {
    var found = hijackBookingButtons();
    if (found === 0) {
      // Retry for SPA hydration
      var retries = [1000, 3000, 6000];
      var idx = 0;
      function retry() {
        if (idx >= retries.length) return;
        setTimeout(function() {
          hijackBookingButtons();
          idx++;
          retry();
        }, retries[idx]);
      }
      retry();
    }
  }

  function buildLeadFormHTML(fields, tc, submitText, title) {
    var formTitle = title || config.leadFormTitle || 'Get a Free Quote';
    var html = '<h3 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">' +
      escapeHtml(formTitle) + '</h3>' +
      '<p style="margin:0 0 16px;color:#6b7280;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">Fill out the form and we\'ll get back to you shortly.</p>';

    var inputStyle = 'width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:inherit;color:#1f2937;background:white;';
    var labelStyle = 'display:block;margin-bottom:6px;font-size:14px;font-weight:500;color:#374151;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;';
    var groupStyle = 'margin-bottom:14px;';

    if (fields.indexOf('name') !== -1) html += '<div style="' + groupStyle + '"><label style="' + labelStyle + '">Name</label><input type="text" data-sorce-field="name" placeholder="Your name" required style="' + inputStyle + '"></div>';
    if (fields.indexOf('email') !== -1) html += '<div style="' + groupStyle + '"><label style="' + labelStyle + '">Email</label><input type="email" data-sorce-field="email" placeholder="your@email.com" required style="' + inputStyle + '"></div>';
    if (fields.indexOf('phone') !== -1) html += '<div style="' + groupStyle + '"><label style="' + labelStyle + '">Phone</label><input type="tel" data-sorce-field="phone" placeholder="(555) 123-4567" style="' + inputStyle + '"></div>';
    if (fields.indexOf('service') !== -1) html += '<div style="' + groupStyle + '"><label style="' + labelStyle + '">Service Interested In</label><input type="text" data-sorce-field="service" placeholder="What service are you looking for?" style="' + inputStyle + '"></div>';
    if (fields.indexOf('message') !== -1) html += '<div style="' + groupStyle + '"><label style="' + labelStyle + '">Message</label><textarea data-sorce-field="message" rows="3" placeholder="Tell us about what you need..." style="' + inputStyle + 'resize:vertical;"></textarea></div>';

    html += '<div style="' + groupStyle + 'display:flex;align-items:flex-start;gap:8px"><input type="checkbox" data-sorce-field="sms" style="margin-top:3px;width:auto;"><label style="font-size:12px;color:#6b7280;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">I consent to receiving SMS messages about my inquiry</label></div>';
    html += '<button type="submit" data-sorce-submit style="width:100%;padding:12px;background:' + tc + ';color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;transition:opacity 0.2s;">' + escapeHtml(submitText) + '</button>';

    return html;
  }

  function submitLeadForm(container) {
    var btn = container.querySelector('[data-sorce-submit]');
    var name = (container.querySelector('[data-sorce-field="name"]') || {}).value || '';
    var email = (container.querySelector('[data-sorce-field="email"]') || {}).value || '';
    var phone = (container.querySelector('[data-sorce-field="phone"]') || {}).value || '';
    var service = (container.querySelector('[data-sorce-field="service"]') || {}).value || '';
    var message = (container.querySelector('[data-sorce-field="message"]') || {}).value || '';
    var smsConsent = (container.querySelector('[data-sorce-field="sms"]') || {}).checked || false;

    if (!name.trim() || !email.trim()) {
      alert('Please provide your name and email.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    fetch(API_BASE + '/api/leads/public/' + config.userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        service: service.trim(),
        message: message.trim(),
        sms_consent: smsConsent,
        source: 'embed'
      })
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      container.innerHTML =
        '<div style="text-align:center;padding:20px;">' +
        '<div style="font-size:48px;color:#059669;">&#10003;</div>' +
        '<h3 style="color:#059669;font-size:20px;margin:12px 0 8px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">Thank You!</h3>' +
        '<p style="color:#6b7280;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">We\'ve received your message and will get back to you shortly.</p>' +
        '</div>';
    })
    .catch(function() {
      btn.textContent = config.submitButtonText || 'Submit';
      btn.disabled = false;
      alert('Something went wrong. Please try again.');
    });
  }

  function openLeadForm() {
    if (leadFormOpen) return;
    leadFormOpen = true;

    var formConfig = resolveFormConfig();
    var tc = config.themeColor || '#d97706';

    var html = buildLeadFormHTML(formConfig.fields, tc, formConfig.submitText, formConfig.title);
    html += '<button class="sorce-btn-secondary" id="sorce-lead-cancel" style="width:100%;padding:10px;background:#f3f4f6;color:#374151;border:none;border-radius:8px;font-weight:500;cursor:pointer;font-size:14px;margin-top:8px;">Cancel</button>';

    var overlay = document.createElement('div');
    overlay.className = 'sorce-modal-overlay';
    overlay.id = 'sorce-lead-overlay';
    overlay.innerHTML = '<div class="sorce-modal" id="sorce-lead-modal">' + html + '</div>';
    document.body.appendChild(overlay);

    // Wire submit
    var modal = document.getElementById('sorce-lead-modal');
    modal.querySelector('[data-sorce-submit]').addEventListener('click', function(e) {
      e.preventDefault();
      submitLeadForm(modal);
    });

    document.getElementById('sorce-lead-cancel').addEventListener('click', closeLeadForm);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeLeadForm();
    });
  }

  function closeLeadForm() {
    var overlay = document.getElementById('sorce-lead-overlay');
    if (overlay) overlay.remove();
    leadFormOpen = false;
  }

  // ── Helpers ────────────────────────────────────────────
  function getOrCreateContainer() {
    var c = document.getElementById('sorce-embed-container');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'sorce-embed-container';
    document.body.appendChild(c);
    return c;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }


  // ── Persistent DOM observer ──────────────────────────────
  // SPAs (Wix, Squarespace, etc.) may re-render sections after navigation,
  // restoring original forms and removing our replacements. This observer
  // detects those changes and re-applies replacements automatically.
  function startDOMObserver() {
    if (typeof MutationObserver === 'undefined') return;
    var debounceTimer = null;
    var observer = new MutationObserver(function(mutations) {
      // Quick-check: only act if nodes were added
      var dominated = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) { dominated = true; break; }
      }
      if (!dominated) return;

      // Debounce to avoid thrashing during hydration
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        if (config.leadFormEnabled) scanAndReplaceForms();
        if (config.bookingEnabled) hijackBookingButtons();
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Start ──────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
