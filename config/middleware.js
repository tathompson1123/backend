const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-fallback-secret-change-me';

// Fail closed anywhere that looks like a deployment, not just when NODE_ENV happens to be
// 'production' — Railway doesn't set NODE_ENV for you, and a forgotten JWT_SECRET would
// otherwise silently fall back to a secret that is sitting in this repository.
const looksDeployed = process.env.NODE_ENV === 'production'
  || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_ENVIRONMENT_NAME
  || !!process.env.RAILWAY_PROJECT_ID;
if (!JWT_SECRET && looksDeployed) {
  console.error('❌ FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}

// Every kind of token SORCE issues (owner sessions, employee sessions, unsubscribe links,
// OAuth state, sales-team sessions) is signed with the same secret, so a signature alone
// proves nothing about WHAT a token is. authenticateToken must therefore accept only owner
// session tokens. New ones carry typ:'user'; tokens issued before that field existed are
// still honoured if they carry none of the markers the other kinds do.
const FOREIGN_TOKEN_MARKERS = ['role', 'analytics', 'type', 'platform', 'scope', 'employeeId', 'tm'];
function isUserSessionToken(decoded) {
  if (!decoded || typeof decoded !== 'object') return false;
  if (decoded.typ) return decoded.typ === 'user' && !!decoded.userId;
  if (FOREIGN_TOKEN_MARKERS.some(k => decoded[k] !== undefined)) return false;
  return !!decoded.userId;
}

// Rate limiters - Tiered security approach
const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Only 5 login attempts per 15 minutes
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Only 3 password reset attempts per hour
  message: { error: 'Too many password reset attempts' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 AI generations per hour
  message: { error: 'AI generation limit reached' }
});

const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per 15 minutes for public endpoints
  message: { error: 'Too many requests from this IP' }
});

const previewGenerateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 preview generations per hour per IP
  message: { error: 'Generation limit reached. Please try again later or sign up for unlimited access.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General authenticated endpoint limiter (prevents DoS from valid JWTs)
const authenticatedLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute per IP (2/sec — plenty for legit use)
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
});

// Per-IP limiters for anonymous endpoints that cost real money (SMS, email, Claude).
const makeLimiter = (windowMs, max, error) => rateLimit({
  windowMs, max, message: { error }, standardHeaders: true, legacyHeaders: false,
});
const analyticsLoginLimiter = makeLimiter(15 * 60 * 1000, 10, 'Too many login attempts, please try again later');
const chatLimiter = makeLimiter(60 * 1000, 20, 'You are sending messages too quickly. Please slow down.');
// Hourly ceilings on top of the per-minute one above. The per-minute limit alone still lets
// one address chat around the clock, and a fresh conversation resets the per-conversation cap.
const chatMessageHourLimiter = makeLimiter(60 * 60 * 1000, 100, 'You have sent a lot of messages. Please contact the business directly.');
const chatStartHourLimiter = makeLimiter(60 * 60 * 1000, 10, 'Too many chats started from this network. Please contact the business directly.');
const publicBookingLimiter = makeLimiter(60 * 60 * 1000, 6, 'Too many booking attempts from this network. Please try again later.');
const publicPaymentLimiter = makeLimiter(15 * 60 * 1000, 10, 'Too many payment attempts. Please try again later.');
const landingEventLimiter = makeLimiter(60 * 1000, 60, 'Too many events');
const adminSecretLimiter = makeLimiter(15 * 60 * 1000, 10, 'Too many attempts');

// Per-USER limiter for endpoints that call Claude. The IP limiter doesn't help here: Pro
// has "unlimited AI", and one signup can fire these as fast as it likes. Keyed on the
// verified token so one user can't spend another's allowance.
const aiUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: { error: 'AI request limit reached for this hour. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    try {
      const token = (req.headers['authorization'] || '').split(' ')[1];
      const d = jwt.verify(token, EFFECTIVE_JWT_SECRET);
      return `u:${d.userId || d.employeeId || d.tm || 'x'}`;
    } catch { return `ip:${req.ip}`; }
  },
});

// Webhook form submissions
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many submissions, please try again later' },
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    if (!isUserSessionToken(decoded)) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// Sales reps open prospects' accounts with an impersonation token (see discovery.js
// open-account). That token is for demonstrating the product, so it must not be able to
// do the irreversible things: delete the account, change its password or login email, or
// cancel its subscription.
function blockImpersonation(req, res, next) {
  if (req.user && req.user.impersonatedBy) {
    return res.status(403).json({ error: 'This action is not available in a staff demo session' });
  }
  next();
}

