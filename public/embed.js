/**
 * SORCE Embed Script
 * Adds chat widget, booking form, and lead capture to any website.
 * Usage: <script src="https://your-backend.com/embed.js" data-site-key="uuid" async></script>
 */
(function() {
  'use strict';

  console.log('SORCE Embed: script loaded');

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
  console.log('SORCE Embed: site key=' + SITE_KEY + ', API=' + API_BASE);

  // ── State ──────────────────────────────────────────────
  var config = null;
  var chatConversationId = null;
  var chatOpen = false;
  var leadFormOpen = false;

  // Regex for booking-related button text (must be defined before scanBookingButtons)
  var bookingPatterns = /\b(book\s*(now|online|today|here|appointment)?|schedule|make\s*an?\s*appointment|reserve|get\s*started)\b/i;

  // ── Init ───────────────────────────────────────────────
  // Hijack booking buttons immediately (before config loads) so fast clicks are caught
  scanBookingButtons();

  function init() {
    console.log('SORCE Embed: fetching config...');
    fetch(API_BASE + '/api/embed/config/' + SITE_KEY)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        console.log('SORCE Embed: config loaded', data.enabled ? 'ENABLED' : 'DISABLED', 'chat=' + data.chatEnabled, 'booking=' + data.bookingEnabled, 'leadForm=' + data.leadFormEnabled);
        if (!data.enabled) return;
        config = data;
        injectStyles();
        if (config.chatEnabled) injectChatWidget();
        if (config.bookingEnabled) {
          scanBookingButtons();
        }
        if (config.leadFormEnabled) injectLeadForm();
        if (config.bookingEnabled || config.leadFormEnabled) startDOMObserver();
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

      /* Modal overlay */
      '.sorce-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n' +
      '.sorce-modal { background: white; color: #1f2937; border-radius: 16px; max-width: 480px; width: 90%; max-height: 90vh; overflow-y: auto; padding: 32px; box-shadow: 0 16px 48px rgba(0,0,0,0.2); }\n' +
      '.sorce-modal h2 { margin: 0 0 8px; font-size: 22px; color: #1f2937; }\n' +
      '.sorce-modal p { margin: 0 0 24px; color: #6b7280; font-size: 14px; }\n' +
      '.sorce-form-group { margin-bottom: 16px; }\n' +
      '.sorce-form-group label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151; }\n' +
      '.sorce-form-group input, .sorce-form-group select, .sorce-form-group textarea { width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; box-sizing: border-box; font-family: inherit; color: #1f2937; background: white; }\n' +
      '.sorce-form-group input:focus, .sorce-form-group select:focus, .sorce-form-group textarea:focus { outline: none; border-color: ' + tc + '; }\n' +
      '.sorce-btn-primary { width: 100%; padding: 12px; background: ' + tc + '; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 15px; transition: opacity 0.2s; }\n' +
      '.sorce-btn-primary:hover { opacity: 0.9; }\n' +
      '.sorce-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }\n' +
      '.sorce-btn-secondary { width: 100%; padding: 10px; background: #f3f4f6; color: #374151; border: none; border-radius: 8px; font-weight: 500; cursor: pointer; font-size: 14px; margin-top: 8px; }\n' +
      '.sorce-slots-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }\n' +
      '.sorce-slot { padding: 8px; text-align: center; border: 2px solid #e5e7eb; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.15s; }\n' +
      '.sorce-slot:hover { border-color: ' + tc + '; background: ' + tc + '10; }\n' +
      '.sorce-slot.selected { border-color: ' + tc + '; background: ' + tc + '; color: white; }\n' +
      '.sorce-success { text-align: center; padding: 20px; }\n' +
      '.sorce-success h3 { color: #059669; font-size: 20px; margin: 12px 0 8px; }\n' +

      /* Replaced form styling — fits into the original form's container */
      '.sorce-replaced-form { max-width: 520px; padding: 24px; background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n' +

      /* Booking widget (multi-step) */
      '#sorce-booking-overlay{display:none;position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}\n' +
      '#sorce-booking-overlay.open{display:flex!important}\n' +
      '#sorce-booking-modal{position:relative;width:95%;max-width:560px;max-height:90vh;overflow-y:auto;background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,.3);padding:0;animation:sbkSlideUp .25s ease}\n' +
      '@keyframes sbkSlideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}\n' +
      '.sbk-step{display:none}.sbk-step.active{display:block}\n' +
      '.sbk-title{font-size:22px;font-weight:700;color:#111;margin:0 0 6px}\n' +
      '.sbk-sub{font-size:14px;color:#6b7280;margin:0 0 20px}\n' +
      '.sbk-card{border:2px solid #e5e7eb;border-radius:12px;padding:16px;cursor:pointer;transition:border .15s,box-shadow .15s;margin-bottom:10px}\n' +
      '.sbk-card:hover,.sbk-card.sel{border-color:' + tc + ';box-shadow:0 0 0 3px ' + tc + '22}\n' +
      '.sbk-card h4{margin:0 0 4px;font-size:16px;font-weight:600;color:#111}\n' +
      '.sbk-card p{margin:0;font-size:13px;color:#6b7280}\n' +
      '.sbk-price{font-size:20px;font-weight:700;color:' + tc + '}\n' +
      '.sbk-dur{font-size:13px;color:#9ca3af}\n' +
      '.sbk-row{display:flex;justify-content:space-between;align-items:center}\n' +
      '.sbk-btn{display:block;width:100%;padding:14px;border:none;border-radius:10px;background:' + tc + ';color:#fff;font-size:16px;font-weight:600;cursor:pointer;transition:opacity .15s;margin-top:16px}\n' +
      '.sbk-btn:hover{opacity:.9}\n' +
      '.sbk-btn:disabled{opacity:.5;cursor:not-allowed}\n' +
      '.sbk-btn-back{background:none;border:none;color:#6b7280;font-size:14px;cursor:pointer;padding:0;margin-bottom:12px;display:flex;align-items:center;gap:4px}\n' +
      '.sbk-btn-back:hover{color:#111}\n' +
      '.sbk-input{width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:8px;font-size:15px;outline:none;transition:border .15s;box-sizing:border-box;margin-bottom:10px}\n' +
      '.sbk-input:focus{border-color:' + tc + '}\n' +
      '.sbk-label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px}\n' +
      '.sbk-req{color:#ef4444}\n' +
      '.sbk-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin:12px 0}\n' +
      '.sbk-slot{padding:10px 8px;border:2px solid #e5e7eb;border-radius:8px;text-align:center;cursor:pointer;font-size:14px;font-weight:500;transition:all .15s}\n' +
      '.sbk-slot:hover,.sbk-slot.sel{border-color:' + tc + ';background:' + tc + ';color:#fff}\n' +
      '.sbk-cal{border:2px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:16px}\n' +
      '.sbk-cal-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f9fafb}\n' +
      '.sbk-cal-header button{background:none;border:none;cursor:pointer;padding:6px 10px;border-radius:8px;font-size:18px;color:#374151;transition:background .15s}\n' +
      '.sbk-cal-header button:hover{background:#e5e7eb}\n' +
      '.sbk-cal-header span{font-weight:700;font-size:15px;color:#111}\n' +
      '.sbk-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);text-align:center}\n' +
      '.sbk-cal-dow{padding:8px 0;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase}\n' +
      '.sbk-cal-day{padding:8px 0;font-size:14px;color:#d1d5db;position:relative;cursor:default}\n' +
      '.sbk-cal-day.avail{color:#111;cursor:pointer;font-weight:500}\n' +
      '.sbk-cal-day.avail:hover{background:#f3f4f6}\n' +
      '.sbk-cal-day.sel{background:' + tc + ';color:#fff;font-weight:700}\n' +
      '.sbk-cal-day.sel:hover{background:' + tc + '}\n' +
      '.sbk-cal-day.today::after{content:"";position:absolute;bottom:3px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:' + tc + '}\n' +
      '.sbk-cal-day.sel.today::after{background:#fff}\n' +
      '.sbk-times-section{animation:sbkFadeIn .2s ease}\n' +
      '@keyframes sbkFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}\n' +
      '.sbk-summary{background:#f9fafb;border-radius:10px;padding:16px;margin-bottom:16px}\n' +
      '.sbk-summary-row{display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px}\n' +
      '.sbk-summary-row span:last-child{font-weight:600}\n' +
      '.sbk-check{display:flex;align-items:center;width:16px;height:16px;border-radius:50%;background:#10b981;color:#fff;font-size:11px;justify-content:center;margin-right:8px}\n' +
      '.sbk-success{text-align:center;padding:30px 0}\n' +
      '.sbk-success h3{font-size:24px;font-weight:700;color:#111;margin:12px 0 8px}\n' +
      '.sbk-error{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:10px 14px;border-radius:8px;font-size:14px;margin-bottom:12px}\n' +
      '.sbk-loading{display:flex;align-items:center;justify-content:center;padding:40px;color:#9ca3af}\n' +
      '.sbk-spin{width:24px;height:24px;border:3px solid #e5e7eb;border-top-color:' + tc + ';border-radius:50%;animation:sbkSpin .6s linear infinite;margin-right:10px}\n' +
      '@keyframes sbkSpin{to{transform:rotate(360deg)}}\n' +
      '.sbk-cat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:12px}\n' +
      '.sbk-cat-card{position:relative;border-radius:12px;height:120px;cursor:pointer;overflow:hidden;background:#e5e7eb;background-size:cover;background-position:center;display:flex;flex-direction:column;justify-content:flex-end;padding:14px;transition:transform .15s,box-shadow .15s}\n' +
      '.sbk-cat-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.15)}\n' +
      '.sbk-cat-card::before{content:"";position:absolute;inset:0;background:linear-gradient(transparent 30%,rgba(0,0,0,.65));border-radius:12px}\n' +
      '.sbk-cat-card h4{position:relative;z-index:1;margin:0;font-size:16px;font-weight:700;color:#fff}\n' +
      '.sbk-cat-card .sbk-cat-count{position:relative;z-index:1;display:inline-block;margin-top:4px;background:rgba(255,255,255,.25);backdrop-filter:blur(4px);color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px}\n' +
      '.sbk-svc-img{width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;margin-right:14px}\n' +
      '.sbk-addon-row{display:flex;align-items:center;padding:12px 0;border-bottom:1px solid #f3f4f6}\n' +
      '.sbk-addon-row:last-child{border-bottom:none}\n' +
      '.sbk-addon-check{width:22px;height:22px;min-width:22px;accent-color:' + tc + ';cursor:pointer;flex-shrink:0;margin-right:12px}\n' +
      '.sbk-total-bar{position:sticky;bottom:0;background:#fff;border-top:2px solid #f3f4f6;padding:14px 0 0;margin-top:12px;display:flex;justify-content:space-between;align-items:center}\n' +
      '.sbk-steps-indicator{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:18px;padding-top:4px}\n' +
      '.sbk-steps-indicator .sbk-dot{width:8px;height:8px;border-radius:50%;background:#e5e7eb;transition:background .2s}\n' +
      '.sbk-steps-indicator .sbk-dot.active{background:' + tc + '}\n' +
      '.sbk-steps-indicator .sbk-dot.done{background:' + tc + ';opacity:.4}\n' +
      '.sbk-stripe-card{border:2px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;transition:border .15s}\n' +
      '.sbk-stripe-card.StripeElement--focus{border-color:' + tc + '}\n' +
      '.sbk-svc-card-inner{display:flex;align-items:center}\n' +
      '.sbk-svc-card-info{flex:1;min-width:0}\n' +

      /* Mobile responsive */
      '@media (max-width: 480px) {\n' +
      '  .sorce-chat-window { width: calc(100vw - 40px); height: calc(100vh - 120px); }\n' +
      '  .sorce-modal { max-width: 100%; margin: 0 12px; padding: 24px; }\n' +
      '  #sorce-booking-modal { width: 100%; max-width: 100%; border-radius: 12px; }\n' +
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

  // ── Booking Widget (Multi-Step) ────────────────────────────
  // Full booking experience: categories → services → addons → datetime → contact → payment → confirmation
  var bookingModalOpen = false;
  var bkOverlay = null;
  var bkContent = null;
  var bkState = null;

  function resetBkState() {
    bkState = {
      step: 'loading',
      config: null,
      categories: [],
      services: [],
      addonMap: {},
      uncategorized: [],
      hours: [],
      biz: null,
      selCategory: null,
      selService: null,
      selAddons: [],
      selDate: '',
      selTime: '',
      slots: [],
      loading: false,
      error: null,
      success: false,
      bookingNum: '',
      cust: { name: '', email: '', phone: '', notes: '' },
      totalPrice: 0,
      stripeReady: false,
      stripeInstance: null,
      cardElement: null,
      clientSecret: '',
      calMonth: new Date().getMonth(),
      calYear: new Date().getFullYear()
    };
  }

  function openBookingModal() {
    if (bookingModalOpen) return;
    if (!config) {
      var waitInterval = setInterval(function() {
        if (config) { clearInterval(waitInterval); openBookingModal(); }
      }, 100);
      return;
    }
    bookingModalOpen = true;
    resetBkState();

    bkOverlay = document.createElement('div');
    bkOverlay.id = 'sorce-booking-overlay';
    bkOverlay.innerHTML =
      '<div id="sorce-booking-modal">' +
      '<button id="sorce-booking-close" style="position:sticky;top:0;float:right;margin:12px 12px 0 0;width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;background:#f3f4f6;color:#374151;font-size:20px;display:flex;align-items:center;justify-content:center;z-index:10;">&times;</button>' +
      '<div id="sorce-booking-content" style="padding:8px 28px 28px;"></div>' +
      '</div>';
    document.body.appendChild(bkOverlay);
    bkContent = document.getElementById('sorce-booking-content');

    document.getElementById('sorce-booking-close').onclick = closeBookingModal;
    bkOverlay.addEventListener('click', function(e) { if (e.target === bkOverlay) closeBookingModal(); });
    bkOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    bkLoadData();
  }

  function closeBookingModal() {
    if (bkOverlay) bkOverlay.remove();
    bkOverlay = null;
    bkContent = null;
    document.body.style.overflow = '';
    bookingModalOpen = false;
  }

  var BK_PRIMARY; // set at render time from config

  function bkEsc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function bkFmtDate(d) { if (!d) return ''; var p = d.split('-'); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }); }

  function bkLoadData() {
    BK_PRIMARY = config.themeColor || '#d97706';
    bkState.loading = true; bkState.step = 'loading'; bkRender();
    var uid = config.userId;
    Promise.all([
      fetch(API_BASE + '/api/public/services?businessId=' + uid).then(function(r) { return r.json(); }),
      fetch(API_BASE + '/api/public/business-hours?businessId=' + uid).then(function(r) { return r.json(); }),
      fetch(API_BASE + '/api/public/business-info?businessId=' + uid).then(function(r) { return r.json(); }),
      fetch(API_BASE + '/api/public/booking-widget-config?businessId=' + uid).then(function(r) { return r.json(); })
    ]).then(function(res) {
      bkState.services = res[0].services || [];
      bkState.categories = res[0].categories || [];
      bkState.uncategorized = res[0].uncategorized || [];
      bkState.addonMap = res[0].addonMap || {};
      bkState.hours = res[1].businessHours || [];
      bkState.biz = res[2].business || null;
      bkState.config = res[3].config || null;
      bkState.loading = false;
      bkState.step = bkState.categories.length > 0 ? 'categories' : 'services';
      bkRender();
    }).catch(function() { bkState.loading = false; bkState.error = 'Failed to load booking info'; bkState.step = 'services'; bkRender(); });
  }

  function bkGetServicesByCategory(catId) {
    var cat = bkState.categories.find(function(c) { return c.id === catId; });
    if (cat && cat.services) return cat.services;
    return bkState.services.filter(function(s) { return s.category_id === catId && !s.is_addon; });
  }

  function bkGetVisibleServices() {
    if (bkState.selCategory) return bkGetServicesByCategory(bkState.selCategory.id);
    if (bkState.uncategorized.length) return bkState.uncategorized;
    return bkState.services.filter(function(s) { return !s.is_addon; });
  }

  function bkGetAddonsForService(serviceId) {
    var ids = bkState.addonMap[serviceId] || [];
    if (!ids.length) return [];
    return bkState.services.filter(function(s) { return ids.indexOf(s.id) !== -1; });
  }

  function bkCalcTotal() {
    var t = 0;
    if (bkState.selService) t += parseFloat(bkState.selService.price) || 0;
    bkState.selAddons.forEach(function(a) { t += parseFloat(a.price) || 0; });
    bkState.totalPrice = t;
  }

  function bkGetAllServiceIds() {
    var ids = [];
    if (bkState.selService) ids.push(bkState.selService.id);
    bkState.selAddons.forEach(function(a) { ids.push(a.id); });
    return ids;
  }

  function bkLoadSlots() {
    if (!bkState.selDate || !bkState.selService) return;
    bkState.loading = true; bkState.selTime = ''; bkRender();
    var ids = bkGetAllServiceIds().join(',');
    fetch(API_BASE + '/api/public/availability?businessId=' + config.userId + '&serviceIds=' + ids + '&date=' + bkState.selDate)
      .then(function(r) { return r.json(); })
      .then(function(d) { bkState.slots = d.slots || []; bkState.loading = false; bkRender(); })
      .catch(function() { bkState.loading = false; bkState.error = 'Failed to load available times'; bkRender(); });
  }

  function bkIsDateAvail(y, m, d) {
    var dt = new Date(y, m, d);
    var now = new Date(); now.setHours(0, 0, 0, 0);
    if (dt < now) return false;
    var dow = dt.getDay();
    var hr = bkState.hours.find(function(x) { return x.day_of_week === dow; });
    return !!(hr && hr.is_open);
  }

  function bkPad2(n) { return n < 10 ? '0' + n : '' + n; }

  function bkRenderCalendar() {
    var y = bkState.calYear, m = bkState.calMonth;
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var dows = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    var firstDay = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var h = '<div class="sbk-cal">';
    h += '<div class="sbk-cal-header">';
    h += '<button data-caldir="-1">&lsaquo;</button>';
    h += '<span>' + months[m] + ' ' + y + '</span>';
    h += '<button data-caldir="1">&rsaquo;</button>';
    h += '</div>';
    h += '<div class="sbk-cal-grid">';
    for (var i = 0; i < 7; i++) h += '<div class="sbk-cal-dow">' + dows[i] + '</div>';
    for (var i = 0; i < firstDay; i++) h += '<div class="sbk-cal-day"></div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var avail = bkIsDateAvail(y, m, d);
      var ds = y + '-' + bkPad2(m + 1) + '-' + bkPad2(d);
      var isToday = (new Date(y, m, d).getTime() === today.getTime());
      var isSel = (bkState.selDate === ds);
      var cls = 'sbk-cal-day';
      if (avail) cls += ' avail';
      if (isSel) cls += ' sel';
      if (isToday) cls += ' today';
      if (avail) h += '<div class="' + cls + '" data-caldate="' + ds + '">' + d + '</div>';
      else h += '<div class="' + cls + '">' + d + '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function bkNeedsPayment() {
    var cfg = bkState.config;
    if (!cfg) return false;
    if (cfg.paymentMode && cfg.paymentMode !== 'none') return !!cfg.paymentConnected;
    return !!(cfg.requirePayment && cfg.paymentConnected);
  }

  function bkGetPaymentMode() {
    var cfg = bkState.config;
    if (!cfg) return 'none';
    return cfg.paymentMode || 'none';
  }

  function bkGetDepositAmount() {
    var cfg = bkState.config;
    if (!cfg || !cfg.depositEnabled || bkGetPaymentMode() !== 'pay_at_booking') return bkState.totalPrice;
    if (cfg.depositType === 'percent') return Math.round(bkState.totalPrice * (cfg.depositAmount || 50) / 100 * 100) / 100;
    return Math.min(cfg.depositAmount || 0, bkState.totalPrice);
  }

  function bkGetContactFields() {
    var cfg = bkState.config;
    if (!cfg || !cfg.contactFields) return [
      { key: 'name', label: 'Full Name', type: 'text', required: true, enabled: true },
      { key: 'email', label: 'Email', type: 'email', required: true, enabled: true },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, enabled: true },
      { key: 'notes', label: 'Notes', type: 'textarea', required: false, enabled: true }
    ];
    return cfg.contactFields.filter(function(f) { return f.enabled; });
  }

  function bkGetStepList() {
    var steps = [];
    if (bkState.categories.length > 0) steps.push('categories');
    steps.push('services');
    if (bkState.selService && bkGetAddonsForService(bkState.selService.id).length > 0) steps.push('addons');
    steps.push('datetime');
    steps.push('contact');
    if (bkNeedsPayment()) steps.push('payment');
    steps.push('confirmation');
    return steps;
  }

  function bkGoStep(s) { bkState.step = s; bkState.error = null; bkRender(); }

  function bkGetPrevStep() {
    var steps = bkGetStepList();
    var idx = steps.indexOf(bkState.step);
    if (idx > 0) return steps[idx - 1];
    return null;
  }

  function bkSubmit() {
    var c = bkState.cust;
    var fields = bkGetContactFields();
    var missing = fields.filter(function(f) { return f.required && !c[f.key]; });
    if (missing.length) { bkState.error = 'Please fill in all required fields'; bkRender(); return; }
    bkState.loading = true; bkState.error = null; bkRender();
    var addonIds = bkState.selAddons.map(function(a) { return a.id; });
    var custInfo = { name: c.name || '', email: c.email || '', phone: c.phone || '' };
    if (c.address) custInfo.address = c.address;
    fetch(API_BASE + '/api/public/bookings/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: config.userId, serviceId: bkState.selService.id, additionalServiceIds: addonIds, bookingDate: bkState.selDate, startTime: bkState.selTime, customerInfo: custInfo, customerNotes: c.notes || '', assignmentType: 'any' })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.success) { bkState.success = true; bkState.bookingNum = d.bookingNumber; bkState.step = 'confirmation'; } else { bkState.error = d.error || 'Booking failed'; }
      bkState.loading = false; bkRender();
    }).catch(function() { bkState.loading = false; bkState.error = 'Failed to submit booking'; bkRender(); });
  }

  function bkLoadStripeJs(cb) {
    if (window.Stripe) { cb(); return; }
    var sc = document.createElement('script');
    sc.src = 'https://js.stripe.com/v3/';
    sc.onload = cb;
    sc.onerror = function() { bkState.error = 'Failed to load payment system'; bkRender(); };
    document.head.appendChild(sc);
  }

  function bkInitStripe() {
    if (!bkState.config || !bkState.config.stripePublicKey) return;
    bkLoadStripeJs(function() {
      bkState.stripeInstance = window.Stripe(bkState.config.stripePublicKey);
      var elements = bkState.stripeInstance.elements();
      bkState.cardElement = elements.create('card', { style: { base: { fontSize: '16px', color: '#374151', '::placeholder': { color: '#9ca3af' } } } });
      var el = document.querySelector('.sbk-stripe-card');
      if (el) { bkState.cardElement.mount(el); bkState.stripeReady = true; }
    });
  }

  function bkSetupPayment() {
    bkState.loading = true; bkState.error = null; bkRender();
    bkCalcTotal();
    var pMode = bkGetPaymentMode();
    var chargeAmt = pMode === 'card_on_file' ? 0 : Math.round(bkGetDepositAmount() * 100);
    fetch(API_BASE + '/api/public/bookings/payment-setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: config.userId, amount: chargeAmt, customerEmail: bkState.cust.email, paymentMode: pMode })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.clientSecret) {
        bkState.clientSecret = d.clientSecret;
        bkState.loading = false;
        bkRender();
        bkInitStripe();
      } else {
        bkState.error = d.error || 'Failed to initialize payment';
        bkState.loading = false; bkRender();
      }
    }).catch(function() { bkState.loading = false; bkState.error = 'Failed to set up payment'; bkRender(); });
  }

  function bkConfirmPayment() {
    if (!bkState.stripeInstance || !bkState.cardElement) { bkState.error = 'Payment not ready'; bkRender(); return; }
    bkState.loading = true; bkState.error = null; bkRender();
    var confirmFn = bkState.clientSecret.indexOf('seti_') === 0
      ? bkState.stripeInstance.confirmCardSetup(bkState.clientSecret, { payment_method: { card: bkState.cardElement, billing_details: { email: bkState.cust.email, name: bkState.cust.name } } })
      : bkState.stripeInstance.confirmCardPayment(bkState.clientSecret, { payment_method: { card: bkState.cardElement, billing_details: { email: bkState.cust.email, name: bkState.cust.name } } });
    confirmFn.then(function(result) {
      if (result.error) { bkState.error = result.error.message; bkState.loading = false; bkRender(); }
      else { bkSubmit(); }
    });
  }

  function bkRenderStepDots() {
    var steps = bkGetStepList();
    var idx = steps.indexOf(bkState.step);
    if (idx < 0) return '';
    var h = '<div class="sbk-steps-indicator">';
    for (var i = 0; i < steps.length; i++) {
      var cls = 'sbk-dot';
      if (i < idx) cls += ' done';
      else if (i === idx) cls += ' active';
      h += '<div class="' + cls + '"></div>';
    }
    h += '</div>';
    return h;
  }

  function bkRenderServiceCard(s) {
    var h = '<div class="sbk-card" data-sid="' + s.id + '">';
    h += '<div class="sbk-svc-card-inner">';
    if (s.image_url) h += '<img class="sbk-svc-img" src="' + bkEsc(s.image_url) + '" alt="' + bkEsc(s.name) + '">';
    h += '<div class="sbk-svc-card-info">';
    h += '<h4>' + bkEsc(s.name) + '</h4>';
    if (s.description) h += '<p>' + bkEsc(s.description) + '</p>';
    h += '<div class="sbk-row" style="margin-top:8px"><span class="sbk-price">$' + parseFloat(s.price).toFixed(2) + '</span><span class="sbk-dur">' + s.duration_hours + 'h</span></div>';
    h += '</div></div></div>';
    return h;
  }

  function bkRender() {
    if (!bkContent) return;

    if (bkState.step === 'loading') {
      bkContent.innerHTML = '<div class="sbk-loading"><div class="sbk-spin"></div>Loading...</div>';
      return;
    }

    if (bkState.step === 'confirmation' && bkState.success) {
      bkCalcTotal();
      var ch = '';
      ch += bkRenderStepDots();
      ch += '<div class="sbk-success">';
      ch += '<div style="width:60px;height:60px;border-radius:50%;background:#d1fae5;display:flex;align-items:center;justify-content:center;margin:0 auto">';
      ch += '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>';
      ch += '<h3>Booking Confirmed!</h3>';
      ch += '<p style="color:#6b7280;margin:0 0 16px">Confirmation #' + bkState.bookingNum + '</p>';
      ch += '<div class="sbk-summary">';
      ch += '<div class="sbk-summary-row"><span>Service</span><span>' + bkEsc(bkState.selService.name) + '</span></div>';
      if (bkState.selAddons.length) {
        bkState.selAddons.forEach(function(a) {
          ch += '<div class="sbk-summary-row"><span style="color:#6b7280">+ ' + bkEsc(a.name) + '</span><span>$' + parseFloat(a.price).toFixed(2) + '</span></div>';
        });
      }
      ch += '<div class="sbk-summary-row"><span>Date</span><span>' + bkFmtDate(bkState.selDate) + '</span></div>';
      ch += '<div class="sbk-summary-row"><span>Time</span><span>' + bkState.selTime + '</span></div>';
      ch += '<div class="sbk-summary-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span style="font-weight:700">Total</span><span class="sbk-price" style="font-size:18px">$' + bkState.totalPrice.toFixed(2) + '</span></div>';
      ch += '</div>';
      ch += '<p style="font-size:14px;color:#6b7280">A confirmation email has been sent to ' + bkEsc(bkState.cust.email) + '</p>';
      ch += '<button class="sbk-btn" id="sbk-done">Done</button>';
      ch += '</div>';
      bkContent.innerHTML = ch;
      var doneBtn = document.getElementById('sbk-done');
      if (doneBtn) doneBtn.onclick = closeBookingModal;
      return;
    }

    var h = '';
    h += bkRenderStepDots();
    if (bkState.error) h += '<div class="sbk-error">' + bkEsc(bkState.error) + '</div>';

    var prev = bkGetPrevStep();

    if (bkState.step === 'categories') {
      h += '<h3 class="sbk-title">' + (bkState.biz ? bkEsc(bkState.biz.business_name) : 'Book Online') + '</h3>';
      h += '<p class="sbk-sub">Select a category to get started</p>';
      if (!bkState.categories.length) {
        h += '<p style="color:#9ca3af;text-align:center;padding:20px">No categories available.</p>';
      } else {
        h += '<div class="sbk-cat-grid">';
        bkState.categories.forEach(function(cat) {
          var count = cat.services ? cat.services.length : bkGetServicesByCategory(cat.id).length;
          var bgStyle = cat.image_url ? 'background-image:url(' + bkEsc(cat.image_url) + ')' : 'background:#374151';
          h += '<div class="sbk-cat-card" data-catid="' + cat.id + '" style="' + bgStyle + '">';
          h += '<h4>' + bkEsc(cat.name) + '</h4>';
          h += '<span class="sbk-cat-count">' + count + ' service' + (count !== 1 ? 's' : '') + '</span>';
          h += '</div>';
        });
        h += '</div>';
      }
      if (bkState.uncategorized.length) {
        h += '<p style="font-size:13px;color:#6b7280;margin:8px 0 4px">Other Services</p>';
        bkState.uncategorized.forEach(function(s) { h += bkRenderServiceCard(s); });
      }

    } else if (bkState.step === 'services') {
      if (prev) h += '<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      h += '<h3 class="sbk-title">' + (bkState.selCategory ? bkEsc(bkState.selCategory.name) : (bkState.biz ? bkEsc(bkState.biz.business_name) : 'Book Online')) + '</h3>';
      h += '<p class="sbk-sub">Select a service</p>';
      var svcs = bkGetVisibleServices();
      if (!svcs.length) h += '<p style="color:#9ca3af;text-align:center;padding:20px">No services available.</p>';
      svcs.forEach(function(s) { h += bkRenderServiceCard(s); });

    } else if (bkState.step === 'addons') {
      if (prev) h += '<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      h += '<h3 class="sbk-title">Add Extras</h3>';
      h += '<p class="sbk-sub">Enhance your ' + bkEsc(bkState.selService.name) + ' experience</p>';
      var addons = bkGetAddonsForService(bkState.selService.id);
      addons.forEach(function(a) {
        var checked = bkState.selAddons.find(function(sa) { return sa.id === a.id; });
        h += '<div class="sbk-addon-row">';
        h += '<input type="checkbox" class="sbk-addon-check" data-addonid="' + a.id + '"' + (checked ? ' checked' : '') + '>';
        h += '<div style="flex:1;min-width:0">';
        h += '<div style="font-weight:600;font-size:15px;color:#111">' + bkEsc(a.name) + '</div>';
        if (a.description) h += '<div style="font-size:13px;color:#6b7280;margin-top:2px">' + bkEsc(a.description) + '</div>';
        h += '</div>';
        h += '<div style="font-weight:700;color:' + BK_PRIMARY + ';font-size:15px;margin-left:12px;white-space:nowrap">+$' + parseFloat(a.price).toFixed(2) + '</div>';
        h += '</div>';
      });
      bkCalcTotal();
      h += '<div class="sbk-total-bar">';
      h += '<div><span style="font-size:13px;color:#6b7280">Total</span><br><span style="font-size:20px;font-weight:700;color:#111">$' + bkState.totalPrice.toFixed(2) + '</span></div>';
      h += '<button class="sbk-btn" style="width:auto;padding:14px 32px;margin:0" data-gonext="datetime">Continue &rarr;</button>';
      h += '</div>';

    } else if (bkState.step === 'datetime') {
      if (prev) h += '<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      h += '<h3 class="sbk-title">Choose Date & Time</h3>';
      bkCalcTotal();
      h += '<div class="sbk-summary" style="padding:12px 14px;margin-bottom:14px">';
      h += '<div class="sbk-row"><span style="font-weight:600">' + bkEsc(bkState.selService.name) + '</span><span class="sbk-price" style="font-size:16px">$' + bkState.totalPrice.toFixed(2) + '</span></div>';
      if (bkState.selAddons.length) {
        bkState.selAddons.forEach(function(a) {
          h += '<div class="sbk-row" style="margin-top:4px"><span style="font-size:13px;color:#6b7280">+ ' + bkEsc(a.name) + '</span><span style="font-size:13px;color:#6b7280">$' + parseFloat(a.price).toFixed(2) + '</span></div>';
        });
      }
      h += '</div>';
      h += bkRenderCalendar();
      if (bkState.selDate) {
        h += '<div class="sbk-times-section">';
        h += '<label class="sbk-label">Available Times for ' + bkFmtDate(bkState.selDate) + '</label>';
        if (bkState.loading) h += '<div class="sbk-loading" style="padding:20px"><div class="sbk-spin"></div></div>';
        else if (bkState.slots.length) {
          h += '<div class="sbk-slots">';
          bkState.slots.forEach(function(s) { h += '<div class="sbk-slot' + (bkState.selTime === s.time ? ' sel' : '') + '" data-time="' + s.time + '">' + s.displayTime + '</div>'; });
          h += '</div>';
        } else h += '<p style="color:#9ca3af;font-size:14px">No available times for this date.</p>';
        h += '</div>';
      }
      if (bkState.selDate && bkState.selTime) {
        h += '<button class="sbk-btn" data-gonext="contact">Continue &rarr;</button>';
      }

    } else if (bkState.step === 'contact') {
      if (prev) h += '<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      h += '<h3 class="sbk-title">Your Information</h3>';
      bkCalcTotal();
      var contactPMode = bkGetPaymentMode();
      h += '<div class="sbk-summary">';
      h += '<div class="sbk-summary-row"><span>Service</span><span>' + bkEsc(bkState.selService.name) + '</span></div>';
      if (bkState.selAddons.length) {
        bkState.selAddons.forEach(function(a) {
          h += '<div class="sbk-summary-row"><span style="color:#6b7280">+ ' + bkEsc(a.name) + '</span><span>$' + parseFloat(a.price).toFixed(2) + '</span></div>';
        });
      }
      var contactBizLoc = [bkState.biz && bkState.biz.address, bkState.biz && bkState.biz.city, bkState.biz && bkState.biz.state].filter(Boolean).join(', ');
      if (contactBizLoc) h += '<div class="sbk-summary-row"><span>Location</span><span style="text-align:right;max-width:60%">' + bkEsc(contactBizLoc) + '</span></div>';
      h += '<div class="sbk-summary-row"><span>Date</span><span>' + bkFmtDate(bkState.selDate) + '</span></div>';
      h += '<div class="sbk-summary-row"><span>Time</span><span>' + (function() { var p = bkState.selTime.split(':'); var hr = parseInt(p[0]); var mn = p[1]; return (hr % 12 || 12) + ':' + mn + ' ' + (hr >= 12 ? 'PM' : 'AM'); })() + '</span></div>';
      if (bkState.taxAmount > 0) {
        h += '<div class="sbk-summary-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span style="color:#6b7280">Subtotal</span><span>$' + bkState.subtotal.toFixed(2) + '</span></div>';
        h += '<div class="sbk-summary-row"><span style="color:#6b7280">Tax (' + (bkState.taxRate * 100).toFixed(2).replace(/\.?0+$/, '') + '%)</span><span>$' + bkState.taxAmount.toFixed(2) + '</span></div>';
        h += '<div class="sbk-summary-row" style="padding-top:6px"><span style="font-weight:700">Total</span><span class="sbk-price" style="font-size:18px">$' + bkState.totalPrice.toFixed(2) + '</span></div>';
      } else {
        h += '<div class="sbk-summary-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span style="font-weight:700">Total</span><span class="sbk-price" style="font-size:18px">$' + bkState.totalPrice.toFixed(2) + '</span></div>';
      }
      if (contactPMode === 'card_on_file') {
        h += '<div class="sbk-summary-row" style="padding-top:6px;border-top:1px solid #e5e7eb;margin-top:4px"><span style="font-weight:700;color:#059669">Due Today</span><span style="font-weight:700;color:#059669;font-size:18px">$0.00</span></div>';
      }
      h += '</div>';
      if (contactPMode === 'card_on_file') {
        h += '<div style="display:flex;align-items:flex-start;gap:8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px;color:#1e40af"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg><span>A card on file is required to confirm your booking. <strong>Your card will not be charged today.</strong></span></div>';
      }
      var cfields = bkGetContactFields();
      cfields.forEach(function(f) {
        var reqMark = f.required ? '<span class="sbk-req">*</span>' : '';
        h += '<label class="sbk-label">' + bkEsc(f.label) + ' ' + reqMark + '</label>';
        if (f.type === 'textarea') {
          h += '<textarea class="sbk-input" data-field="' + f.key + '" rows="2" placeholder="' + bkEsc(f.label) + '..." style="resize:vertical">' + bkEsc(bkState.cust[f.key] || '') + '</textarea>';
        } else {
          h += '<input class="sbk-input" data-field="' + f.key + '" type="' + (f.type || 'text') + '" value="' + bkEsc(bkState.cust[f.key] || '') + '" placeholder="' + bkEsc(f.label) + '...">';
        }
      });
      if (bkNeedsPayment()) {
        h += '<button class="sbk-btn" id="sbk-to-payment"' + (bkState.loading ? ' disabled' : '') + '>Continue to Payment &rarr;</button>';
      } else {
        h += '<button class="sbk-btn" id="sbk-submit"' + (bkState.loading ? ' disabled' : '') + '>' + (bkState.loading ? '<span class="sbk-spin" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></span>Confirming...' : 'Confirm Booking') + '</button>';
      }
      h += '<p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:10px">You\'ll receive a confirmation email</p>';

    } else if (bkState.step === 'payment') {
      if (prev) h += '<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      var pMode = bkGetPaymentMode();
      h += '<h3 class="sbk-title">' + (pMode === 'card_on_file' ? 'Save Card' : 'Payment') + '</h3>';
      h += '<p class="sbk-sub">' + (pMode === 'card_on_file' ? 'Your card will be saved securely but not charged now' : 'Enter your payment details') + '</p>';
      bkCalcTotal();
      var depAmt = bkGetDepositAmount();
      h += '<div class="sbk-summary" style="margin-bottom:20px">';
      if (pMode === 'card_on_file') {
        h += '<div class="sbk-summary-row" style="font-weight:700"><span>Service Total</span><span class="sbk-price" style="font-size:18px">$' + bkState.totalPrice.toFixed(2) + '</span></div>';
        h += '<div class="sbk-summary-row" style="font-size:13px;color:#6b7280"><span>Charged at appointment</span></div>';
      } else {
        h += '<div class="sbk-summary-row" style="font-weight:700"><span>Due Now</span><span class="sbk-price" style="font-size:18px">$' + depAmt.toFixed(2) + '</span></div>';
        if (depAmt < bkState.totalPrice) {
          h += '<div class="sbk-summary-row" style="font-size:13px;color:#6b7280"><span>Remainder due at appointment</span><span>$' + (bkState.totalPrice - depAmt).toFixed(2) + '</span></div>';
        }
      }
      h += '</div>';
      if (bkState.loading) {
        h += '<div class="sbk-loading" style="padding:20px"><div class="sbk-spin"></div>Setting up payment...</div>';
      } else {
        h += '<label class="sbk-label">Card Details</label>';
        h += '<div class="sbk-stripe-card"></div>';
        if (pMode === 'card_on_file') {
          h += '<button class="sbk-btn" id="sbk-pay">Save Card & Confirm</button>';
        } else {
          h += '<button class="sbk-btn" id="sbk-pay">Pay $' + depAmt.toFixed(2) + '</button>';
        }
      }
      h += '<p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:10px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>Secured by Stripe</p>';
    }

    bkContent.innerHTML = h;
    bkBindEvents();
  }

  function bkBindEvents() {
    if (!bkContent) return;

    // Category clicks
    bkContent.querySelectorAll('.sbk-cat-card').forEach(function(el) {
      el.onclick = function() {
        var cid = parseInt(el.getAttribute('data-catid'));
        bkState.selCategory = bkState.categories.find(function(c) { return c.id === cid; }) || null;
        bkGoStep('services');
      };
    });

    // Service clicks
    bkContent.querySelectorAll('.sbk-card[data-sid]').forEach(function(el) {
      el.onclick = function() {
        var sid = parseInt(el.getAttribute('data-sid'));
        bkState.selService = bkState.services.find(function(s) { return s.id === sid; });
        if (!bkState.selService) {
          bkState.selService = bkState.uncategorized.find(function(s) { return s.id === sid; });
        }
        bkState.selAddons = [];
        bkCalcTotal();
        var addons = bkGetAddonsForService(bkState.selService.id);
        if (addons.length > 0) { bkGoStep('addons'); } else { bkGoStep('datetime'); }
      };
    });

    // Addon checkboxes
    bkContent.querySelectorAll('.sbk-addon-check').forEach(function(el) {
      el.onchange = function() {
        var aid = parseInt(el.getAttribute('data-addonid'));
        var addon = bkState.services.find(function(s) { return s.id === aid; });
        if (!addon) return;
        if (el.checked) { bkState.selAddons.push(addon); } else { bkState.selAddons = bkState.selAddons.filter(function(a) { return a.id !== aid; }); }
        bkCalcTotal();
        var totalBar = bkContent.querySelector('.sbk-total-bar');
        if (totalBar) {
          var priceEl = totalBar.querySelector('span[style*="font-size:20px"]');
          if (priceEl) priceEl.textContent = '$' + bkState.totalPrice.toFixed(2);
        }
      };
    });

    // Calendar nav arrows
    bkContent.querySelectorAll('[data-caldir]').forEach(function(el) {
      el.onclick = function() {
        var dir = parseInt(el.getAttribute('data-caldir'));
        bkState.calMonth += dir;
        if (bkState.calMonth > 11) { bkState.calMonth = 0; bkState.calYear++; }
        if (bkState.calMonth < 0) { bkState.calMonth = 11; bkState.calYear--; }
        bkRender();
      };
    });

    // Calendar date clicks
    bkContent.querySelectorAll('[data-caldate]').forEach(function(el) {
      el.onclick = function() {
        bkState.selDate = el.getAttribute('data-caldate');
        bkState.selTime = '';
        bkLoadSlots();
      };
    });

    // Time slots
    bkContent.querySelectorAll('.sbk-slot').forEach(function(el) {
      el.onclick = function() { bkState.selTime = el.getAttribute('data-time'); bkRender(); };
    });

    // Go next
    bkContent.querySelectorAll('[data-gonext]').forEach(function(el) {
      el.onclick = function() { bkGoStep(el.getAttribute('data-gonext')); };
    });

    // Go back
    bkContent.querySelectorAll('[data-goback]').forEach(function(el) {
      el.onclick = function() {
        var p = bkGetPrevStep();
        if (p) bkGoStep(p);
      };
    });

    // Input fields
    bkContent.querySelectorAll('[data-field]').forEach(function(el) {
      el.oninput = function() { bkState.cust[el.getAttribute('data-field')] = el.value; };
    });

    // Submit button (no payment)
    var submitEl = document.getElementById('sbk-submit');
    if (submitEl) submitEl.onclick = bkSubmit;

    // To payment button
    var toPayEl = document.getElementById('sbk-to-payment');
    if (toPayEl) toPayEl.onclick = function() {
      var c = bkState.cust;
      if (!c.name || !c.email || !c.phone) { bkState.error = 'Please fill in all required fields'; bkRender(); return; }
      bkGoStep('payment');
      bkSetupPayment();
    };

    // Pay button
    var payEl = document.getElementById('sbk-pay');
    if (payEl) payEl.onclick = bkConfirmPayment;
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

  // Returns true if this page/element should never have its form replaced —
  // checkout flows, cart pages, login/account pages, or gift card pages on any platform.
  function isGiftCardContext(el) {
    var url = window.location.href.toLowerCase();
    var title = document.title.toLowerCase();

    // ── Checkout / cart / payment pages (all platforms) ──────────────────────
    if (/\/(checkout|cart|bag|order-confirm|payment|pay\b|billing|shipping)(\/?$|\/)/.test(url)) return true;
    // Squarespace commerce checkout
    if (/\/commerce\/checkout/.test(url)) return true;
    // Shopify
    if (/\.myshopify\.com.*\/(cart|checkout)/.test(url)) return true;
    // WooCommerce
    if (/\/(wp\/?)?checkout\/?$/.test(url)) return true;
    // BigCommerce
    if (/\/checkout\//.test(url)) return true;

    // ── Login / account / signup pages ───────────────────────────────────────
    if (/\/(login|log-in|sign-in|signin|signup|sign-up|register|account|my-account|password)(\/|$|\?)/.test(url)) return true;

    // ── Gift card page patterns ───────────────────────────────────────────────
    if (/gift[_-]?card|giftcard|gift.certificate/i.test(url)) return true;
    if (/gift card|gift certificate|e-?gift/i.test(title)) return true;

    // Check page headings for gift card mentions
    var headings = document.querySelectorAll('h1, h2');
    for (var hi = 0; hi < headings.length; hi++) {
      if (/gift card|gift certificate|e-?gift/i.test(headings[hi].textContent)) return true;
    }

    // Check the element's immediate section context
    if (el) {
      var nearby = (el.closest('section, article, main, [data-mesh-id], [data-block-type], .sqs-block') || el);
      if (/gift card|gift certificate|e-?gift/i.test((nearby.textContent || '').slice(0, 500))) return true;
    }

    return false;
  }

  var INPUT_SELECTOR = [
    // Standard HTML inputs
    'input[type="text"]', 'input[type="email"]', 'input[type="tel"]',
    'input[type="number"]', 'input:not([type])',
    'textarea',
    // ARIA / accessible inputs (Wix, Webflow)
    '[role="textbox"]', '[contenteditable="true"]',
    // Squarespace
    '.field-element',
    // Webflow
    '.w-input',
    // Contact Form 7
    '.wpcf7-form-control:not([type="submit"]):not([type="checkbox"]):not([type="radio"])',
    // Gravity Forms
    '.gfield input[type="text"], .gfield input[type="email"], .gfield input[type="tel"], .gfield textarea',
    // Elementor
    '.elementor-field-type-text input, .elementor-field-type-email input, .elementor-field-type-tel input, .elementor-field-type-textarea textarea'
  ].join(', ');

  function isContactForm(form) {
    if (isGiftCardContext(form)) return false;
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
    var inputs = form.querySelectorAll(INPUT_SELECTOR);
    return inputs.length >= 2;
  }

  // Wix/Squarespace often don't use <form> — detect form-like containers
  function isFormLikeContainer(el) {
    if (el.tagName === 'FORM') return false; // already handled
    if (isGiftCardContext(el)) return false;
    var inputs = el.querySelectorAll(INPUT_SELECTOR);
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
    wrapper.setAttribute('data-sorce-replaced', 'true');
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

  function isSorceOwned(el) {
    return el.closest && (el.closest('.sorce-replaced-form') || el.closest('.sorce-modal-overlay') || el.closest('#sorce-embed-container') || el.closest('[data-sorce-form]'));
  }

  function scanAndReplaceForms() {
    var replaced = 0;

    // Standard <form> elements
    var allForms = document.querySelectorAll('form:not([data-sorce-replaced])');
    for (var i = 0; i < allForms.length; i++) {
      if (isSorceOwned(allForms[i])) continue;
      if (!isContactForm(allForms[i])) continue;
      if (replaceFormElement(allForms[i])) replaced++;
    }

    // Platform-specific form containers (no <form> tag, or form tag with platform wrapper needed)
    var divs = document.querySelectorAll(
      // ── Wix ──────────────────────────────────────────────────────────────────
      '[data-mesh-id], [data-hook*="form"], [data-hook*="contact"], ' +

      // ── Squarespace ──────────────────────────────────────────────────────────
      // data-block-type="9" = form block; .sqs-block-form = SS form wrapper
      '[data-block-type="9"], .sqs-block-form, .form-wrapper, ' +

      // ── WordPress: Contact Form 7, Gravity Forms, WPForms, Ninja Forms ───────
      '[class*="wpcf7"], [class*="gform_wrapper"], ' +
      '[class*="wpforms-form"], [class*="wpforms-container"], ' +
      '[class*="nf-form-cont"], [class*="ninja-forms"], ' +
      '[class*="frm_form"], ' +                          // Formidable Forms
      '[class*="mc4wp"], [class*="mailchimp"], ' +        // Mailchimp for WordPress

      // ── WordPress page builders ───────────────────────────────────────────────
      '[class*="elementor-form"], [class*="elementor-widget-form"], ' +
      '[class*="et_pb_contact"], ' +                     // Divi
      '[class*="fl-form"], ' +                           // Beaver Builder
      '[class*="vc_contact_form"], ' +                   // WPBakery

      // ── Webflow ───────────────────────────────────────────────────────────────
      '.w-form, [class*="w-form"], ' +

      // ── Weebly / Square Online ────────────────────────────────────────────────
      '[class*="wsite-form"], [class*="sqsp-form"], ' +

      // ── GoDaddy / Showit / Jimdo ──────────────────────────────────────────────
      '[class*="cc-form"], [class*="formBlock"], ' +

      // ── Shopify (contact page template) ──────────────────────────────────────
      '.contact__form, [action*="/contact"][method], ' +

      // ── Generic patterns (catch-all for any other builder) ────────────────────
      '[class*="form"], [class*="Form"], ' +
      '[class*="contact"], [class*="Contact"], ' +
      '[id*="form"], [id*="contact"], ' +
      '[aria-label*="form" i], [aria-label*="contact" i]'
    );
    for (var j = 0; j < divs.length; j++) {
      if (isSorceOwned(divs[j])) continue;
      if (divs[j].getAttribute('data-sorce-replaced')) continue;
      if (divs[j].querySelector('[data-sorce-form]')) continue;
      if (!isFormLikeContainer(divs[j])) continue;
      if (replaceFormElement(divs[j])) replaced++;
    }

    return replaced;
  }

  function createLeadFormFab() {
    if (leadFormFabCreated) return;
    leadFormFabCreated = true;
    var container = getOrCreateContainer();
    var fab = document.createElement('button');
    fab.className = 'sorce-fab sorce-fab-lead';
    fab.title = 'Get a Quote';
    fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><span class="sorce-fab-label">Get a Quote</span>';
    fab.onclick = openLeadForm;
    container.insertBefore(fab, container.firstChild);
  }

  function injectLeadForm() {
    // Always do an immediate scan first, but do NOT bail out early even if forms
    // are found — Wix SPA navigation will re-render the page and restore original
    // forms, so we need the MutationObserver running persistently regardless.
    var everReplaced = scanAndReplaceForms() > 0;

    // Retry — Wix lazy-loads form components after scroll or after framework hydration.
    // Extended timing covers slow Wix sites.
    var retries = [500, 1500, 3000, 6000, 10000, 15000, 20000];
    var retryIdx = 0;
    function retryReplace() {
      if (retryIdx >= retries.length) {
        // All retries exhausted — if we never replaced an inline form, show FAB fallback
        if (!everReplaced) createLeadFormFab();
        return;
      }
      setTimeout(function() {
        var found = scanAndReplaceForms();
        if (found > 0) everReplaced = true;
        retryIdx++;
        retryReplace();
      }, retries[retryIdx]);
    }
    retryReplace();

    // MutationObserver — catches Wix forms that render on scroll, after SPA navigation,
    // or whenever Wix's framework re-hydrates and restores the original form.
    if (typeof MutationObserver !== 'undefined') {
      var formObserverDebounce = null;
      var formObserver = new MutationObserver(function(mutations) {
        var relevant = false;
        for (var i = 0; i < mutations.length; i++) {
          var t = mutations[i].target;
          if (t.closest && (t.closest('[data-sorce-form]') || t.closest('.sorce-replaced-form') || t.closest('#sorce-embed-container'))) continue;
          if (mutations[i].addedNodes.length > 0) { relevant = true; break; }
        }
        if (!relevant) return;
        clearTimeout(formObserverDebounce);
        formObserverDebounce = setTimeout(function() {
          scanAndReplaceForms();
        }, 600);
      });
      formObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ── Booking Button Hijack ───────────────────────────────
  // Finds existing "Book Now", "Book Online", "Schedule" buttons/links
  // and rewires them to open the SORCE booking modal instead.

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
          openBookingModal();
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

  // Default labels/placeholders used when not customized
  var FIELD_DEFAULTS = {
    name:    { label: 'Name',               placeholder: 'Your name',                     type: 'text',     required: true },
    email:   { label: 'Email',              placeholder: 'your@email.com',                type: 'email',    required: true },
    phone:   { label: 'Phone',              placeholder: '(555) 123-4567',                type: 'tel',      required: false },
    service: { label: 'Service Interested In', placeholder: 'What service are you looking for?', type: 'text', required: false },
    message: { label: 'Message',            placeholder: 'Tell us about what you need...', type: 'textarea', required: false }
  };

  function buildLeadFormHTML(fields, tc, submitText, title) {
    var formTitle = title || config.leadFormTitle || 'Get a Free Quote';
    var desc = config.leadFormDescription || "Fill out the form and we'll get back to you shortly.";
    var html = '<h3 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">' +
      escapeHtml(formTitle) + '</h3>' +
      '<p style="margin:0 0 16px;color:#6b7280;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">' + escapeHtml(desc) + '</p>';

    var inputStyle = 'width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:inherit;color:#1f2937;background:white;';
    var labelStyle = 'display:block;margin-bottom:6px;font-size:14px;font-weight:500;color:#374151;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;';
    var groupStyle = 'margin-bottom:14px;';

    // fields may be an array of strings ['name','email'] or objects [{id:'name',label:'Name',...}]
    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      var fid = (typeof f === 'string') ? f : f.id;
      var def = FIELD_DEFAULTS[fid] || { label: fid, placeholder: '', type: 'text', required: false };
      var flabel = (typeof f === 'object' && f.label) ? f.label : def.label;
      var fplaceholder = (typeof f === 'object' && f.placeholder) ? f.placeholder : def.placeholder;
      var frequired = (typeof f === 'object' && f.required !== undefined) ? f.required : def.required;
      var reqAttrs = frequired ? ' required data-required="true"' : '';
      if (fid === 'message') {
        html += '<div style="' + groupStyle + '"><label style="' + labelStyle + '">' + escapeHtml(flabel) + (frequired ? ' <span style="color:#ef4444">*</span>' : '') + '</label><textarea data-sorce-field="message" rows="3" placeholder="' + escapeHtml(fplaceholder) + '" style="' + inputStyle + 'resize:vertical;"' + reqAttrs + '></textarea></div>';
      } else {
        html += '<div style="' + groupStyle + '"><label style="' + labelStyle + '">' + escapeHtml(flabel) + (frequired ? ' <span style="color:#ef4444">*</span>' : '') + '</label><input type="' + def.type + '" data-sorce-field="' + fid + '" placeholder="' + escapeHtml(fplaceholder) + '" style="' + inputStyle + '"' + reqAttrs + '></div>';
      }
    }

    var bizName = (config && config.businessName) ? config.businessName : 'our team';
    html += '<div style="' + groupStyle + 'display:flex;align-items:flex-start;gap:10px"><input type="checkbox" data-sorce-field="sms" required style="margin-top:2px;width:20px;height:20px;min-width:20px;flex-shrink:0;cursor:pointer;accent-color:' + tc + ';"><label style="font-size:12px;color:#6b7280;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">I consent to receive text messages from ' + escapeHtml(bizName) + ' about services I\'m interested in. Message &amp; data rates may apply. Message frequency may vary. Reply STOP to unsubscribe.</label></div>';
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

    var requiredEls = container.querySelectorAll('[data-sorce-field][data-required="true"]');
    var missingRequired = false;
    for (var ri = 0; ri < requiredEls.length; ri++) {
      if (!requiredEls[ri].value.trim()) { missingRequired = true; break; }
    }
    if (missingRequired || !name.trim() || !email.trim()) {
      alert('Please fill in all required fields.');
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
    var isProcessing = false;
    var observer = new MutationObserver(function(mutations) {
      if (isProcessing) return;

      // Only act if nodes were added outside our own containers
      var dominated = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) {
          var target = mutations[i].target;
          if (target.closest && (target.closest('[data-sorce-form]') || target.closest('.sorce-replaced-form') || target.closest('#sorce-embed-container') || target.closest('.sorce-modal-overlay'))) continue;
          dominated = true;
          break;
        }
      }
      if (!dominated) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        isProcessing = true;
        if (config.bookingEnabled) hijackBookingButtons();
        if (config.leadFormEnabled) scanAndReplaceForms();
        isProcessing = false;
      }, 500);
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
