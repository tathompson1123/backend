const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('../utils/claudeUsage');
const sgMail = require('@sendgrid/mail');
const jwt = require('jsonwebtoken');

const UNSUB_SECRET = process.env.JWT_SECRET || process.env.UNSUB_SECRET || 'sorce-unsubscribe-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.VITE_APP_URL || 'https://app.sorceintegrations.com';

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
        return `  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 28px;text-align:center"><p style="margin:0 0 8px;font-size:12px;color:#6b7280">${esc(c.text||'')}</p><a href="#unsubscribe" style="font-size:12px;color:#6b7280;text-decoration:underline">${esc(c.unsubscribeText||'Unsubscribe')}</a></div>`;
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

// Copywriting frameworks cycled automatically each week (from email-write skill)
const FRAMEWORKS = ['PAS', 'AIDA', 'BAB', 'FAB'];
const FRAMEWORK_INSTRUCTIONS = {
  PAS: 'Use the PAS framework: open with the customer\'s Problem (specific pain they feel), Agitate it (make it feel urgent and real), then introduce your offer as the Solution. The subject line should hook on the problem.',
  AIDA: 'Use the AIDA framework: grab Attention with a bold hook, build Interest with a vivid before/after, stoke Desire by making the offer feel exclusive, then drive Action with a single clear CTA. Subject line should be curiosity-driven.',
  BAB: 'Use the BAB framework: paint the Before (current frustrating state), show the After (the transformed result they want), then position your offer as the Bridge between the two. Subject line should tease the transformation.',
  FAB: 'Use the FAB framework: lead with a Feature (what the offer includes), explain the Advantage (why it\'s better), then land on the Benefit (what it means for their life). Subject line should highlight the core benefit.',
};

// Focus types cycled automatically each week when autopilot is on
const FOCUS_ROTATION = ['seasonal', 'upsell', 'referral', 'winback'];

async function getNextFocus(userId, currentFocus) {
  // Look up the last auto-sent focus for this user
  const result = await pool.query(
    'SELECT last_auto_focus FROM email_campaign_configs WHERE user_id = $1',
    [userId]
  );
  const lastFocus = result.rows[0]?.last_auto_focus || currentFocus;
  const idx = FOCUS_ROTATION.indexOf(lastFocus);
  return FOCUS_ROTATION[(idx + 1) % FOCUS_ROTATION.length];
}

