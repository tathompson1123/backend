// Notifications for SORCE's own discovery calls (not customer bookings).
// These send from SORCE's Twilio Messaging Service and SendGrid sender rather
// than a per-user number, because the recipient is a SORCE prospect.
const { getClient } = require('./twilio');
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const SITE_URL = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
const { TRANSACTIONAL_EMAIL } = require('./emailFrom');
const FROM_EMAIL = TRANSACTIONAL_EMAIL;
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

// Answers "will the confirmation text actually arrive?" before a call is booked, rather
// than after. Deliberately sits next to sendDiscoverySMS and mirrors its branching, so a
// change to one is obvious next to the other.
//
// Config alone can't answer it, which is the whole reason this does network calls:
//
//  - A typo'd SORCE_SMS_FROM looks perfectly healthy to a config check and then fails at
//    send time with Twilio 21606, "not a valid sending number".
//  - Worse, a US 10DLC number whose A2P campaign isn't verified is accepted by Twilio,
//    comes back `queued`, and is then dropped by the carrier with 30034. Nothing throws.
//    dispatchConfirmations records that as a success and the badge goes green, so this is
//    the only place the problem can be caught at all.
//
// Twilio being unreachable must never block a booking, so a failed lookup degrades to
// "configured but unchecked" instead of reporting a fault that may not exist.
async function checkDiscoverySmsSetup() {
  const configured = process.env.SORCE_SMS_FROM || null;
  const poolSid = process.env.TWILIO_MESSAGING_SERVICE_SID || null;

  if (!configured && !poolSid) {
    return {
      ok: false, level: 'error', mode: 'none', from: null,
      summary: 'No confirmation text will be sent',
      detail: 'Neither SORCE_SMS_FROM nor TWILIO_MESSAGING_SERVICE_SID is set, so there is nothing to send from. The booking and its email will still go through.',
    };
  }

  if (!configured) {
    return {
      ok: true, level: 'warn', mode: 'pool', from: null,
      summary: 'Texts will go out from a shared number',
      detail: "SORCE_SMS_FROM isn't set, so Twilio picks from the Messaging Service pool — which holds customers' dedicated numbers. The prospect may be texted by an unrelated business, and because replies route on the receiving number, their answer would land in that business's account and be read by its SMS agent.",
    };
  }

  const from = toE164(configured);
  if (!from) {
    return {
      ok: false, level: 'error', mode: 'dedicated', from: configured,
      summary: 'The SORCE sending number is malformed',
      detail: `SORCE_SMS_FROM is set to "${configured}", which isn't a usable phone number.`,
    };
  }

  try {
    const client = getClient();
    const owned = await client.incomingPhoneNumbers.list({ phoneNumber: from, limit: 1 });
    if (!owned.length) {
      return {
        ok: false, level: 'error', mode: 'dedicated', from,
        summary: `${from} isn't on this Twilio account`,
        detail: `Twilio will reject the send with error 21606. Check SORCE_SMS_FROM against the numbers the account actually owns.`,
      };
    }

    // 10DLC registration travels with the number's Messaging Service, so a number's
    // campaign is only visible through whichever service holds it — never the number.
    //
    // Find that service rather than assuming TWILIO_MESSAGING_SERVICE_SID. The account has
    // more than one: that env var points at the shared pool carrying customers' dedicated
    // numbers, while SORCE's own number sits in its own service under its own campaign.
    // Checking only the configured service reported a correctly registered SORCE number as
    // unregistered, which is worse than not checking — it tells you to fix something that
    // isn't broken.
    const services = await client.messaging.v1.services.list({ limit: 20 });
    let owning = null;
    for (const svc of services) {
      const nums = await client.messaging.v1.services(svc.sid).phoneNumbers.list({ limit: 100 });
      if (nums.some(n => n.phoneNumber === from)) { owning = svc; break; }
    }

    if (!owning) {
      return {
        ok: false, level: 'warn', mode: 'dedicated', from,
        summary: `${from} is not in any Messaging Service`,
        detail: `A number outside every service has no A2P campaign behind it, so carriers will most likely drop the text with error 30034 while Twilio still reports it queued.`,
      };
    }

    const campaigns = await client.messaging.v1.services(owning.sid).usAppToPerson.list({ limit: 5 });
    const campaign = campaigns[0] || null;

    if (!campaign) {
      return {
        ok: false, level: 'warn', mode: 'dedicated', from,
        summary: `No A2P campaign on "${owning.friendlyName}"`,
        detail: `${from} sits in that Messaging Service, but it carries no US A2P campaign — carriers will most likely drop the text with error 30034.`,
      };
    }
    if (campaign.campaignStatus !== 'VERIFIED') {
      return {
        ok: false, level: 'warn', mode: 'dedicated', from,
        summary: `A2P campaign is ${campaign.campaignStatus}, not verified`,
        detail: `Texts from ${from} are likely to be dropped with error 30034 until campaign ${campaign.campaignId} on "${owning.friendlyName}" clears.`,
      };
    }

    return {
      ok: true, level: 'ok', mode: 'dedicated', from,
      summary: `Texts will send from ${from}`,
      detail: `Campaign ${campaign.campaignId} on "${owning.friendlyName}" is verified.`,
    };
  } catch (err) {
    return {
      ok: true, level: 'warn', mode: 'dedicated', from, unchecked: true,
      summary: `Set to send from ${from}, unconfirmed`,
      detail: `Couldn't reach Twilio to check the number and its campaign (${err.message}), so this is the configured value rather than a verified one.`,
    };
  }
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

// Deliberately plain, and that is a measured decision rather than an aesthetic one.
//
// The previous version was junked at a cold Outlook mailbox by two unrelated ESPs, with
// SPF, DKIM, DMARC and compauth all passing on both. A four-sentence plain email from the
// same address, same domain, through those same two providers, reached the inbox of that
// same mailbox. So nothing about the sender was the problem — the difference was entirely
// this template:
//
//   - a remote image on first contact, which is tracking-pixel shaped and was the single
//     largest thing to remove
//   - 6.6KB of nested-table chrome wrapping 975 characters of text
//   - the Zoom URL printed twice, once as a button and again as raw text
//   - a passcode sitting immediately beside a raw link, which is a credential-in-email
//     pattern filters are tuned to distrust
//   - three "what we'll cover" sales bullets in what is meant to be a confirmation
//
// So this keeps only what the prospect needs in order to attend, in markup close to what
// actually landed. If the intro video is ever recorded it goes in as a plain link — a
// thumbnail would put a remote image back and undo the fix.
function confirmationEmailHtml(call, rep) {
  const when = formatWhen(call.scheduled_at, call.timezone);
  const repName = rep?.name || 'your SORCE specialist';
  const repTitle = rep?.title || '';
  const repBio = rep?.bio || '';
  const mins = call.duration_minutes || 30;

  // The passcode gets its own paragraph rather than trailing the link. htmlToText expands
  // an anchor into "label: url", so keeping them on one line reproduced exactly the
  // url-then-credential adjacency this rewrite is meant to remove — it just moved it from
  // the HTML into the text/plain part, where filters read it just as easily. Zoom's join
  // URL already carries ?pwd=, so this line only matters to someone typing the meeting ID.
  const where = call.zoom_join_url
    ? `<p style="margin:0 0 16px;">It's on Zoom &mdash; <a href="${call.zoom_join_url}" style="color:#1d4ed8;">join here</a>. We've texted you the link as well.</p>`
      + (call.zoom_passcode ? `<p style="margin:0 0 16px;">If it asks for a passcode, it's ${call.zoom_passcode}.</p>` : '')
    : `<p style="margin:0 0 16px;">We'll call you at ${call.phone || 'the number you gave us'}.</p>`;

  const who = [repName, repTitle].filter(Boolean).join(', ');
  const video = VIDEO_URL
    ? `<p style="margin:0 0 16px;">Before we talk, here's a two-minute intro: <a href="${VIDEO_URL}" style="color:#1d4ed8;">watch it here</a>.</p>`
    : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;font-size:15px;line-height:1.55;">
    <p style="margin:0 0 16px;">Hi ${firstNameOf(call.name)},</p>
    <p style="margin:0 0 16px;">Your discovery call is confirmed for <strong>${when}</strong>, and should take about ${mins} minutes.</p>
    ${where}
    <p style="margin:0 0 16px;">You'll be speaking with ${who}.${repBio ? ` ${repBio}` : ''}</p>
    ${video}
    <p style="margin:0 0 16px;">Need to reschedule or cancel, just reply to this email and we'll sort it out.</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">SORCE Integrations</p>
  </div>
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
  checkDiscoverySmsSetup,
  sendConfirmationEmail,
  // Exported so the deliverability harness can test the real template rather than a
  // lookalike — a test on approximated HTML tells you nothing about production mail.
  confirmationEmailHtml,
  confirmationSMS,
  reminder24hSMS,
  reminder2hSMS,
};
