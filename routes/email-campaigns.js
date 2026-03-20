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

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emailBlocksToHtml(blocks) {
  if (!blocks || blocks.length === 0) return '';
  const inner = blocks.map(b => {
    const c = b.content || {};
    switch (b.type) {
      case 'header':
        return `  <div style="background:${c.bgColor||'#111827'};padding:20px 24px;text-align:center"><h1 style="color:${c.textColor||'#ffffff'};margin:0;font-size:20px;font-weight:700;letter-spacing:-0.3px">${esc(c.title||'Your Business')}</h1></div>`;
      case 'hero_image':
        return c.src ? `  <img src="${esc(c.src)}" alt="${esc(c.alt||'')}" style="width:100%;display:block;max-height:280px;object-fit:cover" />` : '';
      case 'urgency_bar':
        return `  <div style="background:${c.bgColor||'#fef3c7'};border-bottom:2px solid #f59e0b;padding:12px 24px;text-align:center"><p style="margin:0;font-size:14px;font-weight:700;color:${c.textColor||'#92400e'}">${esc(c.text||'')}</p></div>`;
      case 'body': {
        const paras = (c.paragraphs||[]).map(p=>`<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.65">${esc(p)}</p>`).join('');
        return `  <div style="padding:32px 28px 8px"><h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827;line-height:1.3">${esc(c.heading||'')}</h2>${paras}</div>`;
      }
      case 'offer_box':
        return `  <div style="margin:0 28px 24px;background:${c.bgColor||'#f0fdf4'};border-left:4px solid ${c.borderColor||'#22c55e'};padding:16px 20px;border-radius:8px"><p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#111827">${esc(c.title||'Exclusive Offer')}</p><p style="margin:0;font-size:14px;color:#374151;line-height:1.55">${esc(c.description||'')}</p></div>`;
      case 'cta_button':
        return `  <div style="padding:8px 28px 32px;text-align:center"><a href="${esc(c.link||'#')}" style="display:inline-block;background:${c.bgColor||'#111827'};color:${c.textColor||'#ffffff'};padding:14px 36px;border-radius:${c.borderRadius||'8px'};text-decoration:none;font-weight:700;font-size:16px">${esc(c.text||'Book Now')}</a></div>`;
      case 'divider':
        return `  <div style="padding:0 28px"><hr style="border:none;border-top:${c.thickness||'1px'} solid ${c.color||'#e5e7eb'};margin:8px 0" /></div>`;
      case 'spacer':
        return `  <div style="height:${c.height||'24px'}"></div>`;
      case 'signoff':
        return `  <div style="padding:0 28px 24px"><p style="margin:0;font-size:14px;color:#6b7280">${esc(c.text||'')}</p></div>`;
      case 'footer':
        return `  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 28px;text-align:center"><p style="margin:0 0 8px;font-size:12px;color:#6b7280">${esc(c.text||'')}</p><a href="#" style="font-size:12px;color:#6b7280;text-decoration:underline">${esc(c.unsubscribeText||'Unsubscribe')}</a></div>`;
      default: return '';
    }
  }).join('\n');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10)">\n${inner}\n</div>`;
}

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

