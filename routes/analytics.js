const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const jwt = require('jsonwebtoken');

const ANALYTICS_PASSWORD = process.env.ANALYTICS_PASSWORD || 'sorce-internal-2025';

const PLAN_REVENUE  = { basic: 29.95, pro: 99.95, expert: 99.95, scale: 175.95 };
const SMS_COST      = 0.0075;  // per outbound SMS (Twilio/Telnyx avg)
const CHAT_COST     = 0.04;   // per chat conversation (Claude Sonnet 4 estimate)
const AI_SMS_COST   = 0.003;  // per AI-generated SMS response

// Middleware: verify analytics JWT
const requireAnalytics = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.analytics) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ── POST /api/analytics/login ─────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== ANALYTICS_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign({ analytics: true }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// ── GET /api/analytics/data ───────────────────────────────────
router.get('/data', requireAnalytics, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.business_name,
        u.plan,
        u.created_at,
        u.trial_ends_at,
        u.subscription_canceling,
        COALESCE(sms_m.cnt,  0)::int      AS sms_sent_month,
        COALESCE(sms_t.cnt,  0)::int      AS sms_sent_total,
        COALESCE(chat_m.cnt, 0)::int      AS chat_convos_month,
        COALESCE(chat_t.cnt, 0)::int      AS chat_convos_total,
        COALESCE(lead_m.cnt, 0)::int      AS leads_month,
        COALESCE(cu_m.claude_cost, 0)     AS claude_cost_month,
        COALESCE(cu_m.input_tokens,  0)::int AS claude_input_tokens_month,
        COALESCE(cu_m.output_tokens, 0)::int AS claude_output_tokens_month
      FROM users u
      -- outbound SMS this month
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM sms_messages
        WHERE direction = 'outgoing' AND created_at >= date_trunc('month', NOW())
        GROUP BY user_id
      ) sms_m  ON sms_m.user_id  = u.id
      -- outbound SMS all time
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM sms_messages
        WHERE direction = 'outgoing'
        GROUP BY user_id
      ) sms_t  ON sms_t.user_id  = u.id
      -- chat conversations this month
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM chat_conversations
        WHERE created_at >= date_trunc('month', NOW())
        GROUP BY user_id
      ) chat_m ON chat_m.user_id = u.id
      -- chat conversations all time
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM chat_conversations
        GROUP BY user_id
      ) chat_t ON chat_t.user_id = u.id
      -- leads created this month
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM leads
        WHERE created_at >= date_trunc('month', NOW())
        GROUP BY user_id
      ) lead_m ON lead_m.user_id = u.id
      -- real Claude API costs this month (from tracked usage)
      LEFT JOIN (
        SELECT user_id,
          SUM(cost_usd)      AS claude_cost,
          SUM(input_tokens)  AS input_tokens,
          SUM(output_tokens) AS output_tokens
        FROM claude_usage
        WHERE created_at >= date_trunc('month', NOW())
        GROUP BY user_id
      ) cu_m ON cu_m.user_id = u.id
      ORDER BY u.created_at DESC
    `);

    const users = result.rows.map(u => {
      const revenue      = PLAN_REVENUE[u.plan] || 0;
      const smsCost      = u.sms_sent_month * SMS_COST;
      const claudeCost   = parseFloat(u.claude_cost_month) || 0;  // real tracked cost
      const totalCost    = smsCost + claudeCost;
      const margin       = revenue - totalCost;
      const isTrialing   = u.trial_ends_at && new Date(u.trial_ends_at) > new Date();
      const isCanceling  = !!u.subscription_canceling;

      return {
        id: u.id,
        name: u.name || '—',
        email: u.email,
        business_name: u.business_name || '—',
        plan: u.plan || 'basic',
        created_at: u.created_at,
        trial_ends_at: u.trial_ends_at,
        is_trialing: isTrialing,
        is_canceling: isCanceling,
        sms_sent_month:            u.sms_sent_month,
        sms_sent_total:            u.sms_sent_total,
        chat_convos_month:         u.chat_convos_month,
        chat_convos_total:         u.chat_convos_total,
        leads_month:               u.leads_month,
        claude_cost_month:         +claudeCost.toFixed(4),
        claude_input_tokens_month: u.claude_input_tokens_month,
        claude_output_tokens_month:u.claude_output_tokens_month,
        revenue,
        sms_cost:   +smsCost.toFixed(4),
        total_cost: +totalCost.toFixed(4),
        margin:     +margin.toFixed(2),
      };
    });

    const totals = users.reduce((a, u) => ({
      user_count:        a.user_count + 1,
      revenue:           a.revenue           + u.revenue,
      total_cost:        a.total_cost        + u.total_cost,
      margin:            a.margin            + u.margin,
      sms_sent_month:    a.sms_sent_month    + u.sms_sent_month,
      chat_convos_month: a.chat_convos_month + u.chat_convos_month,
      leads_month:       a.leads_month       + u.leads_month,
    }), { user_count: 0, revenue: 0, total_cost: 0, margin: 0, sms_sent_month: 0, chat_convos_month: 0, leads_month: 0 });

    totals.revenue    = +totals.revenue.toFixed(2);
    totals.total_cost = +totals.total_cost.toFixed(2);
    totals.margin     = +totals.margin.toFixed(2);

    const planBreakdown = users.reduce((a, u) => {
      a[u.plan] = (a[u.plan] || 0) + 1;
      return a;
    }, {});

    res.json({ users, totals, plan_breakdown: planBreakdown, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('Analytics data error:', error.message);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

module.exports = router;
