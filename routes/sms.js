const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendSMS } = require('../utils/twilio');
const { classifyReplySentiment, composePositiveReply } = require('../utils/reviewAI');
const { sendPushToOwner } = require('../utils/pushNotifications');
const { sendSmsBookingConfirmationRequest, sendSmsCampaignReplyNotification } = require('../utils/bookingEmail');
const { getBusinessDateTime } = require('../utils/zipToTimezone');
const twilio = require('twilio');

// Auto-heal Twilio webhook URL for a phone number (non-blocking, fire-and-forget)
function selfHealWebhook(phoneSid, phoneNumber) {
  if (!phoneSid || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;
  setImmediate(async () => {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
      const expectedUrl = `${baseUrl}/api/sms/webhook`;
      const numberInfo = await client.incomingPhoneNumbers(phoneSid).fetch();
      if (numberInfo.smsUrl !== expectedUrl) {
        await client.incomingPhoneNumbers(phoneSid).update({
          smsUrl: expectedUrl,
          smsMethod: 'POST'
        });
        console.log(`🔧 Auto-repaired webhook for ${phoneNumber}: "${numberInfo.smsUrl}" → "${expectedUrl}"`);
      }
    } catch (err) {
      console.error('Webhook self-heal error:', err.message);
    }
  });
}

// Twilio delivery status callback — logs failures and updates the sms_messages row
router.post('/status', express.urlencoded({ extended: false }), async (req, res) => {
  res.status(200).send('OK');
  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body || {};
  if (!MessageSid) return;
  try {
    if (ErrorCode || MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      console.error(
        `❌ Twilio delivery failed sid=${MessageSid} status=${MessageStatus} ` +
        `errorCode=${ErrorCode || 'none'} errorMessage="${ErrorMessage || ''}"`
      );
    } else {
      console.log(`📬 Twilio status sid=${MessageSid} status=${MessageStatus}`);
    }
    await pool.query(
      'UPDATE sms_messages SET status = $1 WHERE twilio_message_sid = $2',
      [MessageStatus || 'unknown', MessageSid]
    );
  } catch (err) {
    console.error('SMS status callback error:', err.message);
  }
});

// Twilio webhook for incoming SMS
// Reply to Twilio immediately (its retry budget is ~15s) and do all DB + AI work async,
// so a slow Claude call or a pg hiccup can never cause a connection-failure (error 11200)
// that loses the inbound message.
router.post('/webhook', express.urlencoded({ extended: false }), (req, res) => {
  const { From, To, Body, MessageSid } = req.body;

  console.log(`📨 SMS: ${From} → ${To}: "${Body}"`);

  res.status(200).type('text/xml').send('<Response></Response>');

  setImmediate(() => {
    processInboundSms({ From, To, Body, MessageSid }).catch(err =>
      console.error('SMS webhook async error:', err.message)
    );
  });
});

// Build the set of phone formats we may have stored historically.
// Twilio gives us E.164 (+1XXXXXXXXXX), but earlier code paths stored
// 10-digit (XXXXXXXXXX) or 11-digit (1XXXXXXXXXX). Match all three.
// Carrier-standard opt-out / opt-in keywords. We match the whole trimmed body so a
// message like "please stop by Tuesday" is NOT treated as an unsubscribe.
const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const OPT_IN_KEYWORDS = new Set(['START', 'UNSTOP', 'YES', 'SUBSCRIBE']);

// Natural-language opt-outs beyond the bare carrier keywords. Customers say
// "don't text me", "lose my number", "stop replying", "take me off your list".
// Patterns run against a normalized body (lowercased, apostrophes removed,
// punctuation → spaces). Tuned to require the negation/verb to sit right next to
// the contact word so "don't forget to text me the address" does NOT match.
const OPT_OUT_PHRASES = [
  /\bstop\s+(text|messag|call|contact|email|repl|reach|send|bother)/,
  /\bquit\s+(text|messag|call|contact|email|repl|reach|send|bother)/,
  /\b(dont|do not|never)\s+(ever\s+|keep\s+|you\s+|gotta\s+)?(text|messag|call|contact|email|reach|bother|hit)/,
  /\bno\s+more\s+(text|messag|call|email|offer|promo)/,
  /\b(lose|delete|remove|drop|ditch)\s+(my\s+)?(number|info|contact)/,
  /\b(take|get)\s+me\s+off\b/,
  /\b(remove|unsubscribe|delete)\s+me\b/,
  /\bleave\s+me\s+alone\b/,
];

