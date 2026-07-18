const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('../utils/claudeUsage');
const { buildLocalBusinessSchema, buildFaqSchema } = require('../utils/seoSchema');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory rate limit map: userId -> timestamp of last audit
const auditRateLimits = new Map();

// Validate/repair the AI-generated SEO head block before we hand it over for pasting.
// Swaps any leaked "SITE_URL" placeholder for the real site URL (or strips it when we
// don't have one), then drops any <script type="application/ld+json"> block whose JSON
// doesn't parse — so a malformed block never ships as broken structured data.
function sanitizeHeadCode(html, siteUrl) {
  if (!html || typeof html !== 'string') return html || '';
  let out = html;
  if (siteUrl) {
    out = out.replace(/SITE_URL/g, siteUrl);
  } else {
    // No known URL — remove any `"url": "SITE_URL"` line rather than ship a placeholder.
    out = out.replace(/["']url["']\s*:\s*["']SITE_URL["']\s*,?\s*/g, '');
  }
  out = out.replace(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    (full, json) => {
      try { JSON.parse(json.trim()); return full; }
      catch { console.warn('[seo/generate-code] dropped an invalid JSON-LD block'); return ''; }
    }
  );
  return out;
}

// ─── POST /api/seo-audit/run ─────────────────────────────────
router.post('/run', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  // ── Plan check ──────────────────────────────────────────────
  try {
    const planResult = await pool.query('SELECT plan, trial_ends_at FROM users WHERE id = $1', [userId]);
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const plan = planResult.rows[0].plan;
    const trialEndsAt = planResult.rows[0].trial_ends_at;
    const onActiveTrial = trialEndsAt && new Date(trialEndsAt) > new Date();
    const allowedPlans = ['pro', 'expert', 'scale'];
    if (!allowedPlans.includes(plan) && !onActiveTrial) {
      return res.status(403).json({ error: 'Pro plan required' });
    }
  } catch (err) {
    console.error('[seo-audit] Plan check error:', err.message);
    return res.status(500).json({ error: 'Failed to verify plan' });
  }

  // ── Rate limit ───────────────────────────────────────────────
  const lastAudit = auditRateLimits.get(userId);
  if (lastAudit && Date.now() - lastAudit < 60 * 1000) {
    const secondsLeft = Math.ceil((60 * 1000 - (Date.now() - lastAudit)) / 1000);
    return res.status(429).json({ error: `Please wait ${secondsLeft} seconds before running another audit.` });
  }

  // ── URL validation + normalization ──────────────────────────
  let { url } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'A URL is required.' });
  }
  url = url.trim();
  // Auto-prepend https:// if missing protocol
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  // ── Fetch website HTML ───────────────────────────────────────
  let htmlContent = '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const fetchRes = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SEO-Audit-Bot/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    const text = await fetchRes.text();
    htmlContent = text.slice(0, 50000);
  } catch (err) {
    console.error('[seo-audit] Fetch error:', err.message);
    // Continue with empty HTML — Claude can still analyze the URL
    htmlContent = '<!-- Could not fetch page content -->';
  }

  // ── Build prompt ─────────────────────────────────────────────
  const systemPrompt = `You are an expert SEO analyst specializing in small local service businesses.
You analyze website HTML and provide detailed, actionable SEO audits.
You understand all aspects of modern SEO: technical optimization, on-page factors, content quality, Core Web Vitals signals from HTML structure, schema markup, local SEO, and AI search readiness (being properly indexed and understood by AI-powered search engines like Perplexity, Google SGE, and Bing Copilot).
You always respond with ONLY valid JSON — no markdown, no explanation, no code blocks.`;

  const userMessage = `Analyze this website for SEO and return a comprehensive audit as a single JSON object.

URL: ${url}

HTML CONTENT:
${htmlContent}

Return ONLY a valid JSON object (no markdown, no explanation, no code fences) with this exact structure:
{
  "score": <weighted average 0-100: technical 22%, content 23%, onPage 20%, schema 10%, performance 10%, aiReadiness 10%, localSeo 5%>,
  "url": "${url}",
  "businessType": "<detected business type, e.g. 'Local Plumbing Service', 'Restaurant', 'Law Firm'>",
  "summary": "<2-3 sentence executive summary of the site's overall SEO health>",
  "categories": {
    "technical": {
      "score": <0-100>,
      "label": "Technical SEO",
      "issues": ["<specific technical issue found>", ...],
      "passes": ["<technical element done well>", ...]
    },
    "onPage": {
      "score": <0-100>,
      "label": "On-Page SEO",
      "issues": ["<on-page issue>", ...],
      "passes": ["<on-page pass>", ...]
    },
    "content": {
      "score": <0-100>,
      "label": "Content Quality",
      "issues": ["<content issue>", ...],
      "passes": ["<content pass>", ...]
    },
    "performance": {
      "score": <0-100>,
      "label": "Performance",
      "issues": ["<performance issue inferred from HTML>", ...],
      "passes": ["<performance pass>", ...]
    },
    "schema": {
      "score": <0-100>,
      "label": "Schema Markup",
      "issues": ["<schema issue>", ...],
      "passes": ["<schema pass>", ...]
    },
    "localSeo": {
      "score": <0-100>,
      "label": "Local SEO",
      "issues": ["<local SEO issue>", ...],
      "passes": ["<local SEO pass>", ...]
    },
    "aiReadiness": {
      "score": <0-100>,
      "label": "AI Search Readiness",
      "issues": ["<AI readiness issue — specifically check for: missing speakable schema, missing FAQPage schema, no sameAs entity linking, schema type too generic (LocalBusiness instead of specific type), missing llms.txt, no structured Q&A content, city/state not in JSON-LD description, competitor links visible in page content>", ...],
      "passes": ["<AI readiness pass>", ...]
    }
  },
  "criticalIssues": ["<most urgent issue 1>", "<most urgent issue 2>", ...],
  "quickWins": ["<easy improvement 1>", "<easy improvement 2>", "<easy improvement 3>", ...],
  "actionPlan": {
    "critical": [{ "title": "<action title>", "description": "<what to do and why>", "impact": "high" }],
    "high": [{ "title": "...", "description": "...", "impact": "high" }],
    "medium": [{ "title": "...", "description": "...", "impact": "medium" }],
    "low": [{ "title": "...", "description": "...", "impact": "low" }]
  }
}

Be specific and actionable. Reference actual content from the HTML where relevant. Score each category fairly based on what you observe. The overall score must equal the weighted average: technical*0.22 + content*0.23 + onPage*0.20 + schema*0.10 + performance*0.10 + aiReadiness*0.10 + localSeo*0.05.`;

  // ── Call Claude ──────────────────────────────────────────────
  let parsedAudit;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    logClaudeUsage(userId, 'claude-sonnet-4-5', message.usage, 'seo_audit');

    const rawText = message.content[0]?.text || '';

    // Strip any accidental markdown code fences
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    try {
      parsedAudit = JSON.parse(cleaned);
    } catch (parseErr) {
      // Response may be truncated — attempt repair by closing open JSON structure
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > 0) {
        try {
          parsedAudit = JSON.parse(cleaned.substring(0, lastBrace + 1));
        } catch {
          throw parseErr;
        }
      } else {
        throw parseErr;
      }
    }
  } catch (err) {
    console.error('[seo-audit] Claude/parse error:', err.message, err.status || '');
    return res.status(500).json({ error: `Failed to generate SEO audit: ${err.message}` });
  }

  // Record rate limit timestamp
  auditRateLimits.set(userId, Date.now());

  // Auto-save audit to DB
  try {
    await pool.query(
      `INSERT INTO seo_audits (user_id, url, audit) VALUES ($1, $2, $3)`,
      [userId, url, parsedAudit]
    );
  } catch (err) {
    console.warn('[seo-audit] Could not save audit:', err.message);
  }

  return res.json({ success: true, audit: parsedAudit });
});

