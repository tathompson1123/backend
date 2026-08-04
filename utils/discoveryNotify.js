// Notifications for SORCE's own discovery calls (not customer bookings).
// These send from SORCE's Twilio Messaging Service and SendGrid sender rather
// than a per-user number, because the recipient is a SORCE prospect.
const { getClient } = require('./twilio');
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const SITE_URL = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
const FROM_EMAIL = process.env.DISCOVERY_FROM_EMAIL || 'hello@sorceintegrations.com';
// TODO: replace with the real intro video once it's recorded. Anything falsy hides the block.
const VIDEO_URL = process.env.DISCOVERY_VIDEO_URL || '';
const VIDEO_THUMB = process.env.DISCOVERY_VIDEO_THUMBNAIL || `${SITE_URL}/home/hero.jpg`;

function toE164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return String(raw).startsWith('+') ? String(raw) : `+${digits}`;
}

// "Tuesday, Aug 4 at 2:30 PM EDT" in the prospect's own timezone
function formatWhen(scheduledAt, timezone = 'America/New_York') {
  const d = new Date(scheduledAt);
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      timeZone: timezone,
    }).format(d).replace(',', '').replace(' at', ' at');
  } catch {
    return d.toLocaleString('en-US');
  }
}

// SORCE_SMS_FROM must win over the Messaging Service here.
//
// purchasePhoneNumber adds every customer's dedicated number to the shared
// Messaging Service pool, so sending with only messagingServiceSid lets Twilio
// pick a number that belongs to one of our customers. The prospect would then be
// texted from some unrelated business, and worse: inbound replies route by the
// `To` number, so their reply would land on that customer's account and be fed to
// that business's AI SMS agent as if the prospect were their lead.
//
// So: send from our own number. Only fall back to the pool if there isn't one,
// and make the noise loud enough that it gets fixed.
async function sendDiscoverySMS(to, body) {
  const phone = toE164(to);
  if (!phone) throw new Error('No valid phone number');
  const client = getClient();
  // This path calls Twilio directly rather than going through sendSMS, so it needs the
  // same GSM-7 normalisation — otherwise a stray em-dash costs an extra segment on
  // every discovery text.
  const { normalizeSmsText } = require('./twilio');
  const params = { body: normalizeSmsText(body), to: phone };

  if (process.env.SORCE_SMS_FROM) {
    params.from = process.env.SORCE_SMS_FROM;
  } else if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    console.warn(
      '⚠️ SORCE_SMS_FROM is not set — this discovery text will go out from the shared ' +
      'Messaging Service pool, which contains customers\' dedicated numbers. The prospect ' +
      'may be texted from an unrelated business, and any reply will be routed to that ' +
      'business\'s account. Set SORCE_SMS_FROM to a number reserved for SORCE.'
    );
    params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    throw new Error('No SORCE_SMS_FROM or Twilio Messaging Service configured');
  }

  const result = await client.messages.create(params);
  return { sid: result.sid, status: result.status };
}

const firstNameOf = (name) => String(name || 'there').trim().split(/\s+/)[0];

// Text is the primary channel for the Zoom link on purpose: it can't land in a spam
// folder, and it's the one they'll actually have open on the day. The email repeats it.
// Every one of these falls back to the phone-call wording when there's no meeting, so
// a Zoom outage degrades to what the system did before rather than to a broken message.
//
// Keep every character in these bodies inside GSM-7 — plain hyphens, straight quotes,
// no em-dashes or emoji. One character outside it flips the whole message to UCS-2,
// which drops the per-segment limit from 153 to 67: these two reminders were costing
// three segments each instead of two and one.
function confirmationSMS(call, rep) {
  const when = formatWhen(call.scheduled_at, call.timezone);
  const who = rep?.name ? ` with ${rep.name}` : '';
  const head = `Hi ${firstNameOf(call.name)}! Your SORCE discovery call${who} is confirmed for ${when}. `;
  return call.zoom_join_url
    ? head + `Join here: ${call.zoom_join_url} (we've emailed it too). Reply STOP to opt out.`
    : head + `We'll call you on this number. Check your email for the details. Reply STOP to opt out.`;
}

function reminder24hSMS(call, rep) {
  const when = formatWhen(call.scheduled_at, call.timezone);
  const who = rep?.name ? `${rep.name} ` : 'we ';
  const head = `Hi ${firstNameOf(call.name)}, reminder about your SORCE discovery call tomorrow, ${when}. `;
  return call.zoom_join_url
    ? head + `Join here: ${call.zoom_join_url} - need to move it? Just reply.`
    : head + `${who}will be calling you. Need to move it? Just reply here.`;
}

function reminder2hSMS(call, rep) {
  const when = formatWhen(call.scheduled_at, call.timezone);
  const who = rep?.name ? `${rep.name}` : 'We';
  const head = `Hi ${firstNameOf(call.name)}, your SORCE discovery call is in about 2 hours (${when}). `;
  return call.zoom_join_url
    ? head + `Join here: ${call.zoom_join_url} - talk soon!`
    : head + `${who} will call you on this number. Talk soon!`;
}

