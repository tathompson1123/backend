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
    'SELECT business_name, business_type FROM users WHERE id = $1',
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
    industry: user.business_type || 'service business',
    city: '',
    state: '',
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

  // Pick a relevant Unsplash hero image based on industry
  const industryImages = {
    landscaping:    'photo-1558618666-fcd25c85cd64',
    'auto detailing': 'photo-1507136566006-cfc505b114fc',
    'auto wrap':    'photo-1552519507-da3b142c6e3d',
    cleaning:       'photo-1581578731548-c64695cc6952',
    hvac:           'photo-1621905251918-48416bd8575a',
    plumbing:       'photo-1585771724684-38269d6639fd',
    roofing:        'photo-1625766763788-95dcce9bf5ac',
    dental:         'photo-1606811841689-23dfddce3e95',
    fitness:        'photo-1534438327276-14e5300c3a48',
    salon:          'photo-1521590832167-7bcbfaa6381f',
    restaurant:     'photo-1414235077428-338989a2e8c0',
    photography:    'photo-1542038784456-1ea8e935640e',
    general:        'photo-1600880292203-757bb62b4baf',
  };
  const industryKey = Object.keys(industryImages).find(k => industry.toLowerCase().includes(k)) || 'general';
  const heroImageId = industryImages[industryKey];
  const heroImageUrl = `https://images.unsplash.com/${heroImageId}?w=600&q=80&auto=format&fit=crop`;

  // Expiry date: end of this week (Sunday)
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + (7 - expiryDate.getDay()));
  const expiryStr = expiryDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const prompt = `You are a top-tier email marketer writing a weekly promotional email for ${businessName}, a ${industry} business${city ? ` in ${city}` : ''}.

Month: ${month}
Services offered: ${services.length ? services.join(', ') : 'various services'}
Tone: ${tone}
Campaign focus: ${focusInstructions[focus] || focusInstructions.seasonal}
Offer expires: ${expiryStr}
${recentSubjects.length ? `Recent subjects used (DO NOT repeat these concepts): ${recentSubjects.join(' | ')}` : ''}

Write ONE high-converting weekly email using proven copywriting techniques:

SUBJECT LINE: Use a curiosity gap or open loop (e.g., "The one thing most [customer type] don't know about…", "Why your [problem] keeps coming back…", "We almost didn't share this…"). Under 55 characters. No generic words like "newsletter" or "update".

PREVIEW TEXT: Continue the curiosity hook, tease the offer without revealing it fully. 80-100 chars.

BODY HTML: A rich, visually compelling email that:
1. Opens with a punchy hook addressing a real customer pain point (1-2 lines)
2. Builds desire with a "before/after" or problem/solution statement
3. Reveals a SPECIFIC time-limited offer (e.g., "20% off this week only", "free add-on with any booking before ${expiryStr}", "2 spots left this week")
4. Uses urgency language ("Expires ${expiryStr}", "Only X spots left", "This week only")
5. Has ONE clear CTA button: bold, prominent, action-driven text
6. Ends with a brief personal sign-off from the business owner/team
7. Includes a footer with unsubscribe option

Use this EXACT HTML structure with inline styles:
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10)">
  <!-- Header -->
  <div style="background:#111827;padding:20px 24px;text-align:center">
    <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;letter-spacing:-0.3px">[BUSINESS NAME]</h1>
  </div>
  <!-- Hero image -->
  <img src="${heroImageUrl}" alt="[BUSINESS NAME] offer" style="width:100%;display:block;max-height:280px;object-fit:cover" />
  <!-- Urgency bar -->
  <div style="background:#fef3c7;border-bottom:2px solid #f59e0b;padding:12px 24px;text-align:center">
    <p style="margin:0;font-size:14px;font-weight:700;color:#92400e">⏰ This offer expires ${expiryStr} — don't miss it</p>
  </div>
  <!-- Body -->
  <div style="padding:32px 28px">
    [HOOK LINE - 1-2 sentences, bold if possible]
    [BODY PARAGRAPHS - 2-3 short paragraphs, problem → solution → offer]
    [SPECIFIC OFFER BOX styled with background:#f0fdf4;border-left:4px solid #22c55e;padding:16px;border-radius:8px;margin:24px 0]
    [CTA BUTTON centered, styled: background:#111827;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block]
    [PERSONAL SIGN-OFF]
  </div>
  <!-- Footer -->
  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 28px;text-align:center">
    <p style="margin:0 0 8px;font-size:12px;color:#6b7280">You're receiving this because you've used [BUSINESS NAME] before.</p>
    <a href="#" style="font-size:12px;color:#6b7280;text-decoration:underline">Unsubscribe</a>
  </div>
</div>

BODY TEXT: A plain-text version of the same content.

Return ONLY valid JSON (no markdown, no code blocks):
{
  "subject": "...",
  "previewText": "...",
  "bodyHtml": "...",
  "bodyText": "..."
}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
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
