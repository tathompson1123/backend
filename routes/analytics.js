const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const ANALYTICS_PASSWORD = process.env.ANALYTICS_PASSWORD || 'sorce-internal-2025';
const DASHBOARD_URL = process.env.FRONTEND_URL || 'https://sorceintegrations.com';

const PLAN_REVENUE  = { basic: 29.95, pro: 99.95, expert: 99.95, scale: 175.95 };
const SMS_COST      = 0.0075;  // per outbound SMS (Twilio)
const CHAT_COST     = 0.04;   // per chat conversation (Claude Sonnet 4 estimate)
const AI_SMS_COST   = 0.003;  // per AI-generated SMS response

// Middleware: verify analytics JWT
const requireAnalytics = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.analytics) return res.status(403).json({ error: 'Forbidden' });
    req.analytics = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Revenue, billing and team management are admin-only. Invited members get the
// discovery call calendar and nothing else. A master-password session has no `tm`
// and is treated as admin.
const requireAdmin = (req, res, next) => {
  if (!req.analytics?.tm || req.analytics.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
};

// ── POST /api/analytics/login ─────────────────────────────────
// Two ways in: an invited team member's own email + password, or the legacy shared
// password (kept so nobody is locked out before team accounts are set up).
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!password) return res.status(401).json({ error: 'Password is required' });

  if (email) {
    try {
      const found = await pool.query(
        `SELECT id, name, email, role, password_hash, active
         FROM sorce_team_members WHERE email = $1`,
        [String(email).trim().toLowerCase()]
      );
      const member = found.rows[0];
      if (!member || !member.active || !member.password_hash) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const bcrypt = require('bcrypt');
      if (!(await bcrypt.compare(password, member.password_hash))) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = jwt.sign(
        { analytics: true, tm: member.id, name: member.name, email: member.email, role: member.role },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
      );
      return res.json({ token, member: { name: member.name, email: member.email, role: member.role } });
    } catch (err) {
      console.error('Team login error:', err.message);
      return res.status(500).json({ error: 'Login failed' });
    }
  }

  if (password !== ANALYTICS_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign({ analytics: true, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// ── GET /api/analytics/data ───────────────────────────────────
router.get('/data', requireAnalytics, requireAdmin, async (req, res) => {
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
        u.subscription_status,
        u.last_payment_at,
        u.last_payment_amount,
        u.last_payment_failed_at,
        u.current_period_end,
        u.stripe_customer_id,
        u.stripe_synced_at,
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
      // "Paying" means Stripe says active, not that a plan column is filled in — a
      // failing card keeps the plan set for the whole dunning window.
      const status     = u.subscription_status || (u.plan ? 'unknown' : 'none');
      const isPaying   = status === 'active';
      const isPastDue  = status === 'past_due' || status === 'unpaid' || status === 'incomplete';
      const revenue    = isPaying ? (PLAN_REVENUE[u.plan] || 0) : 0;
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
        subscription_status:    status,
        is_paying:              isPaying,
        is_past_due:            isPastDue,
        last_payment_at:        u.last_payment_at,
        last_payment_amount:    u.last_payment_amount != null ? u.last_payment_amount / 100 : null,
        last_payment_failed_at: u.last_payment_failed_at,
        current_period_end:     u.current_period_end,
        has_stripe:             !!u.stripe_customer_id,
        stripe_synced_at:       u.stripe_synced_at,
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
      paying_count:      a.paying_count   + (u.is_paying ? 1 : 0),
      trialing_count:    a.trialing_count + (u.subscription_status === 'trialing' ? 1 : 0),
      past_due_count:    a.past_due_count + (u.is_past_due ? 1 : 0),
      churned_count:     a.churned_count  + (u.subscription_status === 'canceled' ? 1 : 0),
      revenue:           a.revenue           + u.revenue,
      total_cost:        a.total_cost        + u.total_cost,
      margin:            a.margin            + u.margin,
      sms_sent_month:    a.sms_sent_month    + u.sms_sent_month,
      chat_convos_month: a.chat_convos_month + u.chat_convos_month,
      leads_month:       a.leads_month       + u.leads_month,
    }), {
      user_count: 0, paying_count: 0, trialing_count: 0, past_due_count: 0, churned_count: 0,
      revenue: 0, total_cost: 0, margin: 0, sms_sent_month: 0, chat_convos_month: 0, leads_month: 0,
    });

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

// ── POST /api/analytics/backfill-stripe ───────────────────────
// Repairs accounts that paid while no live webhook endpoint existed. Defaults to a
// dry run — pass { apply: true } once the report looks right.
router.post('/backfill-stripe', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const { backfillFromStripe } = require('../utils/stripeReconcile');
    const report = await backfillFromStripe({ dryRun: !req.body?.apply });
    res.json({ success: true, dryRun: !req.body?.apply, report });
  } catch (error) {
    console.error('Stripe backfill error:', error.message);
    res.status(500).json({ error: error.message || 'Backfill failed' });
  }
});