async function generateCampaign(userId, config, offerDetails) {
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

  const offerSection = offerDetails ? [
    offerDetails.offer    ? `Specific offer: ${offerDetails.offer}` : '',
    offerDetails.message  ? `Message angle: ${offerDetails.message}` : '',
    offerDetails.emotion  ? `Emotion to elicit: ${offerDetails.emotion}` : '',
    offerDetails.ctaLink  ? `CTA link URL: ${offerDetails.ctaLink}` : '',
  ].filter(Boolean).join('\n') : '';

  const prompt = `You are a top-tier email marketer writing a weekly promotional email for ${businessName}, a ${industry} business${city ? ` in ${city}` : ''}.

Month: ${month}
Services offered: ${services.length ? services.join(', ') : 'various services'}
Tone: ${tone}
Campaign focus: ${focusInstructions[focus] || focusInstructions.seasonal}
Offer expires: ${expiryStr}
${offerSection ? offerSection + '\n' : ''}${recentSubjects.length ? `Recent subjects used (DO NOT repeat these concepts): ${recentSubjects.join(' | ')}` : ''}

Write ONE high-converting weekly email using proven copywriting techniques.

SUBJECT LINE: Under 55 chars. Use a curiosity gap or open loop. No generic words like "newsletter".
PREVIEW TEXT: 80-100 chars. Continue the curiosity hook, tease without revealing the offer fully.

Return ONLY valid JSON (no markdown, no code blocks) with this structure:
{
  "subject": "...",
  "previewText": "...",
  "bodyText": "plain text version of the full email",
  "blocks": [
    { "type": "header", "content": { "title": "${businessName}", "bgColor": "#111827", "textColor": "#ffffff" } },
    { "type": "hero_image", "content": { "src": "${heroImageUrl}", "alt": "${businessName} offer" } },
    { "type": "urgency_bar", "content": { "text": "⏰ This offer expires ${expiryStr} — don't miss it", "bgColor": "#fef3c7", "textColor": "#92400e" } },
    { "type": "body", "content": { "heading": "[HOOK HEADING - punchy, 1 line]", "paragraphs": ["[paragraph 1: pain point / problem]", "[paragraph 2: solution / desire]"] } },
    { "type": "offer_box", "content": { "title": "[SPECIFIC OFFER TITLE]", "description": "[offer details, expiry, what they get]", "bgColor": "#f0fdf4", "borderColor": "#22c55e" } },
    { "type": "cta_button", "content": { "text": "[ACTION VERB + short phrase]", "link": "${offerDetails?.ctaLink || '#'}", "bgColor": "#111827", "textColor": "#ffffff", "borderRadius": "8px" } },
    { "type": "signoff", "content": { "text": "The ${businessName} team" } },
    { "type": "footer", "content": { "text": "You're receiving this because you've used ${businessName} before.", "unsubscribeText": "Unsubscribe" } }
  ]
}

Rules:
- Make the body content emotionally engaging and specific to the campaign focus
- The offer_box should include a SPECIFIC discount, free add-on, or limited availability
- CTA button text should be action-driven (e.g. "Claim Your Spot", "Book Before ${expiryStr}", "Get 20% Off Now")
- Keep paragraphs short (2-3 sentences max)
- Replace ALL placeholders in brackets with real, compelling copy`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  let json = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  const jsonMatch = json.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in AI response');
  const parsed = JSON.parse(jsonMatch[0]);

  // Assign unique IDs to blocks and compute bodyHtml
  const { randomUUID } = require('crypto');
  const blocks = (parsed.blocks || []).map(b => ({ ...b, id: randomUUID().slice(0, 8) }));
  const bodyHtml = emailBlocksToHtml(blocks);

  return {
    subject: parsed.subject,
    previewText: parsed.previewText,
    bodyText: parsed.bodyText,
    blocks,
    bodyHtml,
  };
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
  const ownerReplyEmail = config.from_email;

  const messages = customersResult.rows.map(customer => ({
    to: customer.email,
    from: { name: fromName, email: 'noreply@sorceintegrations.com' },
    replyTo: ownerReplyEmail ? { name: fromName, email: ownerReplyEmail } : undefined,
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

// ── Startup migrations ───────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS email_campaign_presets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('email_campaign_presets migration error:', e.message));

pool.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS blocks JSONB`)
  .catch(e => console.error('email_campaigns blocks column migration error:', e.message));

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

// POST /api/email-campaigns/preview — generate and auto-save as draft
router.post('/preview', authenticateToken, async (req, res) => {
  try {
    const configResult = await pool.query(
      'SELECT * FROM email_campaign_configs WHERE user_id = $1',
      [req.user.userId]
    );
    const config = configResult.rows[0] || {};
    const { offerDetails } = req.body;
    const campaign = await generateCampaign(req.user.userId, config, offerDetails);

    // Auto-save as draft
    const saved = await pool.query(
      `INSERT INTO email_campaigns (user_id, subject, preview_text, body_html, body_text, blocks, status, scheduled_for, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW(), NOW()) RETURNING id`,
      [req.user.userId, campaign.subject, campaign.previewText, campaign.bodyHtml, campaign.bodyText, JSON.stringify(campaign.blocks)]
    );

    res.json({ success: true, campaign, draftId: saved.rows[0].id });
  } catch (e) {
    console.error('Campaign preview error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to generate campaign preview' });
  }
});

// POST /api/email-campaigns/send-now — send immediately (optionally from a draft)
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

    const { usePreview, offerDetails, draftId } = req.body;
    let generated;
    let campaignId;

    if (draftId) {
      // Promote existing draft — update it in place
      const draftResult = await pool.query(
        'SELECT * FROM email_campaigns WHERE id = $1 AND user_id = $2 AND status = $3',
        [draftId, req.user.userId, 'draft']
      );
      if (draftResult.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
      const draft = draftResult.rows[0];

      // If usePreview has updated content, use that; otherwise use saved draft content
      if (usePreview && usePreview.subject) {
        if (usePreview.blocks && !usePreview.bodyHtml) usePreview.bodyHtml = emailBlocksToHtml(usePreview.blocks);
        generated = usePreview;
        await pool.query(
          `UPDATE email_campaigns SET subject=$1, preview_text=$2, body_html=$3, body_text=$4, blocks=$5, status='pending', scheduled_for=NOW() WHERE id=$6`,
          [generated.subject, generated.previewText, generated.bodyHtml, generated.bodyText, JSON.stringify(generated.blocks), draftId]
        );
      } else {
        generated = { subject: draft.subject, previewText: draft.preview_text, bodyHtml: draft.body_html, bodyText: draft.body_text };
        await pool.query(`UPDATE email_campaigns SET status='pending', scheduled_for=NOW() WHERE id=$1`, [draftId]);
      }
      campaignId = draftId;
    } else if (usePreview && usePreview.subject) {
      if (usePreview.blocks && !usePreview.bodyHtml) usePreview.bodyHtml = emailBlocksToHtml(usePreview.blocks);
      generated = usePreview;
      const saved = await pool.query(
        `INSERT INTO email_campaigns (user_id, subject, preview_text, body_html, body_text, blocks, status, scheduled_for, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW()) RETURNING id`,
        [req.user.userId, generated.subject, generated.previewText, generated.bodyHtml, generated.bodyText, JSON.stringify(generated.blocks || [])]
      );
      campaignId = saved.rows[0].id;
    } else {
      generated = await generateCampaign(req.user.userId, config, offerDetails);
      const saved = await pool.query(
        `INSERT INTO email_campaigns (user_id, subject, preview_text, body_html, body_text, blocks, status, scheduled_for, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW()) RETURNING id`,
        [req.user.userId, generated.subject, generated.previewText, generated.bodyHtml, generated.bodyText, JSON.stringify(generated.blocks || [])]
      );
      campaignId = saved.rows[0].id;
    }

    const result = await sendCampaign(req.user.userId, config, campaignId);
    res.json({ success: true, ...result, subject: generated.subject });
  } catch (e) {
    console.error('Send now error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to send campaign' });
  }
});

// POST /api/email-campaigns/test-send — send to self (from_email) only
router.post('/test-send', authenticateToken, async (req, res) => {
  try {
    const configResult = await pool.query(
      'SELECT * FROM email_campaign_configs WHERE user_id = $1',
      [req.user.userId]
    );
    const config = configResult.rows[0] || {};

    if (!config.from_email) {
      return res.status(400).json({ error: 'Please set your From Email in campaign settings first' });
    }

    const { draftId, subject, bodyHtml, bodyText, blocks } = req.body;
    let emailSubject, emailHtml, emailText;

    if (draftId) {
      const draftResult = await pool.query(
        'SELECT subject, body_html, body_text FROM email_campaigns WHERE id = $1 AND user_id = $2',
        [draftId, req.user.userId]
      );
      if (draftResult.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
      const d = draftResult.rows[0];
      emailSubject = d.subject;
      emailHtml = d.body_html;
      emailText = d.body_text;
    } else {
      emailSubject = subject || 'Test Email';
      emailHtml = blocks ? emailBlocksToHtml(blocks) : (bodyHtml || '');
      emailText = bodyText || '';
    }

    await sgMail.send({
      to: config.from_email,
      from: { name: config.from_name || 'Campaign Test', email: config.from_email },
      subject: `[TEST] ${emailSubject}`,
      text: emailText,
      html: emailHtml,
    });

    res.json({ success: true, sentTo: config.from_email });
  } catch (e) {
    console.error('Test send error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to send test email' });
  }
});

// ── Drafts ──────────────────────────────────────────────

// GET /api/email-campaigns/drafts
router.get('/drafts', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, subject, preview_text, blocks, body_html, body_text, created_at
       FROM email_campaigns WHERE user_id = $1 AND status = 'draft' ORDER BY created_at DESC`,
      [req.user.userId]
    );
    res.json({ drafts: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/email-campaigns/drafts/:id
router.put('/drafts/:id', authenticateToken, async (req, res) => {
  try {
    const { subject, previewText, bodyHtml, bodyText, blocks } = req.body;
    const html = bodyHtml || (blocks ? emailBlocksToHtml(blocks) : '');
    const result = await pool.query(
      `UPDATE email_campaigns
       SET subject = COALESCE($1, subject),
           preview_text = COALESCE($2, preview_text),
           body_html = COALESCE($3, body_html),
           body_text = COALESCE($4, body_text),
           blocks = COALESCE($5, blocks)
       WHERE id = $6 AND user_id = $7 AND status = 'draft'
       RETURNING id, subject, preview_text, created_at`,
      [subject, previewText, html, bodyText, blocks ? JSON.stringify(blocks) : null, req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
    res.json({ success: true, draft: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/email-campaigns/drafts/:id
router.delete('/drafts/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM email_campaigns WHERE id = $1 AND user_id = $2 AND status = 'draft' RETURNING id`,
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Campaign Presets ─────────────────────────────────────

// GET /api/email-campaigns/presets
router.get('/presets', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, settings, created_at FROM email_campaign_presets WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json({ presets: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/email-campaigns/presets
router.post('/presets', authenticateToken, async (req, res) => {
  try {
    const { name, settings } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Preset name is required' });
    const result = await pool.query(
      'INSERT INTO email_campaign_presets (user_id, name, settings) VALUES ($1, $2, $3) RETURNING *',
      [req.user.userId, name.trim(), JSON.stringify(settings || {})]
    );
    res.json({ success: true, preset: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/email-campaigns/presets/:id
router.delete('/presets/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM email_campaign_presets WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Preset not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.generateCampaign = generateCampaign;
module.exports.sendCampaign = sendCampaign;
