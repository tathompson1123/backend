// SORCE's own internal CRM: discovery calls with prospects, and the team members
// who can log into /analytics. Distinct from the customer-facing booking system —
// these rows are about people signing up for SORCE, not a customer's clients.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const {
  sendDiscoverySMS, sendConfirmationEmail, confirmationSMS, formatWhen,
  checkDiscoverySmsSetup,
} = require('../utils/discoveryNotify');
const { isZoomConfigured, createMeeting, updateMeeting, deleteMeeting, checkZoomSetup } = require('../utils/zoom');

const SITE_URL = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
const { TRANSACTIONAL_EMAIL } = require('../utils/emailFrom');
const FROM_EMAIL = TRANSACTIONAL_EMAIL;
const DEFAULT_SLOT_MINUTES = 30;

// Same guard the analytics dashboard uses. Tokens minted for an individual team
// member also carry tm (id) so we can attribute bookings and notes.
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

const requireAdmin = (req, res, next) => {
  // Legacy shared-password sessions have no tm and are treated as admin.
  if (!req.analytics?.tm || req.analytics.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
};

/* ─────────────────────────── TEAM MEMBERS ─────────────────────────── */

// GET /api/discovery/team — everyone who can log into /analytics
router.get('/team', requireAnalytics, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, title, phone, photo_url, bio, role, active,
              invite_accepted_at, (invite_token IS NOT NULL) AS invite_pending, created_at
       FROM sorce_team_members
       ORDER BY active DESC, name`
    );
    res.json({ success: true, team: result.rows });
  } catch (err) {
    console.error('Discovery team list error:', err.message);
    res.status(500).json({ error: 'Failed to load team' });
  }
});

// POST /api/discovery/team/invite — create the member and email them a set-password link
router.post('/team/invite', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const { name, email, title, phone, role } = req.body;
    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO sorce_team_members (name, email, title, phone, role, invite_token, invite_token_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name, title = EXCLUDED.title, phone = EXCLUDED.phone,
             role = EXCLUDED.role, invite_token = EXCLUDED.invite_token,
             invite_token_expires = EXCLUDED.invite_token_expires,
             invite_accepted_at = NULL, active = true
       RETURNING id, name, email, title, role`,
      [name.trim(), cleanEmail, title?.trim() || null, phone?.trim() || null,
       role === 'admin' ? 'admin' : 'member', inviteToken, expiresAt]
    );

    const inviteUrl = `${SITE_URL}/analytics/accept-invite?token=${inviteToken}`;
    if (process.env.SENDGRID_API_KEY) {
      try {
        await sgMail.send({
          to: cleanEmail,
          from: { name: 'SORCE', email: FROM_EMAIL },
          subject: "You've been given access to the SORCE dashboard",
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
              <h2 style="color:#111827;">Welcome to the team, ${name.trim().split(/\s+/)[0]}</h2>
              <p style="color:#374151;font-size:15px;line-height:1.6;">
                You've been given access to the internal SORCE dashboard. From there you can see
                signups and revenue, and manage the discovery call calendar.
              </p>
              <p style="color:#374151;font-size:15px;">Set your password to get in:</p>
              <div style="margin:28px 0;">
                <a href="${inviteUrl}" style="background:#d97706;color:#fff;padding:14px 28px;
                   text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">Set My Password</a>
              </div>
              <p style="color:#6b7280;font-size:13px;">This invite expires in 7 days.</p>
              <p style="color:#6b7280;font-size:12px;">If you weren't expecting this, you can ignore this email.</p>
            </div>`,
        });
      } catch (emailErr) {
        console.error('⚠️ Team invite email failed:', emailErr.message);
      }
    }

    res.json({ success: true, member: result.rows[0], inviteUrl });
  } catch (err) {
    console.error('Team invite error:', err.message);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// GET /api/discovery/team/invite-info/:token — public, so the accept page can greet them
router.get('/team/invite-info/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, email, title FROM sorce_team_members
       WHERE invite_token = $1 AND invite_token_expires > NOW()`,
      [req.params.token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'This invite link is invalid or has expired' });
    }
    res.json({ success: true, invite: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load invite' });
  }
});

// POST /api/discovery/team/accept-invite — public; sets the password and logs them in
router.post('/team/accept-invite', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const found = await pool.query(
      `SELECT id, name, email, role FROM sorce_team_members
       WHERE invite_token = $1 AND invite_token_expires > NOW()`,
      [token]
    );
    if (found.rows.length === 0) {
      return res.status(400).json({ error: 'This invite link is invalid or has expired' });
    }
    const member = found.rows[0];
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE sorce_team_members
       SET password_hash = $1, invite_accepted_at = NOW(), invite_token = NULL, invite_token_expires = NULL
       WHERE id = $2`,
      [passwordHash, member.id]
    );
    const authToken = jwt.sign(
      { analytics: true, tm: member.id, name: member.name, email: member.email, role: member.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ success: true, token: authToken, member: { name: member.name, email: member.email, role: member.role } });
  } catch (err) {
    console.error('Accept invite error:', err.message);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// PATCH /api/discovery/team/:id/role — promote to admin or drop back to member
router.patch('/team/:id/role', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const role = req.body.role === 'admin' ? 'admin' : 'member';

    // Don't allow the last admin to demote themselves out of the dashboard.
    if (role === 'member') {
      const admins = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM sorce_team_members
         WHERE role = 'admin' AND active = true AND id <> $1`,
        [req.params.id]
      );
      if (admins.rows[0].cnt === 0) {
        return res.status(400).json({
          error: 'That would leave nobody as admin. Promote someone else first.',
        });
      }
    }

    const result = await pool.query(
      `UPDATE sorce_team_members SET role = $1 WHERE id = $2
       RETURNING id, name, email, role`,
      [role, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team member not found' });
    res.json({ success: true, member: result.rows[0] });
  } catch (err) {
    console.error('Role change error:', err.message);
    res.status(500).json({ error: 'Could not change that role' });
  }
});

