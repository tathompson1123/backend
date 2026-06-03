require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { setupMiddleware } = require('./config/middleware');
const { pool } = require('./config/database');
const app = express();
const PORT = process.env.PORT || 3001;
const { authenticateToken, previewGenerateLimiter } = require('./config/middleware');

// Safety net: pg emits a secondary 'error' event on a destroyed client AFTER its in-flight
// query rejects (e.g. when Railway's proxy drops the TCP connection mid-query). Even with
// the cron's try/catch and pool.on('error'), that secondary event has no listener and Node
// treats it as fatal. Logging here keeps the process alive — every cron tick reconnects
// fresh clients from the pool anyway.
process.on('uncaughtException', (err) => {
  console.error('⚠️ uncaughtException (process kept alive):', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ unhandledRejection (process kept alive):', reason?.message || reason);
});

app.set('pool', pool);
// Security & CORS
app.set('trust proxy', 1);
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      /\.vercel\.app$/,
      /^http:\/\/localhost:\d+$/,  // Allow any localhost port for development
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

// IMPORTANT: Webhooks MUST use raw body for signature verification, so they come BEFORE express.json()
const billingRoutes = require('./routes/billing');
const paymentWebhooks = require('./routes/payment-webhooks');
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingRoutes);
app.post('/api/webhooks/stripe-connect', express.raw({ type: 'application/json' }), paymentWebhooks.stripeConnect);
app.post('/api/webhooks/square', express.raw({ type: 'application/json' }), paymentWebhooks.square);
app.post('/api/webhooks/paypal', express.raw({ type: 'application/json' }), paymentWebhooks.paypal);

