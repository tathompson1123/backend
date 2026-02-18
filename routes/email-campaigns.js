const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const Anthropic = require('@anthropic-ai/sdk');
const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ─────────────────────────────────────────────

async function getBusinessContext(userId) {
  const userRow = await pool.query(
    'SELECT business_name, industry, city, state FROM users WHERE id = $1',
    [userId]
  );
  const user = userRow.rows[0] || {};

  const servicesRow = await pool.query(
    'SELECT name FROM services WHERE user_id = $1 AND active = true LIMIT 10',
    [userId]
  );
  const services = servicesRow.rows.map(r => r.name);

  return {
    businessName: user.business_name || 'Our Business',
    industry: user.industry || 'service business',
    city: user.city || '',
    state: user.state || '',
    services,
  };
}

async function getRecentSubjects(userId, limit = 5) {
  const result = await pool.query(
    'SELECT subject FROM email_campaigns WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return result.rows.map(r => r.subject);
}

async function generateCampaign(userId, config) {
  const { businessName, industry, city, services } = await getBusinessContext(userId);
  const recentSubjects = await getRecentSubjects(userId);
  const month = new Date().toLocaleString('default', { month: 'long' });
  const tone = config?.tone || 'friendly';
  const focus = config?.focus || 'seasonal';

  const focusInstructions = {
    seasonal: `Create a time-sensitive seasonal promotion tied to ${month}. Reference the season, weather, or upcoming holidays to make it feel urgent and relevant.`,
    upsell: 'Create an irresistible add-on or bundle offer that upgrades customers to a higher-value service. Show the before/after value clearly.',
    referral: 'Create a referral bonus offer — reward the customer for sending a friend. Make it feel like an exclusive thank-you for being a loyal customer.',
    winback: 'Create a "we miss you" win-back offer for customers who haven\'t booked in a while. Give them a compelling reason to come back now.',
  };

  const prompt = `You are a marketing expert writing a weekly promotional email for ${businessName}, a ${industry} business${city ? ` in ${city}` : ''}.

Month: ${month}
Services offered: ${services.length ? services.join(', ') : 'various services'}
Tone: ${tone}
Campaign focus: ${focusInstructions[focus] || focusInstructions.seasonal}
${recentSubjects.length ? `Recent subjects used (DO NOT repeat these concepts): ${recentSubjects.join(' | ')}` : ''}

Write ONE compelling weekly email that:
- Has an irresistible, curiosity-driving subject line (under 60 chars)
- Opens with a powerful hook that speaks to a real customer pain point
- Presents a time-limited offer with clear value (discount, bonus service, priority scheduling, etc.)
- Includes a clear call-to-action (call/text/book now)
- Feels personal, not corporate
- Is 150-250 words for the main body

Return ONLY valid JSON (no markdown, no code blocks):
{
  "subject": "...",
  "previewText": "...",
  "bodyHtml": "...",
  "bodyText": "..."
}

For bodyHtml: use simple inline-styled HTML (no external CSS). Include the business name, the offer, and a prominent CTA button styled with background-color:#1d4ed8;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;
For bodyText: plain text version of the same content.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if present, extract first JSON object
  let json = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  // If there's extra text before/after JSON, extract just the JSON object
  const jsonMatch = json.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in AI response');
  return JSON.parse(jsonMatch[0]);
}

async function sendCampaign(userId, config, campaignId) {
  // Get all customers with emails
  const customersResult = await pool.query(
    'SELECT name, email FROM customers WHERE user_id = $1 AND email IS NOT NULL AND email != \'\'',
    [userId]
  );

  if (customersResult.rows.length === 0) {
    await pool.query(
      "UPDATE email_campaigns SET status = 'failed', sent_at = NOW() WHERE id = $1",
      [campaignId]
    );
    return { sent: 0, error: 'No customers with email addresses' };
  }

  const campaign = await pool.query('SELECT * FROM email_campaigns WHERE id = $1', [campaignId]);
  const c = campaign.rows[0];

  const fromName = config.from_name || 'Your Business';
  const fromEmail = config.from_email || process.env.SENDGRID_FROM_EMAIL;
  if (!fromEmail) throw new Error('No from_email configured');

  const messages = customersResult.rows.map(customer => ({
    to: customer.email,
    from: { name: fromName, email: fromEmail },
    subject: c.subject,
    text: c.body_text,
    html: c.body_html,
    trackingSettings: { clickTracking: { enable: true }, openTracking: { enable: true } },
  }));

  // SendGrid allows up to 1000 per batch
  let sent = 0;
  for (let i = 0; i < messages.length; i += 900) {
    const batch = messages.slice(i, i + 900);
    await sgMail.send(batch);
    sent += batch.length;
  }

  await pool.query(
    "UPDATE email_campaigns SET status = 'sent', sent_at = NOW(), recipient_count = $1 WHERE id = $2",
    [sent, campaignId]
  );

  return { sent };
}

// ── Routes ──────────────────────────────────────────────

// GET /api/email-campaigns/config
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM email_campaign_configs WHERE user_id = $1',
      [req.user.userId]
    );
    res.json({ config: result.rows[0] || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/email-campaigns/config
router.put('/config', authenticateToken, async (req, res) => {
  try {
    const { enabled, send_day, send_hour, from_name, from_email, tone, focus } = req.body;
    const result = await pool.query(
      `INSERT INTO email_campaign_configs (user_id, enabled, send_day, send_hour, from_name, from_email, tone, focus, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = $2, send_day = $3, send_hour = $4,
         from_name = $5, from_email = $6, tone = $7, focus = $8, updated_at = NOW()
       RETURNING *`,
      [req.user.userId, enabled ?? false, send_day || 'monday', send_hour ?? 9, from_name, from_email, tone || 'friendly', focus || 'seasonal']
    );
    res.json({ success: true, config: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/email-campaigns/history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, subject, preview_text, status, sent_at, recipient_count, created_at FROM email_campaigns WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user.userId]
    );
    res.json({ campaigns: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/email-campaigns/preview — generate without sending
router.post('/preview', authenticateToken, async (req, res) => {
  try {
    const configResult = await pool.query(
      'SELECT * FROM email_campaign_configs WHERE user_id = $1',
      [req.user.userId]
    );
    const config = configResult.rows[0] || {};
    const campaign = await generateCampaign(req.user.userId, config);
    res.json({ success: true, campaign });
  } catch (e) {
    console.error('Campaign preview error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to generate campaign preview' });
  }
});

// POST /api/email-campaigns/send-now — generate and send immediately
router.post('/send-now', authenticateToken, async (req, res) => {
  try {
    const configResult = await pool.query(
      'SELECT * FROM email_campaign_configs WHERE user_id = $1',
      [req.user.userId]
    );
    const config = configResult.rows[0] || {};

    if (!config.from_email) {
      return res.status(400).json({ error: 'Please set your From Email in campaign settings first' });
    }

    // Use pre-generated campaign if provided (from frontend preview+edit), otherwise generate fresh
    const { usePreview } = req.body;
    const generated = usePreview && usePreview.subject
      ? usePreview
      : await generateCampaign(req.user.userId, config);

    // Save to DB
    const saved = await pool.query(
      `INSERT INTO email_campaigns (user_id, subject, preview_text, body_html, body_text, status, scheduled_for, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW()) RETURNING id`,
      [req.user.userId, generated.subject, generated.previewText, generated.bodyHtml, generated.bodyText]
    );
    const campaignId = saved.rows[0].id;

    // Send
    const result = await sendCampaign(req.user.userId, config, campaignId);

    res.json({ success: true, ...result, subject: generated.subject });
  } catch (e) {
    console.error('Send now error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to send campaign' });
  }
});

module.exports = router;
module.exports.generateCampaign = generateCampaign;
module.exports.sendCampaign = sendCampaign;
