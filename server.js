require('dotenv').config();
// Before any route file requires @sendgrid/mail, so every send in the app picks up the
// patched methods. Gives each email a text/plain part derived from its HTML — 32 of the
// 34 send sites were HTML-only, which both Gmail and Outlook score against.
require('./utils/emailPlainText').installPlainTextFallback();
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
const { router: discoveryRoutes } = require('./routes/discovery');
const { buildReviewLink } = require('./utils/reviewLink');
const internalBillingRoutes = require('./routes/internal-billing');
const bookingRoutes = require('./routes/bookings');
const customerRoutes = require('./routes/customers');
const leadRoutes = require('./routes/leads');
const serviceRoutes = require('./routes/services');
const serviceCategoryRoutes = require('./routes/service-categories');
const bookingWidgetConfigRoutes = require('./routes/booking-widget-config');
const { TRANSACTIONAL_EMAIL } = require('./utils/emailFrom');
const { escapeHtml } = require('./utils/escapeHtml');
const { plainEmail } = require('./utils/emailLayout');
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
app.use('/api/discovery', discoveryRoutes);
app.use('/api/internal-billing', internalBillingRoutes);
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

const serviceDescriptionRoutes = require('./routes/service-descriptions');
app.use('/api/service-descriptions', serviceDescriptionRoutes);

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

