// Inbound texts to SORCE's own number.
//
// The customer-facing webhook resolves who a message belongs to by looking up
// users.twilio_phone_number. SORCE isn't a customer and has no row there, so every
// reply to the discovery number hit "No user found" and was dropped — while the
// confirmation and reminder texts were actively inviting one ("need to move it? just
// reply"). This picks those up before that lookup and routes them to a human.
//
// Env:
//   SORCE_SMS_FROM        — the number prospects are texted from (already required)
//   SORCE_SMS_FORWARD_TO  — where replies land. Falls back per-call to the assigned
//                           rep's phone when one is on file.
const { pool } = require('../config/database');
const { sendDiscoverySMS, formatWhen } = require('./discoveryNotify');

const last10 = (n) => String(n || '').replace(/\D/g, '').slice(-10);

function isForSorceNumber(to) {
  const mine = process.env.SORCE_SMS_FROM;
  return Boolean(mine && last10(to) && last10(to) === last10(mine));
}

// Most recent discovery call for this number — the one they're almost certainly
// replying about. Upcoming beats past when both exist.
async function findCallByPhone(phone) {
  const l10 = last10(phone);
  if (l10.length !== 10) return null;
  const { rows } = await pool.query(
    `SELECT dc.*, tm.name AS rep_name, tm.email AS rep_email, tm.phone AS rep_phone
       FROM discovery_calls dc
       LEFT JOIN sorce_team_members tm ON tm.id = dc.assigned_to
      WHERE right(regexp_replace(COALESCE(dc.phone,''), '\\D', '', 'g'), 10) = $1
      ORDER BY (dc.scheduled_at >= NOW()) DESC, dc.scheduled_at DESC
      LIMIT 1`,
    [l10]
  );
  return rows[0] || null;
}

async function emailRep(call, from, body) {
  const to = call?.rep_email || process.env.DISCOVERY_NOTIFY_EMAIL;
  if (!to || !process.env.SENDGRID_API_KEY) return;
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const { transactionalFrom } = require('./emailFrom');
  const when = call?.scheduled_at ? formatWhen(call.scheduled_at, call.timezone) : null;
  await sgMail.send({
    to,
    from: transactionalFrom('SORCE'),
    replyTo: undefined,
    subject: call ? `${call.name} replied about their discovery call` : `Text reply from ${from}`,
    text: `${call ? `${call.name}${call.company ? ` (${call.company})` : ''}` : from} replied:\n\n`
      + `"${body}"\n\n`
      + (when ? `Their call: ${when}\n` : '')
      + `Text them back directly on ${from}. Replying to this email will not reach them.`,
  }).catch(e => console.error('Discovery reply email failed:', e.message));
}

// Returns true when the message was ours to handle, so the caller stops.
// optAction is passed in rather than imported to avoid a circular require with the
// webhook module that owns the keyword matching.
async function handleSorceInbound({ From, To, Body, MessageSid }, optAction = null) {
  if (!isForSorceNumber(To)) return false;

  const call = await findCallByPhone(From).catch(() => null);

  // Carrier-level STOP already blocks the number at Twilio; this is just so the reply
  // isn't forwarded to a rep as if it were a question worth answering.
  if (optAction) {
    console.log(`🔕 Opt-${optAction} from ${From} on the SORCE number${call ? ` (call ${call.id})` : ''}`);
    return true;
  }

  if (call) {
    await pool.query(
      `UPDATE discovery_calls SET last_reply_at = NOW(), last_reply_text = $2, updated_at = NOW()
        WHERE id = $1`,
      [call.id, Body]
    ).catch(e => console.error('Discovery reply log failed:', e.message));
  }

  const forwardTo = call?.rep_phone || process.env.SORCE_SMS_FORWARD_TO;
  if (forwardTo) {
    const who = call ? `${call.name}${call.company ? ` (${call.company})` : ''}` : From;
    const when = call?.scheduled_at ? ` — call ${formatWhen(call.scheduled_at, call.timezone)}` : '';
    // Their number is in the body because replying to this forward reaches SORCE's
    // number, not the prospect. Better to make the right action obvious than to build
    // a relay that quietly drops half the conversation.
    const note = `${who} replied${when}:\n\n"${Body}"\n\nText them back on ${From}`;
    try {
      await sendDiscoverySMS(forwardTo, note);
      console.log(`📨 Discovery reply from ${From} forwarded to ${forwardTo}${call ? ` (call ${call.id})` : ''}`);
    } catch (err) {
      console.error(`⚠️ Could not forward discovery reply from ${From}:`, err.message);
    }
  } else {
    console.warn(
      `⚠️ Text from ${From} to the SORCE number had nowhere to go — set SORCE_SMS_FORWARD_TO ` +
      `or put a phone on the assigned rep. Message: "${String(Body).slice(0, 120)}"`
    );
  }

  await emailRep(call, From, Body);
  return true;
}

module.exports = { handleSorceInbound, isForSorceNumber };
