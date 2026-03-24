const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-fallback-secret-change-me';

if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: JWT_SECRET must be set in production');
  process.exit(1);
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

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
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
  
  // Employee auth endpoints (prevents brute force on employee login)
  app.use('/api/employee-auth/login', strictAuthLimiter);
  app.use('/api/employee-auth/accept-invite', strictAuthLimiter);

  // Public endpoints that need rate limiting (SPECIFIC PATHS ONLY)
  app.use('/api/leads/public', publicApiLimiter);
  
  // DON'T apply publicApiLimiter to all /api/ routes
  // app.use('/api/', publicApiLimiter); // ❌ REMOVE THIS LINE
}

module.exports = {
  authenticateToken,
  requirePlan,
  setupMiddleware,
  previewGenerateLimiter,
  EFFECTIVE_JWT_SECRET
};
