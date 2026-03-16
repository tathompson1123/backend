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
const serviceCategoryRoutes = require('./routes/service-categories');
const bookingWidgetConfigRoutes = require('./routes/booking-widget-config');
const employeeRoutes = require('./routes/employees');
const websiteRoutes = require('./routes/website');
const aiAgentRoutes = require('./routes/ai-agents');
const reviewRoutes = require('./routes/reviews');
const smsRoutes = require('./routes/sms');
const smsTelnyxRoutes = require('./routes/sms-telnyx');
const marketResearchRoutes = require('./routes/market-research');
const chatRoutes = require('./routes/chat');
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
app.use('/api/services', serviceRoutes);
app.use('/api/service-categories', serviceCategoryRoutes);
app.use('/api/booking-widget-config', bookingWidgetConfigRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/website', websiteRoutes);
app.use('/api/agents', aiAgentRoutes);
app.use('/api/google-business', reviewRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/sms-telnyx', smsTelnyxRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/market-research', marketResearchRoutes);
app.use('/api/chat', embedCors, chatRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/user', userRoutes);
app.use('/api/review-config', reviewConfigRoutes);

const gbpAnalyzerRoutes = require('./routes/gbp-analyzer');
app.use('/api/gbp-analyzer', gbpAnalyzerRoutes);

const businessHoursRoutes = require('./routes/business-hours');
app.use('/api/business-hours', businessHoursRoutes);

const businessInfoRoutes = require('./routes/business-info');
app.use('/api/business-info', businessInfoRoutes);

const employeeAuthRoutes = require('./routes/employee-auth');
const employeeApiRoutes = require('./routes/employee-api');
app.use('/api/employee-auth', employeeAuthRoutes);
app.use('/api/employee', employeeApiRoutes);

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

// External form webhook — open CORS (called from Wix, Squarespace, Zapier etc.)
const webhookRoutes = require('./routes/webhooks');
app.use('/api/webhooks', embedCors, webhookRoutes);

// Email marketing campaigns
const emailCampaignRoutes = require('./routes/email-campaigns');
app.use('/api/email-campaigns', emailCampaignRoutes);

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
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS telnyx_phone_number VARCHAR(20)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS telnyx_order_id VARCHAR(100)');
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor VARCHAR(20)");
    await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor_payment_id VARCHAR(255)");
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
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_tax_rate DECIMAL(5,4) DEFAULT 0");
    await pool.query("ALTER TABLE estimates ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]'::jsonb");
    await pool.query("ALTER TABLE estimates ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb");
    await pool.query(`CREATE TABLE IF NOT EXISTS invoice_items_catalog (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(20) DEFAULT 'fee',
      amount_type VARCHAR(10) DEFAULT 'fixed',
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('✅ SMS scheduling columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify sms_scheduled_at column:', e.message);
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
    console.log('✅ sms_messages columns verified');
  } catch (e) {
    console.warn('⚠️ Could not verify sms_messages booking_id:', e.message);
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
})();

// ── SMS processing cron job ──────────────────────────────
// Runs every 30 seconds. Picks up leads in 'sms_pending' status
// whose sms_scheduled_at has passed, sends the SMS via Twilio or Telnyx,
// and updates the lead status. Survives server restarts.
const cron = require('node-cron');
const { sendSMS } = require('./utils/twilio');
const { sendSMSTelnyx } = require('./utils/telnyx');

// Helper: send SMS using whichever provider the user has a number on
async function sendSMSAuto(to, message, userId) {
  const userRow = await pool.query(
    'SELECT telnyx_phone_number, twilio_phone_number FROM users WHERE id = $1',
    [userId]
  );
  const u = userRow.rows[0];
  if (u?.telnyx_phone_number) {
    const result = await sendSMSTelnyx(to, message, u.telnyx_phone_number);
    return { messageSid: result.messageId, provider: 'telnyx' };
  }
  if (u?.twilio_phone_number) {
    const result = await sendSMS(to, message, userId);
    return { messageSid: result.messageSid, provider: 'twilio' };
  }
  throw new Error(`No SMS phone number assigned to user ${userId}`);
}

cron.schedule('*/30 * * * * *', async () => {
  try {
    const pending = await pool.query(
      `SELECT l.*, u.twilio_phone_number, u.telnyx_phone_number
       FROM leads l
       JOIN users u ON u.id = l.user_id
       WHERE l.status = 'sms_pending'
         AND l.sms_scheduled_at IS NOT NULL
         AND l.sms_scheduled_at <= NOW()
         AND (u.twilio_phone_number IS NOT NULL OR u.telnyx_phone_number IS NOT NULL)`
    );

    for (const lead of pending.rows) {
      try {
        // Check monthly SMS limit for this user's plan
        const planRow = await pool.query('SELECT plan FROM users WHERE id = $1', [lead.user_id]);
        const userPlan = planRow.rows[0]?.plan;
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

        const smsResult = await sendSMSAuto(lead.phone, personalizedSms, lead.user_id);

        await pool.query(
          `INSERT INTO sms_messages (lead_id, user_id, direction, to_number, message, twilio_message_sid, created_at)
           VALUES ($1, $2, 'outgoing', $3, $4, $5, CURRENT_TIMESTAMP)`,
          [lead.id, lead.user_id, lead.phone, personalizedSms, smsResult.messageSid]
        );

        await pool.query(
          `UPDATE leads SET status = 'contacted_sms', last_contact_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [lead.id]
        );

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
              u.business_name, u.telnyx_phone_number, u.twilio_phone_number,
              rc.message_template, rc.incentive, rc.incentive_enabled
       FROM review_requests rr
       JOIN users u ON u.id = rr.user_id
       JOIN customers c ON c.id = rr.customer_id
       LEFT JOIN review_configs rc ON rc.user_id = rr.user_id
       WHERE rr.status = 'pending'
         AND rr.sms_sent = false
         AND c.phone IS NOT NULL
         AND rr.scheduled_send_time <= NOW()
         AND (u.telnyx_phone_number IS NOT NULL OR u.twilio_phone_number IS NOT NULL)`
    );

    for (const req of pending.rows) {
      try {
        // Check monthly SMS limit
        const planRow = await pool.query('SELECT plan FROM users WHERE id = $1', [req.user_id]);
        const userPlan = planRow.rows[0]?.plan;
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

        // Build message from template
        const defaultTemplate = "Hi {name}! Thank you for choosing {business}. We'd love to hear about your experience with {service}! Could you take a moment to leave us a review?";
        let message = (req.message_template || defaultTemplate)
          .replace(/\{name\}/g, req.customer_name || 'there')
          .replace(/\{business\}/g, req.business_name || 'us')
          .replace(/\{service\}/g, req.service_name || 'our service');

        if (req.incentive_enabled && req.incentive_code) {
          message += ` Use code ${req.incentive_code} for ${req.incentive || '$10 off your next service'}!`;
        }

        // Format phone number for sending
        const toPhone = req.customer_phone.startsWith('+') ? req.customer_phone : `+1${req.customer_phone.replace(/\D/g, '')}`;
        const smsResult = await sendSMSAuto(toPhone, message, req.user_id);

        await pool.query(
          `INSERT INTO sms_messages (user_id, direction, to_number, message, twilio_message_sid, created_at)
           VALUES ($1, 'outgoing', $2, $3, $4, CURRENT_TIMESTAMP)`,
          [req.user_id, toPhone, message, smsResult.messageSid]
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

// ── Email campaign cron job ──────────────────────────────
// Runs every hour. Checks if any user has a campaign scheduled for this day+hour.
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
        console.log(`📧 Email campaign cron: generating for user ${config.user_id}`);
        const generated = await generateCampaign(config.user_id, config);

        const saved = await pool.query(
          `INSERT INTO email_campaigns (user_id, subject, preview_text, body_html, body_text, status, scheduled_for, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW()) RETURNING id`,
          [config.user_id, generated.subject, generated.previewText, generated.bodyHtml, generated.bodyText]
        );
        const campaignId = saved.rows[0].id;

        const result = await sendCampaign(config.user_id, config, campaignId);
        console.log(`✅ Email campaign sent: ${result.sent} emails for user ${config.user_id} — "${generated.subject}"`);
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Database: ${pool ? 'Connected' : 'Not connected'}`);
  console.log(`📱 Twilio: ${process.env.TWILIO_ACCOUNT_SID ? 'Ready' : 'Not configured'}`);
  console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? 'Ready' : 'Not configured'}`);
  console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Ready' : 'Not configured'}`);
});

module.exports = app;




