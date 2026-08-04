// Zoom meetings for SORCE discovery calls.
//
// Uses a Server-to-Server OAuth app, not a user OAuth app: there's no human to click
// "authorize", the backend acts as the SORCE account itself, and the credentials are
// three static values rather than a refresh-token dance.
//
// Required in Railway:
//   ZOOM_ACCOUNT_ID     — Account ID from the Server-to-Server OAuth app
//   ZOOM_CLIENT_ID      — Client ID from the same app
//   ZOOM_CLIENT_SECRET  — Client Secret from the same app
// Optional:
//   ZOOM_USER_ID        — host's Zoom email or userId. Defaults to 'me', which is the
//                         account owner. Set it to host from a specific seat.
//
// Everything degrades quietly: if the credentials are absent, isZoomConfigured() is
// false and the callers fall back to the phone-call wording. A booking must never fail
// because Zoom is down.

const TOKEN_URL = 'https://zoom.us/oauth/token';
const API_BASE = 'https://api.zoom.us/v2';

const ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const HOST_USER = process.env.ZOOM_USER_ID || 'me';

function isZoomConfigured() {
  return Boolean(ACCOUNT_ID && CLIENT_ID && CLIENT_SECRET);
}

// Zoom access tokens last an hour. Cached in module scope and refreshed a minute early,
// so a burst of bookings doesn't mint a token per meeting (Zoom rate-limits that).
let cachedToken = null;
let cachedExpiry = 0;

async function getAccessToken() {
  if (!isZoomConfigured()) throw new Error('Zoom is not configured');
  if (cachedToken && Date.now() < cachedExpiry) return cachedToken;

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(
    `${TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Zoom token failed (${res.status}): ${body.reason || body.error || 'unknown'}`);
  }
  cachedToken = body.access_token;
  cachedExpiry = Date.now() + Math.max(0, (body.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

async function zoomFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  // DELETE and PATCH return 204 with no body.
  if (res.status === 204) return {};
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Zoom ${options.method || 'GET'} ${path} failed (${res.status}): ${body.message || 'unknown'}`);
  }
  return body;
}

// Zoom wants start_time as UTC in 'YYYY-MM-DDTHH:mm:ssZ'.
function toZoomStart(when) {
  return new Date(when).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Returns the fields we persist. start_url is the HOST link — it starts the meeting with
// host privileges for whoever opens it, so it is stored for the team and must never be
// put in a prospect-facing message. join_url is the one that goes out.
async function createMeeting({ topic, startTime, durationMinutes = 30, timezone = 'America/New_York', agenda }) {
  const body = await zoomFetch(`/users/${encodeURIComponent(HOST_USER)}/meetings`, {
    method: 'POST',
    body: JSON.stringify({
      topic: topic || 'SORCE Discovery Call',
      type: 2, // scheduled
      start_time: toZoomStart(startTime),
      duration: durationMinutes,
      timezone,
      agenda: agenda || undefined,
      settings: {
        join_before_host: true,      // prospect is never left staring at a waiting room
        waiting_room: false,
        approval_type: 2,            // no registration
        audio: 'both',
        auto_recording: 'none',
      },
    }),
  });
  return {
    meetingId: String(body.id),
    joinUrl: body.join_url,
    startUrl: body.start_url,
    passcode: body.password || null,
  };
}

async function updateMeeting(meetingId, { startTime, durationMinutes, timezone, topic }) {
  const patch = {};
  if (startTime) patch.start_time = toZoomStart(startTime);
  if (durationMinutes) patch.duration = durationMinutes;
  if (timezone) patch.timezone = timezone;
  if (topic) patch.topic = topic;
  if (!Object.keys(patch).length) return;
  await zoomFetch(`/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function deleteMeeting(meetingId) {
  await zoomFetch(`/meetings/${encodeURIComponent(meetingId)}?schedule_for_reminder=false`, {
    method: 'DELETE',
  });
}

module.exports = { isZoomConfigured, createMeeting, updateMeeting, deleteMeeting };
