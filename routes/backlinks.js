const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('../utils/claudeUsage');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Master directory list ─────────────────────────────────────
const DIRECTORIES = [
  // Priority 1 — high authority, always submit
  { id: 'google_business',  name: 'Google Business Profile', url: 'https://business.google.com/add',                     authority: 'high',   category: 'general',  priority: 1 },
  { id: 'bing_places',      name: 'Bing Places',             url: 'https://www.bingplaces.com/',                         authority: 'high',   category: 'general',  priority: 1 },
  { id: 'apple_maps',       name: 'Apple Maps Connect',      url: 'https://mapsconnect.apple.com/',                      authority: 'high',   category: 'general',  priority: 1 },
  { id: 'yelp',             name: 'Yelp for Business',        url: 'https://biz.yelp.com/signup',                         authority: 'high',   category: 'general',  priority: 1 },
  { id: 'facebook',         name: 'Facebook Business Page',   url: 'https://www.facebook.com/pages/create',               authority: 'high',   category: 'general',  priority: 1 },
  { id: 'nextdoor',         name: 'Nextdoor Business',        url: 'https://business.nextdoor.com/',                      authority: 'high',   category: 'local',    priority: 1 },
  { id: 'angi',             name: 'Angi (Angie\'s List)',     url: 'https://pro.angi.com/',                               authority: 'high',   category: 'service',  priority: 1 },
  { id: 'thumbtack',        name: 'Thumbtack Pro',            url: 'https://www.thumbtack.com/pro/',                      authority: 'high',   category: 'service',  priority: 1 },
  { id: 'homeadvisor',      name: 'HomeAdvisor Pro',          url: 'https://pro.homeadvisor.com/',                        authority: 'high',   category: 'service',  priority: 1 },
  { id: 'houzz',            name: 'Houzz Pro',                url: 'https://www.houzz.com/pro',                           authority: 'high',   category: 'service',  priority: 1 },
  // Priority 2 — medium authority, important for citations
  { id: 'bbb',              name: 'Better Business Bureau',   url: 'https://www.bbb.org/bbb-accreditation',               authority: 'high',   category: 'general',  priority: 2 },
  { id: 'yellowpages',      name: 'YellowPages',              url: 'https://www.yellowpages.com/free-business-listing',   authority: 'medium', category: 'general',  priority: 2 },
  { id: 'foursquare',       name: 'Foursquare',               url: 'https://business.foursquare.com/',                    authority: 'medium', category: 'general',  priority: 2 },
  { id: 'manta',            name: 'Manta',                    url: 'https://www.manta.com/claim',                         authority: 'medium', category: 'general',  priority: 2 },
  { id: 'superpages',       name: 'Superpages',               url: 'https://www.superpages.com/advertise/',               authority: 'medium', category: 'general',  priority: 2 },
  { id: 'mapquest',         name: 'MapQuest',                 url: 'https://www.mapquest.com/add-business',               authority: 'medium', category: 'general',  priority: 2 },
  { id: 'chamberofcommerce',name: 'Chamber of Commerce',      url: 'https://www.chamberofcommerce.com/business-directory/add', authority: 'medium', category: 'general', priority: 2 },
  { id: 'porch',            name: 'Porch',                    url: 'https://porch.com/pro',                               authority: 'medium', category: 'service',  priority: 2 },
  { id: 'bark',             name: 'Bark.com',                 url: 'https://www.bark.com/become-a-pro/',                  authority: 'medium', category: 'service',  priority: 2 },
  { id: 'networx',          name: 'Networx',                  url: 'https://www.networx.com/contractors/signup',          authority: 'medium', category: 'service',  priority: 2 },
  // Priority 3 — supporting citations, long tail
  { id: 'hotfrog',          name: 'Hotfrog',                  url: 'https://www.hotfrog.com/AddBusiness.aspx',            authority: 'low',    category: 'general',  priority: 3 },
  { id: 'cylex',            name: 'Cylex',                    url: 'https://www.cylex.us.com/add-company.html',           authority: 'low',    category: 'general',  priority: 3 },
  { id: 'brownbook',        name: 'Brownbook',                url: 'https://www.brownbook.net/add-business/',             authority: 'low',    category: 'general',  priority: 3 },
  { id: 'n49',              name: 'n49',                      url: 'https://n49.com/business/add',                        authority: 'low',    category: 'general',  priority: 3 },
  { id: 'yalwa',            name: 'Yalwa',                    url: 'https://www.yalwa.com/register/',                     authority: 'low',    category: 'general',  priority: 3 },
];