// Regular JSON parsing for all other routes
app.use(express.json({ limit: '10mb' }));
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Apply rate limiting
setupMiddleware(app);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Import routes
const authRoutes = require('./routes/auth');
const analyticsRoutes = require('./routes/analytics');
const bookingRoutes = require('./routes/bookings');
const customerRoutes = require('./routes/customers');
const leadRoutes = require('./routes/leads');
const serviceRoutes = require('./routes/services');
const serviceCategoryRoutes = require('./routes/service-categories');
const bookingWidgetConfigRoutes = require('./routes/booking-widget-config');
const employeeRoutes = require('./routes/employees');
const websiteRoutes = require('./routes/website');
const aiAgentRoutes = require('./routes/ai-agents');
const reviewRoutes = require('./routes/reviews');
const smsRoutes = require('./routes/sms');
const marketResearchRoutes = require('./routes/market-research');
const chatRoutes = require('./routes/chat');
const rewardsRoutes = require('./routes/rewards');
const templateRoutes = require('./routes/templates');
const userRoutes = require('./routes/user');
const reviewConfigRoutes = require('./routes/review-config');
const publicRoutes = require('./routes/public');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/public', embedCors, publicRoutes);
app.use('/api/leads/public', embedCors); // CORS for embed form submissions
app.use('/api/leads', leadRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/service-categories', serviceCategoryRoutes);
app.use('/api/booking-widget-config', bookingWidgetConfigRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/website', websiteRoutes);
app.use('/api/agents', aiAgentRoutes);
app.use('/api/google-business', reviewRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/market-research', marketResearchRoutes);
app.use('/api/chat', embedCors, chatRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/user', userRoutes);
app.use('/api/review-config', reviewConfigRoutes);

const voiceRoutes = require('./routes/voice');
app.use('/api/voice', voiceRoutes);

const gbpAnalyzerRoutes = require('./routes/gbp-analyzer');
app.use('/api/gbp-analyzer', gbpAnalyzerRoutes);

const seoAuditRoutes = require('./routes/seo-audit');
app.use('/api/seo-audit', seoAuditRoutes);

const backlinksRoutes = require('./routes/backlinks');
app.use('/api/backlinks', backlinksRoutes);

const sorceAssistantRoutes = require('./routes/sorce-assistant');
app.use('/api/sorce-assistant', sorceAssistantRoutes);

const trackRoutes = require('./routes/track');
app.use('/api/track', embedCors, trackRoutes);

const businessHoursRoutes = require('./routes/business-hours');
app.use('/api/business-hours', businessHoursRoutes);

const businessInfoRoutes = require('./routes/business-info');
app.use('/api/business-info', businessInfoRoutes);

const employeeAuthRoutes = require('./routes/employee-auth');
const employeeApiRoutes = require('./routes/employee-api');
app.use('/api/employee-auth', employeeAuthRoutes);
app.use('/api/employee', employeeApiRoutes);

const todosRoutes = require('./routes/todos');
app.use('/api/todos', todosRoutes);

const invoiceRoutes = require('./routes/invoices');
const estimateRoutes = require('./routes/estimates');
const paymentRoutes = require('./routes/payments');
const paymentConnectionRoutes = require('./routes/payment-connections');
const paymentPublicRoutes = require('./routes/payment-public');
app.use('/api/invoices', invoiceRoutes);
app.use('/api/estimates', estimateRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/payment-connections', paymentConnectionRoutes);
app.use('/api/pay', paymentPublicRoutes);

const statusTemplateRoutes = require('./routes/status-templates');
app.use('/api/status-templates', statusTemplateRoutes);

const uploadRoutes = require('./routes/upload');
app.use('/api/upload', uploadRoutes);

const bookingReminderRoutes = require('./routes/booking-reminders');
app.use('/api/booking-reminders', bookingReminderRoutes);

const bookingTimesRoutes = require('./routes/booking-times');
app.use('/api/booking-times', bookingTimesRoutes);

// Embed system — public JS bundle + API routes (open CORS for any origin)
const path = require('path');
// Shared CORS middleware for embed-facing routes (called from external sites)
function embedCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
}
app.use('/embed.js', express.static(path.join(__dirname, 'public', 'embed.js'), {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=300');
  }
}));
const embedRoutes = require('./routes/embed');
app.use('/api/embed', embedCors, embedRoutes);

// Embed Forms — standalone embeddable lead forms (inline renderer + public API)
app.use('/forms.js', express.static(path.join(__dirname, 'public', 'forms.js'), {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=300');
  }
}));
const embedFormsRoutes = require('./routes/embed-forms');
app.use('/api/embed-forms', embedCors, embedFormsRoutes);

// External form webhook — open CORS (called from Wix, Squarespace, Zapier etc.)
const webhookRoutes = require('./routes/webhooks');
app.use('/api/webhooks', embedCors, webhookRoutes);

// Ad platform connections (Google Ads, Google LSA, Meta Ads)
const adPlatformRoutes = require('./routes/ad-platforms');
app.use('/api/ad-platforms', adPlatformRoutes);

// Meta Conversions API — server-side Lead events to your Facebook Pixel
const metaCapiRoutes = require('./routes/meta-capi');
app.use('/api/meta-capi', metaCapiRoutes);

// Email marketing campaigns
const emailCampaignRoutes = require('./routes/email-campaigns');
app.use('/api/email-campaigns', emailCampaignRoutes);

// SMS marketing campaigns (sub-tab of Email Marketing)
const smsCampaignRoutes = require('./routes/sms-campaigns');
app.use('/api/sms-campaigns', smsCampaignRoutes);

// Google Drive / Sheets (Business Setup → tips + payroll tracking)
const googleDriveRoutes = require('./routes/google-drive');
app.use('/api/google-drive', googleDriveRoutes);

app.use('/api/rewards', rewardsRoutes);

app.get('/api/groups', (req, res) => {
  res.json({ success: true, groups: [] });
});

const generateV2 = require('./routes/generateV2');
app.post('/api/generate-v2', authenticateToken, generateV2);
app.post('/api/generate-preview', previewGenerateLimiter, generateV2.generatePreview);
app.post('/api/generate-preview/claim', authenticateToken, generateV2.claimPreview);

// ── Startup: ensure required tables/columns exist ────────
(async () => {
  try {
    await pool.query('ALTER TABLE bookings ALTER COLUMN employee_id DROP NOT NULL');
    await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_scheduled_at TIMESTAMP');
    await pool.query("CREATE INDEX IF NOT EXISTS idx_leads_sms_pending ON leads(sms_scheduled_at) WHERE status = 'sms_pending'");
    // leads.source is now an open, user-defined value: the embed-form / form-creator feature
    // tags each submission with that form's own source slug (e.g. 'window_tint_quote'), so a
    // fixed enum CHECK can never cover every legitimate source and rejects valid submissions.
    // Drop the old enum constraint outright (it was previously expanded reactively for
    // sms_inbound / inbound_call / google_lsa — the same losing battle).
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_source_check') THEN
          ALTER TABLE leads DROP CONSTRAINT leads_source_check;
        END IF;
      END $$;
    `);
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor VARCHAR(20)");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor_payment_id VARCHAR(255)");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT");
    await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS job_notes TEXT");
    await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_notes TEXT");
    await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source VARCHAR(50)");
    await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS referral_source TEXT");
    // booking_items.is_addon tells the edit form which lines came from the "Additional
    // Services" picker vs the "Main Service" picker — without it, multi-main bookings
    // round-trip as all-mains and the user loses their add-on grouping.
    await pool.query("ALTER TABLE booking_items ADD COLUMN IF NOT EXISTS is_addon BOOLEAN DEFAULT FALSE");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2) DEFAULT 0");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_brand VARCHAR(50)");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_last_four VARCHAR(4)");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS metadata JSONB");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD'");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason TEXT");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor_fee NUMERIC(10,2)");
    // payment_type was an old NOT NULL column — give it a default so Square sync doesn't break
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50) DEFAULT 'card'");
    await pool.query("ALTER TABLE payments ALTER COLUMN payment_type SET DEFAULT 'card'");
    // Also drop NOT NULL in case the column already exists without a default
    await pool.query("ALTER TABLE payments ALTER COLUMN payment_type DROP NOT NULL");
    await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS square_invoice_id VARCHAR(255)");
    await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_invoice_id VARCHAR(255)");
    await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paypal_invoice_id VARCHAR(255)");
    await pool.query("ALTER TABLE payment_connections ADD COLUMN IF NOT EXISTS clover_merchant_id TEXT");
    await pool.query("ALTER TABLE payment_connections ADD COLUMN IF NOT EXISTS clover_access_token TEXT");
    await pool.query("ALTER TABLE payment_connections ADD COLUMN IF NOT EXISTS square_token_expires_at TIMESTAMPTZ");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_tax_rate DECIMAL(5,4) DEFAULT 0");
    await pool.query("ALTER TABLE estimates ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]'::jsonb");
    await pool.query("ALTER TABLE estimates ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb");
    await pool.query("ALTER TABLE estimates ADD COLUMN IF NOT EXISTS square_estimate_id VARCHAR(255)");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS estimates_square_id_idx ON estimates(square_estimate_id) WHERE square_estimate_id IS NOT NULL");
    await pool.query(`CREATE TABLE IF NOT EXISTS invoice_items_catalog (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(20) DEFAULT 'fee',
      amount_type VARCHAR(10) DEFAULT 'fixed',
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      taxable BOOLEAN DEFAULT false,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query("ALTER TABLE invoice_items_catalog ADD COLUMN IF NOT EXISTS taxable BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS taxable BOOLEAN DEFAULT true");
    // Owner to-do list, shared between web dashboard and employee admin app
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_todos (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      done BOOLEAN DEFAULT false,
      priority VARCHAR(10) DEFAULT 'medium',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query("CREATE INDEX IF NOT EXISTS admin_todos_user_idx ON admin_todos(user_id, done, created_at DESC)");
    // Track which employee created each todo (null = added from web dashboard by the owner)
    await pool.query("ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS created_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL");
    // Separate scopes: 'admin' (web dashboard + admin overview), 'team' (app HomeScreen team to-do)
    await pool.query("ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'admin'");
    await pool.query("CREATE INDEX IF NOT EXISTS admin_todos_user_scope_idx ON admin_todos(user_id, scope, done, created_at DESC)");
    // Service variants
    await pool.query(`CREATE TABLE IF NOT EXISTS service_variants (
      id SERIAL PRIMARY KEY,
      service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      duration_hours NUMERIC,
      sort_order INTEGER DEFAULT 0
    )`);
    await pool.query('ALTER TABLE booking_items ADD COLUMN IF NOT EXISTS variant_id INTEGER');
    await pool.query('ALTER TABLE booking_items ADD COLUMN IF NOT EXISTS variant_name VARCHAR(255)');
    await pool.query(`CREATE TABLE IF NOT EXISTS ad_spend (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      source VARCHAR(100) NOT NULL,
      amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      month VARCHAR(7) NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, source, month)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ad_platform_connections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      platform VARCHAR(50) NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      account_id VARCHAR(255),
      account_name VARCHAR(255),
      token_expires_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ DEFAULT NOW(),
      last_synced_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      UNIQUE(user_id, platform)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ad_verification_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      platform VARCHAR(50) NOT NULL,
      email VARCHAR(255) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      notes TEXT,
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      verified_at TIMESTAMPTZ,
      UNIQUE(user_id, platform)
    )`);
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_lsa_lead_id VARCHAR(255)");
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_recording_url TEXT");
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_transcript TEXT");
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_duration INTEGER");
    // Booking reminder settings
    await pool.query(`CREATE TABLE IF NOT EXISTS booking_reminder_settings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      hours_before INTEGER NOT NULL,
      label VARCHAR(100),
      enabled BOOLEAN DEFAULT true,
      custom_message TEXT
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS booking_reminders_sent (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
      hours_before INTEGER NOT NULL,
      sent_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(booking_id, hours_before)
    )`);
    console.log('✅ SMS scheduling columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify sms_scheduled_at column:', e.message);
  }

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS seo_audits (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      audit JSONB NOT NULL,
      plan JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('✅ SEO audits table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify seo_audits table:', e.message);
  }

  try {
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS send_trigger VARCHAR(30) DEFAULT 'booking_completed'`);
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS send_delay INTEGER DEFAULT 24`);
    await pool.query(`CREATE TABLE IF NOT EXISTS contact_sales_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(200),
      phone VARCHAR(50),
      reason VARCHAR(200),
      flaws TEXT,
      feedback TEXT,
      plan VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('✅ review_configs.send_trigger and send_delay columns verified');
  } catch (e) {
    console.warn('⚠️ Could not add send_trigger column:', e.message);
  }

  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cancellation_policy_enabled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cancellation_policy_text TEXT`);
    await pool.query(`ALTER TABLE booking_reminder_settings ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE booking_reminders_sent ADD COLUMN IF NOT EXISTS channel VARCHAR(10) DEFAULT 'email'`);
    // Drop old unique constraint and add channel-aware one
    await pool.query(`ALTER TABLE booking_reminders_sent DROP CONSTRAINT IF EXISTS booking_reminders_sent_booking_id_hours_before_key`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS booking_reminders_sent_booking_id_hours_before_channel_key ON booking_reminders_sent(booking_id, hours_before, channel)`);
    console.log('✅ Cancellation policy and SMS reminder columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify cancellation policy / SMS reminder columns:', e.message);
  }

  // Chat conversation outcome tracking + customer name
  try {
    await pool.query(`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS outcome VARCHAR(20) DEFAULT 'no_booking'`);
    await pool.query(`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS customer_name VARCHAR(200)`);
    await pool.query(`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS last_booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL`);
    console.log('✅ chat_conversations.outcome + customer_name + last_booking_id columns verified');
  } catch (e) {
    console.warn('⚠️ Could not add chat_conversations columns:', e.message);
  }

  // Timezone per user (derived from phone area code)
  try {
    const { getTimezoneFromPhone } = require('./utils/zipToTimezone');
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(60) DEFAULT 'America/New_York'`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_booking ON review_requests(booking_id) WHERE booking_id IS NOT NULL`);
    // Backfill timezone for existing users that have a phone number
    const usersToFix = await pool.query(
      `SELECT id, twilio_phone_number FROM users
       WHERE (timezone IS NULL OR timezone = 'America/New_York')
         AND twilio_phone_number IS NOT NULL`
    );
    for (const u of usersToFix.rows) {
      const phone = u.twilio_phone_number;
      const tz = getTimezoneFromPhone(phone);
      if (tz !== 'America/New_York') {
        await pool.query('UPDATE users SET timezone = $1 WHERE id = $2', [tz, u.id]);
      }
    }
    console.log('✅ User timezone column verified');
  } catch (e) {
    console.warn('⚠️ Could not verify user timezone:', e.message);
  }

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS booking_time_slots (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      slot_time TIME NOT NULL,
      label VARCHAR(100),
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, slot_time)
    )`);
    console.log('✅ booking_time_slots table verified');
  } catch (e) {
    console.warn('⚠️ Could not create booking_time_slots table:', e.message);
  }

  try {
    // Allow booking deletion without FK violation from sms_messages
    await pool.query(`ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_booking_id_fkey`);
    await pool.query(`ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL`);
    console.log('✅ sms_messages.booking_id FK updated to ON DELETE SET NULL');
  } catch (e) {
    console.warn('⚠️ Could not update sms_messages FK:', e.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS business_hours (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL,
        is_open BOOLEAN DEFAULT true,
        open_time TIME DEFAULT '09:00',
        close_time TIME DEFAULT '17:00',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, day_of_week)
      )
    `);
    console.log('✅ Business hours table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify business_hours table:', e.message);
  }

  // Business information table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS business_information (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        phone VARCHAR(50) DEFAULT '',
        email VARCHAR(255) DEFAULT '',
        address VARCHAR(500) DEFAULT '',
        city VARCHAR(100) DEFAULT '',
        state VARCHAR(100) DEFAULT '',
        zip_code VARCHAR(20) DEFAULT '',
        service_area_type VARCHAR(20) DEFAULT 'zipcodes',
        service_zip_codes JSONB DEFAULT '[]',
        service_radius INTEGER DEFAULT 25,
        center_zip_code VARCHAR(20) DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Business information table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify business_information table:', e.message);
  }

  // Google review link column on users
  try {
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS google_review_link TEXT');
    console.log('✅ Google review link column verified');
  } catch (e) {
    console.warn('⚠️ Could not verify google_review_link column:', e.message);
  }

  // Review configs table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS review_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        message_template TEXT,
        incentive TEXT,
        incentive_enabled BOOLEAN DEFAULT true,
        auto_send_enabled BOOLEAN DEFAULT true,
        send_delay INTEGER DEFAULT 24,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Review configs table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify review_configs table:', e.message);
  }

  // Review replies table (for tracking AI-generated replies)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS review_replies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        review_text TEXT,
        rating INTEGER,
        generated_reply TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Review replies table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify review_replies table:', e.message);
  }

  // Review requests table (for tracking automated review request campaigns)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS review_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        customer_phone VARCHAR(50),
        service_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        scheduled_send_time TIMESTAMP,
        actual_send_time TIMESTAMP,
        sms_sent BOOLEAN DEFAULT false,
        email_sent BOOLEAN DEFAULT false,
        link_clicked BOOLEAN DEFAULT false,
        review_completed BOOLEAN DEFAULT false,
        review_completed_at TIMESTAMP,
        incentive_code VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Review requests table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify review_requests table:', e.message);
  }

  // Employee credentials table (for employee mobile app auth)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_credentials (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE UNIQUE,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255),
        invite_token VARCHAR(255),
        invite_token_expires TIMESTAMP,
        invite_accepted_at TIMESTAMP,
        last_login_at TIMESTAMP,
        push_token VARCHAR(500),
        device_platform VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_credentials_email ON employee_credentials(email)');
    console.log('✅ Employee credentials table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify employee_credentials table:', e.message);
  }

  // Add invite_status column to employees
  try {
    await pool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS invite_status VARCHAR(20) DEFAULT 'none'");
    console.log('✅ Employee invite_status column verified');
  } catch (e) {
    console.warn('⚠️ Could not verify invite_status column:', e.message);
  }

  // Add permissions column to employees
  try {
    await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"view_bookings":true,"manage_bookings":true,"view_customers":true,"view_all_bookings":false,"send_messages":true,"process_payments":false,"view_reports":false}'`);
    console.log('✅ Employee permissions column verified');
  } catch (e) {
    console.warn('⚠️ Could not verify permissions column:', e.message);
  }

  // Employee community messages table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        employee_name VARCHAR(255) NOT NULL,
        employee_color VARCHAR(7) DEFAULT '#6b7280',
        body TEXT NOT NULL,
        reactions JSONB DEFAULT '{}',
        reply_to_id INTEGER REFERENCES employee_messages(id) ON DELETE SET NULL,
        reply_preview TEXT,
        pinned BOOLEAN DEFAULT false,
        edited_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_employee_messages_user ON employee_messages(user_id, created_at DESC)`);
    console.log('✅ Employee messages table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify employee_messages table:', e.message);
  }

  // Add is_admin to employees
  try {
    await pool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false");
    console.log('✅ Employee is_admin column verified');
  } catch (e) {
    console.warn('⚠️ Could not verify is_admin column:', e.message);
  }

  // Add work_hours and work_days columns to employees
  try {
    await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_hours JSONB DEFAULT '{"startTime":"09:00","endTime":"17:00"}'`);
    await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_days JSONB DEFAULT '{"monday":true,"tuesday":true,"wednesday":true,"thursday":true,"friday":true,"saturday":false,"sunday":false}'`);
    console.log('✅ Employee work_hours/work_days columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify work_hours/work_days columns:', e.message);
  }

  // Auto-assign is_admin to employees who are the business owner
  try {
    await pool.query(`
      UPDATE employees e
      SET is_admin = true
      FROM employee_credentials ec, users u
      WHERE ec.employee_id = e.id
        AND e.user_id = u.id
        AND LOWER(ec.email) = LOWER(u.email)
        AND e.is_admin = false
    `);
    console.log('✅ Owner employees auto-assigned admin');
  } catch (e) {
    console.warn('⚠️ Could not auto-assign owner admin:', e.message);
  }

  // Permission templates table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS permission_templates (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        permissions JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Permission templates table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify permission_templates table:', e.message);
  }

  // Payment connections table (multi-processor payment integration)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        processor VARCHAR(20) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        is_primary BOOLEAN DEFAULT false,
        stripe_account_id VARCHAR(255),
        stripe_access_token TEXT,
        square_merchant_id VARCHAR(255),
        square_access_token TEXT,
        square_refresh_token TEXT,
        square_location_id VARCHAR(255),
        paypal_merchant_id VARCHAR(255),
        paypal_client_id VARCHAR(255),
        paypal_client_secret TEXT,
        connected_at TIMESTAMP DEFAULT NOW(),
        last_verified_at TIMESTAMP,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, processor)
      )
    `);
    console.log('✅ Payment connections table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify payment_connections table:', e.message);
  }

  // Invoices table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        customer_phone VARCHAR(50),
        subtotal DECIMAL(10,2) DEFAULT 0,
        tax_rate DECIMAL(5,4) DEFAULT 0,
        tax_amount DECIMAL(10,2) DEFAULT 0,
        discount_amount DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(10,2) DEFAULT 0,
        amount_paid DECIMAL(10,2) DEFAULT 0,
        amount_due DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'draft',
        issue_date DATE DEFAULT CURRENT_DATE,
        due_date DATE,
        paid_at TIMESTAMP,
        payment_processor VARCHAR(20),
        payment_link VARCHAR(500),
        payment_link_token VARCHAR(255) UNIQUE,
        notes TEXT,
        terms TEXT,
        sent_at TIMESTAMP,
        viewed_at TIMESTAMP,
        reminder_sent_at TIMESTAMP,
        pdf_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_invoices_payment_link_token ON invoices(payment_link_token)');
    console.log('✅ Invoices table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify invoices table:', e.message);
  }

  // Invoice items table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
        description VARCHAR(500) NOT NULL,
        quantity DECIMAL(10,2) DEFAULT 1,
        unit_price DECIMAL(10,2) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Invoice items table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify invoice_items table:', e.message);
  }

  // Estimates table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS estimates (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        estimate_number VARCHAR(50) UNIQUE NOT NULL,
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        customer_phone VARCHAR(50),
        subtotal DECIMAL(10,2) DEFAULT 0,
        tax_rate DECIMAL(5,4) DEFAULT 0,
        tax_amount DECIMAL(10,2) DEFAULT 0,
        discount_amount DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'draft',
        issue_date DATE DEFAULT CURRENT_DATE,
        valid_until DATE,
        notes TEXT,
        terms TEXT,
        view_token VARCHAR(255) UNIQUE,
        sent_at TIMESTAMP,
        viewed_at TIMESTAMP,
        reminder_sent_at TIMESTAMP,
        accepted_at TIMESTAMP,
        rejected_at TIMESTAMP,
        converted_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        converted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_estimates_user_id ON estimates(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_estimates_view_token ON estimates(view_token)');
    console.log('✅ Estimates table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify estimates table:', e.message);
  }

  // Estimate items table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS estimate_items (
        id SERIAL PRIMARY KEY,
        estimate_id INTEGER REFERENCES estimates(id) ON DELETE CASCADE,
        description VARCHAR(500) NOT NULL,
        quantity DECIMAL(10,2) DEFAULT 1,
        unit_price DECIMAL(10,2) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Estimate items table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify estimate_items table:', e.message);
  }

  // Payments table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        processor VARCHAR(20) NOT NULL,
        processor_payment_id VARCHAR(255),
        processor_fee DECIMAL(10,2),
        payment_method VARCHAR(30),
        card_last_four VARCHAR(4),
        card_brand VARCHAR(20),
        status VARCHAR(20) DEFAULT 'pending',
        failure_reason TEXT,
        refund_amount DECIMAL(10,2) DEFAULT 0,
        refunded_at TIMESTAMP,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Backfill columns for tables created before these were added
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL');
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL');
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id)');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_processor_payment_id ON payments(processor_payment_id) WHERE processor_payment_id IS NOT NULL');
    console.log('✅ Payments table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify payments table:', e.message);
  }

  // Add payment_status and invoice_id to bookings
  try {
    await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid'");
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id)');
    console.log('✅ Booking payment columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify booking payment columns:', e.message);
  }

  // Agent configs table (chat agents, lead form agents)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent_type VARCHAR(50) NOT NULL,
        config JSONB,
        email_template TEXT,
        sms_template TEXT,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, agent_type)
      )
    `);
    console.log('✅ Agent configs table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify agent_configs table:', e.message);
  }

  // Status update templates table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS status_update_templates (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        message_template TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, status)
      )
    `);
    console.log('✅ Status update templates table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify status_update_templates table:', e.message);
  }

  // Add booking_id column to sms_messages for booking chat
  try {
    await pool.query('ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sms_booking_id ON sms_messages(booking_id)');
    await pool.query('ALTER TABLE sms_messages ALTER COLUMN lead_id DROP NOT NULL');
    await pool.query('ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS from_number VARCHAR(20)');
    await pool.query('ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS provider VARCHAR(10)');
    // Track which employee sent each outgoing booking SMS, so we can push them back when the customer replies
    await pool.query('ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS sent_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL');
    console.log('✅ sms_messages columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify sms_messages booking_id:', e.message);
  }

  // Claude usage tracking
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS claude_usage (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
        model         VARCHAR(100),
        input_tokens  INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cost_usd      NUMERIC(10,6) DEFAULT 0,
        endpoint      VARCHAR(50),
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claude_usage_user ON claude_usage(user_id, created_at DESC)`);
    console.log('✅ claude_usage table verified');
  } catch (e) {
    console.warn('⚠️ Could not create claude_usage table:', e.message);
  }

  // GBP Analyzer tables
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gbp_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        place_id TEXT NOT NULL,
        google_url TEXT,
        business_name TEXT,
        primary_category TEXT,
        additional_categories JSONB DEFAULT '[]',
        address TEXT,
        phone TEXT,
        website TEXT,
        has_website_utm BOOLEAN DEFAULT false,
        description TEXT,
        hours JSONB,
        hours_complete BOOLEAN DEFAULT false,
        total_photos INTEGER DEFAULT 0,
        total_reviews INTEGER DEFAULT 0,
        average_rating NUMERIC(3,1),
        review_response_rate INTEGER DEFAULT 0,
        latest_review_date TIMESTAMP,
        profile_data JSONB,
        audit_scores JSONB,
        audit_good JSONB DEFAULT '[]',
        audit_improvements JSONB DEFAULT '[]',
        overall_score INTEGER DEFAULT 0,
        last_analyzed_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gbp_ranking_scans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        keyword TEXT NOT NULL,
        grid_size INTEGER DEFAULT 7,
        radius_miles NUMERIC DEFAULT 5,
        center_lat NUMERIC NOT NULL,
        center_lng NUMERIC NOT NULL,
        grid_points JSONB NOT NULL,
        average_rank NUMERIC,
        top3_count INTEGER DEFAULT 0,
        total_points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_gbp_ranking_user ON gbp_ranking_scans(user_id, created_at DESC)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gbp_action_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        why_it_matters TEXT,
        priority VARCHAR(20) NOT NULL,
        cadence VARCHAR(20) DEFAULT 'one-time',
        category VARCHAR(50),
        status VARCHAR(20) DEFAULT 'not_started',
        due_date DATE,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_gbp_actions_user ON gbp_action_items(user_id)');
    console.log('✅ GBP Analyzer tables verified');
  } catch (e) {
    console.warn('⚠️ Could not verify GBP Analyzer tables:', e.message);
  }
})();

// ── Backlinks / Citations tables ─────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS citation_submissions (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
        directory_id   VARCHAR(50) NOT NULL,
        directory_name VARCHAR(100),
        status         VARCHAR(20) DEFAULT 'pending',
        notes          TEXT DEFAULT '',
        submitted_at   TIMESTAMP,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, directory_id)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_citation_submissions_user ON citation_submissions(user_id)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS citation_checks (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        report     JSONB,
        nap_score  INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS backlink_content (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content_type VARCHAR(50),
        topic        TEXT,
        title        TEXT,
        content_data JSONB,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_backlink_content_user ON backlink_content(user_id, created_at DESC)');
    console.log('✅ Backlinks tables verified');
  } catch (e) {
    console.warn('⚠️ Could not create backlinks tables:', e.message);
  }
})();

// ── Website visitor tracking ─────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS website_visits (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        page_url   TEXT,
        referrer   TEXT,
        visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_website_visits_user_date ON website_visits(user_id, visited_at DESC)');
    await pool.query('ALTER TABLE seo_audits ADD COLUMN IF NOT EXISTS code_generated_at TIMESTAMP');
    await pool.query('ALTER TABLE seo_audits ADD COLUMN IF NOT EXISTS head_code TEXT');
    await pool.query('ALTER TABLE seo_audits ADD COLUMN IF NOT EXISTS llms_txt TEXT');

    // Backfill: rewrite any stored head_code pointing to localhost (generated before fallback was fixed)
    const prodUrl = (process.env.PRODUCTION_BACKEND_URL || process.env.BACKEND_URL || 'https://backend-production-ab50.up.railway.app').replace(/\/$/, '');
    const fix = await pool.query(
      `UPDATE seo_audits
         SET head_code = REPLACE(head_code, 'http://localhost:3001/api/track', $1 || '/api/track')
       WHERE head_code LIKE '%localhost:3001/api/track%'`,
      [prodUrl]
    );
    if (fix.rowCount > 0) console.log(`🛠  Rewrote tracking pixel URL in ${fix.rowCount} stored SEO code(s)`);
    console.log('✅ website_visits table verified');
  } catch (e) {
    console.warn('⚠️ Could not create website_visits table:', e.message);
  }
})();

// ── Market Research tables ──────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS competitor_reports (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        report_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_competitor_reports_user ON competitor_reports(user_id, created_at DESC)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upsell_reports (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        report_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_upsell_reports_user ON upsell_reports(user_id, created_at DESC)');
    console.log('✅ Market Research tables verified');
  } catch (e) {
    console.warn('⚠️ Could not verify Market Research tables:', e.message);
  }
})();

// ── Embed system tables ──────────────────────────────
(async () => {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS site_key UUID DEFAULT gen_random_uuid()");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_site_key ON users(site_key)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS sendgrid_sender_id INTEGER");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS sendgrid_verified BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS base_plan VARCHAR(20)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_canceling BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS questionnaire_completed BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS leads_per_week VARCHAR(20)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS revenue_range VARCHAR(30)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS interested_feature VARCHAR(50)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(10)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS business_type VARCHAR(100)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS business_services TEXT");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS business_known_for TEXT");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_chat_unlimited BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_limit_notified_at TIMESTAMPTZ");

    // Reset test account to setup mode on every deploy
    await pool.query(
      `UPDATE users SET questionnaire_completed = false, email_verified = false
       WHERE email = 'testsorce@gmail.com'`
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS embed_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        chat_enabled BOOLEAN DEFAULT false,
        booking_enabled BOOLEAN DEFAULT false,
        booking_style VARCHAR(20) DEFAULT 'chat',
        lead_form_enabled BOOLEAN DEFAULT false,
        lead_form_title VARCHAR(255) DEFAULT 'Get a Free Quote',
        lead_form_fields JSONB DEFAULT '["name","email","phone","message"]',
        booking_button_text VARCHAR(100) DEFAULT 'Book Online',
        theme_color VARCHAR(20) DEFAULT '#d97706',
        position VARCHAR(20) DEFAULT 'bottom-right',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Backfill new columns
    await pool.query("ALTER TABLE embed_configs ADD COLUMN IF NOT EXISTS submit_button_text VARCHAR(100) DEFAULT 'Submit'");
    await pool.query("ALTER TABLE embed_configs ADD COLUMN IF NOT EXISTS form_rules JSONB DEFAULT '[]'");
    await pool.query("ALTER TABLE embed_configs ADD COLUMN IF NOT EXISTS lead_form_description TEXT DEFAULT ''");

    console.log('✅ Embed system tables verified');
  } catch (e) {
    console.warn('⚠️ Could not verify embed tables:', e.message);
  }
})();

// ── Email campaign tables ────────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_campaign_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        enabled BOOLEAN DEFAULT false,
        send_day VARCHAR(10) DEFAULT 'monday',
        send_hour INTEGER DEFAULT 9,
        from_name VARCHAR(100),
        from_email VARCHAR(255),
        tone VARCHAR(50) DEFAULT 'friendly',
        focus VARCHAR(50) DEFAULT 'seasonal',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject VARCHAR(300),
        preview_text VARCHAR(200),
        body_html TEXT,
        body_text TEXT,
        recipient_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        scheduled_for TIMESTAMP,
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_email_campaigns_user ON email_campaigns(user_id, created_at DESC)');
    console.log('✅ Email campaign tables verified');
  } catch (e) {
    console.warn('⚠️ Could not verify email campaign tables:', e.message);
  }
})();

// ── Booking system v2: categories, addons, widget config ──
(async () => {
  try {
    // Service categories
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_service_categories_user ON service_categories(user_id)');

    // Add new columns to services
    await pool.query('ALTER TABLE services ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES service_categories(id) ON DELETE SET NULL');
    await pool.query('ALTER TABLE services ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT \'\'');
    await pool.query('ALTER TABLE services ADD COLUMN IF NOT EXISTS buffer_minutes INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE services ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE services ADD COLUMN IF NOT EXISTS is_addon BOOLEAN DEFAULT false');

    // Service addon relationships
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_addons (
        id SERIAL PRIMARY KEY,
        main_service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
        addon_service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(main_service_id, addon_service_id)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_service_addons_main ON service_addons(main_service_id)');

    // Booking widget configuration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_widget_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Payment columns on bookings
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(10,2) DEFAULT 0');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255)');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_setup_intent_id VARCHAR(255)');

    console.log('✅ Booking system v2 tables verified');
  } catch (e) {
    console.warn('⚠️ Could not verify booking v2 tables:', e.message);
  }

  // Missed calls table (for missed call text-back feature)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS missed_calls (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        caller_phone VARCHAR(20) NOT NULL,
        called_number VARCHAR(20) NOT NULL,
        call_sid VARCHAR(64),
        call_status VARCHAR(20) NOT NULL DEFAULT 'no-answer',
        call_duration INTEGER DEFAULT 0,
        forwarded_to VARCHAR(20),
        textback_sent BOOLEAN DEFAULT false,
        textback_sent_at TIMESTAMP,
        textback_message_sid VARCHAR(64),
        lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_missed_calls_user ON missed_calls(user_id, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_missed_calls_sid ON missed_calls(call_sid)');
    console.log('✅ Missed calls table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify missed_calls table:', e.message);
  }

  // Rewards config table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rewards_config (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        enabled BOOLEAN DEFAULT false,
        bookings_required INTEGER DEFAULT 5,
        reward_description TEXT DEFAULT '',
        coupon_after_booking BOOLEAN DEFAULT false,
        coupon_description TEXT DEFAULT '',
        coupon_frequency VARCHAR(20) DEFAULT 'every',
        sms_timing VARCHAR(20) DEFAULT 'after_completed',
        sms_delay_hours INTEGER DEFAULT 1,
        sms_template TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Rewards config table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify rewards_config table:', e.message);
  }

  // Service location fields
  try {
    await pool.query("ALTER TABLE services ADD COLUMN IF NOT EXISTS location_type VARCHAR(20) DEFAULT 'business_address'");
    await pool.query('ALTER TABLE services ADD COLUMN IF NOT EXISTS custom_address TEXT');
    console.log('✅ Service location columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify service location columns:', e.message);
  }

  // Booking customer address (for mobile/on-site services)
  try {
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_address TEXT');
    console.log('✅ Booking customer_address column verified');
  } catch (e) {
    console.warn('⚠️ Could not verify booking customer_address column:', e.message);
  }

  // Lead follow-up and priority fields
  try {
    await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_date DATE');
    await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal'");
    console.log('✅ Lead follow_up_date and priority columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify lead follow-up columns:', e.message);
  }

  // Lead conversation_id for chat agent leads
  try {
    await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversation_id INTEGER');
    await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL');
    console.log('✅ Lead conversation_id/customer_id columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify lead conversation_id column:', e.message);
  }

  // Tax and pricing columns on bookings (added for sales tax support)
  try {
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,4) DEFAULT 0');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10,2) DEFAULT 0');
    console.log('✅ Bookings tax/pricing columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify bookings tax columns:', e.message);
  }

  // Card on file (Square + Stripe + Clover)
  try {
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS square_customer_id TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS square_card_id TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS square_card_brand TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS square_card_last_four TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS clover_customer_id TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS clover_card_id TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_processor TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_brand TEXT');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_last_four TEXT');
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS card_on_file_status TEXT DEFAULT 'not_required'`);
    await pool.query(`CREATE TABLE IF NOT EXISTS card_on_file_tokens (
      id SERIAL PRIMARY KEY,
      token UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      customer_email TEXT,
      customer_name TEXT,
      expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '48 hours',
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('✅ Card on file tables/columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify card on file schema:', e.message);
  }
})();

// ── SMS processing cron job ──────────────────────────────
// Runs every 30 seconds. Picks up leads in 'sms_pending' status
// whose sms_scheduled_at has passed, sends the SMS via Twilio,
// and updates the lead status. Survives server restarts.
const cron = require('node-cron');
const { sendSMS } = require('./utils/twilio');
const { generateAIResponse } = require('./routes/sms');

// Helper: send SMS via the user's Twilio number
async function sendSMSAuto(to, message, userId) {
  const userRow = await pool.query(
    'SELECT twilio_phone_number FROM users WHERE id = $1',
    [userId]
  );
  const u = userRow.rows[0];
  if (u?.twilio_phone_number) {
    const result = await sendSMS(to, message, userId);
    return { messageSid: result.messageSid, provider: 'twilio', fromNumber: u.twilio_phone_number };
  }
  throw new Error(`No SMS phone number assigned to user ${userId}`);
}

cron.schedule('*/30 * * * * *', async () => {
  try {
    // Recover any leads stuck in 'sms_sending' from a previous crashed run
    await pool.query(`
      UPDATE leads SET status = 'sms_pending'
      WHERE status = 'sms_sending'
        AND sms_scheduled_at < NOW() - INTERVAL '10 minutes'
    `);

    // Atomically claim leads by flipping them to 'sms_sending' before processing.
    // If two server instances run simultaneously (e.g. during a Railway deploy),
    // each UPDATE targets different rows and no lead is double-sent.
    const pending = await pool.query(`
      WITH claimed AS (
        UPDATE leads SET status = 'sms_sending'
        WHERE id IN (
          SELECT l.id
          FROM leads l
          JOIN users u ON u.id = l.user_id
          WHERE l.status = 'sms_pending'
            AND l.sms_scheduled_at IS NOT NULL
            AND l.sms_scheduled_at <= NOW()
            AND u.twilio_phone_number IS NOT NULL
          LIMIT 50
        )
        RETURNING *
      )
      SELECT c.*, u.twilio_phone_number, u.business_name
      FROM claimed c
      JOIN users u ON u.id = c.user_id
    `);

    for (const lead of pending.rows) {
      try {
        // Check monthly SMS limit for this user's plan (exempt accounts bypass it entirely)
        const planRow = await pool.query('SELECT plan, email FROM users WHERE id = $1', [lead.user_id]);
        const userPlan = planRow.rows[0]?.plan;
        const unlimited = smsCampaignRoutes.isUnlimitedSms(planRow.rows[0]?.email);
        if (!unlimited) {
          const SMS_LIMITS = { scale: 500, pro: 100, expert: 200, basic: 100 };
          const smsLimit = SMS_LIMITS[userPlan] || 0;
          if (smsLimit === 0) {
            // Free plan — no SMS
            await pool.query("UPDATE leads SET status = 'new' WHERE id = $1", [lead.id]);
            continue;
          }
          const usageRow = await pool.query(
            `SELECT COUNT(*) FROM sms_messages
             WHERE user_id = $1 AND direction = 'outgoing'
             AND created_at >= date_trunc('month', NOW())`,
            [lead.user_id]
          );
          const smsUsed = parseInt(usageRow.rows[0].count, 10);
          if (smsUsed >= smsLimit) {
            console.log(`⚠️ SMS limit reached for user ${lead.user_id} (${smsUsed}/${smsLimit} this month)`);
            await pool.query("UPDATE leads SET status = 'sms_limit_reached' WHERE id = $1", [lead.id]);
            continue;
          }
        }

        // Determine which agent config to use based on lead source
        const agentType = lead.source === 'missed_call' ? 'missed_call' : 'lead_form';
        const agentResult = await pool.query(
          'SELECT config, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
          [lead.user_id, agentType]
        );

        if (agentResult.rows.length === 0 || !agentResult.rows[0].config?.smsEnabled || !agentResult.rows[0].sms_template) {
          await pool.query("UPDATE leads SET status = 'new' WHERE id = $1", [lead.id]);
          continue;
        }

        const smsTemplate = agentResult.rows[0].sms_template;
        const agentConfig = agentResult.rows[0].config;
        const firstName = (lead.name || 'there').split(' ')[0];
        const agentName = agentConfig?.training?.agentName || '';

        // If the customer already texted in, skip the canned intro and let the
        // AI agent answer/qualify directly. Otherwise use the configured template.
        const priorInbound = await pool.query(
          `SELECT message FROM sms_messages
           WHERE lead_id = $1 AND direction = 'incoming'
           ORDER BY created_at ASC LIMIT 10`,
          [lead.id]
        );

        let personalizedSms;
        if (priorInbound.rows.length > 0) {
          const latest = priorInbound.rows[priorInbound.rows.length - 1].message;
          const aiReply = await generateAIResponse(
            lead.user_id,
            lead.id,
            { name: lead.name, email: lead.email },
            latest,
            { firstContact: true, businessName: lead.business_name || '', agentName }
          );
          if (aiReply) {
            // Defensive: strip the internal booking token (handled on inbound replies, not here)
            personalizedSms = aiReply.replace(/BOOKING_REQUEST\|[^\n]*\n?/g, '').trim();
          } else {
            // AI failed — fall back to canned template so the lead still gets contacted
            personalizedSms = smsTemplate
              .replace(/\{\{name\}\}/g, firstName)
              .replace(/\{\{email\}\}/g, lead.email || '')
              .replace(/\{\{phone\}\}/g, lead.phone)
              .replace(/\{\{service\}\}/g, lead.service || 'our services')
              .replace(/\{\{message\}\}/g, lead.message || '')
              .replace(/\{\{agentName\}\}/g, agentName)
              .replace(/\{\{businessName\}\}/g, lead.business_name || '');
          }
        } else {
          personalizedSms = smsTemplate
            .replace(/\{\{name\}\}/g, firstName)
            .replace(/\{\{email\}\}/g, lead.email || '')
            .replace(/\{\{phone\}\}/g, lead.phone)
            .replace(/\{\{service\}\}/g, lead.service || 'our services')
            .replace(/\{\{message\}\}/g, lead.message || '')
            .replace(/\{\{agentName\}\}/g, agentName)
            .replace(/\{\{businessName\}\}/g, lead.business_name || '');
        }

        const smsResult = await sendSMSAuto(lead.phone, personalizedSms, lead.user_id);

        await pool.query(
          `INSERT INTO sms_messages (lead_id, user_id, direction, to_number, from_number, provider, message, twilio_message_sid, created_at)
           VALUES ($1, $2, 'outgoing', $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
          [lead.id, lead.user_id, lead.phone, smsResult.fromNumber, smsResult.provider, personalizedSms, smsResult.messageSid]
        );

        await pool.query(
          `UPDATE leads SET status = 'contacted_sms', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [lead.id]
        );

        // Update missed_calls record if this was a missed call text-back
        if (lead.source === 'missed_call') {
          await pool.query(
            `UPDATE missed_calls SET textback_sent = true, textback_sent_at = NOW(), textback_message_sid = $1
             WHERE lead_id = $2 AND textback_sent = false`,
            [smsResult.messageSid, lead.id]
          );
        }

        console.log(`✅ Cron: SMS sent to lead ${lead.id} (${lead.phone}) via ${smsResult.provider}`);
      } catch (sendErr) {
        console.error(`❌ Cron: SMS failed for lead ${lead.id}:`, sendErr.message);
        await pool.query("UPDATE leads SET status = 'sms_failed' WHERE id = $1", [lead.id]);
      }
    }
  } catch (err) {
    console.error('❌ SMS cron error:', err.message || err);
  }
});

// ── Review request SMS cron job ──────────────────────────
// Runs every 60 seconds. Picks up pending review requests whose
// scheduled_send_time has passed and sends the review SMS.
cron.schedule('*/60 * * * * *', async () => {
  try {
    const pending = await pool.query(
      `SELECT rr.id, rr.user_id, rr.customer_id, rr.incentive_code,
              c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
              c.last_service AS service_name,
              u.business_name, u.twilio_phone_number, u.google_review_link,
              rc.message_template, rc.incentive, rc.incentive_enabled
       FROM review_requests rr
       JOIN users u ON u.id = rr.user_id
       JOIN customers c ON c.id = rr.customer_id
       LEFT JOIN review_configs rc ON rc.user_id = rr.user_id
       WHERE rr.status = 'pending'
         AND rr.sms_sent = false
         AND c.phone IS NOT NULL
         AND rr.scheduled_send_time <= NOW()
         AND u.twilio_phone_number IS NOT NULL`
    );

    for (const req of pending.rows) {
      try {
        // Check monthly SMS limit (exempt accounts bypass it entirely)
        const planRow = await pool.query('SELECT plan, email FROM users WHERE id = $1', [req.user_id]);
        const userPlan = planRow.rows[0]?.plan;
        const unlimited = smsCampaignRoutes.isUnlimitedSms(planRow.rows[0]?.email);
        if (!unlimited) {
          const SMS_LIMITS = { scale: 500, pro: 100, expert: 200, basic: 100 };
          const smsLimit = SMS_LIMITS[userPlan] || 0;
          if (smsLimit === 0) {
            await pool.query("UPDATE review_requests SET status = 'skipped' WHERE id = $1", [req.id]);
            continue;
          }
          const usageRow = await pool.query(
            `SELECT COUNT(*) FROM sms_messages
             WHERE user_id = $1 AND direction = 'outgoing'
             AND created_at >= date_trunc('month', NOW())`,
            [req.user_id]
          );
          if (parseInt(usageRow.rows[0].count, 10) >= smsLimit) {
            await pool.query("UPDATE review_requests SET status = 'sms_limit_reached' WHERE id = $1", [req.id]);
            continue;
          }
        }

        // Build message from template
        const defaultTemplate = "Hi {name}! Thank you for choosing {business}. We'd love to hear about your experience with {service}! Could you take a moment to leave us a review?";
        const reviewFirstName = (req.customer_name || 'there').split(' ')[0];
        let message = (req.message_template || defaultTemplate)
          .replace(/\{name\}/g, reviewFirstName)
          .replace(/\{business\}/g, req.business_name || 'us')
          .replace(/\{service\}/g, req.service_name || 'our service');

        if (req.incentive_enabled && req.incentive) {
          if (!/[.!?]$/.test(message.trimEnd())) message = message.trimEnd() + '.';
          message += ` ${req.incentive}`;
        }
        if (req.google_review_link) {
          const backendUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
          const trackedUrl = `${backendUrl}/api/public/review-click/${req.id}`;
          if (!/[.!?]$/.test(message.trimEnd())) message = message.trimEnd() + '.';
          message += ` Leave your review here: ${trackedUrl}`;
        }

        // Format phone number for sending
        const toPhone = req.customer_phone.startsWith('+') ? req.customer_phone : `+1${req.customer_phone.replace(/\D/g, '')}`;
        const smsResult = await sendSMSAuto(toPhone, message, req.user_id);

        await pool.query(
          `INSERT INTO sms_messages (user_id, direction, to_number, from_number, provider, message, twilio_message_sid, created_at)
           VALUES ($1, 'outgoing', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [req.user_id, toPhone, smsResult.fromNumber, smsResult.provider, message, smsResult.messageSid]
        );

        await pool.query(
          `UPDATE review_requests SET sms_sent = true, sms_sent_at = NOW(), actual_send_time = NOW(), status = 'sent' WHERE id = $1`,
          [req.id]
        );

        console.log(`✅ Cron: Review SMS sent for request ${req.id} to ${toPhone} via ${smsResult.provider}`);
      } catch (sendErr) {
        console.error(`❌ Cron: Review SMS failed for request ${req.id}:`, sendErr.message);
        await pool.query("UPDATE review_requests SET status = 'sms_failed', sms_error = $2 WHERE id = $1", [req.id, sendErr.message]);
      }
    }
  } catch (err) {
    console.error('❌ Review SMS cron error:', err.message || err);
  }
});