function confirmationEmailHtml(call, rep) {
  const when = formatWhen(call.scheduled_at, call.timezone);
  const repName = rep?.name || 'Your SORCE specialist';
  const repTitle = rep?.title || 'Growth Specialist, SORCE';
  const repPhoto = rep?.photo_url || `${SITE_URL}/sorce-logo-120.png`;
  const repBio = rep?.bio || 'They work with service businesses every day on reviews, booking and lead follow-up.';

  const videoBlock = VIDEO_URL ? `
    <tr><td style="padding:0 32px 28px;">
      <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Watch this before we talk (2 min)</p>
      <a href="${VIDEO_URL}" style="display:block;text-decoration:none;">
        <img src="${VIDEO_THUMB}" alt="Watch our intro video" width="536"
             style="width:100%;max-width:536px;border-radius:12px;display:block;border:1px solid #e5e7eb;" />
        <span style="display:inline-block;margin-top:12px;background:#d97706;color:#ffffff;padding:12px 24px;
                     border-radius:8px;font-weight:bold;font-size:15px;">▶ Play the intro video</span>
      </a>
      <p style="margin:12px 0 0;font-size:13px;color:#6b7280;">A quick hello and exactly what we'll cover on the call.</p>
    </td></tr>` : `
    <tr><td style="padding:0 32px 28px;">
      <div style="border:1px dashed #d1d5db;border-radius:12px;padding:24px;text-align:center;background:#f9fafb;">
        <p style="margin:0;font-size:14px;color:#6b7280;">Our intro video is on its way — we'll send it before the call.</p>
      </div>
    </td></tr>`;

  return `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">

        <!-- bgcolor + background-color before the gradient: Outlook and several Gmail
             paths drop CSS gradients entirely, and without a solid fallback the header
             rendered as white text on a white background. Same pattern invoiceEmail
             already uses. -->
        <tr><td bgcolor="#d97706" style="background-color:#d97706;background:linear-gradient(135deg,#d97706,#2563eb);padding:32px;text-align:center;">
          <p style="margin:0;color:#ffffff;font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.9;">SORCE</p>
          <h1 style="margin:8px 0 0;color:#ffffff;font-size:26px;">Your discovery call is booked</h1>
        </td></tr>

        <tr><td style="padding:32px 32px 20px;">
          <p style="margin:0 0 16px;font-size:16px;color:#374151;">Hi ${firstNameOf(call.name)},</p>
          <p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">
            You're all set. Here are the details, plus a quick intro to who you'll be speaking with.
          </p>
        </td></tr>

        <tr><td style="padding:0 32px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">When</p>
              <p style="margin:0 0 18px;font-size:18px;font-weight:bold;color:#111827;">${when}</p>
              <p style="margin:0 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">How long</p>
              <p style="margin:0 0 18px;font-size:16px;color:#111827;">${call.duration_minutes || 30} minutes</p>
              <p style="margin:0 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Where</p>
              ${call.zoom_join_url ? `
              <p style="margin:0 0 14px;font-size:16px;color:#111827;">On Zoom — we've texted you this link too.</p>
              <!-- bgcolor + solid background-color so the button survives clients that
                   drop CSS backgrounds, same reason as the header above. -->
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td bgcolor="#2563eb" style="background-color:#2563eb;border-radius:8px;">
                  <a href="${call.zoom_join_url}"
                     style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;">
                    Join the Zoom call
                  </a>
                </td>
              </tr></table>
              <p style="margin:12px 0 0;font-size:13px;color:#6b7280;word-break:break-all;">
                Or paste this in: ${call.zoom_join_url}${call.zoom_passcode ? `<br/>Passcode: <strong>${call.zoom_passcode}</strong>` : ''}
              </p>` : `
              <p style="margin:0;font-size:16px;color:#111827;">
                We'll call you at <strong>${call.phone || 'the number you provided'}</strong>
              </p>`}
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Who you'll be speaking with</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                 style="border:1px solid #e5e7eb;border-radius:12px;">
            <tr>
              <td width="88" style="padding:16px 0 16px 16px;vertical-align:top;">
                <img src="${repPhoto}" alt="${repName}" width="72" height="72"
                     style="width:72px;height:72px;border-radius:50%;object-fit:cover;display:block;background:#f3f4f6;" />
              </td>
              <td style="padding:16px;vertical-align:top;">
                <p style="margin:0;font-size:17px;font-weight:bold;color:#111827;">${repName}</p>
                <p style="margin:2px 0 8px;font-size:14px;color:#d97706;font-weight:600;">${repTitle}</p>
                <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.5;">${repBio}</p>
              </td>
            </tr>
          </table>
        </td></tr>

        ${videoBlock}

        <tr><td style="padding:0 32px 32px;">
          <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">What we'll cover</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${[
              'Where leads are currently slipping through the cracks in your business',
              'How automated Google reviews and hands-free booking would work for you',
              'A straight answer on whether SORCE is a fit — no pressure either way',
            ].map(item => `
            <tr><td style="padding:6px 0;font-size:15px;color:#374151;line-height:1.5;">
              <span style="color:#059669;font-weight:bold;">✓</span>&nbsp; ${item}
            </td></tr>`).join('')}
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 32px;">
          <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">
            Need to reschedule or cancel? Just reply to this email and we'll sort it out.
          </p>
        </td></tr>

        <tr><td style="background:#111827;padding:24px 32px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:13px;">SORCE — built for service businesses</p>
          <p style="margin:6px 0 0;color:#6b7280;font-size:12px;">
            <a href="${SITE_URL}" style="color:#9ca3af;">sorceintegrations.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendConfirmationEmail(call, rep) {
  if (!process.env.SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not configured');
  if (!call.email) throw new Error('No email address on this call');
  await sgMail.send({
    to: call.email,
    from: { name: 'SORCE', email: FROM_EMAIL },
    replyTo: rep?.email || FROM_EMAIL,
    subject: `Your SORCE discovery call is confirmed — ${formatWhen(call.scheduled_at, call.timezone)}`,
    html: confirmationEmailHtml(call, rep),
  });
}

module.exports = {
  toE164,
  formatWhen,
  sendDiscoverySMS,
  sendConfirmationEmail,
  confirmationSMS,
  reminder24hSMS,
  reminder2hSMS,
};
