const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { sendSMS } = require('../utils/twilio');
const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('../utils/claudeUsage');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Most carriers block well past 1600 chars and long bodies get split into many
// billed segments — cap the per-message length and the audience size like the
// email side caps its blast.
const SMS_SEND_LIMIT = 500;
const SMS_MAX_LENGTH = 320;

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
      'SELECT twilio_phone_number, business_name FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      subscriberCount: parseInt(subsResult.rows[0].count, 10),
      hasPhoneNumber: !!userRow.rows[0]?.twilio_phone_number,
      fromNumber: userRow.rows[0]?.twilio_phone_number || null,
      businessName: userRow.rows[0]?.business_name || '',
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

    const userRow = await pool.query('SELECT twilio_phone_number FROM users WHERE id = $1', [userId]);
    if (!userRow.rows[0]?.twilio_phone_number) {
      return res.status(400).json({ error: 'No SMS number is provisioned for your account yet' });
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
      [userId, SMS_SEND_LIMIT]
    );

    let sent = 0;
    for (const contact of contacts.rows) {
      const phone = normalizePhone(contact.phone);
      if (!phone) continue;
      try {
        await sendSMS(phone, buildMessageFor(message, contact.name), userId);
        sent++;
      } catch (err) {
        console.error(`📵 Campaign SMS failed to ${contact.phone}:`, err.message);
      }
    }

    await pool.query(
      `UPDATE sms_campaigns SET status = $1, recipient_count = $2, sent_at = NOW() WHERE id = $3`,
      [sent > 0 ? 'sent' : 'failed', sent, campaignId]
    );

    console.log(`📱 SMS campaign ${campaignId}: ${sent} texts sent for user ${userId}`);
    res.json({ success: true, sent });
  } catch (e) {
    console.error('SMS send-now error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to send SMS campaign' });
  }
});

module.exports = router;
