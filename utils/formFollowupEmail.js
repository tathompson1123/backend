// The "next steps" email a visitor gets after submitting an embed form. The owner designs
// it per form in the Embed Forms editor: heading, intro, numbered steps ("here's what
// happens next"), an optional button, and a closing line.
//
// Safety, because the recipient is whatever address an anonymous visitor typed:
//   - Only the visitor's FIRST NAME is merged in (never the message or other free text), so
//     the form cannot be used to put words of the visitor's choosing into mail we send
//     under the business's name.
//   - One per address per form per day (checked by the caller), and the form's existing
//     hourly submission cap still applies.
//   - Owner-authored text is escaped like everything else, then newlines become <br>.

const { escapeHtml: esc } = require('./escapeHtml');
const { plainEmail } = require('./emailLayout');
const textSafe = require('./textSafe');
const { TRANSACTIONAL_EMAIL } = require('./emailFrom');
const { LEAD_EMAIL_TRACKING } = require('./leadContactLinks');

const MAX_STEPS = 8;

const DEFAULT_FOLLOWUP = {
  enabled: true,
  subject: "Thanks {{first_name}} — here's what happens next",
  heading: 'We got your request, {{first_name}}!',
  intro: 'Thanks for reaching out to {{business_name}}. Here is exactly what to expect:',
  steps_title: 'What happens next',
  steps: [
    { title: 'We review your request', description: "Someone from our team looks over what you sent — usually within a few hours during business days." },
    { title: "We reach out to you", description: "We'll call or text you to confirm the details and answer any questions." },
    { title: 'We get you scheduled', description: "Once everything looks good, we lock in a time that works for you." },
  ],
  button_label: '',
  button_url: '',
  closing: 'Need something sooner? Just reply to this email.',
};

const clip = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);

function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try {
    const url = new URL(s);
    return (url.protocol === 'https:' || url.protocol === 'http:') ? url.toString() : '';
  } catch {
    return '';
  }
}

/** Normalize whatever the editor sends. Anything missing falls back to the default copy. */
function sanitizeFollowup(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const steps = Array.isArray(r.steps)
    ? r.steps.map(s => ({ title: clip(s?.title, 120), description: clip(s?.description, 500) }))
        .filter(s => s.title || s.description).slice(0, MAX_STEPS)
    : DEFAULT_FOLLOWUP.steps;
  return {
    enabled: r.enabled === undefined ? DEFAULT_FOLLOWUP.enabled : !!r.enabled,
    subject: clip(r.subject, 160) || DEFAULT_FOLLOWUP.subject,
    heading: clip(r.heading, 160),
    intro: clip(r.intro, 1000),
    steps_title: clip(r.steps_title, 80),
    steps,
    button_label: clip(r.button_label, 60),
    button_url: safeUrl(r.button_url),
    closing: clip(r.closing, 1000),
  };
}

// {{first_name}} {{name}} {{business_name}} {{form_name}} — unknown tokens render as empty.
function fill(text, vars) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

const htmlText = (text, vars) => fill(esc(text), vars).split('\n').join('<br>');

/**
 * @param {object} cfg    sanitized follow-up config
 * @param {object} ctx    { name, businessName, formName, ownerEmail }
 * @returns {{subject:string, html:string}}
 */
function renderFollowup(cfg, ctx) {
  const first = textSafe.firstWord(ctx.name) || 'there';
  const rawVars = {
    first_name: first,
    name: textSafe.singleLine(ctx.name) || first,
    business_name: textSafe.displayName(ctx.businessName || 'our team'),
    form_name: textSafe.singleLine(ctx.formName || ''),
  };
  const htmlVars = Object.fromEntries(Object.entries(rawVars).map(([k, v]) => [k, esc(v)]));

  const paragraphs = [];
  if (cfg.heading) paragraphs.push(`<strong style="font-size:18px;">${htmlText(cfg.heading, htmlVars)}</strong>`);
  if (cfg.intro) paragraphs.push(htmlText(cfg.intro, htmlVars));
  if (cfg.steps.length) {
    if (cfg.steps_title) paragraphs.push(`<strong>${htmlText(cfg.steps_title, htmlVars)}</strong>`);
    cfg.steps.forEach((s, i) => {
      paragraphs.push(
        `<strong>${i + 1}. ${htmlText(s.title, htmlVars)}</strong>`
        + (s.description ? `<br>${htmlText(s.description, htmlVars)}` : '')
      );
    });
  }
  const url = safeUrl(cfg.button_url);

  const subject = textSafe.singleLine(fill(cfg.subject, rawVars)).slice(0, 200) || `Thanks from ${rawVars.business_name}`;
  const html = plainEmail({
    paragraphs,
    action: url && cfg.button_label ? { label: esc(cfg.button_label), url: esc(url) } : undefined,
    after: cfg.closing ? [htmlText(cfg.closing, htmlVars)] : [],
    signature: esc(rawVars.business_name),
  });
  return { subject, html };
}

/**
 * Send the follow-up for a submission. Never throws.
 * @param {object} p  { sgMail, cfg, lead:{name,email}, businessName, ownerEmail, formName }
 */
async function sendFollowup({ sgMail, cfg, lead, businessName, ownerEmail, formName, to }) {
  try {
    const recipient = to || lead.email;
    if (!recipient) return false;
    const { subject, html } = renderFollowup(cfg, { name: lead.name, businessName, formName });
    await sgMail.send({
      to: recipient,
      from: { name: `${textSafe.displayName(businessName || 'Our team')} via SORCE`, email: TRANSACTIONAL_EMAIL },
      replyTo: ownerEmail ? { email: ownerEmail } : undefined,
      trackingSettings: LEAD_EMAIL_TRACKING,
      subject,
      html,
    });
    return true;
  } catch (e) {
    console.error('Embed form follow-up email error:', e.message);
    return false;
  }
}

module.exports = { DEFAULT_FOLLOWUP, MAX_STEPS, sanitizeFollowup, renderFollowup, sendFollowup };
