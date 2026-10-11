// Twilio request-signature check for every inbound webhook (SMS, voice, status, recording).
//
// Without this, POST /api/sms/webhook accepts whatever anyone sends: a forged "From"/"To"/
// "Body" makes the AI agent text arbitrary numbers at our cost, flips STOP/START state,
// fabricates review replies, and — worst — supplies the media URL that the screenshot
// checker later fetches with our Twilio credentials attached.
//
// Place AFTER the urlencoded body parser. Twilio signs the full public URL plus the sorted
// POST params, so we try every URL the request could legitimately have been addressed to.
const twilio = require('twilio');

function candidateUrls(req) {
  const path = req.originalUrl;
  const bases = [
    process.env.PRODUCTION_BACKEND_URL,
    process.env.BACKEND_URL,
    'https://backend-production-ab50.up.railway.app',
  ].filter(Boolean).map(b => b.replace(/\/+$/, ''));

  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host) bases.push(`${proto}://${host}`);

  return [...new Set(bases.map(b => b + path))];
}

function validateTwilio(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error('🚫 Twilio webhook rejected: TWILIO_AUTH_TOKEN not configured');
    return res.status(503).type('text/plain').send('Webhook not configured');
  }
  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    console.warn(`🚫 Twilio webhook without signature rejected: ${req.originalUrl} from ${req.ip}`);
    return res.status(403).type('text/plain').send('Forbidden');
  }
  const params = req.body && typeof req.body === 'object' ? req.body : {};
  const ok = candidateUrls(req).some(url => {
    try { return twilio.validateRequest(authToken, signature, url, params); } catch { return false; }
  });
  if (!ok) {
    console.warn(`🚫 Twilio webhook with bad signature rejected: ${req.originalUrl} from ${req.ip}`);
    return res.status(403).type('text/plain').send('Forbidden');
  }
  next();
}

// A media/recording URL we are willing to fetch with Twilio credentials attached.
function isTwilioApiUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'api.twilio.com';
  } catch { return false; }
}

module.exports = { validateTwilio, isTwilioApiUrl };