// GET /api/discovery/me — what this session is allowed to see
router.get('/me', requireAnalytics, (req, res) => {
  const isAdmin = !req.analytics?.tm || req.analytics.role === 'admin';
  res.json({
    success: true,
    isAdmin,
    name: req.analytics?.name || null,
    email: req.analytics?.email || null,
    role: isAdmin ? 'admin' : 'member',
  });
});

// PATCH /api/discovery/team/:id — edit a member's details
// Phone matters beyond the profile: it's how a prospect's reply reaches the rep who
// owns their call, and until now it could only be set at invite time — which meant
// anyone already invited needed a Railway variable and a redeploy to be reachable.
//
// Admins edit anyone; a member can edit their own record. Role is deliberately not in
// the whitelist so nobody can quietly promote themselves — that stays on /role, which
// is admin-guarded.
const TEAM_EDITABLE = ['name', 'email', 'title', 'phone', 'bio', 'photo_url'];

router.patch('/team/:id', requireAnalytics, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const isAdmin = !req.analytics?.tm || req.analytics.role === 'admin';
    if (!isAdmin && req.analytics.tm !== targetId) {
      return res.status(403).json({ error: 'You can only edit your own details' });
    }

    const sets = [];
    const params = [];
    for (const f of TEAM_EDITABLE) {
      if (!(f in (req.body || {}))) continue;
      let v = req.body[f];
      if (typeof v === 'string') v = v.trim();
      if (f === 'email') {
        if (!v) return res.status(400).json({ error: 'Email cannot be empty' });
        v = String(v).toLowerCase();
      }
      if (f === 'name' && !v) return res.status(400).json({ error: 'Name cannot be empty' });
      params.push(v === '' ? null : v);
      sets.push(`${f} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(targetId);
    const result = await pool.query(
      `UPDATE sorce_team_members SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, email, title, phone, photo_url, bio, role, active`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Team member not found' });
    res.json({ success: true, member: result.rows[0] });
  } catch (err) {
    // email is unique — it's the login identifier, so a clash has to be a clear error
    // rather than a 500 the user can't act on.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Another team member already uses that email' });
    }
    console.error('Team update error:', err.message);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

// DELETE /api/discovery/team/:id — revoke access
router.delete('/team/:id', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE sorce_team_members SET active = false, password_hash = NULL, invite_token = NULL WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke access' });
  }
});

// GET /api/discovery/zoom/status — confirm the Zoom credentials and scopes are right
// without having to book a real call to find out. Admin-only: it names the host account
// and echoes Zoom's own error text.
router.get('/zoom/status', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, ...(await checkZoomSetup()) });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Whether a confirmation text will actually arrive, checked before booking rather than
// discovered afterwards. Not requireAdmin: the whole team books calls, so the whole team
// needs to know when the text isn't going to land.
router.get('/sms/status', requireAnalytics, async (req, res) => {
  try {
    res.json({ success: true, ...(await checkDiscoverySmsSetup()) });
  } catch (err) {
    // A broken preflight must not read as broken SMS — it's the check that failed.
    res.status(500).json({ success: false, level: 'unknown', error: err.message });
  }
});

/* ─────────────────────────── SORCE SALES LEADS ─────────────────────────── */
// Prospects for SORCE itself, worked before (or without) a booked discovery call.
// requireAnalytics only, no requireAdmin — the whole team sells, so members need this
// the same way they need the discovery calendar.

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'demo_scheduled', 'won', 'lost'];
const LEAD_FIELDS = [
  'name', 'email', 'phone', 'company', 'source', 'status', 'notes', 'assigned_to',
  'website', 'address', 'city', 'state', 'industry', 'contact_title',
];

// Shared projection. days_since_contact falls back to created_at so a lead nobody has
// touched yet still shows an age rather than a blank — "never contacted, 12 days old"
// is the row most worth chasing, and it'd otherwise be the one that looks fine.
const LEAD_SELECT = `
  sl.*, tm.name AS assigned_name,
  dc.scheduled_at AS call_scheduled_at, dc.status AS call_status,
  dc.zoom_join_url AS call_zoom_url, dc.duration_minutes AS call_duration,
  EXTRACT(DAY FROM (NOW() - COALESCE(sl.last_contacted_at, sl.created_at)))::int AS days_since_contact,
  (sl.last_contacted_at IS NOT NULL) AS has_been_contacted,
  (sl.sms_consent_at IS NOT NULL) AS has_sms_consent,
  consenter.name AS sms_consent_by_name`;

const LEAD_FROM = `
  FROM sorce_leads sl
  LEFT JOIN sorce_team_members tm ON tm.id = sl.assigned_to
  LEFT JOIN discovery_calls dc ON dc.id = sl.discovery_call_id
  LEFT JOIN sorce_team_members consenter ON consenter.id = sl.sms_consent_by`;

// A booked discovery call is the same person further down the pipeline, so it lands in
// the same table rather than a parallel one — that's what lets a cold call graduate to
// "booked meeting" without being re-keyed, and what keeps the Booked Meetings view in
// step with the calendar. Matched on email first, then phone, so booking from the
// public page updates the row the team already created by hand.
async function syncLeadForCall(call) {
  if (!call?.id) return null;
  try {
    const email = call.email ? String(call.email).trim().toLowerCase() : null;
    const last10 = call.phone ? String(call.phone).replace(/\D/g, '').slice(-10) : null;

    const existing = await pool.query(
      `SELECT id FROM sorce_leads
        WHERE ($1::text IS NOT NULL AND LOWER(TRIM(email)) = $1)
           OR ($2::text IS NOT NULL AND length($2) = 10
               AND right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = $2)
        ORDER BY id LIMIT 1`,
      [email, last10]
    );

    if (existing.rows.length) {
      const updated = await pool.query(
        `UPDATE sorce_leads
            SET status = 'demo_scheduled', discovery_call_id = $2,
                company = COALESCE(NULLIF(company,''), $3),
                assigned_to = COALESCE(assigned_to, $4),
                last_contacted_at = NOW(), updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [existing.rows[0].id, call.id, call.company || null, call.assigned_to || null]
      );
      return updated.rows[0];
    }

    const created = await pool.query(
      `INSERT INTO sorce_leads
         (name, email, phone, company, source, status, notes, assigned_to,
          discovery_call_id, last_contacted_at)
       VALUES ($1,$2,$3,$4,$5,'demo_scheduled',$6,$7,$8,NOW())
       RETURNING *`,
      [call.name, email, call.phone || null, call.company || null,
       call.source === 'public' ? 'website' : 'manual',
       call.notes || null, call.assigned_to || null, call.id]
    );
    return created.rows[0];
  } catch (err) {
    // Never let pipeline bookkeeping break a booking.
    console.error(`⚠️ Lead sync failed for discovery call ${call.id}:`, err.message);
    return null;
  }
}

