const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { sendSMS } = require('../utils/twilio');
const { sendSmsCampaignReplyNotification } = require('../utils/bookingEmail');
const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('../utils/claudeUsage');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Most carriers block well past 1600 chars and long bodies get split into many
// billed segments — cap the per-message length and the audience size like the
// email side caps its blast.
const SMS_SEND_LIMIT = 2000;
const SMS_MAX_LENGTH = 320;

// Monthly SMS allowance per plan (mirrors the lead-agent enforcement in server.js).
// Campaign sends count against the same monthly pool as agent texts.
const SMS_PLAN_LIMITS = { scale: 500, pro: 100, expert: 200, basic: 100 };

// Accounts exempt from the monthly SMS cap and the per-blast cap. Keyed by email so
// it survives user-id changes. Lowercase.
const UNLIMITED_SMS_EMAILS = new Set(['ty@thompsonsautodetailing.com']);
const isUnlimitedSms = (email) => UNLIMITED_SMS_EMAILS.has(String(email || '').trim().toLowerCase());

// How many outgoing texts this user has sent so far this calendar month.
async function getMonthlySmsUsage(userId) {
  const r = await pool.query(
    `SELECT COUNT(*) FROM sms_messages
     WHERE user_id = $1 AND direction = 'outgoing'
       AND created_at >= date_trunc('month', NOW())`,
    [userId]
  );
  return parseInt(r.rows[0].count, 10);
}

// The compliance footer every campaign text must carry. Kept short so it eats as
// few SMS segments as possible while still giving recipients a clear opt-out.
const STOP_FOOTER = 'Reply STOP to unsubscribe';

// Same E.164 normalizer the email-campaign SMS phase uses — keep them identical so
// a number that's reachable from one tool is reachable from the other.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// Build the final body for one recipient: personalize {name}/{first_name}, then
// guarantee the STOP footer is present exactly once (owners often forget it, and
// CTIA/Twilio require it on promotional blasts).
function buildMessageFor(message, name) {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  let body = String(message || '')
    .replace(/\{first_name\}/gi, firstName)
    .replace(/\{name\}/gi, firstName)
    .trim();

  // If the owner already wrote their own opt-out line, don't bolt a second one on.
  if (!/\bstop\b/i.test(body)) {
    body += `\n\n${STOP_FOOTER}`;
  }
  return body;
}

async function getBusinessName(userId) {
  const r = await pool.query('SELECT business_name, business_type FROM users WHERE id = $1', [userId]);
  return {
    businessName: r.rows[0]?.business_name || 'Our Business',
    industry: r.rows[0]?.business_type || 'service business',
  };
}

// ── Startup migrations ───────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS sms_campaigns (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    recipient_count INTEGER DEFAULT 0,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('sms_campaigns migration error:', e.message));

// Shared opt-out flag with the email tool's SMS phase. IF NOT EXISTS makes this safe
// even though email-campaigns.js also ensures the column.
pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_unsubscribed BOOLEAN DEFAULT FALSE`)
  .catch(e => console.error('customers sms_unsubscribed migration error:', e.message));

// Tag outgoing campaign texts in sms_messages so the inbound webhook can recognize a
// reply as a campaign reply (route it to Leads + email the owner) and show what we sent.
pool.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS campaign_id INTEGER`)
  .catch(e => console.error('sms_messages campaign_id migration error:', e.message));