// ── GET /api/backlinks/directories ───────────────────────────
// Returns full directory list merged with user's submission statuses
router.get('/directories', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(
      'SELECT directory_id, status, submitted_at, notes FROM citation_submissions WHERE user_id = $1',
      [userId]
    );
    const statusMap = {};
    result.rows.forEach(r => { statusMap[r.directory_id] = r; });

    const directories = DIRECTORIES.map(d => ({
      ...d,
      status: statusMap[d.id]?.status || 'pending',
      submitted_at: statusMap[d.id]?.submitted_at || null,
      notes: statusMap[d.id]?.notes || '',
    }));

    res.json({ success: true, directories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/backlinks/directories/mark ─────────────────────
// Mark a directory submission status
router.post('/directories/mark', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { directoryId, status, notes } = req.body;
  if (!directoryId || !status) return res.status(400).json({ error: 'directoryId and status required' });

  const dir = DIRECTORIES.find(d => d.id === directoryId);
  if (!dir) return res.status(404).json({ error: 'Directory not found' });

  try {
    await pool.query(
      `INSERT INTO citation_submissions (user_id, directory_id, directory_name, status, notes, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, directory_id)
       DO UPDATE SET status = $4, notes = $5, submitted_at = $6`,
      [userId, directoryId, dir.name, status, notes || '', status === 'submitted' ? new Date() : null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/backlinks/citations/check ──────────────────────
// Claude-powered citation consistency analysis
router.post('/citations/check', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  let bizInfo = {}, websiteInfo = {};
  try {
    const [bizRes, webRes] = await Promise.all([
      pool.query(
        `SELECT u.business_name AS name, bi.phone, bi.email, bi.city, bi.state, bi.address, bi.zip_code AS zip
         FROM users u LEFT JOIN business_information bi ON bi.user_id = u.id
         WHERE u.id = $1`,
        [userId]
      ),
      pool.query('SELECT business_name, business_type, vercel_url FROM websites WHERE user_id = $1', [userId]),
    ]);
    bizInfo = bizRes.rows[0] || {};
    websiteInfo = webRes.rows[0] || {};
  } catch (err) {
    console.warn('[backlinks/citations] Context load error:', err.message);
  }

  const businessName = websiteInfo.business_name || bizInfo.name || 'Your Business';
  const phone = bizInfo.phone || '';
  const address = bizInfo.address || '';
  const city = bizInfo.city || '';
  const state = bizInfo.state || '';
  const zip = bizInfo.zip || '';
  const url = websiteInfo.vercel_url || '';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: `You are a local SEO expert specialising in citation consistency for small businesses.
Respond ONLY with valid JSON — no markdown, no explanation, no code fences.`,
      messages: [{
        role: 'user',
        content: `Perform a citation consistency audit for this business and return actionable findings.

BUSINESS NAP:
Name: ${businessName}
Phone: ${phone}
Address: ${address}
City: ${city}
State: ${state}
ZIP: ${zip}
Website: ${url}

Return ONLY a JSON object:
{
  "napScore": <0-100 completeness score for the NAP data provided>,
  "missingFields": ["list of NAP fields that are empty or missing"],
  "napIssues": [
    { "field": "field name", "issue": "what might be inconsistent", "severity": "high|medium|low", "fix": "how to standardize it" }
  ],
  "commonMistakes": [
    { "mistake": "description of a common citation mistake for this type of business", "example": "e.g. listing phone as (555) 123-4567 in some places and 5551234567 in others" }
  ],
  "standardizedNap": {
    "name": "standardized business name",
    "phone": "standardized phone format: (XXX) XXX-XXXX",
    "address": "standardized full address",
    "url": "standardized URL with https://"
  },
  "priorityDirectories": ["top 5 directory names most important for this business type to be listed on"],
  "tips": ["actionable tip 1", "actionable tip 2", "actionable tip 3"]
}`,
      }],
    });
    logClaudeUsage(userId, 'claude-sonnet-4-6', message.usage, 'citation_check');

    const raw = message.content[0]?.text || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let report;
    try {
      report = JSON.parse(cleaned);
    } catch (parseErr) {
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > 0) {
        try { report = JSON.parse(cleaned.substring(0, lastBrace + 1)); } catch { throw parseErr; }
      } else { throw parseErr; }
    }

    // Save to DB
    await pool.query(
      `INSERT INTO citation_checks (user_id, report, nap_score, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET report = $2, nap_score = $3, created_at = NOW()`,
      [userId, report, report.napScore]
    );

    res.json({ success: true, report, businessName, phone, address, city, state, url });
  } catch (err) {
    console.error('[backlinks/citations] Error:', err.message);
    res.status(500).json({ error: `Failed to run citation check: ${err.message}` });
  }
});

// ── GET /api/backlinks/citations/last ────────────────────────
router.get('/citations/last', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(
      'SELECT report, nap_score, created_at FROM citation_checks WHERE user_id = $1',
      [userId]
    );
    if (!result.rows.length) return res.json({ success: true, report: null });
    const row = result.rows[0];
    res.json({ success: true, report: row.report, napScore: row.nap_score, savedAt: row.created_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/backlinks/content/generate ─────────────────────
// Generate link-bait content + outreach templates
router.post('/content/generate', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { contentType, topic } = req.body;
  if (!contentType || !topic) return res.status(400).json({ error: 'contentType and topic required' });

  let bizInfo = {}, websiteInfo = {};
  try {
    const [bizRes, webRes] = await Promise.all([
      pool.query('SELECT phone, email, city, state, address FROM business_information WHERE user_id = $1', [userId]),
      pool.query('SELECT business_name, business_type, vercel_url FROM websites WHERE user_id = $1', [userId]),
    ]);
    bizInfo = bizRes.rows[0] || {};
    websiteInfo = webRes.rows[0] || {};
  } catch (err) {
    console.warn('[backlinks/content] Context load error:', err.message);
  }

  const businessName = websiteInfo.business_name || 'Local Business';
  const businessType = websiteInfo.business_type || 'local service business';
  const city = bizInfo.city || '';
  const state = bizInfo.state || '';
  const phone = bizInfo.phone || '';
  const url = websiteInfo.vercel_url ? `https://${websiteInfo.vercel_url.replace(/^https?:?\/*/, '')}` : '';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 7000,
      system: `You are an expert local SEO strategist and content marketer for small service businesses.
You create content specifically designed to attract backlinks and social shares from local sources.
Respond ONLY with valid JSON — no markdown, no explanation, no code fences.`,
      messages: [{
        role: 'user',
        content: `Generate a link-bait content piece AND outreach templates for this local business.

BUSINESS:
- Name: ${businessName}
- Type: ${businessType}
- City/State: ${[city, state].filter(Boolean).join(', ') || 'local area'}
- Phone: ${phone}
- Website: ${url}

CONTENT TYPE: ${contentType}
TOPIC: ${topic}

Return ONLY a JSON object:
{
  "title": "compelling, shareable title",
  "contentPiece": {
    "headline": "H1 headline",
    "subheadline": "supporting subheadline",
    "body": "full content body in HTML (h2/h3/p/ul/li, 600-900 words) — locally focused, data-driven where possible, genuinely useful to local readers",
    "cta": "closing call-to-action paragraph",
    "suggestedSlug": "url-slug",
    "targetKeywords": ["keyword1", "keyword2", "keyword3"]
  },
  "shareTargets": [
    { "type": "Local Facebook Group", "where": "Search Facebook for '[city] community / neighborhood groups'", "how": "Post the article link with a 2-sentence hook. Don't self-promote — lead with value." },
    { "type": "Nextdoor", "where": "Post in your local Nextdoor neighborhood feed", "how": "Frame it as a helpful local resource, mention your business at the end." },
    { "type": "Local News Site", "where": "Find your city's local news blog or patch.com/[city]", "how": "Email the editor with the pitch below." },
    { "type": "Chamber of Commerce", "where": "Your local chamber's website/newsletter", "how": "Email the chamber director with the pitch below." },
    { "type": "Neighborhood Blog", "where": "Search '[city] neighborhood blog' to find hyperlocal sites", "how": "Guest post offer or simple link request." }
  ],
  "outreachTemplates": {
    "localBlogger": {
      "subject": "email subject line",
      "body": "full email body (3-4 paragraphs, friendly, value-first, clear ask)"
    },
    "chamberOfCommerce": {
      "subject": "email subject line",
      "body": "full email body"
    },
    "localNews": {
      "subject": "email subject line",
      "body": "full email body"
    }
  },
  "estimatedLinks": "realistic range e.g. '3-8 local backlinks'",
  "timeToResults": "e.g. '2-4 weeks'"
}`,
      }],
    });
    logClaudeUsage(userId, 'claude-sonnet-4-6', message.usage, 'backlink_content');

    const raw = message.content[0]?.text || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let content;
    try {
      content = JSON.parse(cleaned);
    } catch (parseErr) {
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > 0) {
        try { content = JSON.parse(cleaned.substring(0, lastBrace + 1)); } catch { throw parseErr; }
      } else { throw parseErr; }
    }

    // Save to history
    await pool.query(
      `INSERT INTO backlink_content (user_id, content_type, topic, title, content_data, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [userId, contentType, topic, content.title, content]
    );

    res.json({ success: true, content });
  } catch (err) {
    console.error('[backlinks/content] Error:', err.message);
    res.status(500).json({ error: `Failed to generate content: ${err.message}` });
  }
});

// ── GET /api/backlinks/content/history ───────────────────────
router.get('/content/history', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(
      'SELECT id, content_type, topic, title, created_at FROM backlink_content WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId]
    );
    res.json({ success: true, history: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