// ─── GET /api/seo-audit/last ─────────────────────────────────
router.get('/last', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    // Get the most recent audit result
    const result = await pool.query(
      `SELECT audit, plan, url, created_at, head_code, llms_txt, code_generated_at FROM seo_audits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) return res.json({ success: true, audit: null, plan: null });
    const row = result.rows[0];

    // If the most recent audit has no head_code (e.g. user re-ran audit without regenerating),
    // pull the most recently generated head_code from any earlier audit row
    let headCode = row.head_code || null;
    let llmsTxt = row.llms_txt || null;
    let codeGeneratedAt = row.code_generated_at || null;
    if (!headCode) {
      const codeRow = await pool.query(
        `SELECT head_code, llms_txt, code_generated_at FROM seo_audits WHERE user_id = $1 AND head_code IS NOT NULL ORDER BY code_generated_at DESC LIMIT 1`,
        [userId]
      );
      if (codeRow.rows.length > 0) {
        headCode = codeRow.rows[0].head_code;
        llmsTxt = codeRow.rows[0].llms_txt;
        codeGeneratedAt = codeRow.rows[0].code_generated_at;
      }
    }

    res.json({
      success: true,
      audit: row.audit,
      plan: row.plan || null,
      savedAt: row.created_at,
      headCode,
      llmsTxtContent: llmsTxt,
      codeGeneratedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/seo-audit/plan ────────────────────────────────
router.post('/plan', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  // Plan check
  try {
    const planResult = await pool.query('SELECT plan FROM users WHERE id = $1', [userId]);
    const plan = planResult.rows[0]?.plan;
    if (!['pro', 'expert', 'scale'].includes(plan)) {
      return res.status(403).json({ error: 'Pro plan required' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify plan' });
  }

  const { audit, platform } = req.body;
  if (!audit || !audit.categories) {
    return res.status(400).json({ error: 'Audit data is required' });
  }

  const PLATFORM_LABELS = {
    wordpress:   'WordPress',
    wix:         'Wix',
    squarespace: 'Squarespace',
    shopify:     'Shopify',
    webflow:     'Webflow',
    godaddy:     'GoDaddy Website Builder',
    weebly:      'Weebly',
    framer:      'Framer',
    sorce:       'SORCE (custom website builder)',
    bigcommerce: 'BigCommerce',
    custom:      'Custom / Developer-built website',
    other:       'Other website platform',
  };
  const platformLabel = PLATFORM_LABELS[platform] || platform || 'their website platform';

  // Load the business's real details so any schema/code step can be handed over already
  // filled in and ready to paste — instead of telling the owner to assemble the code.
  let bizDetails = { name: '', url: audit.url || '', type: audit.businessType || 'local service business', phone: '', email: '', address: '', city: '', state: '', zip: '' };
  try {
    const [bizRes, userRes] = await Promise.all([
      pool.query('SELECT phone, email, address, city, state, zip_code FROM business_information WHERE user_id = $1', [userId]),
      pool.query('SELECT business_name FROM users WHERE id = $1', [userId]),
    ]);
    const b = bizRes.rows[0] || {};
    bizDetails = {
      ...bizDetails,
      name: userRes.rows[0]?.business_name || '',
      phone: b.phone || '', email: b.email || '',
      address: b.address || '', city: b.city || '', state: b.state || '', zip: b.zip_code || '',
    };
  } catch (e) {
    console.warn('[seo/plan] business info load failed:', e.message);
  }

  const systemPrompt = `You are an expert SEO consultant creating detailed implementation plans for small local service businesses.
You write clear, specific, step-by-step instructions that a COMPLETE BEGINNER with no technical background can follow — plain language, no jargon, spell out every click.
Every instruction must reference exact menu names, settings panels, button labels, and navigation paths for the specific platform the user is on.
When a step requires pasting code, you provide the complete, ready-to-paste code already filled in with the business's real details — the owner should never have to write or assemble code themselves.
You always respond with ONLY valid JSON — no markdown, no explanation, no code blocks.`;

  const userMessage = `Based on this SEO audit, create a detailed step-by-step SEO optimization plan.

WEBSITE PLATFORM: ${platformLabel}
CRITICAL: Every single instruction must be written specifically for ${platformLabel}. Use exact menu paths, panel names, field labels, and button names as they appear in ${platformLabel}. Do NOT give generic instructions — if someone is on ${platformLabel}, tell them exactly where to click and what to type.

AUDIT SUMMARY:
URL: ${audit.url}
Business Type: ${audit.businessType}
Overall Score: ${audit.score}/100

BUSINESS DETAILS (use these EXACT values to pre-fill any code or schema you generate — never leave placeholders like "your business name" or "your city"; if a value is blank, omit that field rather than inventing one — and NEVER invent latitude/longitude):
${JSON.stringify(bizDetails, null, 2)}

CATEGORY SCORES AND ISSUES:
${Object.entries(audit.categories).map(([key, cat]) => `
${cat.label} (${cat.score}/100):
Issues: ${(cat.issues || []).join(', ') || 'None'}
`).join('')}

CRITICAL ISSUES: ${(audit.criticalIssues || []).join(', ')}
QUICK WINS: ${(audit.quickWins || []).join(', ')}

Return ONLY a valid JSON object with this exact structure:
{
  "title": "SEO Optimization Plan for [business/url]",
  "overview": "2-3 sentence summary of the plan and expected impact",
  "estimatedTimeTotal": "e.g. 2-4 weeks",
  "platform": "${platformLabel}",
  "phases": [
    {
      "phase": 1,
      "title": "Phase title (e.g. Quick Wins & Critical Fixes)",
      "timeframe": "e.g. Day 1-3",
      "description": "What this phase focuses on",
      "steps": [
        {
          "step": 1,
          "title": "Step title",
          "category": "e.g. Technical SEO",
          "priority": "critical|high|medium|low",
          "timeEstimate": "e.g. 30 minutes",
          "instructions": [
            "Exact instruction 1 written for ${platformLabel} — include exact menu path e.g. 'Go to Settings > SEO > Meta Tags'",
            "Exact instruction 2",
            "Exact instruction 3"
          ],
          "expectedImpact": "What improvement this will make to SEO",
          "code": "<ONLY if this step requires pasting code (schema/JSON-LD, meta tags, etc.): the COMPLETE, ready-to-paste code with the BUSINESS DETAILS already filled in. Otherwise an empty string. Escape it as valid JSON.>"
        }
      ]
    }
  ]
}

Create 3 phases ordered by priority (critical fixes first, then high impact, then polish).
Each phase should have 2-4 steps. Each step should have 3-4 specific instructions.
All instructions must name the exact location in ${platformLabel} — never say "go to your settings", always say the full path for ${platformLabel}.
Do NOT pad with generic advice.

Write for a COMPLETE BEGINNER: plain language, no jargon, spell out every click.
When a step involves adding code (FAQPage schema, LocalBusiness/${bizDetails.type} schema, meta tags, etc.), you MUST:
 - Put the FULL, ready-to-paste code in that step's "code" field, with the BUSINESS DETAILS already filled in (real name, url, phone, address, city, state) — never placeholders and never invented latitude/longitude.
 - Wrap JSON-LD in <script type="application/ld+json"> ... </script> and make sure it is valid JSON.
 - In "instructions", simply tell them where to click and to copy the code shown below and paste it — do NOT ask them to write, edit, or assemble any code themselves, and do NOT describe the code in prose.
 - For a FAQPage step, write 4-5 real question/answer pairs that ${bizDetails.type} customers in ${bizDetails.city || 'the area'} actually ask, using the business details, and put the finished FAQPage JSON-LD in the "code" field.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    logClaudeUsage(userId, 'claude-sonnet-4-5', message.usage, 'seo_plan');

    const rawText = message.content[0]?.text || '';
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    // If response was truncated, attempt to repair by closing open structures
    let plan;
    try {
      plan = JSON.parse(cleaned);
    } catch (parseErr) {
      // Try to truncate to last complete step and close JSON
      const lastGoodPhase = cleaned.lastIndexOf('"steps"');
      const lastGoodBrace = cleaned.lastIndexOf('}', cleaned.length - 2);
      if (lastGoodBrace > 0) {
        try {
          const truncated = cleaned.substring(0, lastGoodBrace + 1) + ']}]}';
          plan = JSON.parse(truncated);
        } catch {
          throw parseErr; // Re-throw original error
        }
      } else {
        throw parseErr;
      }
    }

    // Reliability pass: overwrite the code for schema/FAQ steps with deterministic,
    // always-valid JSON-LD built from the business record — don't trust the model to
    // hand-write valid schema. (Other code steps, e.g. meta tags, keep the model's code.)
    try {
      const localBizCode = buildLocalBusinessSchema(bizDetails);
      const faqCode = buildFaqSchema(bizDetails);
      for (const phase of (plan.phases || [])) {
        for (const step of (phase.steps || [])) {
          const hay = `${step.title || ''} ${step.category || ''} ${(step.instructions || []).join(' ')}`.toLowerCase();
          if (/\bfaq/.test(hay)) step.code = faqCode;
          else if (/schema|json-?ld|structured data|localbusiness|rich result/.test(hay)) step.code = localBizCode;
        }
      }
    } catch (e) {
      console.warn('[seo/plan] deterministic schema injection failed:', e.message);
    }

    // Save plan to the most recent audit record for this user
    try {
      await pool.query(
        `UPDATE seo_audits SET plan = $1 WHERE id = (
          SELECT id FROM seo_audits WHERE user_id = $2 ORDER BY created_at DESC LIMIT 1
        )`,
        [plan, userId]
      );
    } catch (err) {
      console.warn('[seo-audit] Could not save plan:', err.message);
    }

    return res.json({ success: true, plan });
  } catch (err) {
    console.error('[seo-audit] Plan generation error:', err.message);
    return res.status(500).json({ error: `Failed to generate plan: ${err.message}` });
  }
});

