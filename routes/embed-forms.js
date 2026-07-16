// ============================================
// EMBED FORMS — standalone, named, embeddable lead-capture forms
// Each form has its own snippet + source tag. Submissions land in the leads
// pipeline (so they show in Customers/Leads and feed source analytics), and
// optionally trigger the lead-form AI SMS follow-up (per-form toggle).
// ============================================
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const sgMail = require('@sendgrid/mail');
const { fireLeadEvent, clientIpFromReq } = require('../utils/metaConversions');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ── Migration ────────────────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS embed_forms (
    id SERIAL PRIMARY KEY,
    public_id TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT 'Untitled Form',
    source TEXT NOT NULL DEFAULT 'embed_form',
    title TEXT DEFAULT 'Get in touch',
    description TEXT DEFAULT '',
    submit_text TEXT DEFAULT 'Submit',
    success_message TEXT DEFAULT 'Thanks! We''ll be in touch shortly.',
    theme_color TEXT DEFAULT '#d97706',
    field_color TEXT DEFAULT '#d1d5db',
    sms_followup BOOLEAN DEFAULT TRUE,
    fields JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
`).catch(e => console.error('embed_forms migration error:', e.message));

// Backfill field_color on tables created before it existed (accent for input borders).
pool.query(`ALTER TABLE embed_forms ADD COLUMN IF NOT EXISTS field_color TEXT DEFAULT '#d1d5db'`)
  .catch(e => console.error('embed_forms field_color migration error:', e.message));

const STANDARD_KEYS = ['name', 'email', 'phone', 'service', 'message'];

const DEFAULT_FIELDS = [
  { key: 'name',    type: 'text',     label: 'Name',    placeholder: 'Your name',          required: true },
  { key: 'email',   type: 'email',    label: 'Email',   placeholder: 'you@email.com',      required: true },
  { key: 'phone',   type: 'tel',      label: 'Phone',   placeholder: '(555) 123-4567',     required: true },
  { key: 'message', type: 'textarea', label: 'Message', placeholder: 'How can we help?',   required: false },
];

function genPublicId() {
  return 'f_' + crypto.randomBytes(8).toString('hex'); // url-safe, 18 chars
}

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'embed_form';
}

// Normalize/validate the fields array coming from the builder.
function sanitizeFields(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_FIELDS;
  const allowedTypes = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'];
  return raw.map((f, i) => {
    const type = allowedTypes.includes(f.type) ? f.type : 'text';
    let key = (f.key && /^[a-zA-Z0-9_]+$/.test(f.key)) ? f.key : `field_${i + 1}`;
    return {
      key,
      type,
      label: String(f.label || 'Field').slice(0, 100),
      placeholder: String(f.placeholder || '').slice(0, 120),
      required: !!f.required,
      options: type === 'select' && Array.isArray(f.options) ? f.options.map(o => String(o).slice(0, 80)).filter(Boolean) : undefined,
    };
  });
}

function corsHeaders(res) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
}

// Mirror of leads.js triggerLeadFormAgent scheduling, minus the source gate (the per-form
// toggle already decided this should follow up). The cron in server.js sends pending SMS.
async function scheduleLeadSms(userId, lead) {
  try {
    const agentConfig = await pool.query(
      'SELECT config, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );
    const cfg = agentConfig.rows[0]?.config;
    // Explicit off (enabled:false) always wins; otherwise live if deployed or enabled.
    const smsAgentLive = !!cfg && cfg.enabled !== false && (cfg.deployed === true || cfg.enabled === true);
    if (!cfg || !smsAgentLive) {
      console.log('Embed form SMS skipped — lead_form agent not deployed for user', userId);
      return;
    }
    const smsTemplate = agentConfig.rows[0].sms_template;
    if (cfg.smsEnabled && lead.phone && lead.sms_consent && smsTemplate) {
      const delaySeconds = 45 + Math.floor(Math.random() * 30);
      await pool.query(
        `UPDATE leads SET status = 'sms_pending', sms_scheduled_at = NOW() + ($1 * INTERVAL '1 second') WHERE id = $2`,
        [delaySeconds, lead.id]
      );
      console.log(`⏰ Embed form SMS scheduled for lead ${lead.id} in ${delaySeconds}s`);
    }
  } catch (e) {
    console.error('Error scheduling embed form SMS:', e.message);
  }
}

// ════════════════════════════════════════════════════════════
// Authenticated CRUD (dashboard builder)
// ════════════════════════════════════════════════════════════

// List forms + lead counts (matched by source)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*,
              (SELECT COUNT(*) FROM leads l WHERE l.user_id = f.user_id AND l.source = f.source) AS lead_count
       FROM embed_forms f
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC`,
      [req.user.userId]
    );
    res.json({ forms: result.rows });
  } catch (e) {
    console.error('Error listing embed forms:', e.message);
    res.status(500).json({ error: 'Failed to load forms' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || 'Untitled Form').slice(0, 120);
    const source = slugify(b.source || name);
    const result = await pool.query(
      `INSERT INTO embed_forms (public_id, user_id, name, source, title, description, submit_text, success_message, theme_color, field_color, sms_followup, fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        genPublicId(), req.user.userId, name, source,
        String(b.title || 'Get in touch').slice(0, 160),
        String(b.description || '').slice(0, 500),
        String(b.submit_text || 'Submit').slice(0, 60),
        String(b.success_message || "Thanks! We'll be in touch shortly.").slice(0, 300),
        String(b.theme_color || '#d97706').slice(0, 20),
        String(b.field_color || '#d1d5db').slice(0, 20),
        b.sms_followup !== false,
        JSON.stringify(sanitizeFields(b.fields)),
      ]
    );
    res.json({ form: result.rows[0] });
  } catch (e) {
    console.error('Error creating embed form:', e.message);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || 'Untitled Form').slice(0, 120);
    const source = slugify(b.source || name);
    const result = await pool.query(
      `UPDATE embed_forms SET
         name=$1, source=$2, title=$3, description=$4, submit_text=$5,
         success_message=$6, theme_color=$7, field_color=$8, sms_followup=$9, fields=$10, updated_at=NOW()
       WHERE id=$11 AND user_id=$12 RETURNING *`,
      [
        name, source,
        String(b.title || 'Get in touch').slice(0, 160),
        String(b.description || '').slice(0, 500),
        String(b.submit_text || 'Submit').slice(0, 60),
        String(b.success_message || "Thanks! We'll be in touch shortly.").slice(0, 300),
        String(b.theme_color || '#d97706').slice(0, 20),
        String(b.field_color || '#d1d5db').slice(0, 20),
        b.sms_followup !== false,
        JSON.stringify(sanitizeFields(b.fields)),
        req.params.id, req.user.userId,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Form not found' });
    res.json({ form: result.rows[0] });
  } catch (e) {
    console.error('Error updating embed form:', e.message);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// Duplicate an existing form → new public_id + distinct source, everything else copied.
router.post('/:id/duplicate', authenticateToken, async (req, res) => {
  try {
    const src = await pool.query('SELECT * FROM embed_forms WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    if (src.rows.length === 0) return res.status(404).json({ error: 'Form not found' });
    const f = src.rows[0];

    const name = String(f.name || 'Untitled Form').slice(0, 116) + ' (Copy)';

    // Keep the source tag distinct so the copy tracks as its own lead source.
    const existing = await pool.query('SELECT source FROM embed_forms WHERE user_id=$1', [req.user.userId]);
    const taken = new Set(existing.rows.map(r => r.source));
    const base = slugify(`${f.source}_copy`);
    let source = base;
    let n = 2;
    while (taken.has(source)) source = `${base}_${n++}`.slice(0, 40);

    const result = await pool.query(
      `INSERT INTO embed_forms (public_id, user_id, name, source, title, description, submit_text, success_message, theme_color, field_color, sms_followup, fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        genPublicId(), req.user.userId, name, source,
        f.title, f.description, f.submit_text, f.success_message, f.theme_color, f.field_color, f.sms_followup,
        JSON.stringify(Array.isArray(f.fields) ? f.fields : []),
      ]
    );
    res.json({ form: result.rows[0] });
  } catch (e) {
    console.error('Error duplicating embed form:', e.message);
    res.status(500).json({ error: 'Failed to duplicate form' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM embed_forms WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    res.json({ success: true });
  } catch (e) {
    console.error('Error deleting embed form:', e.message);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

// ════════════════════════════════════════════════════════════
// Public (CORS, no auth) — used by the embedded forms.js script
// ════════════════════════════════════════════════════════════

router.options('/public/:publicId', (req, res) => { corsHeaders(res); res.sendStatus(200); });
router.options('/public/:publicId/submit', (req, res) => { corsHeaders(res); res.sendStatus(200); });

// Render config for the embed script
router.get('/public/:publicId', async (req, res) => {
  corsHeaders(res);
  try {
    const r = await pool.query('SELECT * FROM embed_forms WHERE public_id = $1', [req.params.publicId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Form not found' });
    const f = r.rows[0];
    const owner = await pool.query('SELECT business_name FROM users WHERE id = $1', [f.user_id]);
    res.json({
      title: f.title,
      description: f.description,
      submitText: f.submit_text,
      successMessage: f.success_message,
      themeColor: f.theme_color,
      fieldColor: f.field_color,
      smsFollowup: f.sms_followup,
      fields: f.fields || [],
      businessName: owner.rows[0]?.business_name || 'us',
    });
  } catch (e) {
    console.error('Error fetching public form config:', e.message);
    res.status(500).json({ error: 'Failed to load form' });
  }
});

// Submission → leads pipeline
router.post('/public/:publicId/submit', async (req, res) => {
  corsHeaders(res);
  try {
    const r = await pool.query('SELECT * FROM embed_forms WHERE public_id = $1', [req.params.publicId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Form not found' });
    const form = r.rows[0];
    const body = req.body || {};
    const fields = Array.isArray(form.fields) ? form.fields : [];

    // Required-field validation (checkbox required = must be truthy)
    for (const f of fields) {
      if (!f.required) continue;
      const v = body[f.key];
      const ok = f.type === 'checkbox' ? (v === true || v === 'true' || v === 'on') : (v != null && String(v).trim() !== '');
      if (!ok) return res.status(400).json({ error: `${f.label} is required` });
    }

    const val = (k) => (body[k] != null ? String(body[k]).trim() : '');
    const name = val('name') || val('email') || val('phone') || 'Website Lead';
    const email = val('email') || null;
    const phone = val('phone') || null;
    const service = val('service') || null;
    let message = val('message') || null;
    const smsConsent = body.sms_consent === true || body.sms_consent === 'true' || body.sms_consent === 'on';

    // Compile non-standard answers (custom text, selects, checkboxes) into notes for the owner.
    const extraLines = [];
    for (const f of fields) {
      if (STANDARD_KEYS.includes(f.key)) continue;
      let v = body[f.key];
      if (f.type === 'checkbox') v = (v === true || v === 'true' || v === 'on') ? 'Yes' : 'No';
      if (v == null || String(v).trim() === '') continue;
      extraLines.push(`${f.label}: ${String(v).trim()}`);
    }
    const notes = `Via form: ${form.name}` + (extraLines.length ? `\n${extraLines.join('\n')}` : '');

    const insert = await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, status, source, notes, service, message, sms_consent, created_at)
       VALUES ($1,$2,$3,$4,'new',$5,$6,$7,$8,$9,CURRENT_TIMESTAMP) RETURNING *`,
      [form.user_id, name, email, phone, form.source, notes, service, message, smsConsent]
    );
    const lead = insert.rows[0];

    // Fire Meta Conversions API Lead event (no-op if user hasn't configured a pixel).
    fireLeadEvent(form.user_id, lead, {
      fbc: body.fbc, fbp: body.fbp,
      source_url: body.source_url || req.headers.referer,
      client_ip: clientIpFromReq(req),
      client_ua: req.headers['user-agent'],
    });

    if (form.sms_followup && phone && smsConsent) {
      scheduleLeadSms(form.user_id, lead).catch(e => console.error('scheduleLeadSms error:', e.message));
    }

    // Owner notification (non-blocking)
    if (process.env.SENDGRID_API_KEY) {
      pool.query('SELECT email, business_name FROM users WHERE id = $1', [form.user_id])
        .then(o => {
          const owner = o.rows[0];
          if (!owner?.email) return;
          const rows = [`<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;width:120px;">Name</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${name}</td></tr>`];
          if (phone) rows.push(`<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${phone}</td></tr>`);
          if (email) rows.push(`<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${email}</td></tr>`);
          if (service) rows.push(`<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;">Service</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${service}</td></tr>`);
          if (message) rows.push(`<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;vertical-align:top;">Message</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${message}</td></tr>`);
          for (const line of extraLines) {
            const [lbl, ...rest] = line.split(':');
            rows.push(`<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;">${lbl}</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${rest.join(':').trim()}</td></tr>`);
          }
          return sgMail.send({
            to: owner.email,
            from: { name: 'SORCE', email: 'noreply@sorceintegrations.com' },
            subject: `New lead: ${name} (${form.name})`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
              <div style="background:#1d4ed8;padding:1.5rem 2rem;border-radius:8px 8px 0 0;"><h1 style="color:#fff;margin:0;font-size:1.25rem;">New Lead — ${form.name}</h1></div>
              <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                <table style="width:100%;border-collapse:collapse;margin:0 0 1rem;">${rows.join('')}</table>
                <p style="color:#6b7280;font-size:0.85rem;margin:0;">Source: <strong>${form.source}</strong></p>
              </div></div>`,
          });
        })
        .catch(err => console.error('Embed form notification email error:', err.message));
    }

    res.json({ success: true, message: form.success_message || "Thanks! We'll be in touch shortly." });
  } catch (e) {
    console.error('Error submitting embed form:', e.message);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

module.exports = router;
