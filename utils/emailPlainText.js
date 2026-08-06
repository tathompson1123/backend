// Gives every outgoing email a text/plain part.
//
// 32 of the 34 send sites were HTML-only. Gmail and Outlook both treat a missing
// text/plain alternative as a spam signal, and it matters most on a new sending
// identity that has no reputation to absorb it.
//
// This patches @sendgrid/mail once rather than editing 40 call sites. Node caches
// modules, so every file that requires '@sendgrid/mail' gets this same patched object
// — which also means an email added later is covered without anyone remembering to.
// The alternative was a mechanical rewrite of 19 files, with a chance of breaking a
// send in each one, to achieve exactly the same thing.

// Order matters: block-level tags become newlines before tags are stripped, or the
// text collapses into one unreadable paragraph.
function htmlToText(html) {
  let s = String(html);

  // Anything not meant to be read.
  s = s.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // A bare link label is useless in plain text — "Leave a Review" with no URL gives
  // the reader nothing to act on, so carry the href alongside it.
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const text = label.replace(/<[^>]+>/g, '').trim();
    if (!text) return href;
    // Skip the duplicate when the label already is the URL.
    return text === href ? href : `${text}: ${href}`;
  });

  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|h[1-6]|li|table|section)>/gi, '\n\n');
  s = s.replace(/<li\b[^>]*>/gi, '- ');
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n');
  s = s.replace(/<[^>]+>/g, '');

  // Entities that actually show up in these templates.
  s = s.replace(/&nbsp;/gi, ' ')
       .replace(/&amp;/gi, '&')
       .replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>')
       .replace(/&quot;/gi, '"')
       .replace(/&#39;|&apos;/gi, "'")
       .replace(/&mdash;/gi, '-')
       .replace(/&ndash;/gi, '-')
       .replace(/&[a-z]+;/gi, ' ');

  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Leaves the message alone unless it has html and no text. Templated sends
// (dynamic_template_data) carry no html here, so they pass through untouched — their
// text part lives in the template itself.
function addPlainText(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return msg;
  if (msg.text || !msg.html || typeof msg.html !== 'string') return msg;
  const text = htmlToText(msg.html);
  return text ? { ...msg, text } : msg;
}

// SendGrid's open tracking injects a 1x1 pixel into the HTML. SpamAssassin counts it
// as a remote image, and on a short transactional email that tips the text-to-image
// ratio far enough to fire HTML_IMAGE_ONLY_* — mail-tester docked over a point for it
// on a message containing no images of its own.
//
// Knowing whether someone opened a booking confirmation is worth almost nothing;
// having it land in the inbox is worth a lot. So default open tracking off, and only
// when the caller hasn't decided for itself. Campaigns set trackingSettings explicitly,
// so their open rates keep working untouched.
// Click tracking is the worse half of the same problem, and it was left on.
//
// The account default is click=True, so every send that doesn't opt out has its links
// rewritten to url9694.sorceintegrations.com/ls/click?upn=<350 characters of base64>.
// That branded domain has no valid certificate, so the rewritten link is emitted as
// http:// — a plain-text, 350-character, opaque redirector standing in for what should be
// a clean https://us05web.zoom.us/... link. With enableText on it lands in the text/plain
// part too, three times over, which is most of what a filter sees on a short message.
//
// A discovery confirmation that arrived in Junk at a clean Outlook mailbox carried exactly
// that: auth all passing, SCL 5, and a body dominated by obfuscated HTTP redirectors.
// It also means the prospect's Zoom link and a customer's payment link both travel through
// an untrusted HTTP hop, which is its own problem regardless of filtering.
//
// Knowing that someone clicked a booking confirmation is worth very little. Both defaults
// go off, independently, so a caller that has decided about one still gets a sane default
// for the other. Campaigns set both explicitly and keep their tracking untouched.
function defaultTrackingOff(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return msg;
  const current = msg.trackingSettings || {};
  const next = { ...current };
  let changed = false;
  if (current.openTracking === undefined) {
    next.openTracking = { enable: false };
    changed = true;
  }
  if (current.clickTracking === undefined) {
    // enableText matters as much as enable: without it the text/plain part keeps the
    // rewritten links even when the HTML is left alone.
    next.clickTracking = { enable: false, enableText: false };
    changed = true;
  }
  return changed ? { ...msg, trackingSettings: next } : msg;
}

function applyDefaults(msg) {
  return defaultTrackingOff(addPlainText(msg));
}

function applyToPayload(payload) {
  return Array.isArray(payload) ? payload.map(applyDefaults) : applyDefaults(payload);
}

let installed = false;

function installPlainTextFallback(sgMail) {
  if (installed) return;
  const mail = sgMail || require('@sendgrid/mail');
  for (const method of ['send', 'sendMultiple']) {
    if (typeof mail[method] !== 'function') continue;
    const original = mail[method].bind(mail);
    mail[method] = (payload, ...rest) => original(applyToPayload(payload), ...rest);
  }
  installed = true;
  console.log('✅ Email plain-text fallback installed');
}

module.exports = { installPlainTextFallback, htmlToText, addPlainText, defaultTrackingOff };