function normalizeForOptOut(body) {
  return String(body || '')
    .toLowerCase()
    .replace(/['’]/g, '')               // don't -> dont
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function optKeyword(body) {
  const trimmed = String(body || '').trim();
  const wholeWord = trimmed.toUpperCase().replace(/[^A-Z]/g, '');

  // Opt-in stays strict — the message must be just the keyword, so a casual
  // "yes please book me" reply doesn't silently resubscribe someone.
  if (OPT_IN_KEYWORDS.has(wholeWord)) return 'in';
  if (OPT_OUT_KEYWORDS.has(wholeWord)) return 'out';

  // Opt-out is lenient on trailing text: customers (and carriers) routinely
  // write "Stop. I moved" or "STOP texting me". If the FIRST word is an opt-out
  // keyword, honor it. A keyword later in the sentence is ignored on purpose so
  // "please stop by Tuesday" (first word PLEASE) is NOT an unsubscribe.
  const firstWord = (trimmed.toUpperCase().match(/[A-Z]+/) || [''])[0];
  if (OPT_OUT_KEYWORDS.has(firstWord)) return 'out';

  // Natural-language opt-out phrases anywhere in the message.
  const norm = normalizeForOptOut(body);
  if (OPT_OUT_PHRASES.some(re => re.test(norm))) return 'out';

  return null;
}

function phoneVariants(num) {
  if (!num) return [num];
  const digits = num.replace(/\D/g, '');
  const variants = new Set([num]);
  if (digits.length === 11 && digits.startsWith('1')) {
    variants.add('+' + digits);          // +1XXXXXXXXXX
    variants.add(digits);                // 1XXXXXXXXXX
    variants.add(digits.slice(1));       // XXXXXXXXXX
  } else if (digits.length === 10) {
    variants.add(digits);                // XXXXXXXXXX
    variants.add('1' + digits);          // 1XXXXXXXXXX
    variants.add('+1' + digits);         // +1XXXXXXXXXX
  } else if (digits) {
    variants.add(digits);
  }
  return [...variants];
}

async function processInboundSms({ From, To, Body, MessageSid }) {
  if (MessageSid) {
    const dupCheck = await pool.query(
      'SELECT id FROM sms_messages WHERE twilio_message_sid = $1 LIMIT 1',
      [MessageSid]
    );
    if (dupCheck.rows.length > 0) {
      console.log(`⚠️ Duplicate webhook for ${MessageSid} — skipping`);
      return;
    }
  }

  const userResult = await pool.query(
    'SELECT id, business_name, twilio_phone_sid FROM users WHERE twilio_phone_number = $1',
    [To]
  );

  let user;
  if (userResult.rows.length === 0) {
    console.log(`⚠️ No user found for ${To}`);
    return;
  } else if (userResult.rows.length === 1) {
    user = userResult.rows[0];
  } else {
    const leadLookup = await pool.query(
      `SELECT user_id FROM leads WHERE phone = ANY($1) AND user_id = ANY($2)
       ORDER BY created_at DESC LIMIT 1`,
      [phoneVariants(From), userResult.rows.map(r => r.id)]
    );
    user = leadLookup.rows.length > 0
      ? userResult.rows.find(r => r.id === leadLookup.rows[0].user_id)
      : userResult.rows[0];
  }

  selfHealWebhook(user.twilio_phone_sid, To);

  // ── Opt-out / opt-in handling ─────────────────────────────────────────────
  // A bare "STOP" (or START/etc.) is a list-management command, never a lead. Handle
  // it here and RETURN before the booking match or the lead agent so the AI never
  // replies to an unsubscribe — we just flip the contact's flag and send the one
  // confirmation carriers require.
  const optAction = optKeyword(Body);
  if (optAction) {
    const last10 = (From || '').replace(/\D/g, '').slice(-10);
    const unsub = optAction === 'out';
    try {
      await pool.query(
        `UPDATE customers SET sms_unsubscribed = $1
         WHERE user_id = $2 AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $3`,
        [unsub, user.id, last10]
      );
    } catch (e) {
      console.error('Opt-out flag update failed:', e.message);
    }
    // Log the inbound command for the audit trail (no lead_id — it isn't a lead).
    await pool.query(
      `INSERT INTO sms_messages
       (user_id, direction, from_number, to_number, message, twilio_message_sid, status, created_at)
       VALUES ($1, 'incoming', $2, $3, $4, $5, 'received', NOW())`,
      [user.id, From, To, Body, MessageSid]
    ).catch(() => {});

    // Send the required confirmation. Wrapped so it can't throw if the carrier has
    // already blocked the number (Twilio Advanced Opt-Out), and skipped for generic
    // "YES" which is too ambiguous to confirm a resubscribe on.
    const businessName = user.business_name || 'this business';
    const confirmation = unsub
      ? `You've been unsubscribed from ${businessName} texts. Reply START to opt back in.`
      : `You're resubscribed to ${businessName} texts. Reply STOP to unsubscribe.`;
    try {
      await sendSMS(From, confirmation, user.id);
      await pool.query(
        `INSERT INTO sms_messages
         (user_id, direction, to_number, message, created_at)
         VALUES ($1, 'outgoing', $2, $3, NOW())`,
        [user.id, From, confirmation]
      ).catch(() => {});
    } catch (e) {
      console.log(`Opt-${optAction} confirmation not sent to ${From}: ${e.message}`);
    }
    console.log(`🔕 Opt-${optAction} from ${From} for user ${user.id} (lead agent skipped)`);
    return;
  }

  // ── Google Review SMS reply handling ──────────────────────────────────────
  // If we're awaiting this customer's reply to a review opener, classify it and branch:
  // positive/neutral → thank + incentive + review link; negative → escalate to the owner.
  // Checked before the campaign/lead paths so a review reply isn't mistaken for a new lead.
  try {
    const last10rev = (From || '').replace(/\D/g, '').slice(-10);
    if (last10rev) {
      const revRes = await pool.query(
        `SELECT rr.id, rr.customer_name, c.name AS c_name,
                u.email AS owner_email, u.business_name, u.google_review_link,
                rc.incentive, rc.incentive_enabled
         FROM review_requests rr
         JOIN users u ON u.id = rr.user_id
         LEFT JOIN customers c ON c.id = rr.customer_id
         LEFT JOIN review_configs rc ON rc.user_id = rr.user_id
         WHERE rr.user_id = $1
           AND rr.status = 'awaiting_reply'
           AND right(regexp_replace(COALESCE(c.phone, rr.customer_phone, ''), '\\D', '', 'g'), 10) = $2
         ORDER BY rr.created_at DESC
         LIMIT 1`,
        [user.id, last10rev]
      );

      if (revRes.rows.length > 0) {
        const rr = revRes.rows[0];
        const firstName = ((rr.customer_name || rr.c_name || '').split(' ')[0]) || 'there';

        // Log the customer's reply against the review conversation.
        await pool.query(
          `INSERT INTO sms_messages
           (user_id, direction, from_number, to_number, message, twilio_message_sid, status, review_request_id, created_at)
           VALUES ($1, 'incoming', $2, $3, $4, $5, 'received', $6, NOW())`,
          [user.id, From, To, Body, MessageSid, rr.id]
        ).catch(() => {});

        const sentiment = await classifyReplySentiment(Body, user.id);

        if (sentiment === 'negative') {
          const escalation = `Thanks for the honest feedback, ${firstName} — I'm escalating this to our manager so we can look into it and make it right. We'll be in touch.`;
          try {
            await sendSMS(From, escalation, user.id);
            await pool.query(
              `INSERT INTO sms_messages (user_id, direction, to_number, message, review_request_id, created_at)
               VALUES ($1, 'outgoing', $2, $3, $4, NOW())`,
              [user.id, From, escalation, rr.id]
            ).catch(() => {});
          } catch (e) { console.log(`Review escalation SMS not sent to ${From}: ${e.message}`); }

          await pool.query(`UPDATE review_requests SET status = 'replied_negative' WHERE id = $1`, [rr.id]);

          // Email the owner so they can act on the unhappy customer.
          if (rr.owner_email) {
            try {
              const sgMail = require('@sendgrid/mail');
              sgMail.setApiKey(process.env.SENDGRID_API_KEY);
              await sgMail.send({
                to: rr.owner_email,
                from: { name: `${rr.business_name || 'SORCE'} via SORCE`, email: 'help@sorceintegrations.com' },
                replyTo: rr.owner_email,
                subject: `⚠️ Unhappy customer — ${firstName}`,
                text: `${rr.customer_name || rr.c_name || 'A customer'} replied negatively to your review request.\n\n`
                  + `Their message:\n"${Body}"\n\n`
                  + `We replied that you're escalating it to your manager. Reach out at ${From} if you want to act on it.`,
              });
            } catch (e) { console.log(`Owner escalation email failed: ${e.message}`); }
          }
          console.log(`🟠 Review reply NEGATIVE from ${From} (request ${rr.id}) — owner notified`);
        } else {
          // positive or neutral → send the review ask with the incentive woven in.
          const backendUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
          const trackedUrl = rr.google_review_link ? `${backendUrl}/api/public/review-click/${rr.id}` : '';
          const reply = await composePositiveReply({
            firstName,
            businessName: rr.business_name,
            incentive: rr.incentive,
            incentiveEnabled: rr.incentive_enabled,
            reviewLink: trackedUrl,
          }, user.id);
          try {
            await sendSMS(From, reply, user.id);
            await pool.query(
              `INSERT INTO sms_messages (user_id, direction, to_number, message, review_request_id, created_at)
               VALUES ($1, 'outgoing', $2, $3, $4, NOW())`,
              [user.id, From, reply, rr.id]
            ).catch(() => {});
          } catch (e) { console.log(`Review positive SMS not sent to ${From}: ${e.message}`); }

          await pool.query(
            `UPDATE review_requests SET status = $2 WHERE id = $1`,
            [rr.id, sentiment === 'neutral' ? 'replied_neutral' : 'replied_positive']
          );
          console.log(`🟢 Review reply ${sentiment.toUpperCase()} from ${From} (request ${rr.id}) — review ask sent`);
        }
        return;
      }
    }
  } catch (e) {
    console.error('Review reply handling error:', e.message);
  }

  // ── SMS campaign reply handling ───────────────────────────────────────────
  // If the most recent thing we texted this number was a marketing-campaign blast
  // (and it was recent), treat their reply as a campaign reply: drop it into the
  // Leads box and email the owner with what they said — instead of routing it to a
  // booking thread or the AI lead agent, so the owner can follow up personally.
  const replyFromLast10 = (From || '').replace(/\D/g, '').slice(-10);
  const lastOutbound = await pool.query(
    `SELECT campaign_id, message, created_at FROM sms_messages
     WHERE user_id = $1 AND direction = 'outgoing'
       AND right(regexp_replace(to_number, '\\D', '', 'g'), 10) = $2
     ORDER BY created_at DESC LIMIT 1`,
    [user.id, replyFromLast10]
  );
  const lastOut = lastOutbound.rows[0];
  const isCampaignReply = lastOut && lastOut.campaign_id != null &&
    (Date.now() - new Date(lastOut.created_at).getTime()) <= 14 * 24 * 60 * 60 * 1000;

  if (isCampaignReply) {
    // Find an existing lead for this number, or create one tagged as a campaign reply.
    let crLead = await pool.query(
      'SELECT id, name, email FROM leads WHERE phone = ANY($1) AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [phoneVariants(From), user.id]
    );
    let crLeadId;
    if (crLead.rows.length === 0) {
      // Pull the contact's name from customers if we have it, so the lead isn't just a number.
      const cust = await pool.query(
        `SELECT name FROM customers
         WHERE user_id = $1 AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $2
         LIMIT 1`,
        [user.id, replyFromLast10]
      );
      const inserted = await pool.query(
        `INSERT INTO leads (user_id, name, phone, source, status, created_at)
         VALUES ($1, $2, $3, 'sms_campaign', 'replied', CURRENT_TIMESTAMP)
         RETURNING id, name, email`,
        [user.id, cust.rows[0]?.name || From, From]
      );
      crLeadId = inserted.rows[0].id;
      crLead = inserted;
    } else {
      crLeadId = crLead.rows[0].id;
    }

    // Flag the row as emailed up front — we fire the owner email below, and this keeps
    // the one-time backfill from emailing the same reply a second time.
    await pool.query(
      `INSERT INTO sms_messages
       (lead_id, user_id, direction, from_number, to_number, message, twilio_message_sid, status, campaign_reply_emailed, created_at)
       VALUES ($1, $2, 'incoming', $3, $4, $5, $6, 'received', TRUE, CURRENT_TIMESTAMP)`,
      [crLeadId, user.id, From, To, Body, MessageSid]
    );
    await pool.query(
      `UPDATE leads SET status = 'replied', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [crLeadId]
    );

    const crName = crLead.rows[0]?.name || From;
    sendPushToOwner(user.id, 'SMS Campaign Reply', `${crName}: ${Body.slice(0, 100)}`, { leadId: crLeadId, screen: 'AdminLeads' }).catch(() => {});
    sendSmsCampaignReplyNotification({
      userId: user.id,
      leadId: crLeadId,
      customerName: crLead.rows[0]?.name || null,
      customerPhone: From,
      replyText: Body,
      campaignMessage: lastOut.message,
    }).catch(err => console.error('Campaign reply email failed:', err.message));

    console.log(`📣 Campaign reply from ${From} → lead #${crLeadId} (owner emailed, lead agent skipped)`);
    return;
  }

  // If this phone belongs to a booking customer, treat the reply as part of
  // that booking thread — never let the lead agent take over a real customer
  // conversation. Customer phone formats vary in the DB (parens, dashes, +1,
  // bare 10-digit), so match on the last 10 digits of both sides.
  const fromDigits = (From || '').replace(/\D/g, '');
  const fromLast10 = fromDigits.slice(-10);
  const bookingMatch = await pool.query(
    `SELECT id, customer_name FROM bookings
     WHERE user_id = $1
       AND customer_phone IS NOT NULL
       AND right(regexp_replace(customer_phone, '\\D', '', 'g'), 10) = $2
     ORDER BY booking_date DESC, id DESC LIMIT 1`,
    [user.id, fromLast10]
  );

  if (bookingMatch.rows.length > 0) {
    const bookingId = bookingMatch.rows[0].id;
    const customerName = bookingMatch.rows[0].customer_name || From;
    await pool.query(
      `INSERT INTO sms_messages
       (user_id, booking_id, direction, from_number, to_number, message, twilio_message_sid, status, created_at)
       VALUES ($1, $2, 'incoming', $3, $4, $5, $6, 'received', NOW())`,
      [user.id, bookingId, From, To, Body, MessageSid]
    );
    // Push the business owner
    sendPushToOwner(
      user.id,
      'New Customer Reply',
      `${customerName}: ${Body.slice(0, 100)}`,
      { bookingId, screen: 'BookingDetail' }
    ).catch(() => {});
    // Also push the employee who most recently messaged this booking (if different from owner)
    try {
      const lastSender = await pool.query(
        `SELECT sent_by_employee_id FROM sms_messages
         WHERE booking_id = $1 AND direction = 'outgoing' AND sent_by_employee_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [bookingId]
      );
      const senderEmployeeId = lastSender.rows[0]?.sent_by_employee_id;
      if (senderEmployeeId) {
        const { sendPushToEmployee } = require('../utils/pushNotifications');
        sendPushToEmployee(
          senderEmployeeId,
          'Customer Reply',
          `${customerName}: ${Body.slice(0, 100)}`,
          { bookingId, screen: 'BookingDetail' }
        ).catch(() => {});
      }
    } catch (e) {
      console.warn('Could not push reply to original sender:', e.message);
    }
    console.log(`💬 Booking reply from ${From} → booking #${bookingId} (lead agent skipped)`);
    return;
  }

  let leadResult = await pool.query(
    'SELECT id, name, email FROM leads WHERE phone = ANY($1) AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
    [phoneVariants(From), user.id]
  );

  let leadId;
  if (leadResult.rows.length === 0) {
    const newLead = await pool.query(
      `INSERT INTO leads (user_id, name, phone, source, status, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       RETURNING id, name, email`,
      [user.id, From, From, 'sms_inbound', 'new']
    );
    leadId = newLead.rows[0].id;
    leadResult = newLead;
    console.log(`📝 New lead ${leadId} from ${From}`);
  } else {
    leadId = leadResult.rows[0].id;
  }

  await pool.query(
    `INSERT INTO sms_messages
     (lead_id, user_id, direction, from_number, to_number, message, twilio_message_sid, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
    [leadId, user.id, 'incoming', From, To, Body, MessageSid]
  );

  await pool.query(
    `UPDATE leads SET status = 'replied', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [leadId]
  );

  const leadName = leadResult.rows[0]?.name || From;
  sendPushToOwner(user.id, 'New Message', `${leadName}: ${Body.slice(0, 100)}`, { leadId, screen: 'AdminLeads' }).catch(() => {});

  const configResult = await pool.query(
    'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
    [user.id, 'lead_form']
  );
  const agentEnabled = configResult.rows[0]?.config?.enabled !== false;
  if (!agentEnabled) return;

  const aiResponse = await generateAIResponse(user.id, leadId, leadResult.rows[0], Body);
  if (!aiResponse) return;

  // The agent emits a hidden BOOKING_REQUEST|service|date|time|name line once the
  // customer has agreed to a booking. We don't create a booking — we email the owner
  // to confirm it and add it to the schedule manually. Strip the token before sending.
  const bookingTokenMatch = aiResponse.match(/BOOKING_REQUEST\|([^|]*)\|([\d-]+)\|([\d:]+)\|([^|\n]+)/);
  let outgoingMessage = aiResponse.replace(/BOOKING_REQUEST\|[^\n]*\n?/g, '').trim();

  if (bookingTokenMatch) {
    const [, svcName, bookingDate, startTime, bookedName] = bookingTokenMatch;
    const customerName = (bookedName || '').trim() || leadResult.rows[0]?.name || From;
    console.log(`📅 SMS agent booking intent for lead ${leadId}: service="${svcName.trim()}" date=${bookingDate} time=${startTime} name=${customerName}`);

    // Only notify once per lead — guard against the model re-emitting the token.
    const statusRow = await pool.query('SELECT status FROM leads WHERE id = $1', [leadId]);
    const alreadyPending = statusRow.rows[0]?.status === 'booking_pending';

    if (!alreadyPending) {
      await pool.query(
        `UPDATE leads SET status = 'booking_pending', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [leadId]
      );
      sendSmsBookingConfirmationRequest({
        userId: user.id,
        leadId,
        customerName,
        customerPhone: From,
        customerEmail: leadResult.rows[0]?.email || null,
        serviceName: svcName.trim(),
        bookingDate,
        startTime,
      }).catch(err => console.error('SMS booking confirmation email failed:', err.message));
      sendPushToOwner(
        user.id,
        'Booking needs confirmation',
        `${customerName} wants ${svcName.trim()} on ${bookingDate} at ${startTime}`,
        { leadId, screen: 'AdminLeads' }
      ).catch(() => {});
    } else {
      console.log(`📅 Lead ${leadId} already booking_pending — skipping duplicate owner email`);
    }

    // If stripping the token left nothing, give the customer a friendly confirmation.
    if (!outgoingMessage) {
      outgoingMessage = `Perfect, you're all set! We'll reach out shortly to confirm the details. Thanks!`;
    }
  }

  const baseDelay = 15000 + Math.random() * 30000;
  const typingDelay = outgoingMessage.length * (25 + Math.random() * 15);
  const totalDelay = baseDelay + typingDelay;

  console.log(`⏰ AI will respond in ${Math.round(totalDelay / 1000)}s (read ${Math.round(baseDelay / 1000)}s + type ${Math.round(typingDelay / 1000)}s)`);

  setTimeout(async () => {
    try {
      await sendSMS(From, outgoingMessage, user.id);
      await pool.query(
        `INSERT INTO sms_messages
         (lead_id, user_id, direction, to_number, message, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [leadId, user.id, 'outgoing', From, outgoingMessage]
      );
      console.log(`🤖 AI replied to ${From} after ${Math.round(totalDelay / 1000)}s delay`);
    } catch (error) {
      console.error('Error sending delayed AI response:', error.message);
    }
  }, totalDelay);
}

// Generate AI Response
// firstContact: when true, this is the agent's *first* outgoing message in the
// thread — used by the SMS cron when the customer texted in before the canned
// outreach fired. The prompt skips the boilerplate intro and goes straight to
// qualifying questions.
async function generateAIResponse(userId, leadId, lead, userMessage, opts = {}) {
  try {
    const { firstContact = false, businessName = '', agentName = '' } = opts;

    // Most recent 30 messages, re-ordered chronologically for the LLM.
    // (Previously LIMIT 10 ASC always returned the oldest 10 — once a
    //  conversation passed 10 messages the bot lost memory of every
    //  recent turn and kept re-asking the same questions.)
    const historyResult = await pool.query(
      `SELECT direction, message FROM (
         SELECT direction, message, created_at FROM sms_messages
         WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 30
       ) recent ORDER BY created_at ASC`,
      [leadId]
    );

    const servicesResult = await pool.query(
      `SELECT name, price, duration_hours, description
       FROM services WHERE user_id = $1 AND active = true`,
      [userId]
    );

    const services = servicesResult.rows.map(s =>
      `${s.name} - $${s.price} - ${s.duration_hours}hrs${s.description ? ': ' + s.description : ''}`
    ).join('\n') || 'General services';

    const hoursResult = await pool.query(
      `SELECT day_of_week, is_open, open_time, close_time
       FROM business_hours WHERE user_id = $1 ORDER BY day_of_week`,
      [userId]
    );

    const businessHours = hoursResult.rows
      .filter(h => h.is_open)
      .map(h => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `${days[h.day_of_week]}: ${h.open_time}-${h.close_time}`;
      })
      .join(', ') || 'Contact us for hours';

    const conversationHistory = historyResult.rows.map(msg => ({
      role: msg.direction === 'incoming' ? 'user' : 'assistant',
      content: msg.message
    }));

    const firstContactGuidance = firstContact
      ? `

This is your FIRST outgoing reply — the customer reached out before any automated greeting went out. Skip any "Hi I'm X from Y" introduction. Acknowledge what they asked in one short clause if helpful, then ask one specific qualifying question (vehicle, service interest, timing, or location — whichever is missing and most relevant). Do not list services. Stay under 160 characters.`
      : '';

    const identityLine = firstContact && (businessName || agentName)
      ? `\nYou are ${agentName || 'the assistant'} at ${businessName || 'this business'}.`
      : '';

    // Resolve the business timezone so date math is correct (matches the chat agent).
    const bizInfoResult = await pool.query(
      `SELECT bi.state, bi.zip_code
       FROM business_information bi WHERE bi.user_id = $1`,
      [userId]
    );
    const bizDateTime = getBusinessDateTime(
      bizInfoResult.rows[0]?.state,
      bizInfoResult.rows[0]?.zip_code
    );
    const tz = bizDateTime.timezone;

    // Pin today's date so the model never guesses a weekday from training data.
    const todayLabel = bizDateTime.fullDate;

    // Build an explicit 14-day date table — the ONLY source of truth for dates.
    const dateTable = (() => {
      const lines = [];
      const now = new Date();
      for (let i = 0; i <= 14; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        const iso = d.toLocaleDateString('en-CA', { timeZone: tz });
        const weekday = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' });
        const label = d.toLocaleDateString('en-US', { timeZone: tz, month: 'long', day: 'numeric' });
        lines.push(`  ${weekday}, ${label} = ${iso}`);
      }
      return lines.join('\n');
    })();

    const systemPrompt = `You are a friendly service business AI assistant responding to customer SMS.${identityLine}

Today is ${todayLabel}. When the customer mentions a date, work out its weekday from this anchor — do not guess.

Goal: Qualify leads, answer questions, schedule appointments.
Style: Brief, conversational, SMS-friendly (under 160 chars when possible). Sound like a real human texting — casual, warm, and natural.

Rules:
- Track what the customer has already told you (date, time, address, vehicles, services). Once they confirm a detail, do not ask for it again.
- If you already confirmed a booking in a previous turn, do not re-confirm or re-ask for the same fields — just move the conversation forward (e.g., a "thanks" reply gets a brief, friendly acknowledgement, not another booking summary).
- If you were corrected on something (like a weekday), do not keep apologizing for it in later turns.

NEVER use markdown formatting. No asterisks, no dashes for bullet points, no bold text, no lists. Use plain sentences with commas, periods, exclamations, and question marks only.${firstContactGuidance}

DATES — this table is the ONLY source of truth for dates. Do NOT use your training data or calculate. When the customer says "Thursday" or "next week", find the matching weekday in this table and use that exact YYYY-MM-DD:
${dateTable}

BOOKING PROTOCOL:
- When the customer has agreed to a specific service, date, and time, AND you know their name, confirm it to them in a natural sentence (e.g. "Perfect, you're all set for Thursday at 2pm! We'll be in touch to confirm.").
- On that same reply, add a final line in EXACTLY this format (the customer never sees it — it is stripped out before sending):
BOOKING_REQUEST|<service name>|<YYYY-MM-DD>|<HH:MM 24-hour>|<customer name>
- The date MUST be copied exactly from the DATES table above for the weekday you confirmed. The time must be 24-hour (2pm = 14:00).
- Only emit BOOKING_REQUEST once you have service, date, time, and name. If anything is missing, ask for it instead — do not emit the token.
- Do not emit BOOKING_REQUEST again for a booking you already confirmed earlier in this conversation. A later "thanks" just gets a brief acknowledgement.
- Never mention "BOOKING_REQUEST" to the customer.

Services:
${services}

Hours:
${businessHours}

Lead: ${lead.name || 'Customer'} | ${lead.email || 'No email'}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: systemPrompt,
        messages: [
          ...conversationHistory,
          { role: 'user', content: userMessage }
        ]
      })
    });

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('AI error:', error.message);
    return null;
  }
}

// GET /api/sms/webhook-status — check Twilio webhook config for the authenticated user's number
router.get('/webhook-status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    const { EFFECTIVE_JWT_SECRET } = require('../config/middleware');
    const decoded = jwt.verify(authHeader.replace('Bearer ', ''), EFFECTIVE_JWT_SECRET);
    const userId = decoded.userId;

    const userResult = await pool.query(
      'SELECT twilio_phone_number, twilio_phone_sid FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows[0]?.twilio_phone_sid) {
      return res.json({ hasNumber: false, message: 'No Twilio number provisioned' });
    }

    const { twilio_phone_number, twilio_phone_sid } = userResult.rows[0];
    const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
    const expectedUrl = `${baseUrl}/api/sms/webhook`;

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const numberInfo = await client.incomingPhoneNumbers(twilio_phone_sid).fetch();

    const isCorrect = numberInfo.smsUrl === expectedUrl;

    res.json({
      hasNumber: true,
      phoneNumber: twilio_phone_number,
      currentWebhookUrl: numberInfo.smsUrl,
      expectedWebhookUrl: expectedUrl,
      isCorrect,
      status: isCorrect ? '✅ Webhook correctly configured' : '❌ Webhook URL mismatch — replies not being received'
    });
  } catch (err) {
    console.error('Webhook status check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/fix-webhook — force-repair the Twilio webhook URL for the authenticated user
router.post('/fix-webhook', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    const { EFFECTIVE_JWT_SECRET } = require('../config/middleware');
    const decoded = jwt.verify(authHeader.replace('Bearer ', ''), EFFECTIVE_JWT_SECRET);
    const userId = decoded.userId;

    const userResult = await pool.query(
      'SELECT twilio_phone_number, twilio_phone_sid FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows[0]?.twilio_phone_sid) {
      return res.status(400).json({ error: 'No Twilio number provisioned' });
    }

    const { twilio_phone_number, twilio_phone_sid } = userResult.rows[0];
    const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
    const expectedUrl = `${baseUrl}/api/sms/webhook`;

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.incomingPhoneNumbers(twilio_phone_sid).update({
      smsUrl: expectedUrl,
      smsMethod: 'POST'
    });

    console.log(`🔧 Manually repaired webhook for user ${userId} (${twilio_phone_number}) → ${expectedUrl}`);
    res.json({ success: true, phoneNumber: twilio_phone_number, webhookUrl: expectedUrl });
  } catch (err) {
    console.error('Fix webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.generateAIResponse = generateAIResponse;