async function generateCampaign(userId, config, offerDetails, autoRotate = false) {
  const { businessName, industry, city, services } = await getBusinessContext(userId);
  const recentSubjects = await getRecentSubjects(userId);
  const month = new Date().toLocaleString('default', { month: 'long' });
  const tone = config?.tone || 'friendly';

  // Auto-rotate focus each week when called from cron
  let focus = config?.focus || 'seasonal';
  if (autoRotate) {
    focus = await getNextFocus(userId, focus);
    // Persist the new focus so next week advances again
    await pool.query(
      'UPDATE email_campaign_configs SET last_auto_focus = $1 WHERE user_id = $2',
      [focus, userId]
    );
  }

  // Pick framework by week number so it rotates automatically
  const weekOfYear = Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 604800000);
  const framework = FRAMEWORKS[weekOfYear % FRAMEWORKS.length];
  const frameworkInstruction = FRAMEWORK_INSTRUCTIONS[framework];

  const focusInstructions = {
    seasonal: `Create a time-sensitive seasonal promotion tied to ${month}. Reference the season, weather, or upcoming holidays to make it feel urgent and relevant.`,
    upsell: 'Create an irresistible add-on or bundle offer that upgrades customers to a higher-value service. Show the before/after value clearly.',
    referral: 'Create a referral bonus offer — reward the customer for sending a friend. Make it feel like an exclusive thank-you for being a loyal customer.',
    winback: 'Create a "we miss you" win-back offer for customers who haven\'t booked in a while. Give them a compelling reason to come back now.',
  };

  // Industry-specific hero images — each is a real photo of the actual trade, not generic business shots
  const industryImages = {
    'auto detail':    'photo-1607860108855-64acf2078ed9', // person detailing car exterior
    'auto wrap':      'photo-1552519507-da3b142c6e3d', // car with vinyl wrap
    'auto':           'photo-1503376780353-7e6692767b70', // car close-up
    'ceramic coat':   'photo-1607860108855-64acf2078ed9', // ceramic coating on car
    'window tint':    'photo-1552519507-da3b142c6e3d', // tinted car window
    'landscap':       'photo-1558618666-fcd25c85cd64', // lawn mowing / yard work
    'lawn':           'photo-1558618666-fcd25c85cd64',
    'tree':           'photo-1416879595882-3373a0480b5b', // tree trimming
    'cleaning':       'photo-1581578731548-c64695cc6952', // professional cleaner at work
    'maid':           'photo-1581578731548-c64695cc6952',
    'janitorial':     'photo-1581578731548-c64695cc6952',
    'hvac':           'photo-1621905251918-48416bd8575a', // HVAC tech on unit
    'air condition':  'photo-1621905251918-48416bd8575a',
    'plumb':          'photo-1585771724684-38269d6639fd', // plumber working on pipes
    'roof':           'photo-1625766763788-95dcce9bf5ac', // roofers on a roof
    'gutter':         'photo-1625766763788-95dcce9bf5ac',
    'paint':          'photo-1562259949-e8e7689d7828', // painter rolling wall
    'drywall':        'photo-1562259949-e8e7689d7828',
    'electric':       'photo-1621905252179-8a8e2736b4c7', // electrician at panel
    'solar':          'photo-1509391366360-2e959784a276', // solar panels install
    'dental':         'photo-1606811841689-23dfddce3e95', // dental exam
    'fitness':        'photo-1534438327276-14e5300c3a48', // gym / workout
    'personal train': 'photo-1571019614242-c5c5dee9f50b', // trainer with client
    'salon':          'photo-1521590832167-7bcbfaa6381f', // hair salon chair
    'hair':           'photo-1522337360788-8b13dee7a37e', // hair styling
    'barber':         'photo-1503951914875-452162b0f3f1', // barber shop
    'nail':           'photo-1604654894610-df63bc536371', // nail salon
    'spa':            'photo-1540555700478-4be289fbecef', // spa / massage
    'massage':        'photo-1544161515-4ab6ce6db874',
    'restaurant':     'photo-1414235077428-338989a2e8c0', // restaurant food
    'food':           'photo-1414235077428-338989a2e8c0',
    'catering':       'photo-1555244162-803834f70033',
    'photography':    'photo-1542038784456-1ea8e935640e', // camera / photographer
    'pest':           'photo-1635865165118-b9a9e8f19249', // pest control spray
    'pool':           'photo-1575429198097-0414ec08e8cd', // pool cleaning
    'moving':         'photo-1530103862676-de8c9debad1d', // movers carrying boxes
    'storage':        'photo-1530103862676-de8c9debad1d',
    'dog':            'photo-1587300003388-59208cc962cb', // dog grooming / walk
    'pet':            'photo-1548199973-03cce0bbc87b',
    'vet':            'photo-1628009368231-7bb7cfcb0def',
    'tutor':          'photo-1580582932707-520aed937b7b', // tutoring / education
    'general':        'photo-1600880292203-757bb62b4baf', // professional handshake
  };
  const ind = industry.toLowerCase();
  const industryKey = Object.keys(industryImages).find(k => ind.includes(k)) || 'general';
  const heroImageUrl = `https://images.unsplash.com/${industryImages[industryKey]}?w=600&q=80&auto=format&fit=crop`;

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
Copywriting framework: ${frameworkInstruction}
Offer expires: ${expiryStr}
${offerSection ? offerSection + '\n' : ''}${recentSubjects.length ? `Recent subjects used (DO NOT repeat these concepts): ${recentSubjects.join(' | ')}` : ''}

Write ONE high-converting weekly email. Apply the copywriting framework strictly — it should shape the flow of the entire body copy.

SUBJECT LINE: Under 55 chars. Use a curiosity gap or open loop. No generic words like "newsletter".
PREVIEW TEXT: 80-100 chars. Continue the curiosity hook, tease without revealing the offer fully.