// ── Review trigger cron ───────────────────────────────────
// Runs every 5 minutes.
// service_duration trigger: timezone-aware — fires send_delay hours after
//   the booking's calculated service end time in the business's local timezone.
// booking_completed trigger: fires send_delay hours after status set to
//   'completed' (manual). The review_request is also created inline in
//   bookings.js/employee-api.js so this cron acts as a safety net.
cron.schedule('*/5 * * * *', async () => {
  try {
    const eligible = await pool.query(
      `SELECT DISTINCT ON (b.id)
              b.id AS booking_id, b.user_id, b.customer_id,
              rc.send_delay, rc.incentive_enabled, rc.send_trigger
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       JOIN review_configs rc ON rc.user_id = b.user_id
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       WHERE rc.auto_send_enabled = true
         AND b.customer_id IS NOT NULL
         AND b.status NOT IN ('cancelled')
         AND NOT EXISTS (
           SELECT 1 FROM review_requests rr
           WHERE rr.booking_id = b.id
         )
         AND (
           -- Automatic: service has ended + delay (timezone-aware)
           (rc.send_trigger = 'service_duration'
            AND (b.booking_date || ' ' || b.start_time)::timestamp
                  AT TIME ZONE COALESCE(u.timezone, 'America/New_York')
                + COALESCE(bi.service_duration, 1) * INTERVAL '1 hour'
                + COALESCE(rc.send_delay, 1) * INTERVAL '1 hour'
                <= NOW())
           OR
           -- Manual: booking marked complete + delay elapsed
           (rc.send_trigger = 'booking_completed'
            AND b.status = 'completed'
            AND b.updated_at + COALESCE(rc.send_delay, 1) * INTERVAL '1 hour' <= NOW())
         )
       ORDER BY b.id, bi.id`
    );

    for (const row of eligible.rows) {
      try {
        // scheduled_send_time = now (the delay condition already passed in WHERE)
        const scheduledTime = new Date();
        const incentiveCode = row.incentive_enabled
          ? `REV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
          : null;
        await pool.query(
          `INSERT INTO review_requests (user_id, customer_id, booking_id, status, scheduled_send_time, incentive_code, created_at)
           VALUES ($1, $2, $3, 'pending', $4, $5, NOW())
           ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO NOTHING`,
          [row.user_id, row.customer_id, row.booking_id, scheduledTime, incentiveCode]
        );
        console.log(`✅ [service_duration] Review request queued for booking ${row.booking_id}`);
      } catch (rowErr) {
        console.warn(`⚠️ [service_duration] Could not queue review for booking ${row.booking_id}:`, rowErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Service-duration review cron error:', err.message || err);
  }
});

// ── Review follow-up email cron — runs every 30 minutes ──────────────────────
// Sends a follow-up review request email 24 hours after the SMS was sent.
cron.schedule('*/30 * * * *', async () => {
  try {
    const sgMail = require('@sendgrid/mail');
    if (!process.env.SENDGRID_API_KEY) return;
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const pending = await pool.query(
      `SELECT rr.id, rr.user_id, rr.customer_id, rr.incentive_code,
              c.name AS customer_name, c.email AS customer_email, c.last_service AS service_name,
              u.business_name, u.email AS owner_email, u.google_review_link,
              rc.message_template, rc.incentive, rc.incentive_enabled
       FROM review_requests rr
       JOIN users u ON u.id = rr.user_id
       JOIN customers c ON c.id = rr.customer_id
       LEFT JOIN review_configs rc ON rc.user_id = rr.user_id
       WHERE rr.sms_sent = true
         AND (rr.email_sent = false OR rr.email_sent IS NULL)
         AND (rr.link_clicked = false OR rr.link_clicked IS NULL)
         AND c.email IS NOT NULL
         AND rr.sms_sent_at + INTERVAL '24 hours' <= NOW()
         AND (u.plan IS NOT NULL)`
    );

    for (const req of pending.rows) {
      try {
        const firstName = (req.customer_name || 'there').split(' ')[0];
        const backendUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
        const reviewLink = req.google_review_link ? `${backendUrl}/api/public/review-click/${req.id}` : null;

        let bodyText = req.incentive_enabled && req.incentive
          ? `We'd love to hear about your experience! Could you take a moment to share a review? As a thank you, here's a special offer: <strong>${req.incentive}</strong>`
          : `We'd love to hear about your experience with <strong>${req.service_name || 'our service'}</strong>. Could you take a moment to leave us a review?`;

        await sgMail.send({
          to: req.customer_email,
          from: { name: req.business_name || 'Your Service Provider', email: 'noreply@sorceintegrations.com' },
          replyTo: req.owner_email ? { email: req.owner_email } : undefined,
          subject: `How was your experience? — ${req.business_name || 'Us'}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
              <div style="background:#1d4ed8;padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
                <h1 style="color:#fff;margin:0;font-size:1.5rem;">We Value Your Feedback</h1>
              </div>
              <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                <p style="font-size:1rem;margin-top:0;">Hi ${firstName},</p>
                <p>${bodyText}</p>
                ${reviewLink
                  ? `<div style="text-align:center;margin:2rem 0;">
                       <a href="${reviewLink}" style="background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:1rem;font-weight:600;">Leave a Review</a>
                     </div>`
                  : ''}
                <p style="color:#6b7280;font-size:0.85rem;margin-top:1.5rem;">Thank you for choosing ${req.business_name || 'us'}. We appreciate your business!</p>
              </div>
            </div>`,
        });

        await pool.query(
          `UPDATE review_requests SET email_sent = true, email_sent_at = NOW() WHERE id = $1`,
          [req.id]
        );
        console.log(`📧 Cron: Review follow-up email sent for request ${req.id} to ${req.customer_email}`);
      } catch (emailErr) {
        console.error(`❌ Cron: Review email failed for request ${req.id}:`, emailErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Review email follow-up cron error:', err.message || err);
  }
});

// ── Email campaign cron job ──────────────────────────────
// Runs every hour. Two modes:
//   auto_send=true  → generate + send immediately (fully automated)
//   auto_send=false → generate draft only, owner approves via dashboard
const { generateCampaign, sendCampaign } = require('./routes/email-campaigns');

cron.schedule('0 * * * *', async () => {
  try {
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const hour = now.getHours();

    const configs = await pool.query(
      `SELECT ec.*, u.plan FROM email_campaign_configs ec
       JOIN users u ON u.id = ec.user_id
       WHERE ec.enabled = true AND ec.send_day = $1 AND ec.send_hour = $2
         AND u.plan IN ('pro', 'scale', 'expert')`,
      [dayName, hour]
    );

    for (const config of configs.rows) {
      try {
        // Skip if a draft already exists for this week (owner hasn't approved last one yet)
        const existingDraft = await pool.query(
          `SELECT id FROM email_campaigns WHERE user_id = $1 AND status = 'draft'
           AND created_at >= NOW() - INTERVAL '7 days' LIMIT 1`,
          [config.user_id]
        );
        if (existingDraft.rows.length > 0) {
          console.log(`📧 Email cron: skipping user ${config.user_id} — unapproved draft already exists`);
          continue;
        }

        console.log(`📧 Email campaign cron: generating for user ${config.user_id} [auto_send=${config.auto_send}]`);
        const generated = await generateCampaign(config.user_id, config, null, true);

        if (config.auto_send) {
          // Fully automated — save as pending and send immediately
          const saved = await pool.query(
            `INSERT INTO email_campaigns (user_id, subject, preview_text, body_html, body_text, blocks, status, scheduled_for, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW()) RETURNING id`,
            [config.user_id, generated.subject, generated.previewText, generated.bodyHtml, generated.bodyText, JSON.stringify(generated.blocks || [])]
          );
          const result = await sendCampaign(config.user_id, config, saved.rows[0].id);
          console.log(`✅ Auto-sent: ${result.sent} emails for user ${config.user_id} — "${generated.subject}"`);
        } else {
          // Manual approval mode — save as draft only, owner approves via dashboard
          await pool.query(
            `INSERT INTO email_campaigns (user_id, subject, preview_text, body_html, body_text, blocks, status, scheduled_for, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW(), NOW())`,
            [config.user_id, generated.subject, generated.previewText, generated.bodyHtml, generated.bodyText, JSON.stringify(generated.blocks || [])]
          );
          console.log(`📝 Draft ready for approval: user ${config.user_id} — "${generated.subject}"`);
        }
      } catch (err) {
        console.error(`❌ Email campaign failed for user ${config.user_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Email campaign cron error:', err.message);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Trial expiry cron — runs every hour, reverts basic users after PRO trial ends ──
cron.schedule('0 * * * *', async () => {
  try {
    const result = await pool.query(
      `UPDATE users SET plan = base_plan, trial_ends_at = NULL
       WHERE base_plan = 'basic' AND trial_ends_at IS NOT NULL AND trial_ends_at <= NOW()
       RETURNING id, email, base_plan`
    );
    if (result.rows.length > 0) {
      console.log(`⏰ Trial expired: reverted ${result.rows.length} user(s) from PRO back to basic`);
      result.rows.forEach(u => console.log(`   → user ${u.id} (${u.email}) → basic`));
    }
  } catch (err) {
    console.error('Trial expiry cron error:', err.message);
  }
});

// ── Square auto-sync cron — runs every 10 minutes, syncs payments & invoices for all connected users ──
cron.schedule('*/10 * * * *', async () => {
  try {
    const { syncSquarePayments, syncSquareInvoices } = require('./utils/squareSync');
    const { getValidSquareToken } = require('./utils/squareAuth');
    const connections = await pool.query(
      "SELECT user_id FROM payment_connections WHERE processor = 'square' AND is_active = true"
    );
    for (const conn of connections.rows) {
      try {
        // Always fetch a fresh (or refreshed) token before each sync run
        const { accessToken, locationId } = await getValidSquareToken(conn.user_id);
        await syncSquarePayments(conn.user_id, accessToken, pool);
        if (locationId) {
          await syncSquareInvoices(conn.user_id, accessToken, locationId, pool);
        }
      } catch (syncErr) {
        console.error(`Square sync error for user ${conn.user_id}:`, syncErr.message);
      }
    }
  } catch (err) {
    console.error('Square auto-sync cron error:', err.message);
  }
});

// ── Booking reminder email cron — runs every 15 minutes ──────────────────────
cron.schedule('*/15 * * * *', async () => {
  try {
    const sgMail = require('@sendgrid/mail');
    if (!process.env.SENDGRID_API_KEY) return;

    const settingsResult = await pool.query(
      'SELECT * FROM booking_reminder_settings WHERE enabled = true'
    );
    if (settingsResult.rows.length === 0) return;

    for (const setting of settingsResult.rows) {
      const { user_id, hours_before, custom_message } = setting;
      const windowMins = 15;

      // Fetch cancellation policy for this user
      const policyRow = await pool.query(
        'SELECT cancellation_policy_enabled, cancellation_policy_text FROM users WHERE id = $1',
        [user_id]
      );
      const policyEnabled = policyRow.rows[0]?.cancellation_policy_enabled;
      const policyText = policyRow.rows[0]?.cancellation_policy_text;

      const result = await pool.query(
        `SELECT b.id, b.booking_number, b.booking_date, b.start_time, b.end_time,
                b.customer_name, b.customer_email, b.total_amount,
                u.business_name, u.email as owner_email
         FROM bookings b
         JOIN users u ON u.id = b.user_id
         WHERE b.user_id = $1
           AND b.status NOT IN ('cancelled', 'completed', 'no_show')
           AND b.customer_email IS NOT NULL AND b.customer_email != ''
           AND (
             (b.booking_date || ' ' || b.start_time)::timestamp
               AT TIME ZONE COALESCE(u.timezone, 'America/New_York')
             - NOW()
           ) BETWEEN
               INTERVAL '1 minute' * ($2 * 60 - $3) AND INTERVAL '1 minute' * ($2 * 60 + $3)
           AND NOT EXISTS (
             SELECT 1 FROM booking_reminders_sent brs
             WHERE brs.booking_id = b.id AND brs.hours_before = $2 AND brs.channel = 'email'
           )`,
        [user_id, hours_before, windowMins]
      );

      for (const booking of result.rows) {
        try {
          const itemsResult = await pool.query(
            'SELECT service_name FROM booking_items WHERE booking_id = $1',
            [booking.id]
          );
          const serviceName = itemsResult.rows.map(r => r.service_name).join(', ') || 'your service';

          const formatDate = (d) => { if (!d) return ''; const dp = d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10); return new Date(dp + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); };
          const formatTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };

          const reminderLabel = hours_before >= 48 ? `${hours_before / 24} days` : `${hours_before} hours`;
          const bodyText = custom_message
            ? custom_message
              .replace('{{customerName}}', booking.customer_name)
              .replace('{{businessName}}', booking.business_name || '')
              .replace('{{serviceName}}', serviceName)
              .replace('{{date}}', formatDate(booking.booking_date))
              .replace('{{time}}', formatTime(booking.start_time))
            : `This is a reminder that your appointment for <strong>${serviceName}</strong> is coming up in <strong>${reminderLabel}</strong>.`;

          const cancellationBlock = (policyEnabled && policyText)
            ? `<div style="margin-top:1.5rem;padding:1rem;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;">
                 <p style="margin:0;font-weight:600;font-size:0.85rem;color:#92400e;">Cancellation Policy</p>
                 <p style="margin:0.25rem 0 0;font-size:0.85rem;color:#78350f;">${policyText}</p>
               </div>`
            : '';

          await sgMail.send({
            to: booking.customer_email,
            from: { name: booking.business_name || 'Your Service Provider', email: 'noreply@sorceintegrations.com' },
            replyTo: booking.owner_email ? { email: booking.owner_email } : undefined,
            subject: `Reminder: ${serviceName} on ${formatDate(booking.booking_date)}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
                <div style="background:#1d4ed8;padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
                  <h1 style="color:#fff;margin:0;font-size:1.5rem;">Appointment Reminder</h1>
                </div>
                <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                  <p style="font-size:1rem;margin-top:0;">Hi ${booking.customer_name},</p>
                  <p>${bodyText}</p>
                  <table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:15px;">
                    <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;width:40%;">Service</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${serviceName}</td></tr>
                    <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Date</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${formatDate(booking.booking_date)}</td></tr>
                    <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Time</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${formatTime(booking.start_time)}</td></tr>
                    ${booking.total_amount ? `<tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Total</td><td style="padding:10px 12px;">$${parseFloat(booking.total_amount).toFixed(2)}</td></tr>` : ''}
                  </table>
                  ${cancellationBlock}
                  <p style="color:#6b7280;font-size:0.9rem;margin-top:1.5rem;">If you need to reschedule, please contact us directly.</p>
                  <p style="color:#6b7280;font-size:0.9rem;margin:0;">${booking.business_name || ''}</p>
                </div>
              </div>`
          });

          await pool.query(
            `INSERT INTO booking_reminders_sent (booking_id, hours_before, channel) VALUES ($1, $2, 'email')
             ON CONFLICT (booking_id, hours_before, channel) DO NOTHING`,
            [booking.id, hours_before]
          );
          console.log(`📧 Email reminder sent: booking ${booking.booking_number} (${reminderLabel} before)`);
        } catch (emailErr) {
          console.error(`❌ Reminder email error for booking ${booking.id}:`, emailErr.message);
        }
      }
    }
  } catch (err) {
    console.error('❌ Booking reminder cron error:', err.message);
  }
});

// ── Booking reminder SMS cron — runs every 15 minutes ────────────────────────
cron.schedule('*/15 * * * *', async () => {
  try {
    const smsSettingsResult = await pool.query(
      'SELECT * FROM booking_reminder_settings WHERE sms_enabled = true'
    );
    if (smsSettingsResult.rows.length === 0) return;

    for (const setting of smsSettingsResult.rows) {
      const { user_id, hours_before, custom_message } = setting;
      const windowMins = 15;

      const result = await pool.query(
        `SELECT b.id, b.booking_number, b.booking_date, b.start_time,
                b.customer_name, b.customer_phone, b.total_amount,
                u.business_name
         FROM bookings b
         JOIN users u ON u.id = b.user_id
         WHERE b.user_id = $1
           AND b.status NOT IN ('cancelled', 'completed', 'no_show')
           AND b.customer_phone IS NOT NULL AND b.customer_phone != ''
           AND (
             (b.booking_date || ' ' || b.start_time)::timestamp
               AT TIME ZONE COALESCE(u.timezone, 'America/New_York')
             - NOW()
           ) BETWEEN
               INTERVAL '1 minute' * ($2 * 60 - $3) AND INTERVAL '1 minute' * ($2 * 60 + $3)
           AND NOT EXISTS (
             SELECT 1 FROM booking_reminders_sent brs
             WHERE brs.booking_id = b.id AND brs.hours_before = $2 AND brs.channel = 'sms'
           )`,
        [user_id, hours_before, windowMins]
      );

      for (const booking of result.rows) {
        try {
          const itemsResult = await pool.query(
            'SELECT service_name FROM booking_items WHERE booking_id = $1',
            [booking.id]
          );
          const serviceName = itemsResult.rows.map(r => r.service_name).join(', ') || 'your service';
          const formatDate = (d) => { if (!d) return ''; const dp = d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10); return new Date(dp + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
          const formatTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };

          const reminderLabel = hours_before >= 48 ? `${hours_before / 24} days` : `${hours_before} hours`;
          const smsText = custom_message
            ? custom_message
              .replace('{{customerName}}', booking.customer_name)
              .replace('{{businessName}}', booking.business_name || '')
              .replace('{{serviceName}}', serviceName)
              .replace('{{date}}', formatDate(booking.booking_date))
              .replace('{{time}}', formatTime(booking.start_time))
            : `Hi ${(booking.customer_name || '').split(' ')[0]}! Reminder: your ${serviceName} appointment with ${booking.business_name || 'us'} is in ${reminderLabel} on ${formatDate(booking.booking_date)} at ${formatTime(booking.start_time)}.`;

          const toPhone = booking.customer_phone.startsWith('+')
            ? booking.customer_phone
            : `+1${booking.customer_phone.replace(/\D/g, '')}`;

          await sendSMSAuto(toPhone, smsText, user_id);

          await pool.query(
            `INSERT INTO booking_reminders_sent (booking_id, hours_before, channel) VALUES ($1, $2, 'sms')
             ON CONFLICT (booking_id, hours_before, channel) DO NOTHING`,
            [booking.id, hours_before]
          );
          console.log(`📱 SMS reminder sent: booking ${booking.booking_number} (${reminderLabel} before)`);
        } catch (smsErr) {
          console.error(`❌ Reminder SMS error for booking ${booking.id}:`, smsErr.message);
        }
      }
    }
  } catch (err) {
    console.error('❌ Booking reminder SMS cron error:', err.message);
  }
});

// ── Chat learning agent cron — runs every 4 hours ────────────────────────────
// Scans recent conversations for errors & frustration, auto-improves agent prompts.
const { runChatLearningAgent } = require('./utils/chatLearningAgent');
cron.schedule('0 */4 * * *', () => runChatLearningAgent());

// ── Ad platform spend sync — runs daily at 3am ───────────────────────────────
const { syncGoogleAds, syncGoogleLSA, syncMeta } = require('./routes/ad-platforms');
cron.schedule('0 3 * * *', async () => {
  try {
    const conns = await pool.query(`SELECT user_id, platform FROM ad_platform_connections`);
    for (const { user_id, platform } of conns.rows) {
      try {
        if (platform === 'google_ads') await syncGoogleAds(user_id);
        else if (platform === 'google_lsa') await syncGoogleLSA(user_id);
        else if (platform === 'meta') await syncMeta(user_id);
      } catch (e) {
        console.error(`Ad sync error [user ${user_id} / ${platform}]:`, e.message);
      }
    }
    console.log(`✅ Ad spend sync complete (${conns.rows.length} connections)`);
  } catch (e) {
    console.error('Ad spend sync cron error:', e.message);
  }
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




