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
  var bookingModalOpen = false;
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
        if (config.bookingEnabled) injectBookingWidget();
        if (config.leadFormEnabled) injectLeadForm();
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
      '.sorce-fab { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.2); transition: transform 0.2s; color: white; font-size: 24px; }\n' +
      '.sorce-fab:hover { transform: scale(1.1); }\n' +
      '.sorce-fab-chat { background: ' + tc + '; }\n' +
      '.sorce-fab-book { background: #059669; }\n' +
      '.sorce-fab-lead { background: #2563eb; }\n' +
      '.sorce-fab-label { position: absolute; ' + (config.position === 'bottom-left' ? 'left: 66px;' : 'right: 66px;') + ' background: #1f2937; color: white; padding: 6px 12px; border-radius: 8px; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.2s; }\n' +
      '.sorce-fab:hover .sorce-fab-label { opacity: 1; }\n' +

      /* Chat window */
      '.sorce-chat-window { position: fixed; bottom: 90px; ' + posOpp + ' width: 380px; height: 550px; background: white; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden; transform: scale(0); transform-origin: ' + origin + '; transition: transform 0.3s ease; z-index: 100000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n' +
      '.sorce-chat-window.open { transform: scale(1); }\n' +
      '.sorce-chat-header { background: ' + tc + '; color: white; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; }\n' +
      '.sorce-chat-header h3 { margin: 0; font-size: 16px; font-weight: 600; }\n' +
      '.sorce-chat-close { background: none; border: none; color: white; cursor: pointer; font-size: 22px; padding: 0; }\n' +
      '.sorce-chat-messages { flex: 1; overflow-y: auto; padding: 16px; background: #f9fafb; }\n' +
      '.sorce-chat-msg { margin-bottom: 12px; display: flex; }\n' +
      '.sorce-chat-msg.agent .sorce-msg-bubble { background: white; color: #1f2937; border: 1px solid #e5e7eb; }\n' +
      '.sorce-chat-msg.user .sorce-msg-bubble { background: ' + tc + '; color: white; margin-left: auto; }\n' +
      '.sorce-msg-bubble { max-width: 75%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; }\n' +
      '.sorce-chat-input-area { padding: 12px; border-top: 1px solid #e5e7eb; background: white; }\n' +
      '.sorce-chat-input { width: 100%; padding: 10px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; resize: none; box-sizing: border-box; font-family: inherit; }\n' +
      '.sorce-chat-input:focus { outline: none; border-color: ' + tc + '; }\n' +
      '.sorce-chat-send { margin-top: 8px; width: 100%; padding: 10px; background: ' + tc + '; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; }\n' +
      '.sorce-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }\n' +
      '.sorce-typing { display: flex; gap: 4px; padding: 10px 14px; }\n' +
      '.sorce-typing-dot { width: 7px; height: 7px; background: #9ca3af; border-radius: 50%; animation: sorceTyping 1.4s infinite; }\n' +
      '.sorce-typing-dot:nth-child(2) { animation-delay: 0.2s; }\n' +
      '.sorce-typing-dot:nth-child(3) { animation-delay: 0.4s; }\n' +
      '@keyframes sorceTyping { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }\n' +

      /* Booking modal */
      '.sorce-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n' +
      '.sorce-modal { background: white; border-radius: 16px; max-width: 480px; width: 90%; max-height: 90vh; overflow-y: auto; padding: 32px; box-shadow: 0 16px 48px rgba(0,0,0,0.2); }\n' +
      '.sorce-modal h2 { margin: 0 0 8px; font-size: 22px; color: #1f2937; }\n' +
      '.sorce-modal p { margin: 0 0 24px; color: #6b7280; font-size: 14px; }\n' +
      '.sorce-form-group { margin-bottom: 16px; }\n' +
      '.sorce-form-group label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151; }\n' +
      '.sorce-form-group input, .sorce-form-group select, .sorce-form-group textarea { width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; box-sizing: border-box; font-family: inherit; }\n' +
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

    // Chat FAB
    var fab = document.createElement('button');
    fab.className = 'sorce-fab sorce-fab-chat';
    fab.innerHTML = '<svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg><span class="sorce-fab-label">Chat with us</span>';
    fab.onclick = toggleChat;
    container.appendChild(fab);

    // Chat window
    var chatWindow = document.createElement('div');
    chatWindow.className = 'sorce-chat-window';
    chatWindow.id = 'sorce-chat-window';
    chatWindow.innerHTML =
      '<div class="sorce-chat-header"><h3>Chat with ' + escapeHtml(config.chat.agentName) + '</h3><button class="sorce-chat-close" onclick="document.getElementById(\'sorce-chat-window\').classList.remove(\'open\')">\u00d7</button></div>' +
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

    var fetchP = fetch(API_BASE + '/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: config.userId, conversationId: chatConversationId, message: msg })
    });

    // Show typing after brief delay
    setTimeout(function() { showChatTyping(); }, 3000);

    fetchP.then(function(r) { return r.json(); })
    .then(function(data) {
      var len = (data.reply || '').length;
      var typingMs = Math.min(Math.max(len * 150, 2000), 12000);
      setTimeout(function() {
        hideChatTyping();
        addChatMessage(data.reply, 'agent');
      }, typingMs);
    })
    .catch(function() {
      hideChatTyping();
      addChatMessage('Sorry, I had trouble connecting. Please try again.', 'agent');
    });
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

  // ── Booking Widget ─────────────────────────────────────
  function injectBookingWidget() {
    var container = getOrCreateContainer();

    var fab = document.createElement('button');
    fab.className = 'sorce-fab sorce-fab-book';
    fab.innerHTML = '<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg><span class="sorce-fab-label">' + escapeHtml(config.bookingButtonText || 'Book Online') + '</span>';
    fab.onclick = function() {
      if (config.bookingStyle === 'chat') {
        // Open chat with booking focus
        if (!chatOpen) toggleChat();
        if (!sessionStorage.getItem('sorce-chat-opened')) {
          addChatMessage(config.chat ? config.chat.greetingMessage : "Hi! I'd love to help you book an appointment.", 'agent');
          sessionStorage.setItem('sorce-chat-opened', 'true');
        }
      } else {
        openBookingModal();
      }
    };
    container.appendChild(fab);
  }

  function openBookingModal() {
    if (bookingModalOpen) return;
    bookingModalOpen = true;

    var overlay = document.createElement('div');
    overlay.className = 'sorce-modal-overlay';
    overlay.id = 'sorce-booking-overlay';
    overlay.innerHTML =
      '<div class="sorce-modal" id="sorce-booking-modal">' +
      '<h2>' + escapeHtml(config.bookingButtonText || 'Book Online') + '</h2>' +
      '<p>Select a service, date, and time to book your appointment.</p>' +
      '<div id="sorce-booking-form">' +
        '<div class="sorce-form-group"><label>Service</label><select id="sorce-book-service"><option value="">Loading services...</option></select></div>' +
        '<div class="sorce-form-group"><label>Date</label><input type="date" id="sorce-book-date" min="' + getTomorrowDate() + '"></div>' +
        '<div class="sorce-form-group" id="sorce-slots-container" style="display:none"><label>Available Times</label><div class="sorce-slots-grid" id="sorce-slots-grid"></div></div>' +
        '<div class="sorce-form-group"><label>Your Name</label><input type="text" id="sorce-book-name" placeholder="John Smith"></div>' +
        '<div class="sorce-form-group"><label>Email</label><input type="email" id="sorce-book-email" placeholder="john@example.com"></div>' +
        '<div class="sorce-form-group"><label>Phone</label><input type="tel" id="sorce-book-phone" placeholder="(555) 123-4567"></div>' +
        '<div class="sorce-form-group"><label>Notes (optional)</label><textarea id="sorce-book-notes" rows="2" placeholder="Any special requests..."></textarea></div>' +
        '<button class="sorce-btn-primary" id="sorce-book-submit" disabled>Confirm Booking</button>' +
        '<button class="sorce-btn-secondary" id="sorce-book-cancel">Cancel</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Load services
    fetch(API_BASE + '/api/embed/services/' + SITE_KEY)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var sel = document.getElementById('sorce-book-service');
        sel.innerHTML = '<option value="">Choose a service...</option>';
        (data.services || []).forEach(function(s) {
          var opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name + (s.price ? ' - $' + s.price : '');
          sel.appendChild(opt);
        });
      });

    // Wire up events
    var selectedSlot = null;

    document.getElementById('sorce-book-date').addEventListener('change', function() {
      var date = this.value;
      var serviceId = document.getElementById('sorce-book-service').value;
      if (!date) return;
      selectedSlot = null;
      loadSlots(date, serviceId);
    });

    document.getElementById('sorce-book-service').addEventListener('change', function() {
      var date = document.getElementById('sorce-book-date').value;
      selectedSlot = null;
      if (date) loadSlots(date, this.value);
    });

    function loadSlots(date, serviceId) {
      var url = API_BASE + '/api/embed/availability/' + SITE_KEY + '?date=' + date;
      if (serviceId) url += '&serviceId=' + serviceId;

      fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var container = document.getElementById('sorce-slots-container');
          var grid = document.getElementById('sorce-slots-grid');

          if (data.closed || !data.slots || data.slots.length === 0) {
            container.style.display = 'block';
            grid.innerHTML = '<p style="grid-column:1/-1;color:#6b7280;font-size:14px;">No availability on this date. Try another day.</p>';
            return;
          }

          container.style.display = 'block';
          grid.innerHTML = '';
          data.slots.forEach(function(slot) {
            var btn = document.createElement('button');
            btn.className = 'sorce-slot';
            btn.textContent = formatTime(slot.time);
            btn.onclick = function() {
              grid.querySelectorAll('.sorce-slot').forEach(function(b) { b.classList.remove('selected'); });
              btn.classList.add('selected');
              selectedSlot = slot.time;
              updateSubmitButton();
            };
            grid.appendChild(btn);
          });
        });
    }

    function updateSubmitButton() {
      var btn = document.getElementById('sorce-book-submit');
      var hasRequired = selectedSlot &&
        document.getElementById('sorce-book-service').value &&
        document.getElementById('sorce-book-date').value &&
        document.getElementById('sorce-book-name').value.trim() &&
        document.getElementById('sorce-book-email').value.trim();
      btn.disabled = !hasRequired;
    }

    // Listen for input changes to enable submit
    ['sorce-book-name', 'sorce-book-email', 'sorce-book-phone'].forEach(function(id) {
      document.getElementById(id).addEventListener('input', updateSubmitButton);
    });

    document.getElementById('sorce-book-submit').addEventListener('click', function() {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Booking...';

      fetch(API_BASE + '/api/embed/book/' + SITE_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: parseInt(document.getElementById('sorce-book-service').value),
          date: document.getElementById('sorce-book-date').value,
          startTime: selectedSlot,
          customerName: document.getElementById('sorce-book-name').value.trim(),
          customerEmail: document.getElementById('sorce-book-email').value.trim(),
          customerPhone: document.getElementById('sorce-book-phone').value.trim(),
          notes: document.getElementById('sorce-book-notes').value.trim()
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          document.getElementById('sorce-booking-modal').innerHTML =
            '<div class="sorce-success">' +
            '<div style="font-size:48px">&#10003;</div>' +
            '<h3>Booking Confirmed!</h3>' +
            '<p style="color:#6b7280">Booking #' + escapeHtml(data.bookingNumber) + '</p>' +
            '<p style="color:#6b7280;margin-top:8px">' + escapeHtml(data.message) + '</p>' +
            '<button class="sorce-btn-secondary" style="margin-top:20px" onclick="document.getElementById(\'sorce-booking-overlay\').remove()">Close</button>' +
            '</div>';
        } else {
          btn.textContent = 'Confirm Booking';
          btn.disabled = false;
          alert(data.error || 'Booking failed. Please try again.');
        }
      })
      .catch(function() {
        btn.textContent = 'Confirm Booking';
        btn.disabled = false;
        alert('Something went wrong. Please try again.');
      });
    });

    document.getElementById('sorce-book-cancel').addEventListener('click', closeBookingModal);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeBookingModal();
    });
  }

  function closeBookingModal() {
    var overlay = document.getElementById('sorce-booking-overlay');
    if (overlay) overlay.remove();
    bookingModalOpen = false;
  }

  // ── Lead Form ──────────────────────────────────────────
  function injectLeadForm() {
    var container = getOrCreateContainer();

    var fab = document.createElement('button');
    fab.className = 'sorce-fab sorce-fab-lead';
    fab.innerHTML = '<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg><span class="sorce-fab-label">' + escapeHtml(config.leadFormTitle || 'Get a Free Quote') + '</span>';
    fab.onclick = openLeadForm;
    container.appendChild(fab);
  }

  function openLeadForm() {
    if (leadFormOpen) return;
    leadFormOpen = true;

    var fields = config.leadFormFields || ['name', 'email', 'phone', 'message'];

    var html = '<h2>' + escapeHtml(config.leadFormTitle || 'Get a Free Quote') + '</h2>' +
      '<p>Fill out the form below and we\'ll get back to you shortly.</p>';

    if (fields.indexOf('name') !== -1) html += '<div class="sorce-form-group"><label>Name</label><input type="text" id="sorce-lead-name" placeholder="Your name" required></div>';
    if (fields.indexOf('email') !== -1) html += '<div class="sorce-form-group"><label>Email</label><input type="email" id="sorce-lead-email" placeholder="your@email.com" required></div>';
    if (fields.indexOf('phone') !== -1) html += '<div class="sorce-form-group"><label>Phone</label><input type="tel" id="sorce-lead-phone" placeholder="(555) 123-4567"></div>';
    if (fields.indexOf('service') !== -1) html += '<div class="sorce-form-group"><label>Service Interested In</label><input type="text" id="sorce-lead-service" placeholder="What service are you looking for?"></div>';
    if (fields.indexOf('message') !== -1) html += '<div class="sorce-form-group"><label>Message</label><textarea id="sorce-lead-message" rows="3" placeholder="Tell us about what you need..."></textarea></div>';

    html += '<div class="sorce-form-group" style="display:flex;align-items:flex-start;gap:8px"><input type="checkbox" id="sorce-lead-sms" style="margin-top:3px;width:auto"><label for="sorce-lead-sms" style="font-size:12px;color:#6b7280">I consent to receiving SMS messages about my inquiry</label></div>';
    html += '<button class="sorce-btn-primary" id="sorce-lead-submit">Submit</button>';
    html += '<button class="sorce-btn-secondary" id="sorce-lead-cancel">Cancel</button>';

    var overlay = document.createElement('div');
    overlay.className = 'sorce-modal-overlay';
    overlay.id = 'sorce-lead-overlay';
    overlay.innerHTML = '<div class="sorce-modal" id="sorce-lead-modal">' + html + '</div>';
    document.body.appendChild(overlay);

    document.getElementById('sorce-lead-submit').addEventListener('click', function() {
      var btn = this;
      var name = (document.getElementById('sorce-lead-name') || {}).value || '';
      var email = (document.getElementById('sorce-lead-email') || {}).value || '';
      var phone = (document.getElementById('sorce-lead-phone') || {}).value || '';
      var service = (document.getElementById('sorce-lead-service') || {}).value || '';
      var message = (document.getElementById('sorce-lead-message') || {}).value || '';
      var smsConsent = (document.getElementById('sorce-lead-sms') || {}).checked || false;

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
      .then(function(data) {
        document.getElementById('sorce-lead-modal').innerHTML =
          '<div class="sorce-success">' +
          '<div style="font-size:48px">&#9993;</div>' +
          '<h3>Thank You!</h3>' +
          '<p style="color:#6b7280">We\'ve received your message and will get back to you shortly.</p>' +
          '<button class="sorce-btn-secondary" style="margin-top:20px" onclick="document.getElementById(\'sorce-lead-overlay\').remove()">Close</button>' +
          '</div>';
      })
      .catch(function() {
        btn.textContent = 'Submit';
        btn.disabled = false;
        alert('Something went wrong. Please try again.');
      });
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

  function formatTime(time24) {
    var parts = time24.split(':');
    var h = parseInt(parts[0]);
    var m = parts[1];
    var ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return h + ':' + m + ' ' + ampm;
  }

  function getTomorrowDate() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  // ── Start ──────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
