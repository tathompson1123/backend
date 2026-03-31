const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory rate limit map: userId -> timestamp of last audit
const auditRateLimits = new Map();

// ─── POST /api/seo-audit/run ─────────────────────────────────
router.post('/run', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  // ── Plan check ──────────────────────────────────────────────
  try {
    const planResult = await pool.query('SELECT plan FROM users WHERE id = $1', [userId]);
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const plan = planResult.rows[0].plan;
    const allowedPlans = ['pro', 'expert', 'scale'];
    if (!allowedPlans.includes(plan)) {
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
      "issues": ["<AI readiness issue>", ...],
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
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawText = message.content[0]?.text || '';

    // Strip any accidental markdown code fences
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    parsedAudit = JSON.parse(cleaned);
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
    const result = await pool.query(
      `SELECT audit, plan, url, created_at FROM seo_audits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) return res.json({ success: true, audit: null, plan: null });
    const row = result.rows[0];
    res.json({ success: true, audit: row.audit, plan: row.plan || null, savedAt: row.created_at });
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

  const { audit } = req.body;
  if (!audit || !audit.categories) {
    return res.status(400).json({ error: 'Audit data is required' });
  }

  const systemPrompt = `You are an expert SEO consultant creating detailed implementation plans for small local service businesses.
You write clear, specific, step-by-step instructions that a non-technical business owner or their web developer can follow.
You always respond with ONLY valid JSON — no markdown, no explanation, no code blocks.`;

  const userMessage = `Based on this SEO audit, create a detailed step-by-step SEO optimization plan.

AUDIT SUMMARY:
URL: ${audit.url}
Business Type: ${audit.businessType}
Overall Score: ${audit.score}/100

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
            "Exact instruction 1 — be very specific",
            "Exact instruction 2",
            "Exact instruction 3"
          ],
          "expectedImpact": "What improvement this will make to SEO"
        }
      ]
    }
  ]
}

Create 3 phases ordered by priority (critical fixes first, then high impact, then polish).
Each phase should have 2-4 steps. Each step should have 3-4 specific instructions. Keep instructions concise but actionable.
Be specific — include exact HTML tags, character limits, schema types, etc. Do NOT pad with generic advice.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

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

module.exports = router;