// ─── POST /api/seo-audit/generate-code ──────────────────────
// Generates a copy-paste SEO embed snippet (JSON-LD + meta tags)
// and llms.txt content that users paste into ANY platform's <head>.
// Works the same way as the SORCE widget embed code flow.
router.post('/generate-code', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  // Plan check
  try {
    const planResult = await pool.query('SELECT plan, trial_ends_at FROM users WHERE id = $1', [userId]);
    if (!planResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const plan = planResult.rows[0].plan;
    const trialEndsAt = planResult.rows[0].trial_ends_at;
    const onActiveTrial = trialEndsAt && new Date(trialEndsAt) > new Date();
    if (!['pro', 'expert', 'scale'].includes(plan) && !onActiveTrial) {
      return res.status(403).json({ error: 'Pro plan required' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify plan' });
  }

  // Build business context from multiple sources
  let bizInfo = {};
  let websiteInfo = {};
  let lastAudit = null;
  try {
    const [bizRes, webRes, auditRes] = await Promise.all([
      pool.query('SELECT phone, email, city, state, address FROM business_information WHERE user_id = $1', [userId]),
      pool.query('SELECT business_name, business_type, page_data, vercel_url FROM websites WHERE user_id = $1', [userId]),
      pool.query('SELECT audit FROM seo_audits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]),
    ]);
    bizInfo = bizRes.rows[0] || {};
    websiteInfo = webRes.rows[0] || {};
    lastAudit = auditRes.rows[0]?.audit || null;
  } catch (err) {
    console.warn('[seo/generate-code] Context load failed:', err.message);
  }

  // Extract services from page_data sections
  let pageData = {};
  try {
    pageData = typeof websiteInfo.page_data === 'string'
      ? JSON.parse(websiteInfo.page_data)
      : (websiteInfo.page_data || {});
  } catch { /* ignore */ }

  const services = [];
  for (const s of (Array.isArray(pageData.sections) ? pageData.sections : [])) {
    for (const item of (s.content?.items || s.content?.services || [])) {
      const name = item.title || item.name || item.heading || '';
      if (name) services.push(name);
    }
    if (services.length >= 12) break;
  }

  const businessName = websiteInfo.business_name || pageData.meta?.businessName || 'Local Business';
  const businessType = websiteInfo.business_type || pageData.meta?.businessType || lastAudit?.businessType || 'local service business';
  const siteUrl = lastAudit?.url || (websiteInfo.vercel_url ? `https://${websiteInfo.vercel_url.replace(/^https?:?\/*/, '')}` : '');

  const businessContext = {
    name: businessName,
    type: businessType,
    phone: bizInfo.phone || '',
    email: bizInfo.email || '',
    address: bizInfo.address || '',
    city: bizInfo.city || '',
    state: bizInfo.state || '',
    url: siteUrl,
    services: services.slice(0, 10),
    auditIssues: lastAudit ? [
      ...(lastAudit.categories?.schema?.issues || []),
      ...(lastAudit.categories?.onPage?.issues || []),
      ...(lastAudit.categories?.aiReadiness?.issues || []),
    ].slice(0, 6) : [],
  };

  // Generate SEO code with Claude
  let seoCode;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: `You are an expert SEO developer for local service businesses.
Generate clean, production-ready embed code optimized for Google AI Mode, Google SGE, ChatGPT, and Perplexity.
Use the real business info provided. Respond ONLY with valid JSON — no markdown, no code fences, no explanation.`,
      messages: [{
        role: 'user',
        content: `Generate AI-search-optimized SEO embed code for this business. This code will be copy-pasted into the <head> section of their website.

BUSINESS INFO:
${JSON.stringify(businessContext, null, 2)}

Return ONLY a JSON object with exactly this structure:
{
  "headCode": "<!-- the full block to paste in <head> -->",
  "llmsTxtContent": "full llms.txt file content"
}

Rules for headCode — include ALL of the following in order:

1. Start with <!-- SORCE SEO --> comment

2. PRIMARY JSON-LD block (script type="application/ld+json"):
   - Use the MOST SPECIFIC Schema.org type for the business (e.g. AutomotiveService for detailing/auto, Plumber, HVACBusiness, Electrician, CleaningService, LandscapingBusiness, etc.)
   - Required fields: @context, @type, name, url, telephone, email (if available), description (2-3 sentences, mention city/state)
   - address: PostalAddress with streetAddress, addressLocality, addressRegion, postalCode, addressCountry
   - areaServed: array of ServiceArea objects for the city and nearby cities
   - sameAs: array of placeholder strings — include ["YOUR_GOOGLE_BUSINESS_PROFILE_URL", "YOUR_YELP_URL", "YOUR_FACEBOOK_URL"] with that exact placeholder text so the user knows to fill them in
   - hasOfferCatalog: if services provided, include Offer items with name and description
   - If it is an auto detailing / automotive business: use @type "AutomotiveService" and add "knowsAbout": ["auto detailing","car detailing","paint correction","ceramic coating"] as appropriate

3. SPEAKABLE JSON-LD block (separate script tag):
   - @type: SpeakableSpecification inside a WebPage wrapper
   - This tells Google AI Mode which content to read aloud and cite
   - Structure (fill "name" with the real business name + city/state, and "url" with the real business URL from BUSINESS INFO — never output the literal text SITE_URL; if no URL is available, omit the "url" field entirely):
     { "@context": "https://schema.org", "@type": "WebPage", "name": "<Real Business Name> - <City>, <State>", "url": "<real business url>",
       "speakable": { "@type": "SpeakableSpecification", "cssSelector": ["h1", "h2", ".hero-text", "p:first-of-type"] } }

4. FAQPAGE JSON-LD block (separate script tag):
   - @type: FAQPage
   - Generate 4-5 Question/Answer pairs that real customers search for in Google AI Mode
   - Questions must include the business type AND city/state (e.g. "What is the best auto detailing service in Olympia WA?")
   - Answers should be 2-3 sentences, mention the business name, city, and key services
   - Make questions sound like real voice/AI search queries: "Who does car detailing near me in [city]?", "How much does [service] cost in [city]?", "Is [business name] good?", "What services does [business name] offer?"

5. Meta tags block:
   - description: 150-160 chars, include city/state and primary service
   - og:title, og:description, og:type=website, og:url
   - twitter:card=summary_large_image
   - robots: index, follow
   - geo.region: US-[state code]
   - geo.placename: [city], [state]

6. End with <!-- End SORCE SEO --> comment

Rules for llmsTxtContent — this file is read by AI search engines (ChatGPT, Perplexity, Google AI) to understand and cite the business:
- "# BusinessName" header
- "> one-sentence tagline mentioning city and service"
- 2-3 paragraph description with city/state, key services, differentiators, and years in business if known
- ## Services (bullet list with name and brief description for each)
- ## Service Area (city + surrounding areas)
- ## Frequently Asked Questions section — 5-6 Q&A pairs in this format:
  Q: [real AI search query about the business or service in this city]
  A: [direct answer mentioning business name, location, and key fact]
  Examples: "Q: What is the best car detailing service in Olympia WA?\\nA: Thompson's Auto Detailing is Olympia's top-rated detailing service..."
- ## Contact & Location
- ## Why Choose Us (3-4 bullet points)
The llms.txt should be written so that if an AI reads it, it will cite THIS business first when someone searches for these services in this city.`,
      }],
    });
    logClaudeUsage(userId, 'claude-sonnet-4-6', message.usage, 'seo_generate_code');

    const raw = message.content[0]?.text || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    seoCode = JSON.parse(cleaned);
  } catch (err) {
    console.error('[seo/generate-code] Claude error:', err.message);
    return res.status(500).json({ error: `Failed to generate SEO code: ${err.message}` });
  }

  // Sanitize the AI-generated block before we ship it for pasting:
  //  1) swap any leaked "SITE_URL" placeholder for the real site URL (or strip it), and
  //  2) drop any <script type="application/ld+json"> block whose JSON doesn't parse,
  //     so we never hand the user broken structured data.
  const cleanHead = sanitizeHeadCode(seoCode.headCode, siteUrl);

  // Inject tracking pixel before closing comment.
  // Must be a publicly reachable URL — never localhost in production (visitor browsers can't reach it).
  const backendUrl = (
    process.env.PRODUCTION_BACKEND_URL ||
    process.env.BACKEND_URL ||
    'https://backend-production-ab50.up.railway.app'
  ).replace(/\/$/, '');
  const trackingPixel = `<script>(function(){try{var p=new Image();p.src='${backendUrl}/api/track/${userId}?r='+encodeURIComponent(document.referrer)+'&u='+encodeURIComponent(location.pathname);}catch(e){}})();</script>`;
  const headCode = cleanHead.includes('<!-- End SORCE SEO -->')
    ? cleanHead.replace('<!-- End SORCE SEO -->', `${trackingPixel}\n<!-- End SORCE SEO -->`)
    : cleanHead + '\n' + trackingPixel;

  // Save generated code + timestamp to the most recent audit row
  pool.query(
    `UPDATE seo_audits SET code_generated_at = NOW(), head_code = $2, llms_txt = $3
     WHERE id = (SELECT id FROM seo_audits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`,
    [userId, headCode, seoCode.llmsTxtContent]
  ).catch(err => console.warn('[seo/generate-code] Could not save generated code:', err.message));

  console.log(`✅ SEO embed code generated for user ${userId}`);
  return res.json({
    success: true,
    headCode,
    llmsTxtContent: seoCode.llmsTxtContent,
  });
});

// ─── GET /api/seo-audit/visits ───────────────────────────
// Returns daily website_visits counts for the last N days + the date the SEO code was first generated
router.get('/visits', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const days = Math.min(parseInt(req.query.days || '90'), 180);

  try {
    const [visitsRes, codeRes] = await Promise.all([
      pool.query(
        `SELECT DATE(visited_at) AS date, COUNT(*)::int AS count
         FROM website_visits
         WHERE user_id = $1
           AND visited_at >= CURRENT_DATE - ($2 || ' days')::interval
         GROUP BY DATE(visited_at)
         ORDER BY date ASC`,
        [userId, days]
      ),
      pool.query(
        `SELECT MIN(code_generated_at) AS first_generated
         FROM seo_audits
         WHERE user_id = $1 AND code_generated_at IS NOT NULL`,
        [userId]
      ),
    ]);

    res.json({
      success: true,
      visits: visitsRes.rows,
      seoCodeGeneratedAt: codeRes.rows[0]?.first_generated || null,
      days,
    });
  } catch (err) {
    console.error('[seo-audit/visits]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/seo-audit/generate-content ────────────────
// Generates a full SEO-optimised blog post or service page for copy-paste into any CMS
router.post('/generate-content', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const planResult = await pool.query('SELECT plan, trial_ends_at FROM users WHERE id = $1', [userId]);
    if (!planResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const { plan, trial_ends_at } = planResult.rows[0];
    const onTrial = trial_ends_at && new Date(trial_ends_at) > new Date();
    if (!['pro', 'expert', 'scale'].includes(plan) && !onTrial) {
      return res.status(403).json({ error: 'Pro plan required' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify plan' });
  }

  const { type, topic } = req.body; // type: 'blog' | 'service'
  if (!type || !topic) return res.status(400).json({ error: 'type and topic are required' });

  // Load business context
  let bizInfo = {}, websiteInfo = {}, lastAudit = null;
  try {
    const [bizRes, webRes, auditRes] = await Promise.all([
      pool.query('SELECT phone, email, city, state, address FROM business_information WHERE user_id = $1', [userId]),
      pool.query('SELECT business_name, business_type, vercel_url FROM websites WHERE user_id = $1', [userId]),
      pool.query('SELECT audit FROM seo_audits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]),
    ]);
    bizInfo = bizRes.rows[0] || {};
    websiteInfo = webRes.rows[0] || {};
    lastAudit = auditRes.rows[0]?.audit || null;
  } catch (err) {
    console.warn('[seo/generate-content] Context load error:', err.message);
  }

  const businessName = websiteInfo.business_name || lastAudit?.businessType || 'Local Business';
  const businessType = websiteInfo.business_type || lastAudit?.businessType || 'local service business';
  const city = bizInfo.city || '';
  const state = bizInfo.state || '';
  const location = [city, state].filter(Boolean).join(', ');
  const siteUrl = websiteInfo.vercel_url ? `https://${websiteInfo.vercel_url.replace(/^https?:?\/*/, '')}` : '';

  const typeLabel = type === 'blog' ? 'blog post' : 'service page';
  const wordTarget = type === 'blog' ? '800–1200 words' : '500–800 words';
  const schemaType = type === 'blog' ? 'Article' : 'Service';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: `You are an expert SEO content writer for local service businesses.
Write compelling, locally-optimised content that ranks on Google and converts visitors into customers.
Respond ONLY with valid JSON — no markdown, no code fences, no explanation.`,
      messages: [{
        role: 'user',
        content: `Write a fully SEO-optimised ${typeLabel} for this local business.

BUSINESS:
- Name: ${businessName}
- Type: ${businessType}
- Location: ${location || 'local area'}
- Website: ${siteUrl || 'their website'}

TOPIC: ${topic}
TARGET LENGTH: ${wordTarget}

Return ONLY a JSON object with this exact structure:
{
  "title": "H1 title — include primary keyword and location if relevant",
  "slug": "url-friendly-slug-no-spaces",
  "metaDescription": "150-160 char meta description with primary keyword",
  "targetKeywords": ["primary keyword", "secondary keyword", "long-tail keyword", "local keyword"],
  "wordCount": <estimated word count as number>,
  "htmlContent": "<full HTML content using h2/h3/p/ul/li tags — NO <html>/<head>/<body> wrapper, just the body content starting with an intro paragraph>",
  "jsonLd": "<script type=\\"application/ld+json\\"> block — use Schema.org ${schemaType} type, include all relevant fields>"
}

Content rules:
- Use the business name and location naturally throughout
- Include the primary keyword in the first paragraph, at least one H2, and the conclusion
- Write for a local audience — mention the city/region if provided
- Add a clear CTA paragraph at the end (call us, get a quote, book online)
- For service pages: include a "Why Choose Us" section and a benefits list
- For blog posts: include practical tips the reader can use, position the business as the local expert
- Do NOT keyword-stuff — write for humans first, search engines second`,
      }],
    });
    logClaudeUsage(userId, 'claude-sonnet-4-6', message.usage, 'seo_content');

    const raw = message.content[0]?.text || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const content = JSON.parse(cleaned);

    return res.json({ success: true, content, type });
  } catch (err) {
    console.error('[seo/generate-content] Error:', err.message);
    return res.status(500).json({ error: `Failed to generate content: ${err.message}` });
  }
});

// ─── POST /api/seo-audit/verify-llms ────────────────────────
// Fetches the user's website and checks whether llms.txt (or a /llms page) is accessible and correct
router.post('/verify-llms', authenticateToken, async (req, res) => {
  const { websiteUrl } = req.body;
  if (!websiteUrl || typeof websiteUrl !== 'string') {
    return res.status(400).json({ error: 'websiteUrl is required' });
  }

  // Normalize URL
  let base = websiteUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;

  const candidateUrls = [
    base + '/llms.txt',
    base + '/llms',
    base + '/pages/llms',
  ];

  // Platforms that use client-side JavaScript rendering — a plain fetch won't see the content
  const JS_RENDERED_MARKERS = [
    'wix.com', 'wixstatic.com', 'wix-bolt', 'wixapps',
    'squarespace.com', 'static.squarespace.com',
    'shopify.com', 'cdn.shopify.com',
    'webflow.com', 'assets.website-files.com',
  ];

  let found = null;
  let fetchedContent = null;
  let isJsRendered = false;
  let foundStatusOk = false;

  for (const url of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'SORCE-SEO-Verifier/1.0' },
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const text = await resp.text();

        // Detect JS-rendered platforms by checking raw HTML for platform markers
        const lowerText = text.toLowerCase();
        const detectedJsRendered = JS_RENDERED_MARKERS.some(m => lowerText.includes(m));

        if (detectedJsRendered) {
          // Page exists and is JS-rendered — content is there but can't be read by plain fetch
          found = url;
          isJsRendered = true;
          foundStatusOk = true;
          break;
        }

        // For plain HTML/text responses, strip tags and check for real content
        const stripped = text.replace(/<[^>]*>/g, '').trim();
        if (stripped.length > 50) {
          found = url;
          fetchedContent = stripped.slice(0, 3000);
          foundStatusOk = true;
          break;
        }
      }
    } catch {
      // try next URL
    }
  }

  if (!foundStatusOk) {
    return res.json({
      status: 'not_found',
      message: 'We couldn\'t find an llms.txt file or /llms page at your website. Double-check that you followed the upload steps for your platform and try again.',
      checkedUrls: candidateUrls,
    });
  }

  // JS-rendered platform (Wix, Squarespace, Shopify, Webflow) — content exists but can't be read by plain HTTP fetch
  if (isJsRendered) {
    return res.json({
      status: 'found',
      foundAt: found,
      assessment: '✅ Your page is live and accessible! Your website uses JavaScript rendering (this is normal for Wix, Squarespace, Shopify, and Webflow). AI search engines like ChatGPT and Perplexity execute JavaScript and will read your content correctly — our checker just can\'t verify the text directly. You\'re all set.',
    });
  }

  // Ask Claude to do a quick quality check on what was found
  try {
    const userId = req.user.userId;
    // Load their saved llms.txt for comparison
    const savedRow = await pool.query(
      `SELECT llms_txt FROM seo_audits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const savedLlms = savedRow.rows[0]?.llms_txt || '';

    const checkPrompt = savedLlms
      ? `You are checking whether a business owner correctly installed their llms.txt file.

Their SORCE-generated llms.txt content (expected):
${savedLlms.slice(0, 1500)}

What was found at ${found}:
${fetchedContent}

Briefly assess (2-3 sentences max): Is this correct? Does it match the expected content? Any issues?
End with either ✅ Looks good! or ⚠️ Something looks off — and one specific fix if needed.`
      : `You are checking whether an llms.txt file looks correct for a local service business.

Found at ${found}:
${fetchedContent}

Briefly assess (2-3 sentences max): Does this look like a valid llms.txt file for a service business? Any obvious issues?
End with either ✅ Looks good! or ⚠️ Something looks off.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: checkPrompt }],
    });

    const assessment = message.content[0]?.text || '';

    return res.json({
      status: 'found',
      foundAt: found,
      assessment,
    });
  } catch (err) {
    // Claude check failed but file was found — still a win
    return res.json({
      status: 'found',
      foundAt: found,
      assessment: '✅ We found your llms.txt file! AI search engines will be able to read it.',
    });
  }
});

module.exports = router;
