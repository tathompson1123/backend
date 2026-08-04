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
} = require('../utils/discoveryNotify');
const { isZoomConfigured, createMeeting, updateMeeting, deleteMeeting, checkZoomSetup } = require('../utils/zoom');

const SITE_URL = process.env.FRONTEND_URL || 'https://sorceintegrations.com';
const FROM_EMAIL = process.env.DISCOVERY_FROM_EMAIL || 'hello@sorceintegrations.com';
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

/* ─────────────────────────── SORCE SALES LEADS ─────────────────────────── */
// Prospects for SORCE itself, worked before (or without) a booked discovery call.
// requireAnalytics only, no requireAdmin — the whole team sells, so members need this
// the same way they need the discovery calendar.

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'demo_scheduled', 'won', 'lost'];
const LEAD_FIELDS = ['name', 'email', 'phone', 'company', 'source', 'status', 'notes', 'assigned_to'];

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
      `SELECT sl.*, tm.name AS assigned_name,
              dc.scheduled_at AS call_scheduled_at, dc.status AS call_status
         FROM sorce_leads sl
         LEFT JOIN sorce_team_members tm ON tm.id = sl.assigned_to
         LEFT JOIN discovery_calls dc ON dc.id = sl.discovery_call_id
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

    res.json({
      success: true,
      leads: result.rows,
      counts: Object.fromEntries(counts.rows.map(r => [r.status, r.n])),
    });
  } catch (err) {
    console.error('Sorce leads list error:', err.message);
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

// POST /api/discovery/leads
router.post('/leads', requireAnalytics, async (req, res) => {
  try {
    const { name, email, phone, company, source, status, notes, assigned_to } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (status && !LEAD_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const result = await pool.query(
      `INSERT INTO sorce_leads (name, email, phone, company, source, status, notes, assigned_to, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'manual'), COALESCE($6, 'new'), $7, $8, $9)
       RETURNING *`,
      [String(name).trim(), email || null, phone || null, company || null,
       source || null, status || null, notes || null, assigned_to || null,
       req.analytics?.tm || null]
    );
    res.json({ success: true, lead: result.rows[0] });
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
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE sorce_leads SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, lead: result.rows[0] });
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
    if (sendNotifications) await dispatchConfirmations(call);
    res.json({ success: true, call });
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
    const outcome = await dispatchConfirmations(result.rows[0], { force: true });
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
async function dispatchConfirmations(call, { force = false } = {}) {
  const result = { smsSent: false, emailSent: false, errors: [] };

  // Before anything goes out, so the link is in the very first message they get.
  call = await ensureZoomMeeting(call);
  result.zoomJoinUrl = call.zoom_join_url || null;

  const rep = call.assigned_to
    ? (await pool.query(
        'SELECT name, email, title, photo_url, bio FROM sorce_team_members WHERE id = $1',
        [call.assigned_to]
      )).rows[0]
    : null;

  if (call.phone && (force || !call.confirmation_sms_sent)) {
    try {
      await sendDiscoverySMS(call.phone, confirmationSMS(call, rep));
      await pool.query('UPDATE discovery_calls SET confirmation_sms_sent = true WHERE id = $1', [call.id]);
      result.smsSent = true;
    } catch (err) {
      console.error(`⚠️ Discovery confirmation SMS failed (call ${call.id}):`, err.message);
      result.errors.push(`SMS: ${err.message}`);
    }
  }

  if (call.email && (force || !call.confirmation_email_sent)) {
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
  DEFAULT_SLOT_MINUTES,
};
