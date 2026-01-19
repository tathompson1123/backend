const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-fallback-secret-change-me';

if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'AI generation limit reached' }
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
      
      const planLevels = { 'basic': 0, 'pro': 1, 'expert': 2 };
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
      console.error('Plan check error:', error);
      res.status(500).json({ error: 'Failed to verify plan' });
    }
  };
}

// Setup all middleware on app
function setupMiddleware(app) {
  app.use('/api/', generalLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/signup', authLimiter);
  app.use('/api/generate', aiLimiter);
  app.use('/api/website/ai-edit', aiLimiter);
}

module.exports = {
  authenticateToken,
  requirePlan,
  setupMiddleware,
  EFFECTIVE_JWT_SECRET
};