// Marks an inbound campaign reply as already emailed to the owner, so the backfill
// below (and the live webhook) can't email the same reply twice.
pool.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS campaign_reply_emailed BOOLEAN DEFAULT FALSE`)
  .catch(e => console.error('sms_messages campaign_reply_emailed migration error:', e.message));

// One-time catch-up: email the owner about campaign replies that came in before the
// reply-notification feature existed. A "campaign reply" here is an inbound text from a
// number on the user's customer list that arrived after one of their sent campaigns
// (within 14 days) and was never emailed. Idempotent via campaign_reply_emailed, so it's
// safe to run on every boot — it only ever sends each reply once.
async function backfillCampaignReplyEmails() {
  try {
    const campaigns = await pool.query(
      `SELECT id, user_id, message, sent_at FROM sms_campaigns
       WHERE status = 'sent' AND sent_at IS NOT NULL
         AND sent_at >= NOW() - INTERVAL '14 days'
       ORDER BY sent_at DESC`
    );
    if (campaigns.rows.length === 0) return;

    let emailed = 0;
    for (const camp of campaigns.rows) {
      // Inbound replies for this user, after the campaign went out, from a number that's
      // on their customer list (the blast audience), not yet emailed.
      const replies = await pool.query(
        `SELECT m.id, m.from_number, m.message, m.lead_id, c.name AS customer_name
         FROM sms_messages m
         JOIN customers c
           ON c.user_id = m.user_id
          AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) =
              right(regexp_replace(m.from_number, '\\D', '', 'g'), 10)
         WHERE m.user_id = $1
           AND m.direction = 'incoming'
           AND m.created_at >= $2
           AND (m.campaign_reply_emailed IS NULL OR m.campaign_reply_emailed = FALSE)
           -- Never email the owner about an opt-out command (STOP/CANCEL/etc.) — those
           -- unsubscribe the contact, they aren't a reply worth a notification.
           AND upper(regexp_replace(m.message, '[^A-Za-z]', '', 'g'))
               NOT IN ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','START','UNSTOP','YES','SUBSCRIBE')
         ORDER BY m.created_at ASC`,
        [camp.user_id, camp.sent_at]
      );

      const numberToLead = new Map(); // last10 -> leadId (email only the first reply per number)
      for (const r of replies.rows) {
        const last10 = (r.from_number || '').replace(/\D/g, '').slice(-10);
        const alreadySeen = numberToLead.has(last10);

        // Make sure the reply is represented in the Leads box.
        let leadId = r.lead_id || numberToLead.get(last10);
        if (!leadId) {
          const existing = await pool.query(
            `SELECT id FROM leads WHERE user_id = $1
               AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $2
             ORDER BY created_at DESC LIMIT 1`,
            [camp.user_id, last10]
          );
          if (existing.rows.length) {
            leadId = existing.rows[0].id;
          } else {
            const ins = await pool.query(
              `INSERT INTO leads (user_id, name, phone, source, status, created_at)
               VALUES ($1, $2, $3, 'sms_campaign', 'replied', NOW()) RETURNING id`,
              [camp.user_id, r.customer_name || r.from_number, r.from_number]
            );
            leadId = ins.rows[0].id;
          }
        }
        numberToLead.set(last10, leadId);

        // Attach the reply to the lead (so it shows in the lead's conversation) and mark
        // it handled. Only the first reply per number triggers an owner email.
        await pool.query(
          'UPDATE sms_messages SET lead_id = COALESCE(lead_id, $1), campaign_reply_emailed = TRUE WHERE id = $2',
          [leadId, r.id]
        ).catch(() => {});

        if (!alreadySeen) {
          await sendSmsCampaignReplyNotification({
            userId: camp.user_id,
            leadId,
            customerName: r.customer_name || null,
            customerPhone: r.from_number,
            replyText: r.message,
            campaignMessage: camp.message,
          });
          emailed++;
        }
      }
    }
    if (emailed > 0) console.log(`📧 Backfill: emailed ${emailed} missed SMS campaign repl${emailed === 1 ? 'y' : 'ies'}`);
  } catch (e) {
    console.error('Campaign reply backfill error:', e.message);
  }
}

// One-time cleanup: remove leads that exist only because someone texted an opt-out
// command (STOP/CANCEL/etc.). Scope is tight on purpose — only SMS-sourced leads whose
// EVERY inbound message is an opt-out keyword and who never genuinely replied. Engaged
// leads and leads from other channels are left untouched. Idempotent (safe each boot).
const OPT_OUT_WORDS_SQL = `('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT')`;
const OPT_ANY_WORDS_SQL = `('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','START','UNSTOP','YES','SUBSCRIBE')`;
async function cleanupOptOutLeads() {
  try {
    const targets = await pool.query(
      `SELECT l.id FROM leads l
       WHERE l.source IN ('sms_inbound', 'sms_campaign')
         AND COALESCE(l.status, '') <> 'converted'
         AND EXISTS (
           SELECT 1 FROM sms_messages m
           WHERE m.lead_id = l.id AND m.direction = 'incoming'
             AND upper(regexp_replace(m.message, '[^A-Za-z]', '', 'g')) IN ${OPT_OUT_WORDS_SQL}
         )
         AND NOT EXISTS (
           SELECT 1 FROM sms_messages m2
           WHERE m2.lead_id = l.id AND m2.direction = 'incoming'
             AND upper(regexp_replace(m2.message, '[^A-Za-z]', '', 'g')) NOT IN ${OPT_ANY_WORDS_SQL}
         )`
    );
    if (targets.rows.length === 0) return;
    const ids = targets.rows.map(r => r.id);
    // Remove their messages first in case sms_messages.lead_id has no cascade.
    await pool.query('DELETE FROM sms_messages WHERE lead_id = ANY($1)', [ids])
      .catch(e => console.error('Opt-out lead message delete error:', e.message));
    const del = await pool.query('DELETE FROM leads WHERE id = ANY($1) RETURNING id', [ids]);
    console.log(`🧹 Removed ${del.rowCount} opt-out lead(s) from the leads list`);
  } catch (e) {
    console.error('Opt-out lead cleanup error:', e.message);
  }
}

// Run shortly after boot so the migrations above have applied first.
setTimeout(() => {
  backfillCampaignReplyEmails();
  cleanupOptOutLeads();
}, 15000);

// ── Routes ──────────────────────────────────────────────

// GET /api/sms-campaigns/stats — reachable-contact count + sender readiness
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Count contacts we can actually text: has a 10+ digit phone, not opted out,
    // deduplicated by the last 10 digits (the same key STOP matches on).
    const subsResult = await pool.query(
      `SELECT COUNT(DISTINCT right(regexp_replace(phone, '\\D', '', 'g'), 10)) AS count
       FROM customers
       WHERE user_id = $1 AND phone IS NOT NULL AND phone != ''
         AND length(regexp_replace(phone, '\\D', '', 'g')) >= 10
         AND (sms_unsubscribed IS NULL OR sms_unsubscribed = FALSE)`,
      [userId]
    );

    const userRow = await pool.query(
      'SELECT twilio_phone_number, business_name, plan, email FROM users WHERE id = $1',
      [userId]
    );

    const plan = userRow.rows[0]?.plan || null;
    const unlimited = isUnlimitedSms(userRow.rows[0]?.email);
    const monthlyLimit = unlimited ? null : (SMS_PLAN_LIMITS[plan] || 0);
    const monthlyUsed = await getMonthlySmsUsage(userId);
    const monthlyRemaining = unlimited ? null : Math.max(0, monthlyLimit - monthlyUsed);

    res.json({
      subscriberCount: parseInt(subsResult.rows[0].count, 10),
      hasPhoneNumber: !!userRow.rows[0]?.twilio_phone_number,
      fromNumber: userRow.rows[0]?.twilio_phone_number || null,
      businessName: userRow.rows[0]?.business_name || '',
      plan,
      unlimited,
      monthlyLimit,
      monthlyUsed,
      monthlyRemaining,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sms-campaigns/history — recent sent campaigns
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, message, status, recipient_count, sent_at, created_at
       FROM sms_campaigns WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.userId]
    );
    res.json({ campaigns: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sms-campaigns/generate — AI drafts an offer text from a short brief
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { offer } = req.body || {};
    const { businessName, industry } = await getBusinessName(userId);

    const prompt = `You are writing ONE promotional SMS for ${businessName}, a ${industry}.

