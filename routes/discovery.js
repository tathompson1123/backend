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

    const result = await pool.query(
      `SELECT dc.*, tm.name AS rep_name, tm.title AS rep_title, tm.photo_url AS rep_photo
       FROM discovery_calls dc
       LEFT JOIN sorce_team_members tm ON tm.id = dc.assigned_to
       ${where}
       ORDER BY dc.scheduled_at DESC
       LIMIT 500`,
      params
    );
    res.json({ success: true, calls: result.rows });
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
    res.json({ success: true, call: result.rows[0] });
  } catch (err) {
    console.error('Update discovery call error:', err.message);
    res.status(500).json({ error: 'Failed to update discovery call' });
  }
});

// DELETE /api/discovery/calls/:id
router.delete('/calls/:id', requireAnalytics, async (req, res) => {
  try {
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

// Fire the confirmation text + email, recording what actually made it out so the
// dashboard can show which channel failed rather than silently swallowing it.
async function dispatchConfirmations(call, { force = false } = {}) {
  const result = { smsSent: false, emailSent: false, errors: [] };

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
