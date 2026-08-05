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

function applyToPayload(payload) {
  return Array.isArray(payload) ? payload.map(addPlainText) : addPlainText(payload);
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

module.exports = { installPlainTextFallback, htmlToText, addPlainText };