Return ONLY valid JSON (no markdown, no code blocks) with this structure:
{
  "subject": "...",
  "previewText": "...",
  "bodyText": "plain text version of the full email",
  "annotations": [
    { "blockType": "urgency_bar", "label": "Tension builder", "note": "One sentence explaining the psychological tactic used here" },
    { "blockType": "body", "label": "Hook", "note": "One sentence on why the opening works" },
    { "blockType": "offer_box", "label": "Anchor offer", "note": "One sentence on why this offer structure drives action" },
    { "blockType": "cta_button", "label": "Call to action", "note": "One sentence on the action psychology used" }
  ],
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
- Replace ALL placeholders in brackets with real, compelling copy
- Annotations: write short, punchy labels (2-4 words) and plain-English notes (1 sentence) that explain the copywriting tactic — no jargon`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });
  logClaudeUsage(userId, 'claude-haiku-4-5-20251001', response.usage, 'email_campaign');

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
    annotations: parsed.annotations || [],
    meta: { framework, focus },
  };
}

async function sendCampaign(userId, config, campaignId) {
  // Get all customers with emails who haven't unsubscribed
  const customersResult = await pool.query(
    `SELECT name, email FROM customers
     WHERE user_id = $1 AND email IS NOT NULL AND email != ''
     AND (email_unsubscribed IS NULL OR email_unsubscribed = FALSE)`,
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

  const messages = customersResult.rows.map(customer => {
    // Generate a signed unsubscribe token for this recipient
    const unsubToken = jwt.sign(
      { email: customer.email, userId, type: 'unsubscribe' },
      UNSUB_SECRET,
      { expiresIn: '365d' }
    );
    const unsubUrl = `${FRONTEND_URL}/unsubscribe?token=${unsubToken}`;

    // Inject unsubscribe URL into the email HTML (replace placeholder or append)
    const htmlWithUnsub = (c.body_html || '').replace(/href="#unsubscribe"/g, `href="${unsubUrl}"`)
      .replace(/{{UNSUBSCRIBE_URL}}/g, unsubUrl);

    return {
      to: customer.email,
      from: { name: fromName, email: 'noreply@sorceintegrations.com' },
      replyTo: ownerReplyEmail ? { name: fromName, email: ownerReplyEmail } : undefined,
      subject: c.subject,
      text: c.body_text,
      html: htmlWithUnsub,
      trackingSettings: { clickTracking: { enable: true }, openTracking: { enable: true } },
    };
  });

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

pool.query(`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS annotations JSONB`)
  .catch(e => console.error('email_campaigns annotations column migration error:', e.message));

pool.query(`ALTER TABLE email_campaign_configs ADD COLUMN IF NOT EXISTS cta_link TEXT`)
  .catch(e => console.error('email_campaign_configs cta_link migration error:', e.message));

pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN DEFAULT FALSE`)
  .catch(e => console.error('customers email_unsubscribed column migration error:', e.message));

pool.query(`ALTER TABLE email_campaign_configs ADD COLUMN IF NOT EXISTS last_auto_focus VARCHAR(20)`)
  .catch(e => console.error('email_campaign_configs last_auto_focus migration error:', e.message));