${offer ? `The offer / angle the owner wants: ${offer}` : 'Write a compelling limited-time offer to win repeat business.'}

Rules:
- Plain text only. No markdown, no emojis-heavy spam, at most one emoji.
- Under 240 characters total (it gets a "Reply STOP to unsubscribe" footer added automatically, so do NOT include any opt-out line yourself).
- Sound like a real local business texting a past customer — warm and direct.
- Include the business name "${businessName}".
- You may use the token {name} once near the start to insert the customer's first name.
- End with a clear call to action (call, reply, or book).

Return ONLY the SMS text — no quotes, no preamble, no explanation.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    logClaudeUsage(userId, 'claude-haiku-4-5-20251001', response.usage, 'sms_campaign');

    let message = (response.content[0]?.text || '').trim().replace(/^["']|["']$/g, '');
    if (message.length > SMS_MAX_LENGTH) message = message.slice(0, SMS_MAX_LENGTH);

    res.json({ success: true, message });
  } catch (e) {
    console.error('SMS generate error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to generate SMS' });
  }
});

// POST /api/sms-campaigns/test-send — text the owner's own Twilio number's... self.
// Sends to a phone supplied by the owner so they can preview the real message.
router.post('/test-send', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { message, toPhone } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    const phone = normalizePhone(toPhone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit phone number to send the test to' });

    const userRow = await pool.query('SELECT twilio_phone_number FROM users WHERE id = $1', [userId]);
    if (!userRow.rows[0]?.twilio_phone_number) {
      return res.status(400).json({ error: 'No SMS number is provisioned for your account yet' });
    }

    await sendSMS(phone, buildMessageFor(message, 'there'), userId);
    res.json({ success: true, sentTo: phone });
  } catch (e) {
    console.error('SMS test-send error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to send test SMS' });
  }
});