// Plan requirement middleware
function requirePlan(requiredPlan) {
  const { pool } = require('./database');
  
  return async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query('SELECT plan FROM users WHERE id = $1', [userId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const userPlan = result.rows[0].plan;
      
      if (!userPlan) {
        return res.status(403).json({ 
          error: 'Subscription required',
          message: 'Please choose a plan to access this feature.',
          requiredPlan: requiredPlan,
          currentPlan: null,
          upgradeUrl: '/dashboard?view=billing'
        });
      }
      
      // basic/expert are legacy plan values; scale is new top tier
      const planLevels = { 'basic': 1, 'pro': 2, 'expert': 2, 'scale': 3 };
      const userLevel = planLevels[userPlan] || 0;
      const requiredLevel = planLevels[requiredPlan] || 0;
      
      if (userLevel < requiredLevel) {
        return res.status(403).json({ 
          error: 'Upgrade required',
          message: `This feature requires a ${requiredPlan} plan. You are currently on ${userPlan}.`,
          requiredPlan: requiredPlan,
          currentPlan: userPlan,
          upgradeUrl: '/dashboard?view=billing'
        });
      }
      
      next();
    } catch (error) {
      console.error('Plan check error:', error.message);
      res.status(500).json({ error: 'Failed to verify plan' });
    }
  };
}

// Setup all middleware on app
function setupMiddleware(app) {
  // Strict limits for authentication endpoints (prevents brute force)
  app.use('/api/auth/login', strictAuthLimiter);
  app.use('/api/auth/signup', strictAuthLimiter);
  app.use('/api/auth/reset-password', passwordResetLimiter);
  app.use('/api/auth/forgot-password', passwordResetLimiter);
  
  // AI generation limits (prevents API abuse)
  app.use('/api/generate', aiLimiter);
  app.use('/api/website/generate', aiLimiter);
  app.use('/api/website/ai-edit', aiLimiter);
  
  // Sales-team / analytics login, invite acceptance and the admin-secret maintenance routes
  app.use('/api/analytics/login', analyticsLoginLimiter);
  app.use('/api/discovery/team/accept-invite', analyticsLoginLimiter);
  app.use('/api/auth/admin', adminSecretLimiter);
  app.use('/api/voice/sync-webhooks', adminSecretLimiter);

  // Landing-page analytics intake: generous for a real visitor, tight for a script
  app.use('/api/landing/event', landingEventLimiter);

  // Anonymous endpoints that spend money
  app.use('/api/chat/message', chatLimiter, chatMessageHourLimiter);
  app.use('/api/chat/start', chatLimiter, chatStartHourLimiter);
  app.use('/api/public/discovery/book', publicBookingLimiter);
  app.use('/api/public/discovery/lead', publicBookingLimiter);
  app.use('/api/public/bookings/payment-setup', publicPaymentLimiter);
  app.use('/api/public/bookings/create', publicBookingLimiter);

  // Claude-backed endpoints, per user
  ['/api/sms-campaigns/generate', '/api/review-config/rate-incentive', '/api/google-business/generate-reply',
   '/api/leads/generate-response', '/api/seo-audit', '/api/gbp-analyzer', '/api/market-research',
   '/api/backlinks', '/api/sorce-assistant', '/api/tools', '/api/email-campaigns/generate'].forEach(p => app.use(p, aiUserLimiter));

  // Employee auth endpoints (prevents brute force on employee login)
  app.use('/api/employee-auth/login', strictAuthLimiter);
  app.use('/api/employee-auth/accept-invite', strictAuthLimiter);

  // Public endpoints that need rate limiting (SPECIFIC PATHS ONLY)
  app.use('/api/leads/public', publicApiLimiter);

  // Webhook form submissions
  app.use('/api/webhooks', webhookLimiter);

  // General limiter on all /api/ routes (catches authenticated abuse + unlimted endpoints)
  app.use('/api/', authenticatedLimiter);
}

module.exports = {
  authenticateToken,
  requirePlan,
  setupMiddleware,
  previewGenerateLimiter,
  authenticatedLimiter,
  EFFECTIVE_JWT_SECRET,
  isUserSessionToken,
  blockImpersonation
};