pool.query(`ALTER TABLE email_campaign_configs ADD COLUMN IF NOT EXISTS auto_send BOOLEAN DEFAULT FALSE`)
  .catch(e => console.error('email_campaign_configs auto_send migration error:', e.message));

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
    const { enabled, send_day, send_hour, from_name, from_email, tone, focus, auto_send, cta_link } = req.body;
    const result = await pool.query(
      `INSERT INTO email_campaign_configs (user_id, enabled, send_day, send_hour, from_name, from_email, tone, focus, auto_send, cta_link, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = $2, send_day = $3, send_hour = $4,
         from_name = $5, from_email = $6, tone = $7, focus = $8, auto_send = $9, cta_link = $10, updated_at = NOW()
       RETURNING *`,
      [req.user.userId, enabled ?? true, send_day || 'monday', send_hour ?? 9, from_name, from_email, tone || 'friendly', focus || 'seasonal', auto_send ?? false, cta_link || null]
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

// GET /api/email-campaigns/current-draft — fetch or auto-generate this week's campaign
router.get('/current-draft', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Look for a draft created in the last 7 days
    const existing = await pool.query(
      `SELECT id, subject, preview_text, body_html, blocks, body_text, annotations, created_at
       FROM email_campaigns
       WHERE user_id = $1 AND status = 'draft'
         AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (existing.rows.length > 0) {
      const d = existing.rows[0];
      let annotations = d.annotations || [];
      if (typeof annotations === 'string') { try { annotations = JSON.parse(annotations); } catch { annotations = []; } }

      if (annotations.length > 0) {
        // Good draft with annotations — return it
        let blocks = d.blocks || [];
        if (typeof blocks === 'string') { try { blocks = JSON.parse(blocks); } catch { blocks = []; } }
        return res.json({ campaign: { ...d, blocks, annotations }, generated: false });
      }
      // Draft has no annotations (generated before this feature) — replace it so user gets fresh annotated campaign
      await pool.query("UPDATE email_campaigns SET status = 'replaced' WHERE id = $1", [d.id]);
    }

    // None found — auto-generate one now
    const configResult = await pool.query(
      'SELECT * FROM email_campaign_configs WHERE user_id = $1',
      [userId]
    );
    const config = configResult.rows[0] || {};
    // Pass saved CTA link as offerDetails so it applies to the button
    const offerDetails = config.cta_link ? { ctaLink: config.cta_link } : null;

    const campaign = await generateCampaign(userId, config, offerDetails, true);

    const saved = await pool.query(
      `INSERT INTO email_campaigns (user_id, subject, preview_text, body_html, body_text, blocks, annotations, status, scheduled_for, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', NOW(), NOW()) RETURNING id, created_at`,
      [userId, campaign.subject, campaign.previewText, campaign.bodyHtml, campaign.bodyText, JSON.stringify(campaign.blocks), JSON.stringify(campaign.annotations || [])]
    );

    res.json({
      campaign: { id: saved.rows[0].id, created_at: saved.rows[0].created_at, ...campaign },
      generated: true,
    });
  } catch (e) {
    console.error('current-draft error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/email-campaigns/refine — owner asks SORCE to tweak the draft
router.post('/refine', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { draftId, feedback } = req.body;
    if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback is required' });

    const { businessName, industry, services } = await getBusinessContext(userId);

    // Load the existing draft so we can pass it as context
    const draftResult = await pool.query(
      'SELECT subject, preview_text, body_text FROM email_campaigns WHERE id = $1 AND user_id = $2',
      [draftId, userId]
    );
    const draft = draftResult.rows[0];
    if (!draft) return res.status(404).json({ error: 'Draft not found' });

    const configResult = await pool.query(
      'SELECT * FROM email_campaign_configs WHERE user_id = $1',
      [userId]
    );
    const config = configResult.rows[0] || {};

    const { businessName: bn, industry: ind, city, services: svcs } = await getBusinessContext(userId);
    const month = new Date().toLocaleString('default', { month: 'long' });

    const industryImages = {
      'auto detail': 'photo-1607860108855-64acf2078ed9', 'auto wrap': 'photo-1552519507-da3b142c6e3d',
      'ceramic coat': 'photo-1607860108855-64acf2078ed9', auto: 'photo-1503376780353-7e6692767b70',
      landscap: 'photo-1558618666-fcd25c85cd64', lawn: 'photo-1558618666-fcd25c85cd64',
      cleaning: 'photo-1581578731548-c64695cc6952', hvac: 'photo-1621905251918-48416bd8575a',
      plumb: 'photo-1585771724684-38269d6639fd', roof: 'photo-1625766763788-95dcce9bf5ac',
      paint: 'photo-1562259949-e8e7689d7828', electric: 'photo-1621905252179-8a8e2736b4c7',
      dental: 'photo-1606811841689-23dfddce3e95', fitness: 'photo-1534438327276-14e5300c3a48',
      salon: 'photo-1521590832167-7bcbfaa6381f', hair: 'photo-1522337360788-8b13dee7a37e',
      barber: 'photo-1503951914875-452162b0f3f1', restaurant: 'photo-1414235077428-338989a2e8c0',
      photography: 'photo-1542038784456-1ea8e935640e', pest: 'photo-1635865165118-b9a9e8f19249',
      pool: 'photo-1575429198097-0414ec08e8cd', moving: 'photo-1530103862676-de8c9debad1d',
      dog: 'photo-1587300003388-59208cc962cb', pet: 'photo-1548199973-03cce0bbc87b',
      general: 'photo-1600880292203-757bb62b4baf',
    };
    const industryKey = Object.keys(industryImages).find(k => ind.toLowerCase().includes(k)) || 'general';
    const heroImageUrl = `https://images.unsplash.com/${industryImages[industryKey]}?w=600&q=80&auto=format&fit=crop`;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (7 - expiryDate.getDay()));
    const expiryStr = expiryDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const prompt = `You are refining a weekly promotional email for ${bn}, a ${ind} business.

Current email subject: "${draft.subject}"
Current email body (plain text):
${draft.body_text || '(no body text saved)'}

Owner's requested change: "${feedback.trim()}"

Rewrite the email incorporating the owner's feedback. Keep what works, change what they asked.
Month: ${month}. Services: ${svcs.length ? svcs.join(', ') : 'various services'}.

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "subject": "...",
  "previewText": "...",
  "bodyText": "plain text version",
  "blocks": [
    { "type": "header", "content": { "title": "${bn}", "bgColor": "#111827", "textColor": "#ffffff" } },
    { "type": "hero_image", "content": { "src": "${heroImageUrl}", "alt": "${bn} offer" } },
    { "type": "urgency_bar", "content": { "text": "⏰ This offer expires ${expiryStr} — don't miss it", "bgColor": "#fef3c7", "textColor": "#92400e" } },
    { "type": "body", "content": { "heading": "[HOOK HEADING]", "paragraphs": ["[para 1]", "[para 2]"] } },
    { "type": "offer_box", "content": { "title": "[OFFER TITLE]", "description": "[offer details]", "bgColor": "#f0fdf4", "borderColor": "#22c55e" } },
    { "type": "cta_button", "content": { "text": "[CTA TEXT]", "link": "#", "bgColor": "#111827", "textColor": "#ffffff", "borderRadius": "8px" } },
    { "type": "signoff", "content": { "text": "The ${bn} team" } },
    { "type": "footer", "content": { "text": "You're receiving this because you've used ${bn} before.", "unsubscribeText": "Unsubscribe" } }
  ]
}
Replace ALL bracket placeholders with real copy.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    logClaudeUsage(userId, 'claude-haiku-4-5-20251001', response.usage, 'email_refine');

    const text = response.content[0].text.trim();
    let json = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const jsonMatch = json.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');
    const parsed = JSON.parse(jsonMatch[0]);

    const { randomUUID } = require('crypto');
    const blocks = (parsed.blocks || []).map(b => ({ ...b, id: randomUUID().slice(0, 8) }));
    const bodyHtml = emailBlocksToHtml(blocks);

    // Update the existing draft in place
    await pool.query(
      `UPDATE email_campaigns
       SET subject=$1, preview_text=$2, body_html=$3, body_text=$4, blocks=$5
       WHERE id=$6 AND user_id=$7`,
      [parsed.subject, parsed.previewText, bodyHtml, parsed.bodyText, JSON.stringify(blocks), draftId, userId]
    );

    res.json({
      success: true,
      campaign: { id: draftId, subject: parsed.subject, previewText: parsed.previewText, bodyHtml, bodyText: parsed.bodyText, blocks },
    });
  } catch (e) {
    console.error('refine error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/email-campaigns/stats — subscriber count, next send date, last framework used
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Count reachable subscribers (have email, not unsubscribed)
    const subsResult = await pool.query(
      `SELECT COUNT(*) AS count FROM customers
       WHERE user_id = $1 AND email IS NOT NULL AND email != ''
       AND (email_unsubscribed IS NULL OR email_unsubscribed = FALSE)`,
      [userId]
    );

    // Get config for next-send calculation
    const configResult = await pool.query(
      'SELECT send_day, send_hour, enabled, last_auto_focus FROM email_campaign_configs WHERE user_id = $1',
      [userId]
    );
    const cfg = configResult.rows[0];

    let nextSend = null;
    if (cfg?.enabled && cfg.send_day) {
      const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
      const targetDay = dayMap[cfg.send_day] ?? 1;
      const targetHour = cfg.send_hour ?? 9;
      const now = new Date();
      const next = new Date(now);
      next.setHours(targetHour, 0, 0, 0);
      const daysUntil = (targetDay - now.getDay() + 7) % 7 || (now.getHours() >= targetHour ? 7 : 0);
      next.setDate(now.getDate() + daysUntil);
      nextSend = next.toISOString();
    }

    // What focus will next auto-send use
    const lastFocus = cfg?.last_auto_focus || cfg?.focus || 'seasonal';
    const nextFocusIdx = (FOCUS_ROTATION.indexOf(lastFocus) + 1) % FOCUS_ROTATION.length;
    const nextFocus = FOCUS_ROTATION[nextFocusIdx];

    // What framework will next auto-send use
    const weekOfYear = Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 604800000);
    const nextFramework = FRAMEWORKS[(weekOfYear + 1) % FRAMEWORKS.length];

    res.json({
      subscriberCount: parseInt(subsResult.rows[0].count, 10),
      nextSend,
      nextFocus,
      nextFramework,
    });
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
      from: { name: config.from_name || 'Campaign Test', email: 'noreply@sorceintegrations.com' },
      replyTo: { name: config.from_name || '', email: config.from_email },
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

// GET /api/email-campaigns/unsubscribe?token=...  (public — no auth required)
router.get('/unsubscribe', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    let payload;
    try {
      payload = jwt.verify(token, UNSUB_SECRET);
    } catch {
      return res.status(400).json({ error: 'Invalid or expired unsubscribe link' });
    }

    if (payload.type !== 'unsubscribe' || !payload.email || !payload.userId) {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    await pool.query(
      `UPDATE customers SET email_unsubscribed = TRUE
       WHERE LOWER(email) = LOWER($1) AND user_id = $2`,
      [payload.email, payload.userId]
    );

    res.json({ success: true, email: payload.email });
  } catch (e) {
    console.error('Unsubscribe error:', e.message);
    res.status(500).json({ error: 'Failed to process unsubscribe' });
  }
});

module.exports = router;
module.exports.generateCampaign = generateCampaign;
module.exports.sendCampaign = sendCampaign;
