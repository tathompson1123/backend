// Tap-to-text / tap-to-call for the "new lead" emails the owner receives, so a lead can be
// answered straight from the notification. One implementation so every lead email behaves
// the same: forms, landing-page embeds, chat call-backs, discovery bookings.
//
// The phone number is whatever an anonymous visitor typed. The href is therefore rebuilt
// from digits only — never the raw string — and the visible text is escaped by the caller.
// `sms:` opens the owner's own messaging app, so those texts come from their own number.

const LINK = 'color:#1d4ed8;';
const BTN = 'display:inline-block;padding:6px 14px;border-radius:6px;font-weight:600;font-size:0.85rem;text-decoration:none;margin-right:8px;';

/** '+1XXXXXXXXXX' style value for sms:/tel: hrefs, or '' when there are no digits. */
function phoneHref(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/**
 * Text + Call links for a phone number.
 * @param {string} phone
 * @param {{style?: 'button'|'inline'}} [opts] 'button' for the styled lead emails,
 *   'inline' for the plain transactional shape (utils/emailLayout), where a coloured
 *   button block is exactly what that shape avoids.
 * @returns {string} HTML, or '' when the number has no digits
 */
function phoneActionsHtml(phone, { style = 'button' } = {}) {
  const href = phoneHref(phone);
  if (!href) return '';
  if (style === 'inline') {
    return `<a href="sms:${href}" style="${LINK}">Text</a> &middot; <a href="tel:${href}" style="${LINK}">Call</a>`;
  }
  return `<div style="margin-top:8px;">`
    + `<a href="sms:${href}" style="${BTN}background:#1d4ed8;color:#ffffff;">💬 Text</a>`
    + `<a href="tel:${href}" style="${BTN}background:#16a34a;color:#ffffff;">📞 Call</a>`
    + `</div>`;
}

module.exports = { phoneHref, phoneActionsHtml };