// Payroll & efficiency (Tips & Payroll tab native panel)
const payrollRoutes = require('./routes/payroll');
app.use('/api/payroll', payrollRoutes);

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
    // Manager-set budgeted hours per job. NULL = use the booking's service durations as the default.
    await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS budgeted_hours NUMERIC");
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
    // Per-line service description, typed at booking time. Carries through to the
    // invoice line item so the customer sees what was actually done, not just the
    // catalog service name.
    await pool.query("ALTER TABLE booking_items ADD COLUMN IF NOT EXISTS description TEXT");
    // invoice_items historically stuffed the service name into `description`. Square,
    // PayPal and QuickBooks all take a name AND a description, so split them: `name`
    // is the service, `description` is what was actually done. Backfilled below for
    // rows written before the split.
    await pool.query("ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS name VARCHAR(255)");
    await pool.query("UPDATE invoice_items SET name = LEFT(description, 255) WHERE name IS NULL AND description IS NOT NULL");
    // Was VARCHAR(500), but per-line descriptions are allowed up to 1000 chars
    // (utils/bookingServices.js MAX_DESCRIPTION_LENGTH) — a long one would fail the
    // insert with 22001 and take the whole invoice down.
    await pool.query("ALTER TABLE invoice_items ALTER COLUMN description TYPE TEXT");
    // Reusable descriptions per service. service_id NULL = preset offered for every
    // service. Exactly one row per service may be is_default (enforced below); that
    // one pre-fills the description box when the service is added to a booking.
    await pool.query(`CREATE TABLE IF NOT EXISTS service_description_presets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
      label VARCHAR(120) NOT NULL,
      body TEXT NOT NULL,
      is_default BOOLEAN DEFAULT false,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query("CREATE INDEX IF NOT EXISTS sdp_user_service_idx ON service_description_presets(user_id, service_id, sort_order)");
    // One default per service (and one user-level default for the NULL-service row).
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS sdp_one_default_per_service ON service_description_presets(user_id, service_id) WHERE is_default AND service_id IS NOT NULL");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS sdp_one_global_default ON service_description_presets(user_id) WHERE is_default AND service_id IS NULL");
    // QuickBooks Online. Unlike Square/Clover this is an accounting system, so it
    // stores a realm (company) id alongside the OAuth pair. Intuit refresh tokens
    // themselves expire (~100 days), hence the second expiry column.
    await pool.query("ALTER TABLE payment_connections ADD COLUMN IF NOT EXISTS quickbooks_realm_id TEXT");
    await pool.query("ALTER TABLE payment_connections ADD COLUMN IF NOT EXISTS quickbooks_access_token TEXT");
    await pool.query("ALTER TABLE payment_connections ADD COLUMN IF NOT EXISTS quickbooks_refresh_token TEXT");
    await pool.query("ALTER TABLE payment_connections ADD COLUMN IF NOT EXISTS quickbooks_token_expires_at TIMESTAMPTZ");
    await pool.query("ALTER TABLE payment_connections ADD COLUMN IF NOT EXISTS quickbooks_refresh_expires_at TIMESTAMPTZ");
    await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quickbooks_invoice_id VARCHAR(255)");
    // Deep link to the unsent/draft invoice inside the processor's own dashboard,
    // so "Create Draft Invoice" can hand the user somewhere to go review it.
    await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS processor_draft_url TEXT");
    // Claim stamp for draft creation. The auto-draft fires the moment a booking is
    // created, so it can now race a user pressing the manual button on the same
    // booking — and each adapter mints its own idempotency key, so two winners means
    // two drafts in the merchant's account. Claimed atomically; the 2-minute staleness
    // window in invoiceDrafts.js releases it if a dyno dies mid-call.
    await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS draft_claimed_at TIMESTAMPTZ");
    // Auto-draft a processor invoice for every new booking — dashboard, employee app
    // and public website alike. On by default: a merchant who has connected
    // Square/Stripe/PayPal/QuickBooks wants the invoice waiting for them, and it is a
    // DRAFT, so nothing reaches the customer until they send it. Users with no
    // draft-capable connection are unaffected.
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_draft_invoices BOOLEAN DEFAULT true");
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
    // Monthly review raffle settings
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS raffle_enabled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS raffle_consolation TEXT DEFAULT '$50 off any Full Detail'`);
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS raffle_require_verified BOOLEAN DEFAULT false`);
    // The raffle prize is its OWN field, kept separate from `incentive` (which is the
    // enticement appended to review-request texts) so a winner-style phrase can never
    // leak into every review request.
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS raffle_reward TEXT`);
    // Google Review SMS conversational flow: the "this is ___" rep name on the opener,
    // plus the AI 1-10 rating (and tip) of the owner's incentive shown in setup.
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS rep_name VARCHAR(100)`);
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS incentive_score INTEGER`);
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS incentive_tip TEXT`);
    await pool.query(`ALTER TABLE review_configs ADD COLUMN IF NOT EXISTS review_link_base VARCHAR(255)`);
    // Branded review links: sorceintegrations.com/r/<business-slug>/<token>. The slug
    // makes the text recognisable to the customer; the token means the URLs aren't
    // sequential ids anyone could walk. Both are filled in lazily on first send.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS review_slug VARCHAR(60)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_review_slug ON users(review_slug) WHERE review_slug IS NOT NULL`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS click_token VARCHAR(12)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_click_token ON review_requests(click_token) WHERE click_token IS NOT NULL`);
    // SORCE's own internal CRM: who can log into /analytics, and the discovery calls
    // we book with prospects signing up for SORCE.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sorce_team_members (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        title VARCHAR(120),
        phone VARCHAR(30),
        photo_url TEXT,
        bio TEXT,
        role VARCHAR(20) DEFAULT 'member',
        password_hash TEXT,
        invite_token TEXT,
        invite_token_expires TIMESTAMPTZ,
        invite_accepted_at TIMESTAMPTZ,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS discovery_calls (
        id SERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(30),
        company VARCHAR(160),
        scheduled_at TIMESTAMPTZ NOT NULL,
        duration_minutes INTEGER DEFAULT 30,
        timezone VARCHAR(64) DEFAULT 'America/New_York',
        status VARCHAR(24) DEFAULT 'scheduled',
        assigned_to INTEGER REFERENCES sorce_team_members(id) ON DELETE SET NULL,
        source VARCHAR(24) DEFAULT 'manual',
        notes TEXT,
        outcome VARCHAR(40),
        confirmation_sms_sent BOOLEAN DEFAULT false,
        confirmation_email_sent BOOLEAN DEFAULT false,
        reminder_24h_sent BOOLEAN DEFAULT false,
        reminder_2h_sent BOOLEAN DEFAULT false,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_discovery_calls_scheduled ON discovery_calls(scheduled_at)`);
    // Zoom meeting per discovery call. zoom_start_url is the HOST link — it grants host
    // control to whoever opens it, so it is for the team only and never goes in a
    // prospect-facing message. zoom_join_url is the one that gets sent.
    await pool.query(`ALTER TABLE discovery_calls ADD COLUMN IF NOT EXISTS zoom_meeting_id VARCHAR(32)`);
    await pool.query(`ALTER TABLE discovery_calls ADD COLUMN IF NOT EXISTS zoom_join_url TEXT`);
    await pool.query(`ALTER TABLE discovery_calls ADD COLUMN IF NOT EXISTS zoom_start_url TEXT`);
    await pool.query(`ALTER TABLE discovery_calls ADD COLUMN IF NOT EXISTS zoom_passcode VARCHAR(24)`);
    // What a prospect texted back, so the call card can show it rather than the reply
    // living only in whoever's phone it was forwarded to.
    await pool.query(`ALTER TABLE discovery_calls ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE discovery_calls ADD COLUMN IF NOT EXISTS last_reply_text TEXT`);
    // SORCE's own sales pipeline — prospects the team is working before (or without) a
    // booked discovery call. Deliberately separate from the customer-facing `leads`
    // table, which is scoped per business; these rows are people buying SORCE itself.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sorce_leads (
        id SERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(30),
        company VARCHAR(160),
        source VARCHAR(40) DEFAULT 'manual',
        status VARCHAR(24) DEFAULT 'new',
        notes TEXT,
        assigned_to INTEGER REFERENCES sorce_team_members(id) ON DELETE SET NULL,
        discovery_call_id INTEGER REFERENCES discovery_calls(id) ON DELETE SET NULL,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sorce_leads_status ON sorce_leads(status, created_at DESC)`);
    // Business detail for cold outreach — logging who was called needs more than a
    // contact name, and these are what makes a row worth revisiting months later.
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS website VARCHAR(255)`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS address VARCHAR(255)`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS city VARCHAR(120)`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS state VARCHAR(40)`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS industry VARCHAR(120)`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS contact_title VARCHAR(120)`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ`);
    // Verbal SMS consent, captured on the call. Consent given out loud is only worth
    // anything if it's written down — carriers and the TCPA both want the date, who
    // took it and what was read out, and "they said yes on the phone" is not a defence
    // without a record of when.
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS sms_consent_method VARCHAR(20)`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS sms_consent_by INTEGER`);
    await pool.query(`ALTER TABLE sorce_leads ADD COLUMN IF NOT EXISTS sms_consent_note TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sorce_leads_call ON sorce_leads(discovery_call_id) WHERE discovery_call_id IS NOT NULL`);

    // Backfill the pipeline from calls booked before the sync existed, so Booked
    // Meetings shows the whole history rather than only what's been booked since.
    // Both steps are idempotent — once every call has a linked lead they no-op.
    //
    // Link first, insert second: a call whose prospect is already in the pipeline
    // should promote that row, not sit beside a duplicate of it.
    const linked = await pool.query(`
      UPDATE sorce_leads sl
      SET discovery_call_id = dc.id,
          status = 'demo_scheduled',
          last_contacted_at = COALESCE(sl.last_contacted_at, dc.created_at),
          updated_at = NOW()
      FROM discovery_calls dc
      WHERE sl.discovery_call_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM sorce_leads x WHERE x.discovery_call_id = dc.id)
        AND (
          (NULLIF(TRIM(dc.email), '') IS NOT NULL
             AND LOWER(TRIM(sl.email)) = LOWER(TRIM(dc.email)))
          OR (length(right(regexp_replace(COALESCE(dc.phone, ''), '\\D', '', 'g'), 10)) = 10
             AND right(regexp_replace(COALESCE(sl.phone, ''), '\\D', '', 'g'), 10)
               = right(regexp_replace(COALESCE(dc.phone, ''), '\\D', '', 'g'), 10))
        )`);

    const created = await pool.query(`
      INSERT INTO sorce_leads
        (name, email, phone, company, source, status, notes, assigned_to,
         discovery_call_id, last_contacted_at, created_at)
      SELECT dc.name, NULLIF(LOWER(TRIM(dc.email)), ''), dc.phone, dc.company,
             CASE WHEN dc.source = 'public' THEN 'website' ELSE 'manual' END,
             'demo_scheduled', dc.notes, dc.assigned_to, dc.id, dc.created_at, dc.created_at
        FROM discovery_calls dc
       WHERE NOT EXISTS (SELECT 1 FROM sorce_leads sl WHERE sl.discovery_call_id = dc.id)`);

    if (linked.rowCount || created.rowCount) {
      console.log(`✅ Booked-meeting backfill: ${linked.rowCount} lead(s) linked, ${created.rowCount} created`);
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS discovery_availability (
        id SERIAL PRIMARY KEY,
        day_of_week INTEGER NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL
      )`);
    // Tag SMS rows that belong to a Google Review conversation so the dashboard can show
    // the full opener + reply thread in its own sub-tab.
    await pool.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS review_request_id INTEGER`);
    // Backfill: the old one-way review texts embedded /review-click/{id} in the body —
    // recover the review_request_id from it so they appear in the Google Review SMS tab.
    await pool.query(`
      UPDATE sms_messages
      SET review_request_id = (substring(message from 'review-click/([0-9]+)'))::int
      WHERE review_request_id IS NULL
        AND message ~ 'review-click/[0-9]+'
    `);
    // Older texts (pre-tracking) carried the raw google link with no id — match those
    // outbound "leave your review" texts to a review_request by the customer's phone.
    await pool.query(`
      UPDATE sms_messages s
      SET review_request_id = rr.id
      FROM review_requests rr
      JOIN customers c ON c.id = rr.customer_id
      WHERE s.review_request_id IS NULL
        AND s.direction = 'outgoing'
        AND s.user_id = rr.user_id
        AND s.message ILIKE '%leave your review%'
        AND length(right(regexp_replace(coalesce(s.to_number,''), '\\D', '', 'g'), 10)) = 10
        AND right(regexp_replace(coalesce(s.to_number,''), '\\D', '', 'g'), 10)
            = right(regexp_replace(coalesce(c.phone,''), '\\D', '', 'g'), 10)
    `);
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
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Monthly review raffle tracking on each request
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS link_clicked_at TIMESTAMP`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS review_verified BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS review_verified_at TIMESTAMP`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS raffle_status VARCHAR(20)`); // 'won' | 'lost' | null
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS raffle_period VARCHAR(7)`); // 'YYYY-MM'
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS raffle_notified_at TIMESTAMP`);
    // These are in the CREATE TABLE but were never added to tables created by an older
    // schema (CREATE TABLE IF NOT EXISTS won't add columns). The conversation list + the
    // inbound-reply webhook reference them, so a missing column 500s those queries.
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255)`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50)`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS service_name VARCHAR(255)`);

    // Review follow-up sequence: two more texts (day 1, day 7) then two emails
    // (day 21, day 42) for customers who were asked and still haven't left a review.
    //
    // followup_seq_started_at is what enrols a request in the sequence, and it is set
    // when the opener goes out — deliberately NOT reusing sms_sent_at. Every one of the
    // 159 requests already in the table predates this feature and is months past day 42,
    // so anchoring on sms_sent_at would have fired all four steps at every one of them
    // on the first cron tick after deploy. Existing rows have this NULL and are never
    // enrolled; only requests opened from here on enter the sequence.
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS followup_seq_started_at TIMESTAMP`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS followup_sms_1_at TIMESTAMP`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS followup_sms_2_at TIMESTAMP`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS followup_email_1_at TIMESTAMP`);
    await pool.query(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS followup_email_2_at TIMESTAMP`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_requests_followup
      ON review_requests(followup_seq_started_at) WHERE followup_seq_started_at IS NOT NULL`);
    console.log('✅ Review requests table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify review_requests table:', e.message);
  }

  // Monthly review raffle draws (one row per user per month)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS review_raffles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        period VARCHAR(7) NOT NULL,
        winner_request_id INTEGER REFERENCES review_requests(id) ON DELETE SET NULL,
        winner_name VARCHAR(255),
        winner_phone VARCHAR(50),
        reward TEXT,
        consolation TEXT,
        pool_size INTEGER DEFAULT 0,
        texts_sent INTEGER DEFAULT 0,
        status VARCHAR(30) DEFAULT 'completed',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, period)
      )
    `);
    console.log('✅ Review raffles table verified');
  } catch (e) {
    console.warn('⚠️ Could not verify review_raffles table:', e.message);
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
    // Tax collected on the payment (from Square order tax), so revenue can be shown net of tax.
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0');
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

  // Backfill lead_id on historical SMS by phone number.
  //
  // Only a few code paths ever stamped lead_id, so review texts, campaign blasts,
  // booking messages and opt-outs sat in the table unattached. That broke two things:
  // the owner's Conversations panel (keyed on lead_id) showed a partial thread, and
  // reply attribution had almost no tagged history to reason about, which is how a
  // campaign blast ended up claiming replies that belonged elsewhere.
  //
  // Matching is on the last 10 digits because phone formats are inconsistent across
  // both tables (E.164, bare 10-digit, "(555) 123-4567"). Where a number maps to
  // several leads, the most recent one wins — same rule the live webhook uses.
  try {
    // Keeps the rescan on every boot cheap once the backfillable rows are done.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_lead_id_null
      ON sms_messages(user_id) WHERE lead_id IS NULL`);

    const cp = `right(regexp_replace(
      CASE WHEN s2.direction = 'outgoing' THEN COALESCE(s2.to_number, '')
           ELSE COALESCE(s2.from_number, '') END,
      '\\D', '', 'g'), 10)`;

    const backfilled = await pool.query(`
      UPDATE sms_messages s
      SET lead_id = sub.lead_id
      FROM (
        SELECT s2.id AS msg_id,
               (SELECT l.id FROM leads l
                 WHERE l.user_id = s2.user_id
                   AND right(regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g'), 10) = ${cp}
                 ORDER BY l.created_at DESC
                 LIMIT 1) AS lead_id
          FROM sms_messages s2
         WHERE s2.lead_id IS NULL
           AND length(${cp}) = 10
      ) sub
      WHERE s.id = sub.msg_id AND sub.lead_id IS NOT NULL
    `);
    if (backfilled.rowCount > 0) {
      console.log(`✅ Backfilled lead_id on ${backfilled.rowCount} sms_messages rows`);
    } else {
      console.log('✅ sms_messages lead_id backfill — nothing left to attach');
    }
  } catch (e) {
    console.warn('⚠️ Could not backfill sms_messages.lead_id:', e.message);
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
    // Real payment state from Stripe. The plan column only says what they signed up
    // for — it stays set through a failing card for the whole dunning window, so it
    // can't be trusted to mean "paying". These are fed by invoice webhooks and by
    // the nightly reconcile against Stripe.
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(24)");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_payment_amount INTEGER");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_payment_failed_at TIMESTAMPTZ");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_synced_at TIMESTAMPTZ");
    // What the last payment was actually for, so the discovery call card can say
    // "Website build — $500" rather than just showing an amount.
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_payment_description TEXT");
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

    // Self-hosted campaign click tracking. Replaces SendGrid's redirector, which served
    // links over plain HTTP from a domain whose certificate doesn't match it, and kept the
    // resulting data somewhere this codebase could never read. See utils/campaignLinks.
    //
    // One row per distinct destination per campaign — a few rows, not one per recipient.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaign_links (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(16) UNIQUE NOT NULL,
        destination TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_campaign_links_campaign ON campaign_links(campaign_id)');
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_links_dest
                      ON campaign_links(campaign_id, destination)`);

    // Also the send log. Which addresses a campaign actually went to was not recorded
    // anywhere, so "who did we email" was unanswerable once the customer list moved on.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        token VARCHAR(16) UNIQUE NOT NULL,
        sent_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_recipients_unique
                      ON campaign_recipients(campaign_id, LOWER(email))`);
    // Test sends go to the owner's own address through the same path, so their clicks
    // would otherwise land in the campaign's numbers — inflating delivered, skewing the
    // click rate, and putting the owner at the top of their own "who clicked" list.
    await pool.query(`ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE`);

    // Every click, not just the first — repeat clicks are signal, and the dashboard
    // distinguishes total from unique by counting distinct recipients.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaign_link_clicks (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE CASCADE,
        link_id INTEGER REFERENCES campaign_links(id) ON DELETE CASCADE,
        recipient_id INTEGER REFERENCES campaign_recipients(id) ON DELETE CASCADE,
        clicked_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_campaign_clicks_campaign ON campaign_link_clicks(campaign_id, clicked_at DESC)');

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
const { findLeadIdByPhone } = require('./utils/smsThread');
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
      `SELECT rr.id, rr.user_id, rr.customer_id,
              c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
              COALESCE(
                (SELECT bi.service_name FROM booking_items bi
                  WHERE bi.booking_id = rr.booking_id AND bi.is_addon = false
                  ORDER BY bi.id LIMIT 1),
                c.last_service
              ) AS service_name,
              u.business_name, u.twilio_phone_number, u.google_review_link,
              rc.message_template, rc.incentive, rc.incentive_enabled, rc.rep_name
       FROM review_requests rr
       JOIN users u ON u.id = rr.user_id
       JOIN customers c ON c.id = rr.customer_id
       LEFT JOIN review_configs rc ON rc.user_id = rr.user_id
       WHERE rr.status = 'pending'
         AND rr.sms_sent = false
         AND c.phone IS NOT NULL
         AND (c.sms_unsubscribed IS NULL OR c.sms_unsubscribed = FALSE)
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

        // Conversational opener — just the question. The incentive + review link are sent
        // later, and ONLY if the customer replies positively (see the review branch in
        // routes/sms.js). Claude shortens the service name the way a customer would say it.
        const { shortenServiceName } = require('./utils/reviewAI');
        const reviewFirstName = (req.customer_name || 'there').split(' ')[0];
        const repName = (req.rep_name || '').trim();
        const shortService = await shortenServiceName(req.service_name, req.user_id);
        const message = repName
          ? `Hey ${reviewFirstName}, this is ${repName} with ${req.business_name || 'us'}. How did the ${shortService} go?`
          : `Hey ${reviewFirstName}, it's ${req.business_name || 'us'} — how did the ${shortService} go?`;

        // Format phone number for sending
        const toPhone = req.customer_phone.startsWith('+') ? req.customer_phone : `+1${req.customer_phone.replace(/\D/g, '')}`;
        const smsResult = await sendSMSAuto(toPhone, message, req.user_id);

        // Tie the opener to the lead as well as the review request, so the review
        // exchange shows up inside that contact's conversation rather than only in
        // the review tab.
        const openerLeadId = await findLeadIdByPhone(pool, req.user_id, toPhone);
        await pool.query(
          `INSERT INTO sms_messages (user_id, lead_id, direction, to_number, from_number, provider, message, twilio_message_sid, review_request_id, created_at)
           VALUES ($1, $2, 'outgoing', $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
          [req.user_id, openerLeadId, toPhone, smsResult.fromNumber, smsResult.provider, message, smsResult.messageSid, req.id]
        );

        // Opener sent → now waiting for the customer's reply, which the inbound webhook
        // classifies (positive → incentive+link, negative → escalate to owner).
        await pool.query(
          `UPDATE review_requests
              SET sms_sent = true, sms_sent_at = NOW(), actual_send_time = NOW(),
                  status = 'awaiting_reply', followup_seq_started_at = NOW()
            WHERE id = $1`,
          [req.id]
        );

        console.log(`✅ Cron: Review opener sent for request ${req.id} to ${toPhone} via ${smsResult.provider}`);
      } catch (sendErr) {
        console.error(`❌ Cron: Review SMS failed for request ${req.id}:`, sendErr.message);
        await pool.query("UPDATE review_requests SET status = 'sms_failed', sms_error = $2 WHERE id = $1", [req.id, sendErr.message]);
      }
    }
  } catch (err) {
    console.error('❌ Review SMS cron error:', err.message || err);
  }
});

// ── Review follow-up sequence ─────────────────────────────
// After the opener and the review ask, a customer who was asked and still hasn't
// used the link gets: a text at day 1, a text at day 7, then emails at day 21 and
// day 42. Everything is anchored on followup_seq_started_at (set when the opener
// goes out) and stops the moment they click through.
//
// Two kinds of customer travel through these steps and they get different messages:
//
//   asked        — replied, were judged happy, got a link. Nudge them about the review.
//   awaiting_reply — never answered "how did it go?", so they have NEVER been sent a
//                  link. Chasing them for a review would be nonsense, and asking before
//                  we know they're happy is exactly what the sentiment gate exists to
//                  prevent. They get the original question re-opened instead; if they
//                  answer, the inbound webhook runs the normal branch from there.
//
// The re-ask is texts only. An email three weeks after the job asking "how did it go?"
// is stale, and it reads as a review ask however it's worded.
//
// 'replied_negative' appears in neither list, for the obvious reason.
const REVIEW_ASKED_STATUSES = ['replied_positive', 'replied_neutral', 'sent'];
const REVIEW_REASK_STATUSES = ['awaiting_reply'];

const REVIEW_FOLLOWUP_STEPS = [
  { col: 'followup_sms_1_at',   channel: 'sms',   afterDays: 1,  attempt: 1,
    statuses: [...REVIEW_ASKED_STATUSES, ...REVIEW_REASK_STATUSES] },
  { col: 'followup_sms_2_at',   channel: 'sms',   afterDays: 7,  attempt: 2,
    statuses: [...REVIEW_ASKED_STATUSES, ...REVIEW_REASK_STATUSES] },
  { col: 'followup_email_1_at', channel: 'email', afterDays: 21, attempt: 1,
    statuses: REVIEW_ASKED_STATUSES },
  { col: 'followup_email_2_at', channel: 'email', afterDays: 42, attempt: 2,
    statuses: REVIEW_ASKED_STATUSES },
];

// A step more than this far overdue is marked done without sending. Without it, a
// cron outage (or a long deploy gap) would come back up and fire a burst of stale
// nudges at people whose job was weeks ago.
const FOLLOWUP_MAX_LATE_DAYS = 3;

cron.schedule('*/10 * * * *', async () => {
  for (const step of REVIEW_FOLLOWUP_STEPS) {
    try {
      const due = await pool.query(
        `SELECT rr.id, rr.user_id, rr.status, rr.followup_seq_started_at,
                COALESCE(c.name,  rr.customer_name)  AS customer_name,
                COALESCE(c.phone, rr.customer_phone) AS customer_phone,
                COALESCE(c.email, rr.customer_email) AS customer_email,
                c.sms_unsubscribed, c.email_unsubscribed,
                u.business_name, u.email AS owner_email, u.google_review_link,
                u.twilio_phone_number, u.plan,
                rc.incentive, rc.incentive_enabled, rc.review_link_base, rc.rep_name,
                COALESCE(
                  (SELECT bi.service_name FROM booking_items bi
                    WHERE bi.booking_id = rr.booking_id AND bi.is_addon = false
                    ORDER BY bi.id LIMIT 1),
                  rr.service_name, c.last_service
                ) AS service_name,
                rr.followup_seq_started_at + ($2::int * INTERVAL '1 day') AS due_at
           FROM review_requests rr
           JOIN users u ON u.id = rr.user_id
           LEFT JOIN customers c ON c.id = rr.customer_id
           LEFT JOIN review_configs rc ON rc.user_id = rr.user_id
          WHERE rr.followup_seq_started_at IS NOT NULL
            AND rr.${step.col} IS NULL
            AND rr.status = ANY($1)
            AND COALESCE(rr.link_clicked, false)    = false
            AND COALESCE(rr.review_completed, false) = false
            AND COALESCE(rr.review_verified, false)  = false
            AND rr.followup_seq_started_at + ($2::int * INTERVAL '1 day') <= NOW()
          LIMIT 200`,
        [step.statuses, step.afterDays]
      );

      for (const req of due.rows) {
        // Stamp first, then send. A crash mid-send costs one nudge; the other order
        // would re-text the same person every 10 minutes until it succeeded.
        const markDone = () => pool.query(
          `UPDATE review_requests SET ${step.col} = NOW() WHERE id = $1`, [req.id]
        ).catch(e => console.error(`Follow-up stamp failed for ${req.id}:`, e.message));

        const lateDays = (Date.now() - new Date(req.due_at).getTime()) / 86400000;
        if (lateDays > FOLLOWUP_MAX_LATE_DAYS) {
          await markDone();
          console.log(`⏭️ Review follow-up ${step.col} skipped for request ${req.id} — ${Math.round(lateDays)}d overdue`);
          continue;
        }

        try {
          const firstName = String(req.customer_name || 'there').split(' ')[0];
          // A re-ask carries no link — it re-opens "how did it go?" and nothing more —
          // so only the review chase needs one, and only it should abort without one.
          const isReAsk = REVIEW_REASK_STATUSES.includes(req.status);
          const reviewLink = isReAsk ? null : await buildReviewLink(pool, {
            reviewRequestId: req.id,
            userId: req.user_id,
            customBase: req.review_link_base,
            hasGoogleLink: !!req.google_review_link,
          });
          if (!isReAsk && !reviewLink) { await markDone(); continue; }

          if (step.channel === 'sms') {
            if (!req.customer_phone || req.sms_unsubscribed || !req.twilio_phone_number) {
              await markDone();
              continue;
            }
            // Same monthly allowance the opener respects — a follow-up shouldn't be
            // the thing that pushes an account over its plan limit.
            const unlimited = smsCampaignRoutes.isUnlimitedSms(req.owner_email);
            if (!unlimited) {
              const SMS_LIMITS = { scale: 500, pro: 100, expert: 200, basic: 100 };
              const smsLimit = SMS_LIMITS[req.plan] || 0;
              const used = parseInt((await pool.query(
                `SELECT COUNT(*) FROM sms_messages
                  WHERE user_id = $1 AND direction = 'outgoing'
                    AND created_at >= date_trunc('month', NOW())`,
                [req.user_id]
              )).rows[0].count, 10);
              if (smsLimit === 0 || used >= smsLimit) {
                await markDone();
                console.log(`⏭️ Review follow-up ${step.col} skipped for request ${req.id} — SMS limit`);
                continue;
              }
            }

            const priorTurns = (await pool.query(
              `SELECT direction, message FROM sms_messages
                WHERE review_request_id = $1 ORDER BY created_at ASC LIMIT 8`,
              [req.id]
            ).catch(() => ({ rows: [] }))).rows;

            const { composeReviewFollowUp, composeOpenerReAsk, shortenServiceName } = require('./utils/reviewAI');
            const body = isReAsk
              ? await composeOpenerReAsk({
                  firstName,
                  businessName: req.business_name,
                  serviceName: await shortenServiceName(req.service_name, req.user_id),
                  repName: (req.rep_name || '').trim(),
                  attempt: step.attempt,
                  history: priorTurns,
                }, req.user_id)
              : await composeReviewFollowUp({
                  firstName,
                  businessName: req.business_name,
                  incentive: req.incentive,
                  incentiveEnabled: req.incentive_enabled,
                  reviewLink,
                  attempt: step.attempt,
                  history: priorTurns,
                }, req.user_id);

            const toPhone = req.customer_phone.startsWith('+')
              ? req.customer_phone
              : `+1${req.customer_phone.replace(/\D/g, '')}`;

            await markDone();
            const smsResult = await sendSMSAuto(toPhone, body, req.user_id);
            const followUpLeadId = await findLeadIdByPhone(pool, req.user_id, toPhone);
            await pool.query(
              `INSERT INTO sms_messages (user_id, lead_id, direction, to_number, from_number, provider, message, twilio_message_sid, review_request_id, created_at)
               VALUES ($1, $2, 'outgoing', $3, $4, $5, $6, $7, $8, NOW())`,
              [req.user_id, followUpLeadId, toPhone, smsResult.fromNumber, smsResult.provider, body, smsResult.messageSid, req.id]
            ).catch(e => console.error('Follow-up SMS log failed:', e.message));
            console.log(`🔁 Review ${isReAsk ? 're-ask' : 'follow-up'} text ${step.attempt} sent for request ${req.id} to ${toPhone}`);
          } else {
            const toEmail = String(req.customer_email || '').trim();
            // email_unsubscribed was not being checked at all — someone who opted out
            // would still have been chased for a review by email, which is both the
            // thing that generates spam complaints and the thing those complaints then
            // punish the whole sending domain for.
            if (!process.env.SENDGRID_API_KEY || req.email_unsubscribed ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
              await markDone();
              continue;
            }
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            const finalOne = step.attempt === 2;
            const incentiveLine = req.incentive_enabled && req.incentive
              ? `<p style="margin:0 0 16px;">Leave a review and ${req.incentive}.</p>`
              : '';

            await markDone();
            await sgMail.send({
              to: toEmail,
              from: { name: req.business_name || 'SORCE', email: TRANSACTIONAL_EMAIL },
              replyTo: req.owner_email ? { email: req.owner_email } : undefined,
              subject: finalOne
                ? `One last ask — ${req.business_name || 'us'}`
                : `Would you mind leaving us a review?`,
              // One-click unsubscribe, same as the campaigns. A review chase is
              // promotional however politely it's worded, and giving people an easy way
              // out is what keeps them from using "report spam" as the exit instead.
              headers: require('./routes/email-campaigns').unsubscribeHeaders(toEmail, req.user_id),
              html: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
                  <p style="margin:0 0 16px;font-size:16px;">Hi ${firstName},</p>
                  <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                    ${finalOne
                      ? `We won't keep asking — but if you have a spare minute, a quick Google review really does help a small business like ${req.business_name || 'ours'}.`
                      : `You mentioned things went well with us, and we'd be really grateful if you'd share that in a quick Google review.`}
                  </p>
                  ${incentiveLine}
                  <div style="text-align:center;margin:28px 0;">
                    <a href="${reviewLink}" style="background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">Leave a Review</a>
                  </div>
                  <p style="margin:0;color:#6b7280;font-size:13px;">Thanks again for choosing ${req.business_name || 'us'}.</p>
                </div>`,
            });
            console.log(`🔁 Review follow-up email ${step.attempt} sent for request ${req.id} to ${toEmail}`);
          }
        } catch (stepErr) {
          console.error(`❌ Review follow-up ${step.col} failed for request ${req.id}:`, stepErr.message);
        }
      }
    } catch (err) {
      console.error(`❌ Review follow-up cron error (${step.col}):`, err.message || err);
    }
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
      `SELECT b.id AS booking_id, b.user_id, b.customer_id,
              rc.send_delay, rc.incentive_enabled, rc.send_trigger
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       JOIN review_configs rc ON rc.user_id = b.user_id
       WHERE rc.auto_send_enabled = true
         AND b.customer_id IS NOT NULL
         AND b.status NOT IN ('cancelled')
         AND NOT EXISTS (
           SELECT 1 FROM review_requests rr
           WHERE rr.booking_id = b.id
         )
         AND (
           -- Automatic: fires send_delay hours after the booking's END time (timezone-aware).
           -- Uses end_time directly rather than start_time + per-item service_duration — a
           -- 0-duration add-on item was making the join fire this hours early.
           (rc.send_trigger = 'service_duration'
            AND (b.booking_date || ' ' || COALESCE(b.end_time, b.start_time))::timestamp
                  AT TIME ZONE COALESCE(u.timezone, 'America/New_York')
                + COALESCE(rc.send_delay, 1) * INTERVAL '1 hour'
                <= NOW())
           OR
           -- Manual: booking marked complete + delay elapsed
           (rc.send_trigger = 'booking_completed'
            AND b.status = 'completed'
            AND b.updated_at + COALESCE(rc.send_delay, 1) * INTERVAL '1 hour' <= NOW())
         )`
    );

    for (const row of eligible.rows) {
      try {
        // scheduled_send_time = now (the delay condition already passed in WHERE)
        const scheduledTime = new Date();
        await pool.query(
          `INSERT INTO review_requests (user_id, customer_id, booking_id, status, scheduled_send_time, created_at)
           VALUES ($1, $2, $3, 'pending', $4, NOW())
           ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO NOTHING`,
          [row.user_id, row.customer_id, row.booking_id, scheduledTime]
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

// The old 24-hour review follow-up email cron used to live here. It is replaced by
// the review follow-up sequence above, which emails at day 21 and day 42 instead —
// and, unlike this one, only chases customers who were actually sent a review link.
// The old query had no status filter, so a customer who replied that the job went
// badly got an email the next morning asking them to review it.

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

          // Amber callout box replaced with a plain labelled line — see utils/emailLayout.
          const cancellationBlock = (policyEnabled && policyText)
            ? `<strong>Cancellation policy:</strong> ${escapeHtml(policyText)}`
            : '';

          await sgMail.send({
            to: booking.customer_email,
            from: { name: booking.business_name || 'Your Service Provider', email: TRANSACTIONAL_EMAIL },
            replyTo: booking.owner_email ? { email: booking.owner_email } : undefined,
            subject: `Reminder: ${serviceName} on ${formatDate(booking.booking_date)}`,
            html: plainEmail({
              greeting: `Hi ${escapeHtml(booking.customer_name)},`,
              // bodyText is either a template the business wrote (with its own markup) or
              // our default sentence, so it is not escaped here.
              paragraphs: [bodyText],
              details: [
                { label: 'Service', value: escapeHtml(serviceName) },
                { label: 'Date', value: escapeHtml(formatDate(booking.booking_date)) },
                { label: 'Time', value: escapeHtml(formatTime(booking.start_time)) },
                booking.total_amount
                  ? { label: 'Total', value: `$${parseFloat(booking.total_amount).toFixed(2)}` }
                  : null,
              ].filter(Boolean),
              after: [
                cancellationBlock,
                'If you need to reschedule, please contact us directly.',
              ],
              signature: escapeHtml(booking.business_name || ''),
            })
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

          const reminderResult = await sendSMSAuto(toPhone, smsText, user_id);

          // Log the reminder into the thread. It used to go out untracked, which left
          // a hole in attribution: a customer replying "can we push it to Friday?" had
          // no booking-tagged message to reply TO, so the webhook fell back to guessing
          // from their phone number. Now the reminder itself says which booking it is.
          const reminderLeadId = await findLeadIdByPhone(pool, user_id, toPhone);
          await pool.query(
            `INSERT INTO sms_messages (user_id, booking_id, lead_id, direction, to_number, from_number, provider, message, twilio_message_sid, status, created_at)
             VALUES ($1, $2, $3, 'outgoing', $4, $5, $6, $7, $8, 'sent', CURRENT_TIMESTAMP)`,
            [user_id, booking.id, reminderLeadId, toPhone, reminderResult.fromNumber,
             reminderResult.provider, smsText, reminderResult.messageSid]
          ).catch(e => console.error('Reminder SMS log insert failed:', e.message));

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

// ── Monthly Google review raffle — runs at 9am on the 1st of each month ───────
// Draws one winner from the prior month's review-link clickers and texts the
// whole pool (winner gets the GBP incentive reward; everyone else a consolation).
const { runMonthlyRaffles } = require('./utils/reviewRaffle');
cron.schedule('0 9 1 * *', () => runMonthlyRaffles(), { timezone: 'America/New_York' });

// ── Stripe reconcile — nightly at 4am ────────────────────────────────────────
// Webhooks fire once and can be missed; this is the safety net that keeps
// "who is actually paying" on the internal dashboard true.
cron.schedule('0 4 * * *', async () => {
  try {
    const { reconcileAllSubscriptions } = require('./utils/stripeReconcile');
    await reconcileAllSubscriptions();
  } catch (err) {
    console.error('Nightly Stripe reconcile error:', err.message);
  }
});

// ── Discovery call reminders — 24 hours and 2 hours out ──────────────────────
// Each window is one-shot per call via its own flag, so a late run or a restart
// can't double-text a prospect. Rescheduling clears the flags to re-arm them.
cron.schedule('*/10 * * * *', async () => {
  const { sendDiscoverySMS, reminder24hSMS, reminder2hSMS } = require('./utils/discoveryNotify');
  const windows = [
    { flag: 'reminder_24h_sent', low: '23 hours', high: '25 hours', build: reminder24hSMS, label: '24h' },
    { flag: 'reminder_2h_sent',  low: '90 minutes', high: '150 minutes', build: reminder2hSMS, label: '2h' },
  ];

  for (const w of windows) {
    try {
      const due = await pool.query(
        `SELECT dc.*, tm.name AS rep_name
         FROM discovery_calls dc
         LEFT JOIN sorce_team_members tm ON tm.id = dc.assigned_to
         WHERE dc.status = 'scheduled'
           AND dc.${w.flag} = false
           AND dc.phone IS NOT NULL
           AND dc.scheduled_at BETWEEN NOW() + INTERVAL '${w.low}' AND NOW() + INTERVAL '${w.high}'`
      );
      for (const call of due.rows) {
        try {
          await sendDiscoverySMS(call.phone, w.build(call, { name: call.rep_name }));
          await pool.query(`UPDATE discovery_calls SET ${w.flag} = true WHERE id = $1`, [call.id]);
          console.log(`📅 Discovery ${w.label} reminder sent → ${call.name} (call ${call.id})`);
        } catch (err) {
          // Flag stays false so the next tick retries while still inside the window.
          console.error(`⚠️ Discovery ${w.label} reminder failed (call ${call.id}):`, err.message);
        }
      }
    } catch (err) {
      console.error(`Discovery ${w.label} reminder sweep error:`, err.message);
    }
  }
});

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
  // Mode mismatches between the API key and the webhook secrets are silent and
  // brutal: a test key produces test-mode events, which a live signing secret
  // rejects, so checkouts appear to work while nothing is ever recorded. Say so.
  (() => {
    const key = process.env.STRIPE_SECRET_KEY || '';
    if (!key) return console.log('💳 Stripe: Not configured');

    const mode = key.startsWith('sk_live_') ? 'LIVE' : key.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN';
    console.log(`💳 Stripe: Ready — API key is ${mode}`);

    if (mode === 'TEST') {
      console.warn(
        '⚠️ STRIPE_SECRET_KEY is a TEST key. Checkout sessions, customers and ' +
        'subscriptions are all test-mode — no real money will be collected, and ' +
        'this applies to customer Connect payments too.'
      );
    }
    if (mode === 'TEST' && !process.env.STRIPE_WEBHOOK_SECRET_TEST) {
      console.warn(
        '⚠️ Running a TEST key with no STRIPE_WEBHOOK_SECRET_TEST. Test-mode events ' +
        'are signed by the sandbox endpoint, so they will fail signature verification ' +
        'and every billing webhook will 400.'
      );
    }
    const pk = process.env.STRIPE_PUBLIC_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
    if (pk && mode !== 'UNKNOWN') {
      const pkMode = pk.startsWith('pk_live_') ? 'LIVE' : pk.startsWith('pk_test_') ? 'TEST' : 'UNKNOWN';
      if (pkMode !== 'UNKNOWN' && pkMode !== mode) {
        console.warn(`⚠️ Stripe key mismatch: secret key is ${mode} but publishable key is ${pkMode}.`);
      }
    }
  })();
});

module.exports = app;




