// First-party analytics for SORCE's own marketing pages (starting with /learnmore).
//
//   POST /api/landing/event    public — the page reports visits, clicks, scroll depth, video
//                              progress and quiz/booking steps. Anonymous: a random visitor
//                              id, no names, emails or phone numbers are ever stored.
//   GET  /api/landing/summary  /analytics admins only — the numbers behind the Landing Page tab.
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { requireAnalytics, requireAdmin } = require('../config/analyticsAuth');

const PAGES = new Set(['learnmore', 'book-a-call', 'watch']);
const EVENTS = new Set([
  'pageview', 'click', 'scroll', 'video_play', 'video_progress', 'video_complete',
  'quiz_open', 'quiz_step', 'quiz_abandon', 'book_day', 'book_slot', 'book_form_start', 'quiz_submit', 'call_booked',
]);
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|node-fetch|go-http/i;
const MAX_EVENTS_PER_REQUEST = 20;
const MAX_EVENTS_PER_VISITOR_PER_DAY = 400;
const TZ = 'America/Los_Angeles';

pool.query(`
  CREATE TABLE IF NOT EXISTS landing_events (
    id BIGSERIAL PRIMARY KEY,
    page VARCHAR(40) NOT NULL,
    event VARCHAR(40) NOT NULL,
    target VARCHAR(100),
    visitor_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64),
    referrer_host VARCHAR(200),
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(150),
    utm_content VARCHAR(150),
    device VARCHAR(12),
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).then(() => Promise.all([
  pool.query('CREATE INDEX IF NOT EXISTS idx_landing_events_page_time ON landing_events (page, created_at)'),
  pool.query('CREATE INDEX IF NOT EXISTS idx_landing_events_visitor ON landing_events (visitor_id, created_at)'),
])).catch(e => console.error('landing_events migration error:', e.message));

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
// Labels and ids only: letters, digits and a little punctuation, so nothing odd is stored.
const safeLabel = (v, n) => clip(v, n).replace(/[^\p{L}\p{N} _\-:.,'&+!?/#()%$]/gu, '');

// POST /api/landing/event
router.post('/event', async (req, res) => {
  // Always answer quickly and quietly; analytics must never surface an error to a visitor.
  res.status(204).end();
  try {
    if (BOT_UA.test(String(req.headers['user-agent'] || ''))) return;
    const b = req.body || {};
    const page = clip(b.page, 40);
    const visitor = clip(b.v, 64);
    if (!PAGES.has(page) || !/^[a-zA-Z0-9-]{8,64}$/.test(visitor)) return;
    const session = /^[a-zA-Z0-9-]{8,64}$/.test(clip(b.s, 64)) ? clip(b.s, 64) : null;

    const events = (Array.isArray(b.events) ? b.events : [])
      .slice(0, MAX_EVENTS_PER_REQUEST)
      .filter(e => e && EVENTS.has(e.event))
      .map(e => ({ event: e.event, target: safeLabel(e.target, 100) || null, meta: e.meta && typeof e.meta === 'object' ? e.meta : null }));
    if (events.length === 0) return;

    const recent = await pool.query(
      "SELECT COUNT(*)::int AS n FROM landing_events WHERE visitor_id = $1 AND created_at > NOW() - INTERVAL '24 hours'",
      [visitor]
    );
    if (recent.rows[0].n >= MAX_EVENTS_PER_VISITOR_PER_DAY) return;

    const utm = b.utm && typeof b.utm === 'object' ? b.utm : {};
    const device = ['mobile', 'tablet', 'desktop'].includes(b.device) ? b.device : null;
    const refHost = safeLabel(b.ref, 200).toLowerCase() || null;

    const values = [];
    const params = [];
    events.forEach((e) => {
      const base = params.length;
      params.push(page, e.event, e.target, visitor, session, refHost,
        safeLabel(utm.source, 100) || null, safeLabel(utm.medium, 100) || null,
        safeLabel(utm.campaign, 150) || null, safeLabel(utm.content, 150) || null,
        device, e.meta ? JSON.stringify(e.meta).slice(0, 500) : null);
      values.push(`(${Array.from({ length: 12 }, (_, i) => `$${base + i + 1}`).join(',')})`);
    });
    await pool.query(
      `INSERT INTO landing_events
         (page, event, target, visitor_id, session_id, referrer_host, utm_source, utm_medium, utm_campaign, utm_content, device, meta)
       VALUES ${values.join(',')}`,
      params
    );
  } catch (err) {
    console.error('landing event error:', err.message);
  }
});

// GET /api/landing/summary?page=learnmore&days=30
router.get('/summary', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const page = PAGES.has(req.query.page) ? req.query.page : 'learnmore';
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const since = `NOW() - INTERVAL '${days} days'`; // days is whitelisted above
    const base = `FROM landing_events WHERE page = $1 AND created_at > ${since}`;

    const [totals, funnel, clicks, scroll, sources, campaigns, daily, devices, video, quizReached, quizAbandon] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'pageview')::int AS visitors,
                COUNT(*) FILTER (WHERE event = 'pageview')::int AS pageviews,
                COUNT(DISTINCT session_id) FILTER (WHERE event = 'pageview')::int AS sessions
           ${base}`, [page]),
      pool.query(
        `SELECT COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'pageview')::int AS visited,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'scroll' AND target = '50')::int AS scrolled,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'video_play')::int AS played,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'click')::int AS clicked,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'quiz_open')::int AS quiz_started,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'quiz_submit')::int AS quiz_done,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'call_booked')::int AS booked,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'book_day')::int AS day_picked,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'book_slot')::int AS slot_picked,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'book_form_start')::int AS form_started
           ${base}`, [page]),
      pool.query(
        `SELECT target, COUNT(*)::int AS clicks, COUNT(DISTINCT visitor_id)::int AS people
           ${base} AND event = 'click' AND target IS NOT NULL
          GROUP BY target ORDER BY clicks DESC LIMIT 25`, [page]),
      pool.query(
        `SELECT target, COUNT(DISTINCT visitor_id)::int AS people
           ${base} AND event = 'scroll' GROUP BY target`, [page]),
      pool.query(
        `SELECT COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_host, ''), 'direct') AS source,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'pageview')::int AS visitors,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'quiz_submit')::int AS leads,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'call_booked')::int AS booked
           ${base} GROUP BY 1 HAVING COUNT(*) FILTER (WHERE event = 'pageview') > 0
          ORDER BY visitors DESC LIMIT 15`, [page]),
      pool.query(
        `SELECT utm_campaign AS campaign,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'pageview')::int AS visitors,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'quiz_submit')::int AS leads,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'call_booked')::int AS booked
           ${base} AND utm_campaign IS NOT NULL AND utm_campaign <> ''
          GROUP BY utm_campaign ORDER BY visitors DESC LIMIT 15`, [page]),
      pool.query(
        `SELECT to_char((created_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS day,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'pageview')::int AS visitors,
                COUNT(DISTINCT visitor_id) FILTER (WHERE event = 'quiz_submit')::int AS leads
           ${base} GROUP BY 1 ORDER BY 1`, [page]),
      pool.query(
        `SELECT COALESCE(device, 'unknown') AS device, COUNT(DISTINCT visitor_id)::int AS visitors
           ${base} AND event = 'pageview' GROUP BY 1 ORDER BY visitors DESC`, [page]),
      pool.query(
        `SELECT target, COUNT(DISTINCT visitor_id)::int AS people
           ${base} AND event = 'video_progress' GROUP BY target`, [page]),
      // Quiz steps people reached (quiz_step target is the step number, 1-4).
      pool.query(
        `SELECT target, COUNT(DISTINCT visitor_id)::int AS people
           ${base} AND event = 'quiz_step' GROUP BY target ORDER BY target`, [page]),
      // Where people left the quiz / calendar without booking. Anyone who went on to book
      // a call in the same period is not counted as having left.
      pool.query(
        `SELECT a.target, COUNT(DISTINCT a.visitor_id)::int AS people
           FROM landing_events a
          WHERE a.page = $1 AND a.created_at > ${since} AND a.event = 'quiz_abandon' AND a.target IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM landing_events b
               WHERE b.visitor_id = a.visitor_id AND b.page = a.page
                 AND b.event = 'call_booked' AND b.created_at > ${since})
          GROUP BY a.target ORDER BY people DESC`, [page]),
    ]);

    const f = funnel.rows[0];
    res.json({
      success: true, page, days,
      totals: totals.rows[0],
      funnel: page === 'book-a-call' ? [
        { key: 'visited', label: 'Visited the page', people: f.visited },
        { key: 'day_picked', label: 'Picked a day', people: f.day_picked },
        { key: 'slot_picked', label: 'Picked a time', people: f.slot_picked },
        { key: 'form_started', label: 'Started the details form', people: f.form_started },
        { key: 'booked', label: 'Booked a call', people: f.booked },
      ] : [
        { key: 'visited', label: 'Visited the page', people: f.visited },
        { key: 'scrolled', label: 'Scrolled halfway', people: f.scrolled },
        { key: 'played', label: 'Played the video', people: f.played },
        { key: 'clicked', label: 'Clicked a button', people: f.clicked },
        { key: 'quiz_started', label: 'Started the quiz', people: f.quiz_started },
        { key: 'quiz_done', label: 'Submitted the quiz', people: f.quiz_done },
        { key: 'booked', label: 'Booked a call', people: f.booked },
      ],
      clicks: clicks.rows,
      scroll: scroll.rows,
      video: video.rows,
      quizReached: quizReached.rows,
      quizAbandon: quizAbandon.rows,
      sources: sources.rows,
      campaigns: campaigns.rows,
      daily: daily.rows,
      devices: devices.rows,
    });
  } catch (err) {
    console.error('landing summary error:', err.message);
    res.status(500).json({ error: 'Could not load landing page metrics' });
  }
});

module.exports = router;
