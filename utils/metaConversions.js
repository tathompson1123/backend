// ============================================
// Meta Conversions API (CAPI) — server-side Lead events
// Per-user config (meta_capi_configs). All sends are fire-and-forget; nothing here
// is allowed to throw into the caller's lead-creation path.
// ============================================
const crypto = require('crypto');
const { pool } = require('../config/database');

const GRAPH_VERSION = 'v19.0';

function sha256(v) {
  return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
}

// Pull the active Meta CAPI config for this user, or null if not configured / disabled.
async function getConfig(userId) {
  try {
    const r = await pool.query(
      `SELECT pixel_id, access_token, enabled, test_event_code
       FROM meta_capi_configs WHERE user_id = $1`,
      [userId]
    );
    const c = r.rows[0];
    if (!c || !c.enabled) return null;
    if (!c.pixel_id || !c.access_token) return null;
    return c;
  } catch (e) {
    // Table doesn't exist yet (startup race) — skip silently.
    if (e.code === '42P01') return null;
    console.warn('Meta CAPI getConfig error:', e.message);
    return null;
  }
}

// Fire one `Lead` event to Meta for the given user's pixel.
// lead:  { id, name, email, phone }   (any subset; missing fields are skipped)
// opts:  { fbc, fbp, source_url, client_ip, client_ua, action_source }
async function fireLeadEvent(userId, lead, opts = {}) {
  try {
    const cfg = await getConfig(userId);
    if (!cfg) return;

    const userData = {};
    if (lead?.email) userData.em = sha256(lead.email);
    if (lead?.phone) {
      const digits = String(lead.phone).replace(/\D/g, '');
      if (digits) userData.ph = sha256(digits);
    }
    if (lead?.name) {
      const parts = String(lead.name).trim().split(/\s+/);
      if (parts[0]) userData.fn = sha256(parts[0]);
      if (parts.length > 1) userData.ln = sha256(parts.slice(1).join(' '));
    }
    // Pass-through identifiers captured from the visitor's browser cookies / request.
    if (opts.fbc) userData.fbc = opts.fbc;
    if (opts.fbp) userData.fbp = opts.fbp;
    if (opts.client_ip) userData.client_ip_address = opts.client_ip;
    if (opts.client_ua) userData.client_user_agent = opts.client_ua;

    const event = {
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      action_source: opts.action_source || 'website',
      event_source_url: opts.source_url || undefined,
      user_data: userData,
      // Deterministic id helps Meta dedupe with any browser-side pixel Lead event.
      event_id: `lead-${lead?.id || ''}-${Date.now()}`,
    };

    const body = { data: [event] };
    if (cfg.test_event_code) body.test_event_code = cfg.test_event_code;

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixel_id}/events?access_token=${encodeURIComponent(cfg.access_token)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.warn(`Meta CAPI lead event non-OK (${r.status}):`, txt.slice(0, 400));
    }
  } catch (e) {
    console.warn('Meta CAPI lead event error (suppressed):', e.message);
  }
}

// Best-effort extraction of the visitor's IP from an Express req (respects X-Forwarded-For).
function clientIpFromReq(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || undefined;
}

module.exports = { fireLeadEvent, clientIpFromReq };