// POST /api/sms-campaigns/send-now — blast to every reachable contact
router.post('/send-now', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    const userRow = await pool.query('SELECT twilio_phone_number, plan, email FROM users WHERE id = $1', [userId]);
    if (!userRow.rows[0]?.twilio_phone_number) {
      return res.status(400).json({ error: 'No SMS number is provisioned for your account yet' });
    }

    const plan = userRow.rows[0]?.plan || null;
    const unlimited = isUnlimitedSms(userRow.rows[0]?.email);

    // Enforce the plan's monthly SMS allowance (shared pool with the lead agent). Trim the
    // blast to what's left rather than hard-failing, and report how many were skipped.
    // Exempt accounts (UNLIMITED_SMS_EMAILS) bypass both the monthly and per-blast caps.
    let monthlyLimit = null, monthlyRemaining = null, sendCap;
    if (unlimited) {
      sendCap = 1000000;
    } else {
      monthlyLimit = SMS_PLAN_LIMITS[plan] || 0;
      if (monthlyLimit === 0) {
        return res.status(403).json({ error: 'Your plan does not include SMS. Upgrade to send text campaigns.' });
      }
      const monthlyUsed = await getMonthlySmsUsage(userId);
      monthlyRemaining = Math.max(0, monthlyLimit - monthlyUsed);
      if (monthlyRemaining === 0) {
        return res.status(403).json({
          error: `You've used all ${monthlyLimit} texts in your ${plan} plan this month. Upgrade or wait until next month.`,
          monthlyLimit, monthlyUsed,
        });
      }
      sendCap = Math.min(SMS_SEND_LIMIT, monthlyRemaining);
    }

    // Record the campaign up front so a mid-send crash still leaves a trail.
    const campaignRow = await pool.query(
      `INSERT INTO sms_campaigns (user_id, message, status, created_at)
       VALUES ($1, $2, 'pending', NOW()) RETURNING id`,
      [userId, message.trim()]
    );
    const campaignId = campaignRow.rows[0].id;

    // Reachable, deduplicated by last-10-digits (same key STOP uses), opt-outs excluded.
    const contacts = await pool.query(
      `SELECT DISTINCT ON (right(regexp_replace(phone, '\\D', '', 'g'), 10)) name, phone
       FROM customers
       WHERE user_id = $1 AND phone IS NOT NULL AND phone != ''
         AND length(regexp_replace(phone, '\\D', '', 'g')) >= 10
         AND (sms_unsubscribed IS NULL OR sms_unsubscribed = FALSE)
       ORDER BY right(regexp_replace(phone, '\\D', '', 'g'), 10), created_at ASC
       LIMIT $2`,
      [userId, sendCap]
    );

    // How many reachable contacts we couldn't text because the monthly limit cut us off.
    const reachableRow = await pool.query(
      `SELECT COUNT(DISTINCT right(regexp_replace(phone, '\\D', '', 'g'), 10)) AS count
       FROM customers
       WHERE user_id = $1 AND phone IS NOT NULL AND phone != ''
         AND length(regexp_replace(phone, '\\D', '', 'g')) >= 10
         AND (sms_unsubscribed IS NULL OR sms_unsubscribed = FALSE)`,
      [userId]
    );
    const reachableTotal = parseInt(reachableRow.rows[0].count, 10);

    let sent = 0;
    for (const contact of contacts.rows) {
      const phone = normalizePhone(contact.phone);
      if (!phone) continue;
      const body = buildMessageFor(message, contact.name);
      try {
        const result = await sendSMS(phone, body, userId);
        sent++;
        // Log the outgoing campaign text. The campaign_id tag lets the inbound webhook
        // recognize a reply as a campaign reply, and stores exactly what we sent.
        await pool.query(
          `INSERT INTO sms_messages
           (user_id, campaign_id, direction, to_number, message, twilio_message_sid, status, provider, created_at)
           VALUES ($1, $2, 'outgoing', $3, $4, $5, 'sent', 'twilio', NOW())`,
          [userId, campaignId, phone, body, result?.messageSid || null]
        ).catch(err => console.error('Campaign SMS log insert failed:', err.message));
      } catch (err) {
        console.error(`📵 Campaign SMS failed to ${contact.phone}:`, err.message);
      }
    }

    await pool.query(
      `UPDATE sms_campaigns SET status = $1, recipient_count = $2, sent_at = NOW() WHERE id = $3`,
      [sent > 0 ? 'sent' : 'failed', sent, campaignId]
    );

    // Without a monthly cap, anything not sent was a per-message failure, not a limit trim.
    const skipped = unlimited ? 0 : Math.max(0, reachableTotal - sent);
    console.log(`📱 SMS campaign ${campaignId}: ${sent} texts sent for user ${userId}${skipped ? ` (${skipped} skipped — monthly limit ${monthlyLimit})` : ''}`);
    res.json({
      success: true,
      sent,
      skipped,
      reachableTotal,
      unlimited,
      monthlyLimit,
      monthlyRemaining: unlimited ? null : Math.max(0, monthlyRemaining - sent),
      limitReached: skipped > 0,
    });
  } catch (e) {
    console.error('SMS send-now error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to send SMS campaign' });
  }
});

module.exports = router;