// GET /api/discovery/leads
router.get('/leads', requireAnalytics, async (req, res) => {
  try {
    const { status, q } = req.query;
    const where = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      where.push(`sl.status = $${params.length}`);
    }
    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      where.push(`(sl.name ILIKE ${p} OR sl.email ILIKE ${p} OR sl.company ILIKE ${p} OR sl.phone ILIKE ${p})`);
    }

    const result = await pool.query(
      `SELECT ${LEAD_SELECT} ${LEAD_FROM}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY sl.created_at DESC
        LIMIT 500`,
      params
    );

    // Counts are unfiltered so the status chips keep showing the whole pipeline even
    // while a filter is applied — otherwise every chip but the active one reads zero.
    const counts = await pool.query(
      `SELECT status, COUNT(*)::int AS n FROM sorce_leads GROUP BY status`
    );
    const views = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE discovery_call_id IS NOT NULL)::int AS booked,
              COUNT(*) FILTER (WHERE source = 'cold_outreach')::int AS outreach
         FROM sorce_leads`
    );

    res.json({
      success: true,
      leads: result.rows,
      counts: Object.fromEntries(counts.rows.map(r => [r.status, r.n])),
      views: views.rows[0],
    });
  } catch (err) {
    console.error('Sorce leads list error:', err.message);
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

// POST /api/discovery/leads
router.post('/leads', requireAnalytics, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (b.status && !LEAD_STATUSES.includes(b.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    // Logging a cold call is itself a contact, so the row starts its clock now rather
    // than reading "0 days since contact, never contacted".
    const contactedNow = b.source === 'cold_outreach' || b.markContacted === true;
    const inserted = await pool.query(
      `INSERT INTO sorce_leads
         (name, email, phone, company, source, status, notes, assigned_to,
          website, address, city, state, industry, contact_title,
          last_contacted_at, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,'manual'),COALESCE($6,'new'),$7,$8,
               $9,$10,$11,$12,$13,$14,
               CASE WHEN $15 THEN NOW() ELSE NULL END, $16)
       RETURNING id`,
      [String(b.name).trim(), b.email || null, b.phone || null, b.company || null,
       b.source || null, b.status || null, b.notes || null, b.assigned_to || null,
       b.website || null, b.address || null, b.city || null, b.state || null,
       b.industry || null, b.contact_title || null,
       contactedNow, req.analytics?.tm || null]
    );
    const full = await pool.query(
      `SELECT ${LEAD_SELECT} ${LEAD_FROM} WHERE sl.id = $1`, [inserted.rows[0].id]
    );
    res.json({ success: true, lead: full.rows[0] });
  } catch (err) {
    console.error('Sorce lead create error:', err.message);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// PATCH /api/discovery/leads/:id — partial update, whitelist-driven
router.patch('/leads/:id', requireAnalytics, async (req, res) => {
  try {
    const sets = [];
    const params = [];
    for (const f of LEAD_FIELDS) {
      if (!(f in (req.body || {}))) continue;
      if (f === 'status' && req.body.status && !LEAD_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      params.push(req.body[f] === '' ? null : req.body[f]);
      sets.push(`${f} = $${params.length}`);
    }
    // "Log contact" resets the days-since counter without the caller having to know
    // the column, and moving a lead to Contacted implies it too.
    if (req.body?.markContacted === true || req.body?.status === 'contacted') {
      sets.push('last_contacted_at = NOW()');
    }

    // Consent is stamped server-side with who recorded it, so the timestamp can't be
    // backdated from the client — the whole point of the record is that it's evidence.
    if (req.body?.recordSmsConsent === true) {
      params.push(req.analytics?.tm || null);
      sets.push(`sms_consent_at = NOW()`, `sms_consent_method = 'verbal'`,
                `sms_consent_by = $${params.length}`);
      if (typeof req.body.sms_consent_note === 'string') {
        params.push(req.body.sms_consent_note.trim() || null);
        sets.push(`sms_consent_note = $${params.length}`);
      }
    } else if (req.body?.recordSmsConsent === false) {
      // Withdrawn, or recorded by mistake. Clearing it is as important as setting it.
      sets.push('sms_consent_at = NULL', 'sms_consent_method = NULL', 'sms_consent_by = NULL');
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE sorce_leads SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING id`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Lead not found' });
    const full = await pool.query(
      `SELECT ${LEAD_SELECT} ${LEAD_FROM} WHERE sl.id = $1`, [result.rows[0].id]
    );
    res.json({ success: true, lead: full.rows[0] });
  } catch (err) {
    console.error('Sorce lead update error:', err.message);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// DELETE /api/discovery/leads/:id
router.delete('/leads/:id', requireAnalytics, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM sorce_leads WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Sorce lead delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// POST /api/discovery/leads/:id/book — graduate a pipeline lead to a booked call.
//
// The mirror of syncLeadForCall, and deliberately not built on it. That function matches
// a lead by email then phone, which is right when a stranger books themselves off the
// public page and we have to guess who they are. Here the rep has one row on screen and
// clicked it, so guessing is a downgrade: phone formats are inconsistent across the
// pipeline, a prospect can book under a different address than we hold, and the fallback
// on no match is to INSERT — so the failure mode is a duplicate lead and a "Demo Set" row
// that still reads unbooked. Linking by the id we were handed can't do either.
//
// Setting a lead's status to demo_scheduled by hand used to be the only route to this
// state, and it created no call at all: the lead claimed a demo was set while the calendar
// and the Discovery Calls tab knew nothing about it.
router.post('/leads/:id/book', requireAnalytics, async (req, res) => {
  try {
    const {
      scheduledAt, durationMinutes, timezone, assignedTo, notes,
      sendNotifications = true,
    } = req.body || {};
    if (!scheduledAt) return res.status(400).json({ error: 'A date and time is required' });

    const leadRes = await pool.query('SELECT * FROM sorce_leads WHERE id = $1', [req.params.id]);
    if (!leadRes.rows.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = leadRes.rows[0];

    // Same floor as POST /calls — a booking nobody can be told about isn't one.
    if (!lead.email && !lead.phone) {
      return res.status(400).json({
        error: 'Add a phone number or email to this lead first so we can send the invite',
      });
    }

    // Already on the calendar. Handing the existing call back lets the UI offer a
    // reschedule rather than quietly standing up a second meeting for the same person.
    // Cancelled and no-show calls don't count — those leads are meant to be re-booked.
    if (lead.discovery_call_id) {
      const live = await pool.query(
        `SELECT * FROM discovery_calls
          WHERE id = $1 AND status NOT IN ('cancelled', 'no_show')`,
        [lead.discovery_call_id]
      );
      if (live.rows.length) {
        return res.status(409).json({
          error: 'This lead already has a call booked',
          call: live.rows[0],
        });
      }
    }

    // Whoever already owns the lead keeps it unless the form says otherwise, so booking
    // doesn't silently reassign a prospect to whoever happened to schedule the meeting.
    const rep = assignedTo || lead.assigned_to || req.analytics?.tm || null;

    // The lead's own notes are pipeline history, not a briefing for this call, so they
    // aren't copied across — the call carries only what the rep writes here.
    const created = await pool.query(
      `INSERT INTO discovery_calls
         (name, email, phone, company, scheduled_at, duration_minutes, timezone,
          assigned_to, notes, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'lead',$10)
       RETURNING *`,
      [lead.name, lead.email || null, lead.phone || null, lead.company || null,
       scheduledAt, durationMinutes || DEFAULT_SLOT_MINUTES,
       timezone || 'America/New_York', rep, notes?.trim() || null, req.analytics?.tm || null]
    );
    const call = created.rows[0];

    await pool.query(
      `UPDATE sorce_leads
          SET status = 'demo_scheduled', discovery_call_id = $2,
              assigned_to = COALESCE(assigned_to, $3),
              last_contacted_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [lead.id, call.id, rep]
    );

    const delivery = sendNotifications ? await dispatchConfirmations(call) : null;

    // Return the re-projected lead so the row can update in place — it now carries
    // call_scheduled_at and the Zoom link the Booked Meetings view reads.
    const full = await pool.query(
      `SELECT ${LEAD_SELECT} ${LEAD_FROM} WHERE sl.id = $1`, [lead.id]
    );
    res.json({ success: true, call, lead: full.rows[0], delivery });
  } catch (err) {
    console.error('Book call from lead error:', err.message);
    res.status(500).json({ error: 'Failed to book the call' });
  }
});

/* ─────────────────────────── DISCOVERY CALLS ─────────────────────────── */

// GET /api/discovery/calls
router.get('/calls', requireAnalytics, async (req, res) => {
  try {
    const { status, from, to } = req.query;
    const clauses = [];
    const params = [];
    if (status && status !== 'all') { params.push(status); clauses.push(`dc.status = $${params.length}`); }
    if (from) { params.push(from); clauses.push(`dc.scheduled_at >= $${params.length}`); }
    if (to) { params.push(to); clauses.push(`dc.scheduled_at <= $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    // Match the prospect to a SORCE account by email so the card can show whether
    // they've actually paid, and for what.
    const result = await pool.query(
      `SELECT dc.*,
              tm.name AS rep_name, tm.title AS rep_title, tm.photo_url AS rep_photo,
              u.id                       AS customer_user_id,
              u.plan                     AS customer_plan,
              u.subscription_status      AS customer_status,
              u.last_payment_at          AS customer_last_payment_at,
              u.last_payment_amount      AS customer_last_payment_amount,
              u.last_payment_description AS customer_last_payment_description
       FROM discovery_calls dc
       LEFT JOIN sorce_team_members tm ON tm.id = dc.assigned_to
       LEFT JOIN users u ON dc.email IS NOT NULL AND LOWER(u.email) = LOWER(dc.email)
       ${where}
       ORDER BY dc.scheduled_at DESC
       LIMIT 500`,
      params
    );
    const calls = result.rows.map(c => ({
      ...c,
      customer_last_payment_amount:
        c.customer_last_payment_amount != null ? c.customer_last_payment_amount / 100 : null,
      // Paid means money cleared — an active subscription or a recorded one-off.
      has_paid: !!c.customer_last_payment_at || c.customer_status === 'active',
      is_subscribed: c.customer_status === 'active',
    }));
    res.json({ success: true, calls });
  } catch (err) {
    console.error('Discovery calls list error:', err.message);
    res.status(500).json({ error: 'Failed to load discovery calls' });
  }
});

// POST /api/discovery/calls — book manually from the dashboard
router.post('/calls', requireAnalytics, async (req, res) => {
  try {
    const {
      name, email, phone, company, scheduledAt, durationMinutes,
      timezone, assignedTo, notes, sendNotifications = true,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!scheduledAt) return res.status(400).json({ error: 'A date and time is required' });
    if (!phone?.trim() && !email?.trim()) {
      return res.status(400).json({ error: 'A phone number or email is required so we can reach them' });
    }

    const rep = assignedTo || req.analytics?.tm || null;
    const result = await pool.query(
      `INSERT INTO discovery_calls
         (name, email, phone, company, scheduled_at, duration_minutes, timezone,
          assigned_to, notes, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10)
       RETURNING *`,
      [name.trim(), email?.trim().toLowerCase() || null, phone?.trim() || null,
       company?.trim() || null, scheduledAt, durationMinutes || DEFAULT_SLOT_MINUTES,
       timezone || 'America/New_York', rep, notes?.trim() || null, req.analytics?.tm || null]
    );

    const call = result.rows[0];
    // Outside the sendNotifications branch on purpose — a call booked quietly is still
    // a booked meeting and still belongs in the pipeline.
    await syncLeadForCall(call);
    // Hand the delivery result back. It used to be discarded, so a text that failed to
    // send — the usual cause being SORCE_SMS_FROM unset — looked like a clean booking
    // and was only discoverable by noticing the "Confirmation text" badge stayed grey.
    const delivery = sendNotifications ? await dispatchConfirmations(call) : null;
    res.json({ success: true, call, delivery });
  } catch (err) {
    console.error('Create discovery call error:', err.message);
    res.status(500).json({ error: 'Failed to create discovery call' });
  }
});

// PUT /api/discovery/calls/:id — notes, status, reassignment, reschedule
router.put('/calls/:id', requireAnalytics, async (req, res) => {
  try {
    const allowed = {
      name: 'name', email: 'email', phone: 'phone', company: 'company',
      scheduledAt: 'scheduled_at', durationMinutes: 'duration_minutes',
      timezone: 'timezone', assignedTo: 'assigned_to', notes: 'notes',
      status: 'status', outcome: 'outcome',
    };
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (req.body[key] !== undefined) {
        params.push(req.body[key] === '' ? null : req.body[key]);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    // Moving the call means the old reminders no longer apply — let them fire again.
    if (req.body.scheduledAt !== undefined) {
      sets.push('reminder_24h_sent = false', 'reminder_2h_sent = false');
    }
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE discovery_calls SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Call not found' });

    const updated = result.rows[0];

    // Keep Zoom in step with the row. A moved call whose meeting still sits at the old
    // time would put the prospect in an empty room at the right moment; a cancelled one
    // would leave a live link they could still join.
    if (updated.zoom_meeting_id) {
      const moved = req.body.scheduledAt !== undefined || req.body.durationMinutes !== undefined;
      const killed = ['cancelled', 'no_show'].includes(req.body.status);
      try {
        if (killed) {
          await deleteMeeting(updated.zoom_meeting_id);
          await pool.query(
            `UPDATE discovery_calls
                SET zoom_meeting_id = NULL, zoom_join_url = NULL, zoom_start_url = NULL, zoom_passcode = NULL
              WHERE id = $1`,
            [updated.id]
          );
          updated.zoom_meeting_id = updated.zoom_join_url = updated.zoom_start_url = updated.zoom_passcode = null;
        } else if (moved) {
          await updateMeeting(updated.zoom_meeting_id, {
            startTime: updated.scheduled_at,
            durationMinutes: updated.duration_minutes,
            timezone: updated.timezone,
          });
        }
      } catch (zoomErr) {
        // Never fail the update over Zoom — the row is already correct and the team can
        // see the discrepancy, whereas a 500 here would lose the edit entirely.
        console.error(`⚠️ Zoom sync failed (call ${updated.id}):`, zoomErr.message);
      }
    }

    res.json({ success: true, call: updated });
  } catch (err) {
    console.error('Update discovery call error:', err.message);
    res.status(500).json({ error: 'Failed to update discovery call' });
  }
});

// DELETE /api/discovery/calls/:id
router.delete('/calls/:id', requireAnalytics, async (req, res) => {
  try {
    // Tear the meeting down first — deleting the row loses the id, and the meeting
    // would stay live on the Zoom account forever with a link the prospect still holds.
    const existing = await pool.query(
      'SELECT zoom_meeting_id FROM discovery_calls WHERE id = $1', [req.params.id]
    );
    const meetingId = existing.rows[0]?.zoom_meeting_id;
    if (meetingId) {
      await deleteMeeting(meetingId)
        .catch(e => console.error(`⚠️ Zoom delete failed (call ${req.params.id}):`, e.message));
    }
    await pool.query('DELETE FROM discovery_calls WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete discovery call' });
  }
});

// POST /api/discovery/calls/:id/resend — manually re-fire the confirmation
router.post('/calls/:id/resend', requireAnalytics, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM discovery_calls WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Call not found' });
    const channel = ['sms', 'email', 'both'].includes(req.body?.channel) ? req.body.channel : 'both';
    const outcome = await dispatchConfirmations(result.rows[0], { force: true, channel });
    res.json({ success: true, ...outcome });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resend confirmation' });
  }
});

/* ─────────────────────────── AVAILABILITY (public booking) ─────────────────────────── */

// Weekday windows the public page offers. Falls back to Mon–Fri 9–5 when nothing is set.
const DEFAULT_WINDOWS = [1, 2, 3, 4, 5].map(day => ({ day_of_week: day, start_time: '09:00', end_time: '17:00' }));

async function loadWindows() {
  try {
    const result = await pool.query(
      `SELECT day_of_week, start_time::text, end_time::text FROM discovery_availability ORDER BY day_of_week`
    );
    return result.rows.length ? result.rows : DEFAULT_WINDOWS;
  } catch {
    return DEFAULT_WINDOWS;
  }
}

// GET /api/discovery/availability — internal view of the windows
router.get('/availability', requireAnalytics, async (req, res) => {
  res.json({ success: true, windows: await loadWindows() });
});

// PUT /api/discovery/availability — replace the whole schedule
router.put('/availability', requireAnalytics, requireAdmin, async (req, res) => {
  try {
    const windows = Array.isArray(req.body.windows) ? req.body.windows : [];
    await pool.query('DELETE FROM discovery_availability');
    for (const w of windows) {
      await pool.query(
        `INSERT INTO discovery_availability (day_of_week, start_time, end_time) VALUES ($1,$2,$3)`,
        [w.day_of_week, w.start_time, w.end_time]
      );
    }
    res.json({ success: true, windows: await loadWindows() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save availability' });
  }
});

/* ─────────────────────────── shared helpers ─────────────────────────── */

// Give the call a Zoom meeting, once. Returns the call row — updated in place when a
// meeting was created, unchanged otherwise.
//
// Every failure path deliberately returns the call rather than throwing: a prospect
// who booked a slot must stay booked even if Zoom is misconfigured or down, and the
// messaging below already falls back to the phone-call wording when there's no link.
async function ensureZoomMeeting(call) {
  if (call.zoom_join_url || !isZoomConfigured()) return call;
  try {
    const meeting = await createMeeting({
      topic: `SORCE Discovery Call — ${call.name}`,
      startTime: call.scheduled_at,
      durationMinutes: call.duration_minutes || DEFAULT_SLOT_MINUTES,
      timezone: call.timezone || 'America/New_York',
      agenda: call.company ? `Discovery call with ${call.name} (${call.company})` : undefined,
    });
    const updated = await pool.query(
      `UPDATE discovery_calls
          SET zoom_meeting_id = $1, zoom_join_url = $2, zoom_start_url = $3, zoom_passcode = $4,
              updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [meeting.meetingId, meeting.joinUrl, meeting.startUrl, meeting.passcode, call.id]
    );
    console.log(`🎥 Zoom meeting ${meeting.meetingId} created for discovery call ${call.id}`);
    return updated.rows[0] || call;
  } catch (err) {
    console.error(`⚠️ Zoom meeting creation failed (call ${call.id}):`, err.message);
    return call;
  }
}

// Fire the confirmation text + email, recording what actually made it out so the
// dashboard can show which channel failed rather than silently swallowing it.
// channel narrows what gets re-fired. The recovery case that needs it: the text was
// dropped because A2P wasn't verified yet while the email went out fine, so forcing both
// would send a second identical confirmation email just to deliver the missing text.
async function dispatchConfirmations(call, { force = false, channel = 'both' } = {}) {
  const result = { smsSent: false, emailSent: false, errors: [], channel };
  const wantSms = channel !== 'email';
  const wantEmail = channel !== 'sms';

  // Before anything goes out, so the link is in the very first message they get.
  call = await ensureZoomMeeting(call);
  result.zoomJoinUrl = call.zoom_join_url || null;

  const rep = call.assigned_to
    ? (await pool.query(
        'SELECT name, email, title, photo_url, bio FROM sorce_team_members WHERE id = $1',
        [call.assigned_to]
      )).rows[0]
    : null;

  if (wantSms && call.phone && (force || !call.confirmation_sms_sent)) {
    try {
      await sendDiscoverySMS(call.phone, confirmationSMS(call, rep));
      await pool.query('UPDATE discovery_calls SET confirmation_sms_sent = true WHERE id = $1', [call.id]);
      result.smsSent = true;
    } catch (err) {
      console.error(`⚠️ Discovery confirmation SMS failed (call ${call.id}):`, err.message);
      result.errors.push(`SMS: ${err.message}`);
    }
  }

  if (wantEmail && call.email && (force || !call.confirmation_email_sent)) {
    try {
      await sendConfirmationEmail(call, rep);
      await pool.query('UPDATE discovery_calls SET confirmation_email_sent = true WHERE id = $1', [call.id]);
      result.emailSent = true;
    } catch (err) {
      console.error(`⚠️ Discovery confirmation email failed (call ${call.id}):`, err.message);
      result.errors.push(`Email: ${err.message}`);
    }
  }

  return result;
}

// Free 30-minute slots on a given date, in the windows above, minus anything booked.
async function slotsForDate(dateStr) {
  const windows = await loadWindows();
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const todays = windows.filter(w => Number(w.day_of_week) === day);
  if (todays.length === 0) return [];

  const booked = (await pool.query(
    `SELECT scheduled_at, duration_minutes FROM discovery_calls
     WHERE status != 'cancelled' AND scheduled_at::date = $1::date`,
    [dateStr]
  )).rows;

  const slots = [];
  for (const w of todays) {
    const [sh, sm] = String(w.start_time).split(':').map(Number);
    const [eh, em] = String(w.end_time).split(':').map(Number);
    for (let m = sh * 60 + sm; m + DEFAULT_SLOT_MINUTES <= eh * 60 + em; m += DEFAULT_SLOT_MINUTES) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const start = new Date(`${dateStr}T${hh}:${mm}:00`);
      if (start.getTime() < Date.now() + 60 * 60 * 1000) continue; // need an hour's notice
      const overlaps = booked.some(b => {
        const bStart = new Date(b.scheduled_at).getTime();
        const bEnd = bStart + (b.duration_minutes || DEFAULT_SLOT_MINUTES) * 60000;
        const sStart = start.getTime();
        return sStart < bEnd && sStart + DEFAULT_SLOT_MINUTES * 60000 > bStart;
      });
      if (!overlaps) slots.push({ time: `${hh}:${mm}`, iso: start.toISOString() });
    }
  }
  return slots;
}

module.exports = {
  router,
  requireAnalytics,
  loadWindows,
  slotsForDate,
  dispatchConfirmations,
  syncLeadForCall,
  DEFAULT_SLOT_MINUTES,
};
