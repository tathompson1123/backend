require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { setupMiddleware } = require('./config/middleware');
const { pool } = require('./config/database');
const app = express();
const PORT = process.env.PORT || 3001;
const { authenticateToken } = require('./config/middleware');

app.set('pool', pool);
// Security & CORS
app.set('trust proxy', 1);
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      /\.vercel\.app$/,
      'http://localhost:5173',
      'http://localhost:3000',
      'https://sorceintegrations.com',
      'https://www.sorceintegrations.com'
    ];
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(pattern => {
      if (pattern instanceof RegExp) return pattern.test(origin);
      return pattern === origin;
    });
    callback(null, isAllowed);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// IMPORTANT: Stripe webhook MUST use raw body, so it comes BEFORE express.json()
const billingRoutes = require('./routes/billing');
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingRoutes);

// Regular JSON parsing for all other routes
app.use(express.json({ limit: '50mb' }));
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Apply rate limiting
setupMiddleware(app);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: pool ? 'connected' : 'disconnected',
      twilio: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'not configured',
      sendgrid: process.env.SENDGRID_API_KEY ? 'configured' : 'not configured',
      stripe: process.env.STRIPE_SECRET_KEY ? 'configured' : 'not configured'
    }
  });
});

// Import routes
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const customerRoutes = require('./routes/customers');
const leadRoutes = require('./routes/leads');
const serviceRoutes = require('./routes/services');
const employeeRoutes = require('./routes/employees');
const websiteRoutes = require('./routes/website');
const aiAgentRoutes = require('./routes/ai-agents');
const reviewRoutes = require('./routes/reviews');
const smsRoutes = require('./routes/sms');
const marketResearchRoutes = require('./routes/market-research');
const chatRoutes = require('./routes/chat');
const templateRoutes = require('./routes/templates');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/website', websiteRoutes);
app.use('/api/agents', aiAgentRoutes);
app.use('/api/google-business', reviewRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/market-research', marketResearchRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/templates', templateRoutes);

const businessHoursRoutes = require('./routes/business-hours');
app.use('/api/business-hours', businessHoursRoutes);
app.get('/api/groups', (req, res) => {
  res.json({ success: true, groups: [] });
});

const generateV2 = require('./routes/generateV2');
app.post('/api/generate-v2', authenticateToken, generateV2);

// ── Startup: ensure required tables/columns exist ────────
(async () => {
  try {
    await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_scheduled_at TIMESTAMP');
    await pool.query("CREATE INDEX IF NOT EXISTS idx_leads_sms_pending ON leads(sms_scheduled_at) WHERE status = 'sms_pending'");
    console.log('✅ SMS scheduling columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify sms_scheduled_at column:', e.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS business_hours (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        day_name VARCHAR(20) NOT NULL,
        is_open BOOLEAN DEFAULT true,
        open_time TIME DEFAULT '09:00',
        close_time TIME DEFAULT '17:00',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, day_name)
      )
    `);
    console.log('✅ Business hours table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify business_hours table:', e.message);
  }
})();

// ── SMS processing cron job ──────────────────────────────
// Runs every 30 seconds. Picks up leads in 'sms_pending' status
// whose sms_scheduled_at has passed, sends the SMS via Twilio,
// and updates the lead status. Survives server restarts.
const cron = require('node-cron');
const { sendSMS } = require('./utils/twilio');

cron.schedule('*/30 * * * * *', async () => {
  try {
    const pending = await pool.query(
      `SELECT l.*, u.twilio_phone_number
       FROM leads l
       JOIN users u ON u.id = l.user_id
       WHERE l.status = 'sms_pending'
         AND l.sms_scheduled_at IS NOT NULL
         AND l.sms_scheduled_at <= NOW()
         AND u.twilio_phone_number IS NOT NULL`
    );

    for (const lead of pending.rows) {
      try {
        const agentResult = await pool.query(
          'SELECT config, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
          [lead.user_id, 'lead_form']
        );

        if (agentResult.rows.length === 0 || !agentResult.rows[0].config?.smsEnabled || !agentResult.rows[0].sms_template) {
          await pool.query("UPDATE leads SET status = 'new' WHERE id = $1", [lead.id]);
          continue;
        }

        const smsTemplate = agentResult.rows[0].sms_template;
        const personalizedSms = smsTemplate
          .replace(/\{\{name\}\}/g, lead.name || 'there')
          .replace(/\{\{email\}\}/g, lead.email || '')
          .replace(/\{\{phone\}\}/g, lead.phone)
          .replace(/\{\{service\}\}/g, lead.service || 'our services')
          .replace(/\{\{message\}\}/g, lead.message || '');

        const smsResult = await sendSMS(lead.phone, lead.twilio_phone_number, personalizedSms);

        await pool.query(
          `INSERT INTO sms_messages (lead_id, user_id, direction, to_number, message, twilio_message_sid, created_at)
           VALUES ($1, $2, 'outgoing', $3, $4, $5, CURRENT_TIMESTAMP)`,
          [lead.id, lead.user_id, lead.phone, personalizedSms, smsResult.messageSid]
        );

        await pool.query(
          `UPDATE leads SET status = 'contacted_sms', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [lead.id]
        );

        console.log(`✅ Cron: SMS sent to lead ${lead.id} (${lead.phone})`);
      } catch (sendErr) {
        console.error(`❌ Cron: SMS failed for lead ${lead.id}:`, sendErr.message);
        await pool.query("UPDATE leads SET status = 'sms_failed' WHERE id = $1", [lead.id]);
      }
    }
  } catch (err) {
    console.error('❌ SMS cron error:', err.message || err);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Database: ${pool ? 'Connected' : 'Not connected'}`);
  console.log(`📱 Twilio: ${process.env.TWILIO_ACCOUNT_SID ? 'Ready' : 'Not configured'}`);
  console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? 'Ready' : 'Not configured'}`);
  console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Ready' : 'Not configured'}`);
});

module.exports = app;




