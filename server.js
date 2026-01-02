// server-review-automation.js - Complete Review Automation System
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// Twilio setup
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// SendGrid setup
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Middleware
app.set('trust proxy', 1);
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      /\.vercel\.app$/,
      'http://localhost:5173',
      'http://localhost:3000'
    ];
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(pattern => {
      if (pattern instanceof RegExp) return pattern.test(origin);
      return pattern === origin;
    });
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// ============================================
// HELPER FUNCTIONS
// ============================================

// Generate unique incentive code
function generateIncentiveCode() {
  return 'REVIEW' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Create short review link (you can use bit.ly API later)
function createReviewLink(placeId, incentiveCode) {
  const googleReviewUrl = `https://search.google.com/local/writereview?placeid=${placeId}`;
  // For now, return Google URL directly. Later: integrate bit.ly for tracking
  return googleReviewUrl;
}

// ============================================
// SERVICES ENDPOINTS
// ============================================

// Get all services for a user
app.get('/api/services', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const result = await pool.query(
      'SELECT * FROM services WHERE user_id = $1 AND active = true ORDER BY name',
      [userId]
    );

    res.json({ services: result.rows });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// Create new service
app.post('/api/services', async (req, res) => {
  try {
    const { userId, name, description, durationHours, price } = req.body;

    if (!userId || !name || !durationHours || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO services (user_id, name, description, duration_hours, price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, name, description, durationHours, price]
    );

    res.json({ service: result.rows[0] });
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// Update service
app.put('/api/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, durationHours, price, active } = req.body;

    const result = await pool.query(
      `UPDATE services 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           duration_hours = COALESCE($3, duration_hours),
           price = COALESCE($4, price),
           active = COALESCE($5, active)
       WHERE id = $6
       RETURNING *`,
      [name, description, durationHours, price, active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ service: result.rows[0] });
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// ============================================
// CUSTOMERS ENDPOINTS
// ============================================

// Get all customers for a user
app.get('/api/customers', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const result = await pool.query(
      'SELECT * FROM customers WHERE user_id = $1 ORDER BY name',
      [userId]
    );

    res.json({ customers: result.rows });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// Create new customer
app.post('/api/customers', async (req, res) => {
  try {
    const { userId, name, email, phone, notes } = req.body;

    if (!userId || !name) {
      return res.status(400).json({ error: 'userId and name required' });
    }

    const result = await pool.query(
      `INSERT INTO customers (user_id, name, email, phone, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, name, email, phone, notes]
    );

    res.json({ customer: result.rows[0] });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// ============================================
// JOBS ENDPOINTS
// ============================================

// Get all jobs for a user
app.get('/api/jobs', async (req, res) => {
  try {
    const { userId, status } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    let query = `
      SELECT j.*, c.name as customer_name, c.email, c.phone, s.name as service_name
      FROM jobs j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN services s ON j.service_id = s.id
      WHERE j.user_id = $1
    `;
    
    const params = [userId];

    if (status) {
      query += ' AND j.status = $2';
      params.push(status);
    }

    query += ' ORDER BY j.scheduled_start DESC';

    const result = await pool.query(query, params);

    res.json({ jobs: result.rows });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Create new job
app.post('/api/jobs', async (req, res) => {
  try {
    const { userId, customerId, serviceId, scheduledStart, notes } = req.body;

    if (!userId || !customerId || !serviceId || !scheduledStart) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get service details
    const serviceResult = await pool.query(
      'SELECT name, duration_hours, price FROM services WHERE id = $1',
      [serviceId]
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = serviceResult.rows[0];
    const scheduledStartDate = new Date(scheduledStart);
    const calculatedEnd = new Date(scheduledStartDate.getTime() + (service.duration_hours * 60 * 60 * 1000));

    // Create job
    const result = await pool.query(
      `INSERT INTO jobs (user_id, customer_id, service_id, service_name, scheduled_start, duration_hours, calculated_end, price, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, customerId, serviceId, service.name, scheduledStart, service.duration_hours, calculatedEnd, service.price, notes]
    );

    // Create review request (scheduled)
    await createReviewRequest(result.rows[0]);

    res.json({ job: result.rows[0] });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// Mark job as complete
app.post('/api/jobs/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE jobs 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Update customer stats
    await pool.query(
      'UPDATE customers SET total_jobs = total_jobs + 1 WHERE id = $1',
      [result.rows[0].customer_id]
    );

    res.json({ job: result.rows[0] });
  } catch (error) {
    console.error('Error completing job:', error);
    res.status(500).json({ error: 'Failed to complete job' });
  }
});

// ============================================
// REVIEW REQUEST SYSTEM
// ============================================

// Create review request when job is created
async function createReviewRequest(job) {
  try {
    // Get user settings
    const userResult = await pool.query(
      'SELECT review_buffer_hours, google_place_id FROM users WHERE id = $1',
      [job.user_id]
    );

    if (userResult.rows.length === 0) return;

    const user = userResult.rows[0];
    const bufferHours = user.review_buffer_hours || 1;

    // Calculate send time: job end + buffer
    const scheduledSendTime = new Date(job.calculated_end.getTime() + (bufferHours * 60 * 60 * 1000));

    const incentiveCode = generateIncentiveCode();

    await pool.query(
      `INSERT INTO review_requests (job_id, user_id, customer_id, scheduled_send_time, incentive_code, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [job.id, job.user_id, job.customer_id, scheduledSendTime, incentiveCode]
    );

    console.log(`✅ Review request scheduled for job ${job.id} at ${scheduledSendTime}`);
  } catch (error) {
    console.error('Error creating review request:', error);
  }
}

// Send review request (SMS + Email)
async function sendReviewRequest(reviewRequest) {
  try {
    // Get job, customer, and user details
    const result = await pool.query(
      `SELECT 
        rr.*, 
        j.service_name,
        c.name as customer_name, c.email, c.phone,
        u.business_name, u.google_place_id, u.review_incentive, u.sms_enabled, u.email_enabled, u.twilio_phone
       FROM review_requests rr
       JOIN jobs j ON rr.job_id = j.id
       JOIN customers c ON rr.customer_id = c.id
       JOIN users u ON rr.user_id = u.id
       WHERE rr.id = $1`,
      [reviewRequest.id]
    );

    if (result.rows.length === 0) {
      console.error('Review request not found:', reviewRequest.id);
      return;
    }

    const data = result.rows[0];
    const reviewLink = createReviewLink(data.google_place_id, data.incentive_code);

    let smsSent = false;
    let emailSent = false;
    let smsError = null;
    let emailError = null;

    // Send SMS
    if (data.sms_enabled && data.phone && twilioClient) {
      try {
        const smsMessage = `Hi ${data.customer_name}! Thanks for choosing ${data.business_name} for ${data.service_name}!\n\nLove our work? Leave a Google review & get ${data.review_incentive}:\n${reviewLink}`;

        await twilioClient.messages.create({
          body: smsMessage,
          from: data.twilio_phone,
          to: data.phone
        });

        smsSent = true;
        console.log(`📱 SMS sent to ${data.customer_name}`);
      } catch (error) {
        smsError = error.message;
        console.error('SMS error:', error);
      }
    }

    // Send Email
    if (data.email_enabled && data.email && sgMail) {
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #10b981;">Thank You, ${data.customer_name}!</h1>
            <p>We hope you loved our ${data.service_name} service!</p>
            <p>Would you mind taking a moment to leave us a Google review? As a thank you, we'll give you:</p>
            <div style="background: #f0fdf4; padding: 20px; border-radius: 10px; margin: 20px 0;">
              <h2 style="color: #059669; margin: 0;">${data.review_incentive}</h2>
            </div>
            <p style="text-align: center;">
              <a href="${reviewLink}" style="display: inline-block; background: #10b981; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 18px;">
                Leave a Review
              </a>
            </p>
            <p style="font-size: 14px; color: #666; margin-top: 30px;">
              Use code: <strong>${data.incentive_code}</strong> on your next booking!
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            <p style="font-size: 12px; color: #666;">
              ${data.business_name}<br>
              This is an automated message. Please don't reply to this email.
            </p>
          </div>
        `;

        await sgMail.send({
          to: data.email,
          from: process.env.SENDGRID_FROM_EMAIL || 'noreply@sorce.com',
          subject: `Thanks for choosing ${data.business_name}! 🌟`,
          html: emailHtml
        });

        emailSent = true;
        console.log(`📧 Email sent to ${data.customer_name}`);
      } catch (error) {
        emailError = error.message;
        console.error('Email error:', error);
      }
    }

    // Update review request status
    await pool.query(
      `UPDATE review_requests
       SET actual_send_time = CURRENT_TIMESTAMP,
           sms_sent = $1,
           sms_sent_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
           sms_error = $2,
           email_sent = $3,
           email_sent_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,
           email_error = $4,
           status = CASE WHEN $1 OR $3 THEN 'sent' ELSE 'failed' END
       WHERE id = $5`,
      [smsSent, smsError, emailSent, emailError, reviewRequest.id]
    );

    // Update analytics
    const today = new Date().toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO review_analytics (user_id, date, requests_sent, sms_sent, emails_sent)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (user_id, date) 
       DO UPDATE SET 
         requests_sent = review_analytics.requests_sent + 1,
         sms_sent = review_analytics.sms_sent + $3,
         emails_sent = review_analytics.emails_sent + $4`,
      [data.user_id, today, smsSent ? 1 : 0, emailSent ? 1 : 0]
    );

  } catch (error) {
    console.error('Error sending review request:', error);
  }
}

// Cron job: Check for pending review requests every minute
cron.schedule('* * * * *', async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM review_requests
       WHERE status = 'pending'
       AND scheduled_send_time <= CURRENT_TIMESTAMP
       LIMIT 10`
    );

    for (const reviewRequest of result.rows) {
      await sendReviewRequest(reviewRequest);
    }

    if (result.rows.length > 0) {
      console.log(`✅ Processed ${result.rows.length} review requests`);
    }
  } catch (error) {
    console.error('Cron job error:', error);
  }
});

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

// Get review analytics for a user
app.get('/api/analytics/reviews', async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // Get aggregated stats
    const statsResult = await pool.query(
      `SELECT 
        COALESCE(SUM(requests_sent), 0) as total_sent,
        COALESCE(SUM(sms_sent), 0) as total_sms,
        COALESCE(SUM(emails_sent), 0) as total_emails,
        COALESCE(SUM(links_clicked), 0) as total_clicked,
        COALESCE(SUM(reviews_completed), 0) as total_reviewed,
        ROUND(AVG(click_rate), 2) as avg_click_rate,
        ROUND(AVG(review_rate), 2) as avg_review_rate
       FROM review_analytics
       WHERE user_id = $1
       ${startDate ? 'AND date >= $2' : ''}
       ${endDate ? 'AND date <= $3' : ''}`,
      [userId, startDate, endDate].filter(Boolean)
    );

    // Get daily breakdown
    const dailyResult = await pool.query(
      `SELECT * FROM review_analytics
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 30`,
      [userId]
    );

    res.json({
      summary: statsResult.rows[0],
      daily: dailyResult.rows
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: pool ? 'connected' : 'disconnected',
      twilio: twilioClient ? 'configured' : 'not configured',
      sendgrid: process.env.SENDGRID_API_KEY ? 'configured' : 'not configured'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Database: ${pool ? 'Connected' : 'Not connected'}`);
  console.log(`📱 Twilio: ${twilioClient ? 'Ready' : 'Not configured'}`);
  console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? 'Ready' : 'Not configured'}`);
  console.log(`⏰ Cron scheduler: Active (checking every minute)`);
});
