// Tap-to-text / tap-to-call for the "new lead" emails the owner receives, so a lead can be
// answered straight from the notification. One implementation so every lead email behaves
// the same: forms, landing-page embeds, chat call-backs, discovery bookings.
//
// The phone number is whatever an anonymous visitor typed. The href is therefore rebuilt
// from digits only — never the raw string — and the visible text is escaped by the caller.
// `sms:` opens the owner's own messaging app, so those texts come from their own number.

const LINK = 'color:#1d4ed8;';
const BTN = 'display:inline-block;padding:6px 14px;border-radius:6px;font-weight:600;font-size:0.85rem;text-decoration:none;margin-right:8px;';

/**
 * SendGrid settings for any email carrying these links. Click tracking rewrites every link
 * into an https redirect on SendGrid's tracking domain; a tel:/sms: link wrapped that way
 * no longer opens the dialer or messaging app. Booking emails already turn tracking off for
 * the same family of reasons (see utils/bookingEmail), lead notifications must too.
 */
const LEAD_EMAIL_TRACKING = {
  clickTracking: { enable: false, enableText: false },
  openTracking: { enable: false },
};

/** '+1XXXXXXXXXX' style value for sms:/tel: hrefs, or '' when there are no digits. */
function phoneHref(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

const API_BASE = () => (process.env.BACKEND_URL || process.env.VITE_API_URL || 'https://backend-production-ab50.up.railway.app').replace(/\/+$/, '');

/**
 * Why Text points at a SORCE page instead of straight at `sms:`: many email apps open
 * tel: links but silently ignore sms: ones (Call worked while Text did nothing). An https
 * link always opens, and from a browser page an sms: link opens the messaging app — see
 * GET /api/public/text/:phone in routes/public.js.
 */
function textPageUrl(phone) {
  const digits = phoneHref(phone).replace(/\D/g, '');
  return digits ? `${API_BASE()}/api/public/text/${digits}` : '';
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
    return `<a clicktracking="off" href="${textPageUrl(phone)}" style="${LINK}">Text</a> &middot; <a clicktracking="off" href="tel:${href}" style="${LINK}">Call</a>`;
  }
  return `<div style="margin-top:8px;">`
    + `<a clicktracking="off" href="${textPageUrl(phone)}" style="${BTN}background:#1d4ed8;color:#ffffff;">💬 Text</a>`
    + `<a clicktracking="off" href="tel:${href}" style="${BTN}background:#16a34a;color:#ffffff;">📞 Call</a>`
    + `</div>`;
}

module.exports = { phoneHref, phoneActionsHtml, textPageUrl, LEAD_EMAIL_TRACKING };