// ── POST /api/analytics/sync-stripe ───────────────────────────
// Pull payment state straight from Stripe. Runs nightly too, but this is here for
// when you need the numbers to be right now — after a refund, say.
router.post('/sync-stripe', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const { reconcileAllSubscriptions } = require('../utils/stripeReconcile');
    const result = await reconcileAllSubscriptions();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Stripe sync error:', error.message);
    res.status(500).json({ error: 'Failed to sync with Stripe' });
  }
});

// ══════════════════════════════════════════════════════════════════
// AD PLATFORM VERIFICATION REQUESTS (admin-only)
// ══════════════════════════════════════════════════════════════════

// GET /verification-requests — list all pending + recent
router.get('/verification-requests', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.user_id, r.platform, r.email, r.status, r.requested_at, r.verified_at,
             u.name AS user_name, u.email AS user_email, u.business_name
      FROM ad_verification_requests r
      JOIN users u ON u.id = r.user_id
      ORDER BY
        CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
        r.requested_at DESC
    `);
    res.json({ requests: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /verification-requests/:id/approve — mark verified & email user
router.post('/verification-requests/:id/approve', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      UPDATE ad_verification_requests
      SET status = 'verified', verified_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);
    const request = result.rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const userRes = await pool.query(
      'SELECT email, name FROM users WHERE id = $1',
      [request.user_id]
    );
    const user = userRes.rows[0];
    const platformLabel = request.platform === 'google_ads' ? 'Google Ads' : 'Google Local Services';
    const connectUrl = `${DASHBOARD_URL}/dashboard?tab=leads&subtab=analytics&connect=${request.platform}`;

    if (process.env.SENDGRID_API_KEY && user?.email && process.env.SENDGRID_FROM_EMAIL) {
      try {
        await sgMail.send({
          to: user.email,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: `Your ${platformLabel} account has been verified!`,
          html: `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
              <h2 style="color:#111">Your ${platformLabel} account is verified ✓</h2>
              <p>Hi ${user.name || 'there'},</p>
              <p>Great news — your ${platformLabel} account (<strong>${request.email}</strong>) has been approved for SORCE integration.</p>
              <p>Click the button below to connect your account and start seeing your ad spend &amp; ROI analytics directly in your dashboard.</p>
              <p style="margin:28px 0">
                <a href="${connectUrl}"
                   style="display:inline-block;padding:14px 28px;background:#2563eb;color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px">
                  Connect ${platformLabel}
                </a>
              </p>
              <p style="color:#555;font-size:13px">If the button doesn't work, paste this into your browser:<br>
              <a href="${connectUrl}" style="color:#2563eb">${connectUrl}</a></p>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
              <p style="color:#888;font-size:12px">The SORCE team</p>
            </div>
          `,
        });
      } catch (e) { console.error('Approval email failed:', e.message); }
    }

    res.json({ request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /verification-requests/:id/reject — mark rejected
router.post('/verification-requests/:id/reject', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const result = await pool.query(`
      UPDATE ad_verification_requests
      SET status = 'rejected', notes = $2, verified_at = NULL
      WHERE id = $1 RETURNING *
    `, [id, notes || null]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Request not found' });
    res.json({ request: result.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
