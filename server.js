const rateLimit = require('express-rate-limit'); 
const { buildVisualSupremacyPrompt } = require('./visual_supremacy_prompt');
const helmet = require('helmet'); 
const { body, query, param, validationResult } = require('express-validator');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getRecommendedTemplate, getTemplateInfo } = require('./templates-enhanced.js');
const path = require('path');
const fs = require('fs');
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

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-fallback-secret-change-me';


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

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { error: 'AI generation limit reached' }
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/generate', aiLimiter);
app.use('/api/website/ai-edit', aiLimiter);

// ============================================
// HELPER FUNCTIONS
// ============================================

// Add this function to handle customer creation/update
async function updateCustomerFromBooking(booking, userId) {
  try {
    // Check if customer exists
    let customer = await pool.query(
      'SELECT * FROM customers WHERE user_id = $1 AND (email = $2 OR phone = $3)',
      [userId, booking.customer_email, booking.customer_phone]
    );

    if (customer.rows.length === 0) {
      // Create new customer
      await pool.query(
        `INSERT INTO customers (user_id, name, email, phone, last_service, last_service_date, total_jobs, lifetime_value, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, CURRENT_TIMESTAMP)`,
        [
          userId,
          booking.customer_name,
          booking.customer_email,
          booking.customer_phone,
          booking.items?.[0]?.service_name || 'Service',
          booking.booking_date,
          booking.total_amount
        ]
      );
      console.log(`✅ New customer created: ${booking.customer_name}`);
    } else {
      // Update existing customer
      const customerId = customer.rows[0].id;
      const newTotalJobs = (customer.rows[0].total_jobs || 0) + 1;
      const newLifetimeValue = (customer.rows[0].lifetime_value || 0) + parseFloat(booking.total_amount || 0);

      await pool.query(
        `UPDATE customers 
         SET last_service = $1, 
             last_service_date = $2, 
             total_jobs = $3, 
             lifetime_value = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [
          booking.items?.[0]?.service_name || 'Service',
          booking.booking_date,
          newTotalJobs,
          newLifetimeValue,
          customerId
        ]
      );
      console.log(`✅ Customer updated: ${booking.customer_name}`);
    }
  } catch (error) {
    console.error('Error updating customer from booking:', error);
  }
}

// Add this to your POST /api/bookings endpoint (after booking is created)
app.post('/api/bookings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const bookingData = req.body;

    // ... existing booking creation code ...

    const result = await pool.query(/* your insert query */);
    const newBooking = result.rows[0];

    // 🆕 ADD THIS: Automatically create/update customer
    await updateCustomerFromBooking(newBooking, userId);

    res.json({ success: true, booking: newBooking });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Also add to PUT /api/bookings/:id/complete endpoint
app.put('/api/bookings/:id/complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Get booking details
    const bookingResult = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // Update booking status
    await pool.query(
      'UPDATE bookings SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['completed', id]
    );

    // 🆕 ADD THIS: Update customer when booking is completed
    await updateCustomerFromBooking(booking, userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error completing booking:', error);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

// Generate incentive code
function generateIncentiveCode() {
  return 'REVIEW' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Create review link
function createReviewLink(placeId, incentiveCode) {
  return `https://search.google.com/local/writereview?placeid=${placeId}`;
}

// OPTIMIZED: Initialize review request sequence when booking is completed
// 1 SMS (immediate) + 4 Emails (follow-ups) = 50% cost savings
async function initializeReviewSequence(booking) {
  try {
    const userResult = await pool.query(
      'SELECT google_review_link, business_name FROM users WHERE id = $1',
      [booking.user_id]
    );

    if (userResult.rows.length === 0) {
      console.log('User not found for booking:', booking.id);
      return;
    }

    const user = userResult.rows[0];
    
    const reviewLink = user.google_review_link;
    if (!reviewLink) {
      console.log('⚠️ No Google review link set for user:', booking.user_id);
      console.log('   Review sequence skipped. Please add review link in Google Business Settings.');
      return;
    }

    // Calculate end time of booking
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.start_time}`);
    const [endHour, endMin] = booking.end_time.split(':').map(Number);
    const bookingEndTime = new Date(bookingDateTime);
    bookingEndTime.setHours(endHour, endMin, 0, 0);

    // OPTIMIZED SCHEDULE:
    // Step 1: SMS at 2 hours (immediate, high engagement)
    // Step 2-5: All emails (free, professional)
    const step1Time = new Date(bookingEndTime.getTime() + (2 * 60 * 60 * 1000)); // +2 hours - SMS
    const step2Time = new Date(bookingEndTime.getTime() + (24 * 60 * 60 * 1000)); // +24 hours - Email
    const step3Time = new Date(bookingEndTime.getTime() + (3 * 24 * 60 * 60 * 1000)); // +3 days - Email
    const step4Time = new Date(bookingEndTime.getTime() + (5 * 24 * 60 * 60 * 1000)); // +5 days - Email
    const step5Time = new Date(bookingEndTime.getTime() + (7 * 24 * 60 * 60 * 1000)); // +7 days - Final Email

    const incentiveCode = generateIncentiveCode();

    // Create ONE sequence with all 5 steps
    await pool.query(
      `INSERT INTO review_request_sequences (
        user_id, booking_id, customer_id, incentive_code,
        step1_scheduled_time, step1_status,
        step2_scheduled_time, step2_status,
        step3_scheduled_time, step3_status,
        step4_scheduled_time, step4_status,
        step5_scheduled_time, step5_status,
        sequence_status
      )
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'pending', $7, 'pending', $8, 'pending', $9, 'pending', 'active')`,
      [
        booking.user_id,
        booking.id,
        booking.customer_id,
        incentiveCode,
        step1Time,
        step2Time,
        step3Time,
        step4Time,
        step5Time
      ]
    );

    console.log(`✅ OPTIMIZED Review sequence initialized for booking ${booking.id}`);
    console.log(`   💰 Cost Savings: 50% (1 SMS instead of 2)`);
    console.log(`   Step 1 (SMS): ${step1Time.toLocaleString()} - 2 hours after completion`);
    console.log(`   Step 2 (Email): ${step2Time.toLocaleString()} - 24 hours after`);
    console.log(`   Step 3 (Email): ${step3Time.toLocaleString()} - 3 days after`);
    console.log(`   Step 4 (Email): ${step4Time.toLocaleString()} - 5 days after`);
    console.log(`   Step 5 (Email): ${step5Time.toLocaleString()} - 7 days after (final)`);

  } catch (error) {
    console.error('Error initializing review sequence:', error);
  }
}

// OPTIMIZED: Send individual review request step
async function sendReviewRequestStep(sequence, step) {
  try {
    // Get full data
    const result = await pool.query(
      `SELECT 
        s.*,
        b.booking_date, b.start_time,
        c.name as customer_name, c.email, c.phone,
        u.business_name, u.google_review_link, u.review_incentive, 
        u.twilio_phone, u.sms_enabled, u.email_enabled
       FROM review_request_sequences s
       JOIN bookings b ON s.booking_id = b.id
       JOIN customers c ON s.customer_id = c.id
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [sequence.id]
    );

    if (result.rows.length === 0) {
      console.error('Sequence not found:', sequence.id);
      return;
    }

    const data = result.rows[0];
    const reviewLink = data.google_review_link;

    if (!reviewLink) {
      console.error('No review link for user:', data.user_id);
      return;
    }

    let success = false;
    let errorMessage = null;

    // OPTIMIZED FLOW:
    // Step 1 = SMS (immediate impact)
    // Steps 2-5 = Email (free, professional)
    const isSMS = step === 1;
    const isEmail = step >= 2 && step <= 5;

    // Send SMS (ONLY STEP 1)
    if (isSMS && data.sms_enabled && data.phone && twilioClient) {
      try {
        const smsMessage = `Hi ${data.customer_name}! Thanks for choosing ${data.business_name}! 🌟

Loved our service? Leave a quick Google review & get ${data.review_incentive || '10% off your next visit'}!

${reviewLink}

Reply STOP to opt out`;

        await twilioClient.messages.create({
          body: smsMessage,
          from: data.twilio_phone,
          to: data.phone
        });

        success = true;
        console.log(`📱 Step ${step} SMS sent to ${data.customer_name} - Strike while iron is hot!`);
      } catch (error) {
        errorMessage = error.message;
        console.error(`SMS error for step ${step}:`, error);
      }
    }

    // Send Email (STEPS 2-5)
    if (isEmail && data.email_enabled && data.email && sgMail) {
      try {
        let subject = '';
        let heading = '';
        let bodyText = '';
        let urgency = '';

        if (step === 2) {
          subject = `We'd love your feedback! - ${data.business_name}`;
          heading = `How was your experience, ${data.customer_name}?`;
          bodyText = `We hope you enjoyed our service! Your feedback means the world to us. It only takes 60 seconds to leave a Google review, and you'll get a special thank you from us!`;
          urgency = 'Take a moment today to share your thoughts! ⭐';
        } else if (step === 3) {
          subject = `Quick reminder: Share your experience - ${data.business_name}`;
          heading = `Still time to claim your reward!`;
          bodyText = `We wanted to follow up and see if you'd be willing to leave us a quick Google review. Your feedback helps us improve and helps others find great service like you did!`;
          urgency = 'Leave a review this week and save on your next visit! 💰';
        } else if (step === 4) {
          subject = `Don't miss out on your special offer! - ${data.business_name}`;
          heading = `Your reward is waiting, ${data.customer_name}!`;
          bodyText = `We noticed you haven't left a review yet. No worries! You still have time to share your experience and claim your special offer. We'd genuinely love to hear from you.`;
          urgency = 'Offer expires soon - review today! ⏰';
        } else if (step === 5) {
          subject = `Final chance: Your exclusive discount expires soon! - ${data.business_name}`;
          heading = `Last call, ${data.customer_name}! 🔔`;
          bodyText = `This is your final reminder to leave a Google review and claim your exclusive offer. We truly appreciate your business and would love to hear your thoughts. After this, the offer expires!`;
          urgency = '⚠️ FINAL REMINDER - Claim your reward today!';
        }

        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%); padding: 40px 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">${heading}</h1>
              </div>
              
              <!-- Body -->
              <div style="padding: 40px 30px;">
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  ${bodyText}
                </p>
                
                <!-- Urgency Banner -->
                ${step >= 4 ? `
                <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; border-left: 4px solid #f59e0b;">
                  <p style="color: #92400e; font-size: 15px; margin: 0; font-weight: 600;">
                    ${urgency}
                  </p>
                </div>
                ` : ''}
                
                <!-- Incentive Box -->
                <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 30px; border-radius: 12px; margin: 30px 0; text-align: center; border: 2px solid #10b981;">
                  <p style="color: #059669; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">YOUR REWARD</p>
                  <h2 style="color: #047857; margin: 0; font-size: 32px; font-weight: bold;">${data.review_incentive || '10% Off Next Visit'}</h2>
                  <p style="color: #059669; font-size: 14px; margin: 10px 0 0 0;">Use code: <strong>${data.incentive_code}</strong></p>
                </div>
                
                <!-- CTA Button -->
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${reviewLink}" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%); color: #ffffff; padding: 18px 50px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    Leave Your Review ⭐
                  </a>
                </div>
                
                <p style="color: #6b7280; font-size: 14px; line-height: 1.6; text-align: center; margin-top: 30px;">
                  ${step === 5 ? '⚠️ This is your last chance to claim this exclusive offer!' : 'It only takes 60 seconds and helps us serve you better!'}
                </p>

                ${step >= 3 ? `
                <div style="margin-top: 30px; padding: 20px; background-color: #f9fafb; border-radius: 8px; text-align: center;">
                  <p style="color: #6b7280; font-size: 13px; margin: 0;">
                    <strong>Prefer to chat instead?</strong><br>
                    Reply to this email or text us at ${data.twilio_phone || 'our business number'}
                  </p>
                </div>
                ` : ''}
              </div>
              
              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
                  ${data.business_name}
                </p>
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                  You're receiving this because you recently used our services.<br>
                  <a href="#" style="color: #9ca3af; text-decoration: underline;">Unsubscribe</a>
                </p>
              </div>
            </div>
          </body>
          </html>
        `;

        await sgMail.send({
          to: data.email,
          from: process.env.SENDGRID_FROM_EMAIL || 'noreply@yourbusiness.com',
          subject: subject,
          html: emailHtml
        });

        success = true;
        console.log(`📧 Step ${step} Email sent to ${data.customer_name} - ${subject}`);
      } catch (error) {
        errorMessage = error.message;
        console.error(`Email error for step ${step}:`, error);
      }
    }

    // Update database
    const updateFields = {
      sent_time: 'CURRENT_TIMESTAMP',
      status: success ? 'sent' : 'failed',
      error: errorMessage || null
    };

    if (isSMS) {
      updateFields.sms_sent = success;
    }
    if (isEmail) {
      updateFields.email_sent = success;
    }

    const setClause = Object.keys(updateFields)
      .map((key, idx) => {
        if (key === 'sent_time') {
          return `step${step}_sent_time = ${updateFields[key]}`;
        } else if (key === 'status') {
          return `step${step}_status = $${idx + 1}`;
        } else if (key === 'error') {
          return `step${step}_error = $${idx + 1}`;
        } else if (key === 'sms_sent') {
          return `step${step}_sms_sent = $${idx + 1}`;
        } else if (key === 'email_sent') {
          return `step${step}_email_sent = $${idx + 1}`;
        }
      })
      .join(', ');

    const values = Object.values(updateFields).filter(v => v !== 'CURRENT_TIMESTAMP');

    await pool.query(
      `UPDATE review_request_sequences SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length + 1}`,
      [...values, sequence.id]
    );

    console.log(`✅ Step ${step} processed for sequence ${sequence.id} (${isSMS ? 'SMS' : 'Email'})`);

  } catch (error) {
    console.error(`Error sending step ${step}:`, error);
  }
}

module.exports = {
  initializeReviewSequence,
  sendReviewRequestStep
};

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

function requirePlan(requiredPlan) {
  return async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query('SELECT plan FROM users WHERE id = $1', [userId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userPlan = result.rows[0].plan;

      // If user has no plan, they must subscribe
      if (!userPlan) {
        return res.status(403).json({ 
          error: 'Subscription required',
          message: 'Please choose a plan to access this feature.',
          requiredPlan: requiredPlan,
          currentPlan: null,
          upgradeUrl: '/dashboard?view=billing'
        });
      }
      
      // Plan hierarchy: basic < pro < expert
      const planLevels = { 
        'basic': 0, 
        'pro': 1, 
        'expert': 2 
      };
      
      const userLevel = planLevels[userPlan] || 0;
      const requiredLevel = planLevels[requiredPlan] || 0;
      
      if (userLevel < requiredLevel) {
        return res.status(403).json({ 
          error: 'Upgrade required',
          message: 'This feature requires a ' + requiredPlan + ' plan. You are currently on ' + userPlan + '.',
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
     // XSS Prevention - use this when outputting user data to HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sanitize for AI prompts
function sanitizeForPrompt(str) {
  if (!str) return '';
  return String(str)
    .replace(/</g, '')
    .replace(/>/g, '')
    .replace(/\$/g, '')
    .replace(/`/g, "'")
    .trim()
    .substring(0, 5000);
}

// Standardized responses
function sendError(res, status, message, details = null) {
  const response = { success: false, error: message };
  if (details && process.env.NODE_ENV !== 'production') {
    response.details = details;
  }
  return res.status(status).json(response);
}

function sendSuccess(res, data, message = null) {
  return res.json({ success: true, ...(message && { message }), ...data });
}

// Validation handler
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(res, 400, 'Validation failed', errors.array());
  }
  next();
}

function generateIncentiveCode() {
  return 'REVIEW' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createReviewLink(placeId, incentiveCode) {
  const googleReviewUrl = `https://search.google.com/local/writereview?placeid=${placeId}`;
  return googleReviewUrl;
}

function generateTimeSlots(openTime, closeTime, serviceDuration, interval, buffer) {
  const slots = [];
  const [openHour, openMin] = openTime.split(':').map(Number);
  const [closeHour, closeMin] = closeTime.split(':').map(Number);

  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;
  const durationMinutes = serviceDuration * 60;

  for (let minutes = openMinutes; minutes + durationMinutes <= closeMinutes; minutes += interval) {
    const startHour = Math.floor(minutes / 60);
    const startMin = minutes % 60;
    const endMinutes = minutes + durationMinutes;
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;

    slots.push({
      start: `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`,
      end: `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`,
      duration: serviceDuration
    });
  }

  return slots;
}

function hasConflict(slot, existingBookings, buffer) {
  const [slotStartHour, slotStartMin] = slot.start.split(':').map(Number);
  const [slotEndHour, slotEndMin] = slot.end.split(':').map(Number);
  
  const slotStart = slotStartHour * 60 + slotStartMin;
  const slotEnd = slotEndHour * 60 + slotEndMin;

  for (const booking of existingBookings) {
    const [bookStartHour, bookStartMin] = booking.start_time.split(':').map(Number);
    const [bookEndHour, bookEndMin] = booking.end_time.split(':').map(Number);
    
    const bookStart = bookStartHour * 60 + bookStartMin - buffer;
    const bookEnd = bookEndHour * 60 + bookEndMin + buffer;

    if (slotStart < bookEnd && slotEnd > bookStart) {
      return true;
    }
  }

  return false;
}

// GET - Public services list
app.get('/api/public/services', async (req, res) => {
  try {
    const { businessId } = req.query;
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId required' });
    }

    const result = await pool.query(
      'SELECT id, name, description, duration_hours, price FROM services WHERE user_id = $1 AND active = true ORDER BY name',
      [businessId]
    );

    res.json({ services: result.rows });
  } catch (error) {
    console.error('Error fetching public services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// GET - Public employees list
app.get('/api/public/employees', async (req, res) => {
  try {
    const { businessId } = req.query;
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId required' });
    }

    const result = await pool.query(
      'SELECT id, name, color FROM employees WHERE user_id = $1 AND active = true ORDER BY name',
      [businessId]
    );

    res.json({ employees: result.rows });
  } catch (error) {
    console.error('Error fetching public employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// GET - Public groups list
app.get('/api/public/groups', async (req, res) => {
  try {
    const { businessId } = req.query;
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId required' });
    }

    const result = await pool.query(
      'SELECT id, name, employee_ids FROM groups WHERE user_id = $1 ORDER BY name',
      [businessId]
    );

    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Error fetching public groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// GET - Public business hours
app.get('/api/public/business-hours', async (req, res) => {
  try {
    const { businessId } = req.query;
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId required' });
    }

    const result = await pool.query(
      'SELECT day_of_week, is_open, open_time, close_time FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
      [businessId]
    );

    res.json({ businessHours: result.rows });
  } catch (error) {
    console.error('Error fetching public business hours:', error);
    res.status(500).json({ error: 'Failed to fetch business hours' });
  }
});

// GET - Public business info
app.get('/api/public/business-info', async (req, res) => {
  try {
    const { businessId } = req.query;
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId required' });
    }

    const result = await pool.query(
      'SELECT business_name, email FROM users WHERE id = $1',
      [businessId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json({ business: result.rows[0] });
  } catch (error) {
    console.error('Error fetching public business info:', error);
    res.status(500).json({ error: 'Failed to fetch business info' });
  }
});

// GET - Public availability (available time slots)
app.get('/api/public/availability', async (req, res) => {
  try {
    const { businessId, serviceIds, date } = req.query;
    
    if (!businessId || !serviceIds || !date) {
      return res.status(400).json({ error: 'businessId, serviceIds, and date required' });
    }

    // Parse service IDs
    const serviceIdArray = serviceIds.split(',').map(id => parseInt(id));
    
    // Get total duration for all selected services
    const servicesResult = await pool.query(
      `SELECT SUM(duration_hours) as total_duration 
       FROM services 
       WHERE id = ANY($1)`,
      [serviceIdArray]
    );
    
    const totalDuration = parseFloat(servicesResult.rows[0].total_duration) || 1;

    // Get day of week
    const requestDate = new Date(date);
    const dayOfWeek = requestDate.getDay();

    // Get business hours for this day
    const hoursResult = await pool.query(
      'SELECT * FROM business_hours WHERE user_id = $1 AND day_of_week = $2',
      [businessId, dayOfWeek]
    );

    if (hoursResult.rows.length === 0 || !hoursResult.rows[0].is_open) {
      return res.json({ slots: [], message: 'Business closed on this day' });
    }

    const businessHours = hoursResult.rows[0];

    // Get booking settings
    const settingsResult = await pool.query(
      'SELECT * FROM booking_settings WHERE user_id = $1',
      [businessId]
    );

    const settings = settingsResult.rows[0] || {
      time_slot_interval: 30,
      buffer_time: 15
    };

    // Get all employees who can perform these services
    const employeesResult = await pool.query(
      `SELECT DISTINCT e.id
       FROM employees e
       LEFT JOIN service_employees se ON e.id = se.employee_id
       WHERE e.user_id = $1 
       AND e.active = true
       AND (
         se.service_id = ANY($2)
         OR NOT EXISTS (
           SELECT 1 FROM service_employees WHERE employee_id = e.id
         )
       )`,
      [businessId, serviceIdArray]
    );

    if (employeesResult.rows.length === 0) {
      return res.json({ slots: [], message: 'No employees available for this service' });
    }

    const availableEmployees = employeesResult.rows;

    // Get existing bookings for this date
    const bookingsResult = await pool.query(
      `SELECT employee_id, start_time, end_time 
       FROM bookings 
       WHERE user_id = $1 
       AND booking_date = $2 
       AND status NOT IN ('cancelled', 'no_show')
       AND employee_id IN (${availableEmployees.map((_, i) => `$${i + 3}`).join(',')})`,
      [businessId, date, ...availableEmployees.map(e => e.id)]
    );

    // Group bookings by employee
    const employeeBookings = {};
    availableEmployees.forEach(emp => {
      employeeBookings[emp.id] = bookingsResult.rows
        .filter(b => b.employee_id === emp.id)
        .map(b => ({
          start_time: b.start_time,
          end_time: b.end_time
        }));
    });

    // Generate time slots
    const [openHour, openMin] = businessHours.open_time.split(':').map(Number);
    const [closeHour, closeMin] = businessHours.close_time.split(':').map(Number);
    
    const openMinutes = openHour * 60 + openMin;
    const closeMinutes = closeHour * 60 + closeMin;
    const durationMinutes = totalDuration * 60;
    const interval = settings.time_slot_interval;
    const buffer = settings.buffer_time;

    const availableSlots = [];

    for (let minutes = openMinutes; minutes + durationMinutes <= closeMinutes; minutes += interval) {
      const startHour = Math.floor(minutes / 60);
      const startMin = minutes % 60;
      const endMinutes = minutes + durationMinutes;
      const endHour = Math.floor(endMinutes / 60);
      const endMin = endMinutes % 60;

      const slotStart = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
      const slotEnd = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

      // Check if any employee is available for this slot
      let hasAvailableEmployee = false;

      for (const employee of availableEmployees) {
        const employeeBookingsForDay = employeeBookings[employee.id] || [];
        let hasConflict = false;

        for (const booking of employeeBookingsForDay) {
          const [bookStartHour, bookStartMin] = booking.start_time.split(':').map(Number);
          const [bookEndHour, bookEndMin] = booking.end_time.split(':').map(Number);
          
          const bookStart = bookStartHour * 60 + bookStartMin - buffer;
          const bookEnd = bookEndHour * 60 + bookEndMin + buffer;

          if (minutes < bookEnd && endMinutes > bookStart) {
            hasConflict = true;
            break;
          }
        }

        if (!hasConflict) {
          hasAvailableEmployee = true;
          break;
        }
      }

      if (hasAvailableEmployee) {
        // Format time for display (12-hour format)
        const period = startHour >= 12 ? 'PM' : 'AM';
        const displayHour = startHour > 12 ? startHour - 12 : startHour === 0 ? 12 : startHour;
        const displayTime = `${displayHour}:${String(startMin).padStart(2, '0')} ${period}`;

        availableSlots.push({
          time: slotStart,
          displayTime: displayTime,
          availableEmployees: availableEmployees.length
        });
      }
    }

    res.json({ 
      slots: availableSlots,
      totalDuration,
      businessHours: {
        open: businessHours.open_time,
        close: businessHours.close_time
      }
    });

  } catch (error) {
    console.error('Error calculating public availability:', error);
    res.status(500).json({ error: 'Failed to calculate availability' });
  }
});

// ============================================
// LEADS ENDPOINTS
// ============================================

// POST - Create new lead
app.post('/api/leads', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, phone, status, source, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, status, source, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, name, email, phone, status || 'new', source || 'manual', notes]
    );

    console.log(`✅ Lead created: ${name}`);

    res.json({
      success: true,
      lead: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating lead:', error);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// PATCH - Update lead field
app.patch('/api/leads/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((field, idx) => `${field} = $${idx + 2}`).join(', ');

    const result = await pool.query(
      `UPDATE leads 
       SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $${fields.length + 2}
       RETURNING *`,
      [id, ...values, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({
      success: true,
      lead: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// DELETE - Delete lead
app.delete('/api/leads/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM leads WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    console.log(`✅ Lead deleted: ${result.rows[0].name}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ============================================
// CUSTOMERS ENDPOINTS
// ============================================

// POST - Create new customer
app.post('/api/customers', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, phone, last_service, last_service_date, left_review, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      `INSERT INTO customers (user_id, name, email, phone, last_service, last_service_date, left_review, notes, total_jobs, lifetime_value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, name, email, phone, last_service, last_service_date, left_review || 'N', notes]
    );

    console.log(`✅ Customer created: ${name}`);

    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// PATCH - Update customer field
app.patch('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((field, idx) => `${field} = $${idx + 2}`).join(', ');

    const result = await pool.query(
      `UPDATE customers 
       SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $${fields.length + 2}
       RETURNING *`,
      [id, ...values, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// DELETE - Delete customer
app.delete('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM customers WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    console.log(`✅ Customer deleted: ${result.rows[0].name}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

console.log('✅ Leads and Customers endpoints loaded');

// POST - Handle incoming lead from website form
app.post('/api/leads/submit', async (req, res) => {
  try {
    const { 
      businessId, 
      customerName, 
      customerEmail, 
      customerPhone,
      preferredContact, // 'email' or 'sms'
      serviceInterest,
      message 
    } = req.body;

    if (!businessId || !customerName || (!customerEmail && !customerPhone)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create lead record
    const leadResult = await pool.query(
      `INSERT INTO leads (
        user_id, name, email, phone, preferred_contact, 
        service_interest, message, status, source, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', 'website', CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        businessId, 
        customerName, 
        customerEmail, 
        customerPhone,
        preferredContact || 'email',
        serviceInterest,
        message
      ]
    );

    const lead = leadResult.rows[0];

    // Get business info
    const businessResult = await pool.query(
      'SELECT business_name, email as business_email, twilio_phone FROM users WHERE id = $1',
      [businessId]
    );

    const business = businessResult.rows[0];

    // SEND INITIAL RESPONSE - EMAIL FIRST (FREE!)
    if (customerEmail && sgMail) {
      try {
        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Thanks for your interest! 🎉</h1>
              </div>
              
              <!-- Body -->
              <div style="padding: 40px 30px;">
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  Hi ${customerName},
                </p>
                
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  Thank you for reaching out to <strong>${business.business_name}</strong>! We're excited to help you with ${serviceInterest || 'your needs'}.
                </p>

                <!-- Quick Response Options -->
                <div style="background: #f0f9ff; padding: 25px; border-radius: 12px; margin: 30px 0; border-left: 4px solid #3b82f6;">
                  <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">How would you like to continue?</h3>
                  
                  <div style="margin: 20px 0;">
                    <a href="mailto:${business.business_email}?subject=Re: Service Inquiry&body=Hi, I'd like to continue our conversation about ${serviceInterest || 'my inquiry'}..." 
                       style="display: inline-block; background: #3b82f6; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 5px;">
                      📧 Continue via Email (Recommended)
                    </a>
                  </div>

                  ${customerPhone ? `
                  <div style="margin: 20px 0;">
                    <a href="sms:${business.twilio_phone}?body=Hi ${business.business_name}, I'd like to discuss ${serviceInterest || 'my inquiry'}" 
                       style="display: inline-block; background: #10b981; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 5px;">
                      💬 Switch to Text Message
                    </a>
                  </div>
                  ` : ''}
                </div>

                <div style="background: #fefce8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #eab308;">
                  <p style="color: #713f12; font-size: 14px; margin: 0; line-height: 1.6;">
                    <strong>💡 Why email?</strong><br>
                    Email lets us share photos, detailed quotes, and scheduling options more easily. Plus, you'll have everything in writing for your records!
                  </p>
                </div>

                <!-- Quick Questions -->
                <div style="margin: 30px 0;">
                  <h3 style="color: #374151; font-size: 18px; margin-bottom: 15px;">
                    To help us serve you better, please share:
                  </h3>
                  <ul style="color: #6b7280; line-height: 1.8;">
                    <li>What specific service are you interested in?</li>
                    <li>When would you like us to start?</li>
                    <li>What's your location/address?</li>
                    <li>Any specific requirements or questions?</li>
                  </ul>
                </div>

                <!-- CTA -->
                <div style="text-align: center; margin: 40px 0;">
                  <a href="mailto:${business.business_email}?subject=Service Inquiry - ${serviceInterest || 'General'}&body=Hi ${business.business_name},%0D%0A%0D%0AService needed: ${serviceInterest || ''}%0D%0AWhen: %0D%0ALocation: %0D%0ADetails: ${message || ''}%0D%0A%0D%0AThanks!" 
                     style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; padding: 18px 50px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    Reply Now →
                  </a>
                </div>

                <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 30px;">
                  We typically respond within 2 hours during business hours.
                </p>
              </div>
              
              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
                  ${business.business_name}
                </p>
                ${business.twilio_phone ? `
                <p style="color: #9ca3af; font-size: 13px; margin: 5px 0;">
                  📞 ${business.twilio_phone}
                </p>
                ` : ''}
                <p style="color: #9ca3af; font-size: 13px; margin: 5px 0;">
                  📧 ${business.business_email}
                </p>
              </div>
            </div>
          </body>
          </html>
        `;

        await sgMail.send({
          to: customerEmail,
          from: process.env.SENDGRID_FROM_EMAIL || business.business_email,
          subject: `Thanks for contacting ${business.business_name}! 🎉`,
          html: emailHtml
        });

        console.log(`✅ Email-first response sent to ${customerName} (FREE)`);

        // Update lead status
        await pool.query(
          `UPDATE leads SET status = 'contacted_email', last_contact = CURRENT_TIMESTAMP WHERE id = $1`,
          [lead.id]
        );

      } catch (error) {
        console.error('Error sending email response:', error);
      }
    }

    // FALLBACK: If no email or they prefer SMS
    if (preferredContact === 'sms' && customerPhone && twilioClient) {
      try {
        await twilioClient.messages.create({
          body: `Hi ${customerName}! Thanks for your interest in ${business.business_name}! 

We'd love to help with ${serviceInterest || 'your request'}. 

For the best experience, would you prefer to:
1. Continue via text (charges may apply)
2. Email us at ${business.business_email} (FREE & easier for quotes/photos)

Reply 1 or 2!`,
          from: business.twilio_phone,
          to: customerPhone
        });

        console.log(`📱 SMS preference offer sent to ${customerName} ($0.0079)`);

        await pool.query(
          `UPDATE leads SET status = 'contacted_sms', last_contact = CURRENT_TIMESTAMP WHERE id = $1`,
          [lead.id]
        );

      } catch (error) {
        console.error('Error sending SMS:', error);
      }
    }

    // Notify business owner
    if (business.business_email && sgMail) {
      try {
        await sgMail.send({
          to: business.business_email,
          from: process.env.SENDGRID_FROM_EMAIL || business.business_email,
          subject: `🔔 New Lead: ${customerName}`,
          html: `
            <h2>New Lead Received!</h2>
            <p><strong>Name:</strong> ${customerName}</p>
            <p><strong>Email:</strong> ${customerEmail || 'Not provided'}</p>
            <p><strong>Phone:</strong> ${customerPhone || 'Not provided'}</p>
            <p><strong>Preferred Contact:</strong> ${preferredContact || 'email'}</p>
            <p><strong>Interest:</strong> ${serviceInterest || 'Not specified'}</p>
            <p><strong>Message:</strong> ${message || 'None'}</p>
            <hr>
            <p><em>Customer has been sent an email-first response to save on SMS costs.</em></p>
          `
        });
      } catch (error) {
        console.error('Error notifying business:', error);
      }
    }

    res.json({ 
      success: true, 
      lead,
      message: 'Thank you! We\'ll be in touch shortly.',
      contactMethod: customerEmail ? 'email' : 'sms'
    });

  } catch (error) {
    console.error('Error handling lead submission:', error);
    res.status(500).json({ error: 'Failed to process inquiry' });
  }
});

// POST - Handle incoming SMS (Twilio webhook)
app.post('/api/sms-webhook', async (req, res) => {
  try {
    const customerMessage = req.body.Body;
    const customerPhone = req.body.From;
    const businessPhone = req.body.To;

    // Find which business this belongs to
    const businessResult = await pool.query(
      'SELECT id, business_name, email FROM users WHERE twilio_phone = $1',
      [businessPhone]
    );

    if (businessResult.rows.length === 0) {
      return res.status(404).send('Business not found');
    }

    const business = businessResult.rows[0];

    // Check if this is a response to "1 or 2" choice
    const trimmedMessage = customerMessage.trim().toLowerCase();
    
    if (trimmedMessage === '1') {
      // Customer chose SMS
      await twilioClient.messages.create({
        body: `Great! We'll continue via text. What service are you interested in?`,
        from: businessPhone,
        to: customerPhone
      });

      // Update lead
      await pool.query(
        `UPDATE leads 
         SET preferred_contact = 'sms', status = 'sms_conversation'
         WHERE phone = $1 AND user_id = $2`,
        [customerPhone, business.id]
      );

      return res.status(200).send('OK');
    }

    if (trimmedMessage === '2') {
      // Customer chose email - send them the email address
      await twilioClient.messages.create({
        body: `Perfect! Please email us at ${business.email} - we'll send you photos, quotes, and details there. Looking forward to hearing from you! 📧`,
        from: businessPhone,
        to: customerPhone
      });

      // Update lead
      await pool.query(
        `UPDATE leads 
         SET preferred_contact = 'email', status = 'email_preferred'
         WHERE phone = $1 AND user_id = $2`,
        [customerPhone, business.id]
      );

      return res.status(200).send('OK');
    }

    // For any other SMS, ask if they'd prefer email
    await twilioClient.messages.create({
      body: `Hi! Thanks for texting ${business.business_name}! 

For the fastest response with photos & detailed quotes, would you prefer email? 

Reply YES for email address, or NO to continue via text.`,
      from: businessPhone,
      to: customerPhone
    });

    // Log the interaction
    await pool.query(
      `INSERT INTO lead_messages (user_id, phone, message, direction, created_at)
       VALUES ($1, $2, $3, 'inbound', CURRENT_TIMESTAMP)`,
      [business.id, customerPhone, customerMessage]
    );

    res.status(200).send('OK');

  } catch (error) {
    console.error('Error handling SMS webhook:', error);
    res.status(500).send('Error');
  }
});

app.get('/api/leads', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT * FROM leads 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ 
      success: true,
      leads: result.rows 
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// POST - Generate AI response for lead
app.post('/api/leads/generate-response', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { leadName, serviceInterest, leadMessage, preferredContact } = req.body;

    if (!leadName) {
      return res.status(400).json({ error: 'Lead name required' });
    }

    // Get business info
    const businessResult = await pool.query(
      'SELECT business_name FROM users WHERE id = $1',
      [userId]
    );

    const businessName = businessResult.rows[0]?.business_name || 'our business';

    // Call Claude API to generate response
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are a friendly customer service representative for ${businessName}.

A potential customer named ${leadName} has contacted us with interest in: ${serviceInterest || 'our services'}.

${leadMessage ? `Their message: "${leadMessage}"` : ''}

They prefer ${preferredContact === 'sms' ? 'text messages' : 'email'} communication.

Write a warm, professional, personalized response that:
1. Thanks them for their interest
2. Acknowledges their specific service interest
3. Asks 1-2 relevant questions to better understand their needs
4. Encourages them to book or continue the conversation
5. Keeps it conversational and friendly (not corporate)
6. Is appropriate for ${preferredContact === 'sms' ? 'SMS (keep under 160 characters)' : 'email (2-3 short paragraphs)'}

Return ONLY the message text, no quotes or formatting.`
        }]
      })
    });

    const data = await response.json();
    const aiResponse = data.content[0].text.trim();

    console.log(`✅ Generated AI response for lead ${leadName}`);

    res.json({
      success: true,
      response: aiResponse
    });

  } catch (error) {
    console.error('Error generating AI response:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

// POST - Send SMS to lead
app.post('/api/leads/send-sms', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { leadId, phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message required' });
    }

    if (!twilioClient) {
      return res.status(500).json({ error: 'SMS not configured' });
    }

    // Get business Twilio phone
    const businessResult = await pool.query(
      'SELECT twilio_phone FROM users WHERE id = $1',
      [userId]
    );

    const twilioPhone = businessResult.rows[0]?.twilio_phone || process.env.TWILIO_PHONE_NUMBER;

    // Send SMS
    await twilioClient.messages.create({
      body: message,
      from: twilioPhone,
      to: phone
    });

    // Update lead status
    await pool.query(
      `UPDATE leads 
       SET status = 'contacted_sms', last_contact = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [leadId]
    );

    // Log message
    await pool.query(
      `INSERT INTO lead_messages (user_id, lead_id, phone, message, direction, created_at)
       VALUES ($1, $2, $3, $4, 'outbound', CURRENT_TIMESTAMP)`,
      [userId, leadId, phone, message]
    );

    console.log(`✅ SMS sent to lead ${leadId}`);

    res.json({
      success: true,
      message: 'SMS sent successfully'
    });

  } catch (error) {
    console.error('Error sending SMS:', error);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

// POST - Send email to lead
app.post('/api/leads/send-email', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { leadId, email, subject, message } = req.body;

    if (!email || !message) {
      return res.status(400).json({ error: 'Email and message required' });
    }

    if (!sgMail) {
      return res.status(500).json({ error: 'Email not configured' });
    }

    // Get business info
    const businessResult = await pool.query(
      'SELECT business_name, email as business_email FROM users WHERE id = $1',
      [userId]
    );

    const businessName = businessResult.rows[0]?.business_name || 'Our Business';
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || businessResult.rows[0]?.business_email;

    // Send email
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 30px 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">${businessName}</h1>
          </div>
          
          <div style="padding: 40px 30px;">
            <div style="color: #374151; font-size: 16px; line-height: 1.6; white-space: pre-wrap;">
${message}
            </div>
          </div>
          
          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              ${businessName}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    await sgMail.send({
      to: email,
      from: fromEmail,
      subject: subject || `Message from ${businessName}`,
      html: emailHtml
    });

    // Update lead status
    await pool.query(
      `UPDATE leads 
       SET status = 'contacted_email', last_contact = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [leadId]
    );

    console.log(`✅ Email sent to lead ${leadId}`);

    res.json({
      success: true,
      message: 'Email sent successfully'
    });

  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// POST - Convert lead to customer
app.post('/api/leads/:id/convert', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Get lead info
    const leadResult = await pool.query(
      'SELECT * FROM leads WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = leadResult.rows[0];

    // Check if customer already exists
    const existingCustomer = await pool.query(
      'SELECT id FROM customers WHERE user_id = $1 AND email = $2',
      [userId, lead.email]
    );

    let customerId;

    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
    } else {
      // Create new customer
      const customerResult = await pool.query(
        `INSERT INTO customers (user_id, name, email, phone, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         RETURNING id`,
        [userId, lead.name, lead.email, lead.phone, lead.message]
      );
      customerId = customerResult.rows[0].id;
    }

    // Update lead status
    await pool.query(
      `UPDATE leads 
       SET status = 'converted', customer_id = $1
       WHERE id = $2`,
      [customerId, id]
    );

    console.log(`✅ Lead ${id} converted to customer ${customerId}`);

    res.json({
      success: true,
      customerId,
      message: 'Lead converted to customer'
    });

  } catch (error) {
    console.error('Error converting lead:', error);
    res.status(500).json({ error: 'Failed to convert lead' });
  }
});

console.log('✅ Leads endpoints loaded');

// GET - Website Chat Agent Configuration
app.get('/api/agents/website/config', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    if (result.rows.length === 0) {
      return res.json({
        config: {
          enabled: true,
          agentName: 'Kurt',
          greetingMessage: "Hey it's Kurt, I just happened to look and saw you were browsing. What are you looking to get done?",
          autoOpenDelay: 3
        }
      });
    }

    res.json({ config: result.rows[0].config });
  } catch (error) {
    console.error('Error fetching website agent config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// POST - Save Website Chat Agent Configuration
app.post('/api/agents/website/config', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { agentName, greetingMessage, autoOpenDelay } = req.body;

    const config = { agentName: agentName, greetingMessage: greetingMessage, autoOpenDelay: autoOpenDelay, enabled: true };

    const result = await pool.query(
      'INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (user_id, agent_type) DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP RETURNING *',
      [userId, 'website_chat', JSON.stringify(config)]
    );

    console.log('Website chat config saved for user:', userId);
    res.json({ success: true, config: result.rows[0].config });
  } catch (error) {
    console.error('Error saving website agent config:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// GET - Website Chat Agent Stats
app.get('/api/agents/website/stats', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const conversationsResult = await pool.query(
      'SELECT COUNT(*) as count FROM chat_conversations WHERE user_id = $1 AND created_at >= $2',
      [userId, startOfMonth]
    );

    const leadsResult = await pool.query(
      'SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND source = $2 AND created_at >= $3',
      [userId, 'ai_chat_agent', startOfMonth]
    );

    const bookingsResult = await pool.query(
      'SELECT COUNT(*) as count FROM bookings WHERE user_id = $1 AND source = $2 AND created_at >= $3',
      [userId, 'ai_chat_agent', startOfMonth]
    );

    res.json({
      conversations: parseInt(conversationsResult.rows[0].count),
      leadsCaptured: parseInt(leadsResult.rows[0].count),
      avgResponse: '2.3s',
      bookingsCreated: parseInt(bookingsResult.rows[0].count)
    });
  } catch (error) {
    console.error('Error fetching website agent stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// PATCH - Toggle Website Chat Agent
app.patch('/api/agents/website', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { enabled } = req.body;

    const existing = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    let config = {
      enabled: enabled,
      agentName: 'Kurt',
      greetingMessage: "Hey it's Kurt, I just happened to look and saw you were browsing. What are you looking to get done?",
      autoOpenDelay: 3
    };

    if (existing.rows.length > 0 && existing.rows[0].config) {
      config = Object.assign({}, existing.rows[0].config, { enabled: enabled });
    }

    await pool.query(
      'INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (user_id, agent_type) DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP',
      [userId, 'website_chat', JSON.stringify(config)]
    );

    console.log('Website chat toggled for user:', userId, 'enabled:', enabled);
    res.json({ success: true, enabled: enabled });
  } catch (error) {
    console.error('Error toggling website agent:', error);
    res.status(500).json({ error: 'Failed to toggle agent' });
  }
});

// GET - Lead Form Agent Templates
app.get('/api/agents/leadform/templates', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT email_template, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (result.rows.length === 0) {
      const defaultEmail = "Hey {{name}},\n\nThanks for reaching out! I'm Kurt, and I just saw your request come through.\n\nYou mentioned you are interested in {{service}}. I would love to help you out with that!\n\nHere is what I can do:\n- Get you scheduled ASAP (we have availability this week)\n- Answer any questions about pricing or our process\n- Show you some before/after photos of similar work we have done\n\nWhat day works best for you? Or if you want, just reply with your phone number and I will give you a call directly.\n\nLooking forward to working with you!\n\nKurt\n(555) 123-4567";
      const defaultSms = "Hey {{name}}, it's Kurt! Just got your request for {{service}}. When's a good time to chat? - Kurt";
      
      return res.json({
        email: defaultEmail,
        sms: defaultSms
      });
    }

    res.json({
      email: result.rows[0].email_template,
      sms: result.rows[0].sms_template
    });
  } catch (error) {
    console.error('Error fetching lead form templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST - Save Lead Form Agent Templates
app.post('/api/agents/leadform/templates', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { email, sms } = req.body;

    await pool.query(
      'INSERT INTO agent_configs (user_id, agent_type, email_template, sms_template, created_at, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (user_id, agent_type) DO UPDATE SET email_template = $3, sms_template = $4, updated_at = CURRENT_TIMESTAMP',
      [userId, 'lead_form', email, sms]
    );

    console.log('Lead form templates saved for user:', userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving lead form templates:', error);
    res.status(500).json({ error: 'Failed to save templates' });
  }
});

// GET - Lead Form Agent Stats
app.get('/api/agents/leadform/stats', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const totalResult = await pool.query(
      'SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND source = $2 AND created_at >= $3',
      [userId, 'lead_form', startOfMonth]
    );

    const emailsResult = await pool.query(
      'SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND source = $2 AND status = $3 AND created_at >= $4',
      [userId, 'lead_form', 'contacted_email', startOfMonth]
    );

    const smsResult = await pool.query(
      'SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND source = $2 AND status = $3 AND created_at >= $4',
      [userId, 'lead_form', 'contacted_sms', startOfMonth]
    );

    const bookingsResult = await pool.query(
      'SELECT COUNT(*) as count FROM bookings WHERE user_id = $1 AND source = $2 AND created_at >= $3',
      [userId, 'lead_form', startOfMonth]
    );

    const total = parseInt(totalResult.rows[0].count);
    const emailsSent = parseInt(emailsResult.rows[0].count);
    const smsSent = parseInt(smsResult.rows[0].count);
    const bookings = parseInt(bookingsResult.rows[0].count);

    res.json({
      total: total,
      emailsSent: emailsSent,
      smsSent: smsSent,
      responseRate: total > 0 ? Math.round((emailsSent + smsSent) / total * 100) : 0,
      bookingsCreated: bookings
    });
  } catch (error) {
    console.error('Error fetching lead form stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// PATCH - Toggle Lead Form Agent
app.patch('/api/agents/leadform', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { enabled } = req.body;

    const existing = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    let config = { enabled: enabled };

    if (existing.rows.length > 0 && existing.rows[0].config) {
      config = Object.assign({}, existing.rows[0].config, { enabled: enabled });
    }

    await pool.query(
      'INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (user_id, agent_type) DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP',
      [userId, 'lead_form', JSON.stringify(config)]
    );

    console.log('Lead form agent toggled for user:', userId, 'enabled:', enabled);
    res.json({ success: true, enabled: enabled });
  } catch (error) {
    console.error('Error toggling lead form agent:', error);
    res.status(500).json({ error: 'Failed to toggle agent' });
  }
});

console.log('✅ AI Agents endpoints loaded');

// Middleware to check for Pro plan
// POST - Create public booking
app.post('/api/public/bookings/create', async (req, res) => {
  try {
    const { 
      businessId, 
      serviceId, 
      additionalServiceIds,
      bookingDate, 
      startTime, 
      customerInfo, 
      customerNotes,
      assignmentType,
      employeeId,
      groupId
    } = req.body;

    if (!businessId || !serviceId || !bookingDate || !startTime || !customerInfo) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get main service details
    const serviceResult = await pool.query(
      'SELECT duration_hours, price, name FROM services WHERE id = $1',
      [serviceId]
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const mainService = serviceResult.rows[0];
    
    // Calculate total duration and price
    let totalDuration = parseFloat(mainService.duration_hours);
    let totalPrice = parseFloat(mainService.price);

    if (additionalServiceIds && additionalServiceIds.length > 0) {
      const additionalResult = await pool.query(
        'SELECT duration_hours, price FROM services WHERE id = ANY($1)',
        [additionalServiceIds]
      );

      additionalResult.rows.forEach(service => {
        totalDuration += parseFloat(service.duration_hours);
        totalPrice += parseFloat(service.price);
      });
    }

    // Calculate end time
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + (totalDuration * 60);
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    // Determine employee assignment
    let assignedEmployeeId = null;

    if (assignmentType === 'employee' && employeeId) {
      // User selected specific employee
      assignedEmployeeId = employeeId;
    } else if (assignmentType === 'group' && groupId) {
      // User selected group - pick random employee from group
      const groupResult = await pool.query(
        'SELECT employee_ids FROM groups WHERE id = $1',
        [groupId]
      );

      if (groupResult.rows.length > 0 && groupResult.rows[0].employee_ids.length > 0) {
        const groupEmployees = groupResult.rows[0].employee_ids;
        // Pick random employee from group
        assignedEmployeeId = groupEmployees[Math.floor(Math.random() * groupEmployees.length)];
      }
    }

    // If no employee assigned yet, auto-assign
    if (!assignedEmployeeId) {
      const availableEmpResult = await pool.query(
        `SELECT e.id 
         FROM employees e
         LEFT JOIN service_employees se ON e.id = se.employee_id
         WHERE e.user_id = $1 
         AND e.active = true
         AND (se.service_id = $2 OR NOT EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id))
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.employee_id = e.id
           AND b.booking_date = $3
           AND b.status NOT IN ('cancelled', 'no_show')
           AND (
             (b.start_time <= $4 AND b.end_time > $4) OR
             (b.start_time < $5 AND b.end_time >= $5) OR
             (b.start_time >= $4 AND b.end_time <= $5)
           )
         )
         LIMIT 1`,
        [businessId, serviceId, bookingDate, startTime, endTime]
      );

      if (availableEmpResult.rows.length === 0) {
        return res.status(409).json({ error: 'No employees available for this time slot' });
      }

      assignedEmployeeId = availableEmpResult.rows[0].id;
    }

    // Generate booking number
    const bookingNumberResult = await pool.query('SELECT generate_booking_number() as number');
    const bookingNumber = bookingNumberResult.rows[0].number;

    // Create or find customer
    let customerId;
    const existingCustomer = await pool.query(
      'SELECT id FROM customers WHERE user_id = $1 AND email = $2',
      [businessId, customerInfo.email]
    );

    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
      
      // Update customer info
      await pool.query(
        'UPDATE customers SET name = $1, phone = $2 WHERE id = $3',
        [customerInfo.name, customerInfo.phone, customerId]
      );
    } else {
      const customerResult = await pool.query(
        `INSERT INTO customers (user_id, name, email, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [businessId, customerInfo.name, customerInfo.email, customerInfo.phone]
      );
      customerId = customerResult.rows[0].id;
    }

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO bookings (
        user_id, customer_id, booking_number, booking_date, start_time, end_time,
        subtotal, total_amount, customer_name, customer_email, 
        customer_phone, customer_address, customer_notes, status, employee_id, group_id, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        businessId, customerId, bookingNumber, bookingDate, startTime, endTime,
        totalPrice, totalPrice, customerInfo.name, customerInfo.email,
        customerInfo.phone, customerInfo.address || null, customerNotes || null, 
        'confirmed', assignedEmployeeId, groupId || null, 'public_booking'
      ]
    );

    const booking = bookingResult.rows[0];

    // Create booking items
    // Main service
    await pool.query(
      `INSERT INTO booking_items (
        booking_id, service_id, service_name, service_duration, 
        service_price, quantity, subtotal
      )
      VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [booking.id, serviceId, mainService.name, mainService.duration_hours, mainService.price, mainService.price]
    );

    // Additional services
    if (additionalServiceIds && additionalServiceIds.length > 0) {
      const additionalResult = await pool.query(
        'SELECT id, name, duration_hours, price FROM services WHERE id = ANY($1)',
        [additionalServiceIds]
      );

      for (const service of additionalResult.rows) {
        await pool.query(
          `INSERT INTO booking_items (
            booking_id, service_id, service_name, service_duration, 
            service_price, quantity, subtotal
          )
          VALUES ($1, $2, $3, $4, $5, 1, $6)`,
          [booking.id, service.id, service.name, service.duration_hours, service.price, service.price]
        );
      }
    }

    // Get assigned employee name
    const empResult = await pool.query('SELECT name FROM employees WHERE id = $1', [assignedEmployeeId]);

    console.log(`✅ Public booking created: ${bookingNumber} for ${customerInfo.name}`);

    res.json({ 
      success: true, 
      booking,
      bookingNumber,
      assignedEmployee: empResult.rows[0].name,
      message: 'Booking confirmed!'
    });

  } catch (error) {
    console.error('Error creating public booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

console.log('✅ Public booking endpoints loaded');

// GET - Fetch review request sequences (UPDATED VERSION)
app.get('/api/google-business/review-requests', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT 
        s.*,
        b.booking_date, b.start_time, b.end_time,
        c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
        (SELECT name FROM services WHERE id = (
          SELECT service_id FROM booking_items WHERE booking_id = b.id LIMIT 1
        )) as service_name
       FROM review_request_sequences s
       LEFT JOIN bookings b ON s.booking_id = b.id
       LEFT JOIN customers c ON s.customer_id = c.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 100`,
      [userId]
    );

    // Transform data to match frontend expectations
    const requests = result.rows.map(row => ({
      id: row.id,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      customer_phone: row.customer_phone,
      service_name: row.service_name,
      incentive_code: row.incentive_code,
      
      // Determine overall status
      status: row.review_completed ? 'completed' : 
              (row.step1_status === 'sent' || row.step2_status === 'sent' || 
               row.step3_status === 'sent' || row.step4_status === 'sent' || 
               row.step5_status === 'sent') ? 'sent' : 'pending',
      
      scheduled_send_time: row.step1_scheduled_time,
      actual_send_time: row.step1_sent_time || row.step2_sent_time || row.step3_sent_time,
      
      sms_sent: row.step1_sms_sent || row.step2_sms_sent,
      email_sent: row.step3_email_sent || row.step4_email_sent || row.step5_email_sent,
      
      link_clicked: row.link_clicked,
      link_clicked_at: row.link_clicked_at,
      review_completed: row.review_completed,
      review_completed_at: row.review_completed_at,
      
      // Include step details
      steps: {
        step1: { scheduled: row.step1_scheduled_time, sent: row.step1_sent_time, status: row.step1_status, type: 'SMS' },
        step2: { scheduled: row.step2_scheduled_time, sent: row.step2_sent_time, status: row.step2_status, type: 'SMS' },
        step3: { scheduled: row.step3_scheduled_time, sent: row.step3_sent_time, status: row.step3_status, type: 'Email' },
        step4: { scheduled: row.step4_scheduled_time, sent: row.step4_sent_time, status: row.step4_status, type: 'Email' },
        step5: { scheduled: row.step5_scheduled_time, sent: row.step5_sent_time, status: row.step5_status, type: 'Email' }
      }
    }));

    res.json({
      success: true,
      requests
    });
  } catch (error) {
    console.error('Error fetching review requests:', error);
    res.status(500).json({ error: 'Failed to fetch review requests' });
  }
});

// PUT - Mark booking as completed (add this after your other booking endpoints)
app.put('/api/bookings/:id/complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE bookings 
       SET status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    // Initialize automated review request sequence
    await initializeReviewSequence(booking);

    res.json({ 
      success: true,
      booking,
      message: 'Booking completed and review sequence started'
    });
  } catch (error) {
    console.error('Error completing booking:', error);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

// GET - Fetch Google Business Profile for a user
app.get('/api/google-business/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM google_business_profiles WHERE user_id = $1',
      [userId]
    );

    res.json({ 
      success: true,
      profile: result.rows[0] || null 
    });
  } catch (error) {
    console.error('Error fetching Google Business profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST - Create or update Google Business Profile
app.post('/api/google-business/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 
      businessName, 
      placeId, 
      connected, 
      rating, 
      totalReviews,
      address,
      phone,
      websiteUrl
    } = req.body;

    const existing = await pool.query(
      'SELECT id FROM google_business_profiles WHERE user_id = $1',
      [userId]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE google_business_profiles 
         SET business_name = $1, place_id = $2, connected = $3, 
             rating = $4, total_reviews = $5, address = $6, 
             phone = $7, website_url = $8, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $9
         RETURNING *`,
        [businessName, placeId, connected, rating, totalReviews, address, phone, websiteUrl, userId]
      );
    } else {
      result = await pool.query(
        `INSERT INTO google_business_profiles 
         (user_id, business_name, place_id, connected, rating, total_reviews, 
          address, phone, website_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [userId, businessName, placeId, connected, rating, totalReviews, address, phone, websiteUrl]
      );
    }

    res.json({ 
      success: true,
      profile: result.rows[0] 
    });
  } catch (error) {
    console.error('Error saving Google Business profile:', error);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// GET - Get review reply statistics
app.get('/api/google-business/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT replies_generated_today, replies_generated_week, 
              replies_generated_month, last_reply_date 
       FROM google_business_profiles 
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        stats: {
          today: 0,
          week: 0,
          month: 0,
          lastReplyDate: null
        }
      });
    }

    res.json({
      success: true,
      stats: {
        today: result.rows[0].replies_generated_today || 0,
        week: result.rows[0].replies_generated_week || 0,
        month: result.rows[0].replies_generated_month || 0,
        lastReplyDate: result.rows[0].last_reply_date
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST - Reset daily/weekly/monthly stats (internal/cron only)
app.post('/api/google-business/reset-stats', async (req, res) => {
  try {
    const { period, apiKey } = req.body;

    // Simple API key check for cron jobs
    if (apiKey !== process.env.CRON_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let updateQuery;
    if (period === 'daily') {
      updateQuery = 'UPDATE google_business_profiles SET replies_generated_today = 0';
    } else if (period === 'weekly') {
      updateQuery = 'UPDATE google_business_profiles SET replies_generated_week = 0';
    } else if (period === 'monthly') {
      updateQuery = 'UPDATE google_business_profiles SET replies_generated_month = 0';
    } else {
      return res.status(400).json({ error: 'Invalid period' });
    }

    await pool.query(updateQuery);

    res.json({ success: true, message: `${period} stats reset successfully` });
  } catch (error) {
    console.error('Error resetting stats:', error);
    res.status(500).json({ error: 'Failed to reset stats' });
  }
});

// ============================================
// SERVICES ENDPOINTS (SECURED)
// ============================================

app.get('/api/services', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

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

app.post('/api/services', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, description, durationHours, price } = req.body;

    if (!name || !durationHours || !price) {
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

app.put('/api/services/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, description, durationHours, price, active } = req.body;

    const result = await pool.query(
      `UPDATE services 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           duration_hours = COALESCE($3, duration_hours),
           price = COALESCE($4, price),
           active = COALESCE($5, active)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [name, description, durationHours, price, active, id, userId]
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
// CUSTOMERS ENDPOINTS (SECURED)
// ============================================

app.get('/api/customers', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

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

app.post('/api/customers', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, phone, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name required' });
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
// JOBS ENDPOINTS (SECURED)
// ============================================

app.get('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status } = req.query;

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

app.post('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { customerId, serviceId, scheduledStart, notes } = req.body;

    if (!customerId || !serviceId || !scheduledStart) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const serviceResult = await pool.query(
      'SELECT name, duration_hours, price FROM services WHERE id = $1 AND user_id = $2',
      [serviceId, userId]
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = serviceResult.rows[0];
    const scheduledStartDate = new Date(scheduledStart);
    const calculatedEnd = new Date(scheduledStartDate.getTime() + (service.duration_hours * 60 * 60 * 1000));

    const result = await pool.query(
      `INSERT INTO jobs (user_id, customer_id, service_id, service_name, scheduled_start, duration_hours, calculated_end, price, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, customerId, serviceId, service.name, scheduledStart, service.duration_hours, calculatedEnd, service.price, notes]
    );

    res.json({ job: result.rows[0] });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// POST - Save user's Google review link
// POST - Save user's Google review link
app.post('/api/user/google-review-link', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reviewLink } = req.body;

    if (!reviewLink || !reviewLink.trim()) {
      return res.status(400).json({ error: 'Review link is required' });
    }

    // Validate it's a Google link (accepts g.page short links and google.com links)
    const link = reviewLink.toLowerCase();
    if (!link.includes('g.page') && !link.includes('google.com')) {
      return res.status(400).json({ 
        error: 'Invalid link. Must be a Google review link (g.page or google.com)' 
      });
    }

    const result = await pool.query(
      'UPDATE users SET google_review_link = $1 WHERE id = $2 RETURNING id, google_review_link',
      [reviewLink.trim(), userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ Google review link saved for user ${userId}`);

    res.json({
      success: true,
      message: 'Google review link saved successfully',
      reviewLink: result.rows[0].google_review_link
    });
  } catch (error) {
    console.error('Error saving Google review link:', error);
    res.status(500).json({ error: 'Failed to save Google review link' });
  }
});

// GET - Fetch user profile (including review link)
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT id, email, business_name, google_review_link FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

app.post('/api/jobs/:id/complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE jobs 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

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
// ANALYTICS ENDPOINTS (SECURED)
// ============================================

app.get('/api/analytics/reviews', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate } = req.query;

    let queryStr = `
      SELECT 
        COALESCE(SUM(requests_sent), 0) as total_sent,
        COALESCE(SUM(sms_sent), 0) as total_sms,
        COALESCE(SUM(emails_sent), 0) as total_emails,
        COALESCE(SUM(links_clicked), 0) as total_clicked,
        COALESCE(SUM(reviews_completed), 0) as total_reviewed,
        ROUND(AVG(click_rate), 2) as avg_click_rate,
        ROUND(AVG(review_rate), 2) as avg_review_rate
       FROM review_analytics
       WHERE user_id = $1
    `;
    
    const params = [userId];
    let paramCount = 1;

    if (startDate) {
      paramCount++;
      queryStr += ` AND date >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      queryStr += ` AND date <= $${paramCount}`;
      params.push(endDate);
    }

    const statsResult = await pool.query(queryStr, params);

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
// BUSINESS HOURS ENDPOINTS (SECURED)
// ============================================

app.get('/api/business-hours', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
      [userId]
    );

    res.json({ hours: result.rows });
  } catch (error) {
    console.error('Error fetching business hours:', error);
    res.status(500).json({ error: 'Failed to fetch business hours' });
  }
});

app.post('/api/business-hours', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { hours } = req.body;

    if (!hours) {
      return res.status(400).json({ error: 'hours required' });
    }

    await pool.query('DELETE FROM business_hours WHERE user_id = $1', [userId]);

    for (const hour of hours) {
      await pool.query(
        `INSERT INTO business_hours (user_id, day_of_week, is_open, open_time, close_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, hour.day_of_week, hour.is_open, hour.open_time, hour.close_time]
      );
    }

    const result = await pool.query(
      'SELECT * FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
      [userId]
    );

    res.json({ 
      success: true,
      hours: result.rows 
    });
  } catch (error) {
    console.error('Error saving business hours:', error);
    res.status(500).json({ error: 'Failed to save business hours' });
  }
});

// ============================================
// BUSINESS INFORMATION ENDPOINTS (SECURED)
// ============================================

app.get('/api/business-info', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM business_information WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ businessInfo: null });
    }

    res.json({ businessInfo: result.rows[0] });
  } catch (error) {
    console.error('Error fetching business info:', error);
    res.status(500).json({ error: 'Failed to fetch business information' });
  }
});

app.post('/api/business-info', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 
      phone, 
      email, 
      address, 
      city, 
      state, 
      zipCode,
      serviceAreaType,
      serviceZipCodes,
      serviceRadius,
      centerZipCode
    } = req.body;

    const existing = await pool.query(
      'SELECT id FROM business_information WHERE user_id = $1',
      [userId]
    );

    let result;
    
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE business_information 
         SET phone = $1,
             email = $2,
             address = $3,
             city = $4,
             state = $5,
             zip_code = $6,
             service_area_type = $7,
             service_zip_codes = $8,
             service_radius = $9,
             center_zip_code = $10,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $11
         RETURNING *`,
        [
          phone, 
          email, 
          address, 
          city, 
          state, 
          zipCode,
          serviceAreaType,
          serviceZipCodes || [],
          serviceRadius || 25,
          centerZipCode,
          userId
        ]
      );
    } else {
      result = await pool.query(
        `INSERT INTO business_information (
          user_id, phone, email, address, city, state, zip_code,
          service_area_type, service_zip_codes, service_radius, center_zip_code
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          userId,
          phone, 
          email, 
          address, 
          city, 
          state, 
          zipCode,
          serviceAreaType || 'zipcodes',
          serviceZipCodes || [],
          serviceRadius || 25,
          centerZipCode
        ]
      );
    }

    if (phone) {
      await pool.query(
        'UPDATE users SET phone = $1 WHERE id = $2',
        [phone, userId]
      );
    }

    res.json({ 
      success: true,
      businessInfo: result.rows[0] 
    });
  } catch (error) {
    console.error('Error saving business info:', error);
    res.status(500).json({ error: 'Failed to save business information' });
  }
});

app.get('/api/business-info/check-service-area', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { zipCode } = req.query;
    
    if (!zipCode) {
      return res.status(400).json({ error: 'zipCode required' });
    }

    const result = await pool.query(
      'SELECT service_area_type, service_zip_codes, service_radius, center_zip_code FROM business_information WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        inServiceArea: true, 
        message: 'Service area not configured - accepting all bookings' 
      });
    }

    const info = result.rows[0];

    if (info.service_area_type === 'zipcodes') {
      const inArea = info.service_zip_codes && info.service_zip_codes.includes(zipCode);
      return res.json({ 
        inServiceArea: true,
        isPrimaryArea: inArea,
        message: inArea 
          ? 'This is within our primary service area!' 
          : 'We accept bookings from all locations'
      });
    } else if (info.service_area_type === 'radius') {
      return res.json({ 
        inServiceArea: true,
        isPrimaryArea: true,
        message: 'We accept bookings from all locations'
      });
    }

    res.json({ 
      inServiceArea: true,
      message: 'We accept bookings from all locations'
    });
  } catch (error) {
    console.error('Error checking service area:', error);
    res.status(500).json({ error: 'Failed to check service area' });
  }
});

// ============================================
// BOOKING SETTINGS ENDPOINTS (SECURED)
// ============================================

app.get('/api/booking-settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM booking_settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        settings: {
          time_slot_interval: 30,
          buffer_time: 15,
          max_advance_booking: 60,
          min_advance_booking: 1,
          require_deposit: false,
          deposit_percentage: 25.00,
          auto_confirm: true,
          cancellation_hours: 24
        }
      });
    }

    res.json({ settings: result.rows[0] });
  } catch (error) {
    console.error('Error fetching booking settings:', error);
    res.status(500).json({ error: 'Failed to fetch booking settings' });
  }
});

app.post('/api/booking-settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const settings = req.body;

    const result = await pool.query(
      `INSERT INTO booking_settings (
        user_id, time_slot_interval, buffer_time, max_advance_booking, 
        min_advance_booking, require_deposit, deposit_percentage, 
        auto_confirm, cancellation_hours
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id) 
      DO UPDATE SET
        time_slot_interval = EXCLUDED.time_slot_interval,
        buffer_time = EXCLUDED.buffer_time,
        max_advance_booking = EXCLUDED.max_advance_booking,
        min_advance_booking = EXCLUDED.min_advance_booking,
        require_deposit = EXCLUDED.require_deposit,
        deposit_percentage = EXCLUDED.deposit_percentage,
        auto_confirm = EXCLUDED.auto_confirm,
        cancellation_hours = EXCLUDED.cancellation_hours
      RETURNING *`,
      [
        userId,
        settings.time_slot_interval || 30,
        settings.buffer_time || 15,
        settings.max_advance_booking || 60,
        settings.min_advance_booking || 1,
        settings.require_deposit || false,
        settings.deposit_percentage || 25.00,
        settings.auto_confirm !== undefined ? settings.auto_confirm : true,
        settings.cancellation_hours || 24
      ]
    );

    res.json({ settings: result.rows[0] });
  } catch (error) {
    console.error('Error updating booking settings:', error);
    res.status(500).json({ error: 'Failed to update booking settings' });
  }
});

// ============================================
// BOOKINGS ENDPOINTS (SECURED)
// ============================================

app.get('/api/bookings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate, status } = req.query;

    let query = `
      SELECT b.*, 
        json_agg(
          json_build_object(
            'service_name', bi.service_name,
            'duration', bi.service_duration,
            'price', bi.service_price,
            'quantity', bi.quantity
          )
        ) as items
      FROM bookings b
      LEFT JOIN booking_items bi ON b.id = bi.booking_id
      WHERE b.user_id = $1
    `;

    const params = [userId];
    let paramCount = 1;

    if (startDate) {
      paramCount++;
      query += ` AND b.booking_date >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      query += ` AND b.booking_date <= $${paramCount}`;
      params.push(endDate);
    }

    if (status) {
      paramCount++;
      query += ` AND b.status = $${paramCount}`;
      params.push(status);
    }

    query += ` GROUP BY b.id ORDER BY b.booking_date, b.start_time`;

    const result = await pool.query(query, params);
    res.json({ bookings: result.rows });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

app.post('/api/bookings/create', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { serviceId, bookingDate, startTime, customerInfo, customerNotes, employeeId, groupId } = req.body;

    if (!serviceId || !bookingDate || !startTime || !customerInfo) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const serviceResult = await pool.query(
      'SELECT duration_hours, price, name FROM services WHERE id = $1 AND user_id = $2',
      [serviceId, userId]
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = serviceResult.rows[0];
    
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + (service.duration_hours * 60);
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    let assignedEmployeeId = employeeId;
    
    if (!assignedEmployeeId) {
      const availableEmpResult = await pool.query(
        `SELECT e.id 
         FROM employees e
         LEFT JOIN service_employees se ON e.id = se.employee_id
         WHERE e.user_id = $1 
         AND e.active = true
         AND (se.service_id = $2 OR NOT EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id))
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.employee_id = e.id
           AND b.booking_date = $3
           AND b.status NOT IN ('cancelled', 'no_show')
           AND (
             (b.start_time <= $4 AND b.end_time > $4) OR
             (b.start_time < $5 AND b.end_time >= $5) OR
             (b.start_time >= $4 AND b.end_time <= $5)
           )
         )
         LIMIT 1`,
        [userId, serviceId, bookingDate, startTime, endTime]
      );

      if (availableEmpResult.rows.length === 0) {
        return res.status(409).json({ error: 'No employees available for this time slot' });
      }

      assignedEmployeeId = availableEmpResult.rows[0].id;
    }

    const bookingNumberResult = await pool.query('SELECT generate_booking_number() as number');
    const bookingNumber = bookingNumberResult.rows[0].number;

    const customerResult = await pool.query(
      `INSERT INTO customers (user_id, name, email, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, customerInfo.name, customerInfo.email, customerInfo.phone]
    );
    const customerIdToUse = customerResult.rows[0].id;

    const bookingResult = await pool.query(
      `INSERT INTO bookings (
        user_id, customer_id, booking_number, booking_date, start_time, end_time,
        subtotal, total_amount, customer_name, customer_email, 
        customer_phone, customer_notes, status, employee_id, group_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        userId, customerIdToUse, bookingNumber, bookingDate, startTime, endTime,
        service.price, service.price, customerInfo.name, customerInfo.email,
        customerInfo.phone, customerNotes || null, 'confirmed', assignedEmployeeId, groupId || null
      ]
    );

    const booking = bookingResult.rows[0];

    await pool.query(
      `INSERT INTO booking_items (
        booking_id, service_id, service_name, service_duration, 
        service_price, quantity, subtotal
      )
      VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [booking.id, serviceId, service.name, service.duration_hours, service.price, service.price]
    );

    const empResult = await pool.query('SELECT name FROM employees WHERE id = $1', [assignedEmployeeId]);

    res.json({ 
      success: true, 
      booking,
      assignedEmployee: empResult.rows[0].name,
      message: 'Booking confirmed!'
    });
      
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PUT - Mark booking as completed
app.put('/api/bookings/:id/complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE bookings 
       SET status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    // Initialize automated review request sequence
    await initializeReviewSequence(booking);

    res.json({ 
      success: true,
      booking,
      message: 'Booking completed and review sequence started'
    });
  } catch (error) {
    console.error('Error completing booking:', error);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

// Find your existing PUT /api/bookings/:id endpoint and replace it with this:
app.put('/api/bookings/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { serviceId, bookingDate, startTime, customerInfo, notes, employeeId, groupId, status } = req.body;

    const serviceResult = await pool.query(
      'SELECT duration_hours, price, name FROM services WHERE id = $1',
      [serviceId]
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = serviceResult.rows[0];
    
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + (service.duration_hours * 60);
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    const bookingResult = await pool.query(
      `UPDATE bookings 
       SET booking_date = $1,
           start_time = $2,
           end_time = $3,
           customer_name = $4,
           customer_email = $5,
           customer_phone = $6,
           customer_address = $7,
           customer_notes = $8,
           employee_id = $9,
           group_id = $10,
           status = $11,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 AND user_id = $13
       RETURNING *`,
      [
        bookingDate,
        startTime,
        endTime,
        customerInfo?.name,
        customerInfo?.email,
        customerInfo?.phone,
        customerInfo?.address,
        notes,
        employeeId,
        groupId || null,
        status || 'confirmed',
        id,
        userId
      ]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // If status changed to 'completed', initialize review sequence
    if (status === 'completed') {
      await initializeReviewSequence(booking);
    }

    if (booking.customer_id && customerInfo) {
      await pool.query(
        `UPDATE customers 
         SET name = $1, email = $2, phone = $3
         WHERE id = $4`,
        [customerInfo.name, customerInfo.email, customerInfo.phone, booking.customer_id]
      );
    }

    await pool.query(
      `UPDATE booking_items
       SET service_id = $1,
           service_name = $2,
           service_duration = $3,
           service_price = $4,
           subtotal = $5
       WHERE booking_id = $6`,
      [serviceId, service.name, service.duration_hours, service.price, service.price, id]
    );

    res.json({ 
      success: true,
      booking: bookingResult.rows[0],
      message: status === 'completed' ? 'Booking completed and review sequence started' : 'Booking updated successfully'
    });

  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

app.put('/api/bookings/:id/notes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(
      `UPDATE bookings 
       SET job_notes = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [notes, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ 
      success: true,
      booking: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating booking notes:', error);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

// ============================================
// EMPLOYEE ENDPOINTS (SECURED)
// ============================================

app.get('/api/employees', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT e.*, 
        (SELECT json_agg(se.service_id) FROM service_employees se WHERE se.employee_id = e.id) as service_ids
       FROM employees e
       WHERE e.user_id = $1
       ORDER BY e.name`,
      [userId]
    );

    res.json({ employees: result.rows });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

app.post('/api/employees', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, phone, color, serviceIds } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name required' });
    }

    const result = await pool.query(
      `INSERT INTO employees (user_id, name, email, phone, color)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, name, email, phone, color || '#3b82f6']
    );

    const employee = result.rows[0];

    if (serviceIds && serviceIds.length > 0) {
      for (const serviceId of serviceIds) {
        await pool.query(
          `INSERT INTO service_employees (service_id, employee_id)
           VALUES ($1, $2)
           ON CONFLICT (service_id, employee_id) DO NOTHING`,
          [serviceId, employee.id]
        );
      }
    }

    res.json({ employee });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

app.put('/api/employees/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, email, phone, color, active, serviceIds } = req.body;

    const result = await pool.query(
      `UPDATE employees
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           color = COALESCE($4, color),
           active = COALESCE($5, active)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [name, email, phone, color, active, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (serviceIds !== undefined) {
      await pool.query('DELETE FROM service_employees WHERE employee_id = $1', [id]);

      if (serviceIds && serviceIds.length > 0) {
        for (const serviceId of serviceIds) {
          await pool.query(
            `INSERT INTO service_employees (service_id, employee_id)
             VALUES ($1, $2)
             ON CONFLICT (service_id, employee_id) DO NOTHING`,
            [serviceId, id]
          );
        }
      }
    }

    res.json({ employee: result.rows[0] });
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

app.delete('/api/employees/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const bookingsCheck = await pool.query(
      `SELECT COUNT(*) as count FROM bookings 
       WHERE employee_id = $1 
       AND booking_date >= CURRENT_DATE 
       AND status NOT IN ('cancelled', 'completed')`,
      [id]
    );

    if (parseInt(bookingsCheck.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete employee with active bookings',
        activeBookings: bookingsCheck.rows[0].count
      });
    }

    await pool.query('DELETE FROM employees WHERE id = $1 AND user_id = $2', [id, userId]);
    res.json({ success: true, message: 'Employee deleted' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
  });

console.log('✅ Google Business Profile endpoints loaded');

// ============================================
// GROUPS ENDPOINTS (SECURED)
// ============================================

app.get('/api/groups', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM groups WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

app.post('/api/groups', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, employeeIds } = req.body;

    if (!name || !employeeIds || !Array.isArray(employeeIds)) {
      return res.status(400).json({ error: 'name and employeeIds (array) required' });
    }

    const result = await pool.query(
      'INSERT INTO groups (user_id, name, employee_ids) VALUES ($1, $2, $3) RETURNING *',
      [userId, name, employeeIds]
    );

    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

app.put('/api/groups/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, employeeIds } = req.body;

    if (!name || !employeeIds || !Array.isArray(employeeIds)) {
      return res.status(400).json({ error: 'name and employeeIds (array) required' });
    }

    const result = await pool.query(
      'UPDATE groups SET name = $1, employee_ids = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
      [name, employeeIds, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

app.delete('/api/groups/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM groups WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ============================================
// AVAILABILITY CALCULATOR (SECURED)
// ============================================

app.get('/api/availability', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { serviceId, date } = req.query;

    if (!serviceId || !date) {
      return res.status(400).json({ error: 'serviceId and date required' });
    }

    const serviceResult = await pool.query(
      'SELECT duration_hours FROM services WHERE id = $1 AND user_id = $2',
      [serviceId, userId]
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const serviceDuration = serviceResult.rows[0].duration_hours;

    const employeesResult = await pool.query(
      `SELECT DISTINCT e.id, e.name
       FROM employees e
       LEFT JOIN service_employees se ON e.id = se.employee_id
       WHERE e.user_id = $1 
       AND e.active = true
       AND (
         se.service_id = $2
         OR NOT EXISTS (
           SELECT 1 FROM service_employees WHERE employee_id = e.id
         )
       )`,
      [userId, serviceId]
    );

    if (employeesResult.rows.length === 0) {
      return res.json({ 
        availableSlots: [], 
        message: 'No employees available to perform this service' 
      });
    }

    const availableEmployees = employeesResult.rows;
    const requestDate = new Date(date);
    const dayOfWeek = requestDate.getDay();

    const hoursResult = await pool.query(
      'SELECT * FROM business_hours WHERE user_id = $1 AND day_of_week = $2',
      [userId, dayOfWeek]
    );

    if (hoursResult.rows.length === 0 || !hoursResult.rows[0].is_open) {
      return res.json({ availableSlots: [], message: 'Business closed on this day' });
    }

    const businessHours = hoursResult.rows[0];

    const settingsResult = await pool.query(
      'SELECT * FROM booking_settings WHERE user_id = $1',
      [userId]
    );

    const settings = settingsResult.rows[0] || {
      time_slot_interval: 30,
      buffer_time: 15
    };

    const blockedResult = await pool.query(
      'SELECT * FROM blocked_dates WHERE user_id = $1 AND blocked_date = $2',
      [userId, date]
    );

    if (blockedResult.rows.length > 0 && blockedResult.rows[0].all_day) {
      return res.json({ availableSlots: [], message: 'Date is blocked' });
    }

    const employeeIds = availableEmployees.map(e => e.id);
    const bookingsResult = await pool.query(
      `SELECT employee_id, start_time, end_time 
       FROM bookings 
       WHERE user_id = $1 
       AND booking_date = $2 
       AND status NOT IN ('cancelled', 'no_show')
       AND employee_id = ANY($3)`,
      [userId, date, employeeIds]
    );

    const employeeBookings = {};
    availableEmployees.forEach(emp => {
      employeeBookings[emp.id] = bookingsResult.rows
        .filter(b => b.employee_id === emp.id)
        .map(b => ({
          start_time: b.start_time,
          end_time: b.end_time
        }));
    });

    const allSlots = generateTimeSlots(
      businessHours.open_time,
      businessHours.close_time,
      serviceDuration,
      settings.time_slot_interval,
      settings.buffer_time
    );

    const availableSlots = allSlots.map(slot => {
      const availableForSlot = availableEmployees.filter(employee => {
        const employeeBookingsForDay = employeeBookings[employee.id] || [];
        return !hasConflict(slot, employeeBookingsForDay, settings.buffer_time);
      });

      return {
        ...slot,
        availableEmployees: availableForSlot.length,
        employeeIds: availableForSlot.map(e => e.id),
        employeeNames: availableForSlot.map(e => e.name)
      };
    }).filter(slot => slot.availableEmployees > 0);

    res.json({ 
      availableSlots,
      totalEmployees: availableEmployees.length,
      businessHours: {
        open: businessHours.open_time,
        close: businessHours.close_time
      },
      serviceDuration
    });

  } catch (error) {
    console.error('Error calculating availability:', error);
    res.status(500).json({ error: 'Failed to calculate availability' });
  }
});

// ============================================
// AI WEBSITE GENERATION ENDPOINT (SECURED)
// ============================================

// ============================================
// AI WEBSITE GENERATION ENDPOINT (SECURED)
// ============================================

app.post('/api/generate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 
      businessName, 
      businessType, 
      tagline,
      services, 
      yearsInBusiness,
      certifications,
      description, 
      uniqueSellingPoints,
      targetCustomer
    } = req.body;

    // ============================================
    // SANITIZE ALL USER INPUTS
    // ============================================
    const safeBusinessName = sanitizeForPrompt(businessName);
    const safeBusinessType = sanitizeForPrompt(businessType);
    const safeTagline = sanitizeForPrompt(tagline);
    const safeServices = sanitizeForPrompt(services);
    const safeCertifications = sanitizeForPrompt(certifications);
    const safeDescription = sanitizeForPrompt(description);
    const safeUSPs = sanitizeForPrompt(uniqueSellingPoints);
    const safeTargetCustomer = sanitizeForPrompt(targetCustomer);

    console.log('🎨 Generating premium website for:', safeBusinessName);
    console.log('👤 User ID:', userId);
    console.log('📋 Business Type:', safeBusinessType);

    if (!safeBusinessName || !safeBusinessType) {
      return res.status(400).json({ error: 'Business name and type are required' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ ANTHROPIC_API_KEY not set!');
      return res.status(500).json({ error: 'API key not configured' });
    }

    // ============================================
    // FETCH USER'S ACTUAL DATA FROM DATABASE
    // ============================================
    let userServices = [];
    let userBusinessHours = [];
    let userEmployees = [];
    let userBusinessInfo = null;

    try {
      const servicesResult = await pool.query(
        'SELECT * FROM services WHERE user_id = $1 AND active = true ORDER BY name',
        [userId]
      );
      userServices = servicesResult.rows;

      const hoursResult = await pool.query(
        'SELECT * FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
        [userId]
      );
      userBusinessHours = hoursResult.rows;

      const employeesResult = await pool.query(
        'SELECT name FROM employees WHERE user_id = $1 AND active = true ORDER BY name LIMIT 10',
        [userId]
      );
      userEmployees = employeesResult.rows;

      const businessInfoResult = await pool.query(
        `SELECT 
          bi.*,
          u.business_name,
          u.name as owner_name
         FROM business_information bi
         LEFT JOIN users u ON bi.user_id = u.id
         WHERE bi.user_id = $1`,
        [userId]
      );

      if (businessInfoResult.rows.length > 0) {
        userBusinessInfo = businessInfoResult.rows[0];
      } else {
        const userResult = await pool.query(
          'SELECT business_name, name, email, phone FROM users WHERE id = $1',
          [userId]
        );
        userBusinessInfo = userResult.rows[0];
      }

      console.log('✅ Fetched user data:', {
        services: userServices.length,
        businessHours: userBusinessHours.length,
        employees: userEmployees.length
      });
    } catch (error) {
      console.error('⚠️ Error fetching user data:', error);
    }

    // ============================================
    // FORMAT SERVICES DATA
    // ============================================
    const servicesInfo = userServices.length > 0 
      ? {
          hasData: true,
          services: userServices.map(s => `
**${sanitizeForPrompt(s.name)}**
Description: ${sanitizeForPrompt(s.description) || 'Professional service'}
Price: $${parseFloat(s.price).toFixed(2)}${s.duration_hours ? ` (${s.duration_hours} hour${s.duration_hours > 1 ? 's' : ''})` : ''}
`).join('\n'),
          instruction: `IMPORTANT: Use these EXACT ${userServices.length} services with their real names, descriptions, and prices.`
        }
      : {
          hasData: false,
          services: safeServices || `General ${safeBusinessType} services`,
          instruction: `CRITICAL: Create 4-6 SPECIFIC ${safeBusinessType} services with realistic names, prices ($50-$5000), and durations (1-8 hours).`
        };

    // ============================================
    // FORMAT BUSINESS HOURS
    // ============================================
    const hoursInfo = userBusinessHours.length > 0 && userBusinessHours.some(h => h.is_open)
      ? (() => {
          const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const openDays = userBusinessHours.filter(h => h.is_open);
          
          if (openDays.length === 0) {
            return {
              hasData: false,
              hours: 'Monday-Friday: 9:00 AM - 5:00 PM\nSaturday: 10:00 AM - 2:00 PM\nSunday: Closed',
              instruction: 'Use these typical business hours.'
            };
          }
          
          const hoursText = openDays.map(h => 
            `${daysMap[h.day_of_week]}: ${h.open_time} - ${h.close_time}`
          ).join('\n');
          
          return {
            hasData: true,
            hours: hoursText,
            instruction: 'IMPORTANT: Use these EXACT business hours.'
          };
        })()
      : {
          hasData: false,
          hours: 'Monday-Friday: 9:00 AM - 5:00 PM\nSaturday: 10:00 AM - 2:00 PM\nSunday: Closed',
          instruction: 'Use these typical business hours.'
        };

    // ============================================
    // FORMAT TEAM DATA
    // ============================================
    const teamInfo = userEmployees.length > 0
      ? {
          hasData: true,
          team: `Our team includes: ${userEmployees.map(e => sanitizeForPrompt(e.name)).join(', ')}`,
          instruction: 'You can mention these team members.'
        }
      : { hasData: false, team: null, instruction: '' };

    // ============================================
    // FORMAT BUSINESS CONTACT INFORMATION
    // ============================================
    const contactEmail = sanitizeForPrompt(userBusinessInfo?.email) || 'contact@example.com';
    const ownerName = sanitizeForPrompt(userBusinessInfo?.owner_name || userBusinessInfo?.name) || null;
    const phoneNumber = sanitizeForPrompt(userBusinessInfo?.phone) || '(555) 123-4567';
    const phoneNumberClean = phoneNumber.replace(/\D/g, '');

    const address = sanitizeForPrompt(userBusinessInfo?.address) || null;
    const city = sanitizeForPrompt(userBusinessInfo?.city) || null;
    const state = sanitizeForPrompt(userBusinessInfo?.state) || null;
    const zipCode = sanitizeForPrompt(userBusinessInfo?.zip_code) || null;

    const fullAddress = [address, city, state, zipCode]
      .filter(Boolean)
      .join(', ');

    const serviceAreaType = userBusinessInfo?.service_area_type || 'zipcodes';
    const serviceZipCodes = userBusinessInfo?.service_zip_codes || [];
    const serviceRadius = userBusinessInfo?.service_radius || 25;
    const centerZipCode = sanitizeForPrompt(userBusinessInfo?.center_zip_code) || zipCode;

    const serviceAreaText = serviceAreaType === 'radius'
      ? `We serve a ${serviceRadius} mile radius from ${centerZipCode || 'our location'}`
      : serviceZipCodes.length > 0
        ? `Service Areas: ${serviceZipCodes.slice(0, 10).join(', ')}${serviceZipCodes.length > 10 ? ' and more' : ''}`
        : null;

    // ============================================
    // DETERMINE BOOKING URL
    // ============================================
    const bookingUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/book/${userId}`;

    console.log('🔗 Booking URL:', bookingUrl);
    console.log('📞 Phone:', phoneNumber);
    console.log('📍 Address:', fullAddress || 'Not provided');

    // ============================================
    // DETERMINE PRIMARY COLOR
    // ============================================
    const businessTypeLower = safeBusinessType.toLowerCase();
    let primaryColor = '#2563eb';
    let accentColor = '#10b981';
    
    if (businessTypeLower.includes('auto') || businessTypeLower.includes('detail')) {
      primaryColor = '#000000';
      accentColor = '#D4AF37';
    } else if (businessTypeLower.includes('land')) {
      primaryColor = '#047857';
      accentColor = '#16a34a';
    } else if (businessTypeLower.includes('plumb')) {
      primaryColor = '#1e40af';
      accentColor = '#f97316';
    } else if (businessTypeLower.includes('clean')) {
      primaryColor = '#06b6d4';
      accentColor = '#10b981';
    } else if (businessTypeLower.includes('hvac')) {
      primaryColor = '#dc2626';
      accentColor = '#3b82f6';
    } else if (businessTypeLower.includes('salon') || businessTypeLower.includes('spa')) {
      primaryColor = '#ec4899';
      accentColor = '#a855f7';
    }

    // ============================================
    // BUILD THE PROMPT USING THE NEW FUNCTION
    // ============================================
    const prompt = buildVisualSupremacyPrompt({
      safeBusinessName,
      safeBusinessType,
      safeTagline,
      safeDescription,
      safeUSPs,
      yearsInBusiness,
      safeCertifications,
      safeTargetCustomer,
      phoneNumber,
      phoneNumberClean,
      contactEmail,
      fullAddress,
      serviceAreaText,
      bookingUrl,
      ownerName,
      servicesInfo,
      hoursInfo,
      teamInfo,
      primaryColor,
      accentColor
    });

    console.log('📡 Calling Anthropic API with premium prompt...');

    // ============================================
    // CALL ANTHROPIC API
    // ============================================
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 40000,
        temperature: 0.5,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });
    
    console.log('📥 API Response Status:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Anthropic API error:', error);
      return res.status(500).json({ error: 'Failed to generate website', details: error });
    }

   const data = await response.json();
const fullResponse = data.content?.[0]?.text;

if (!fullResponse) {
  console.error('❌ No HTML content in response');
  return res.status(500).json({ error: 'No content generated' });
}

// Parse multiple files
const files = {};
const fileSeparator = /<!-- FILE_SEPARATOR: (.+?) -->/g;
const parts = fullResponse.split(fileSeparator);

if (parts.length > 1) {
  // Multi-file response
  for (let i = 1; i < parts.length; i += 2) {
    const filename = parts[i].trim();
    const content = parts[i + 1]?.trim()
      .replace(/```html\n?/g, '')
      .replace(/```\n?$/g, '')
      .replace(/```/g, '') || '';
    
    if (filename && content) {
      files[filename] = content;
    }
  }
  console.log('✅ Generated', Object.keys(files).length, 'pages:', Object.keys(files));
} else {
  // Single file (fallback) - clean up markdown
  const cleanContent = fullResponse.trim()
    .replace(/```html\n?/g, '')
    .replace(/```\n?$/g, '')
    .replace(/```/g, '');
  files['index.html'] = cleanContent;
  console.log('✅ Generated single-page website');
}

// Use index.html as the primary content
const htmlContent = files['index.html'];

if (!htmlContent) {
  console.error('❌ No index.html generated');
  return res.status(500).json({ error: 'No homepage content generated' });
}

// Clean up markdown formatting if present (already done above, but kept for consistency)

    // Clean up markdown formatting if present
    let cleanHtml = htmlContent.trim()
      .replace(/```html\n?/g, '')
      .replace(/```\n?$/g, '')
      .replace(/```/g, '');

    // Verify content
    const bookingLinkCount = (cleanHtml.match(new RegExp(bookingUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const phoneCount = (cleanHtml.match(new RegExp(phoneNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    
    console.log(`✅ Premium website generated with visual enhancements`);
    console.log(`✅ Booking links: ${bookingLinkCount}`);
    console.log(`✅ Phone displays: ${phoneCount}`);

    res.json({ 
  success: true, 
  html: cleanHtml,
  pages: files,  // Add this - the actual page files!
  businessName: safeBusinessName,
  bookingUrl,
  phoneNumber,
  address: fullAddress || null,
  serviceArea: serviceAreaText || null,
  pageNames: Object.keys(files),
      usedRealData: {
        services: servicesInfo.hasData,
        hours: hoursInfo.hasData,
        team: teamInfo.hasData,
        phone: !!userBusinessInfo?.phone,
        address: !!fullAddress,
        serviceArea: !!serviceAreaText
      }
    });

  } catch (error) {
    console.error('❌ Error generating website:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

console.log('✅ Website generation endpoint loaded with Visual Supremacy prompt');

// ============================================
// AUTHENTICATION ENDPOINTS (NO AUTH NEEDED)
// ============================================

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, businessName, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, business_name, plan, created_at)
       VALUES ($1, $2, $3, $4, NULL, CURRENT_TIMESTAMP)
       RETURNING id, email, name, business_name, plan`,
      [
        email.toLowerCase(), 
        hashedPassword, 
        fullName || businessName || 'User',
        businessName || 'My Business'
        // No plan assigned - they must choose and pay
      ]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, EFFECTIVE_JWT_SECRET, { expiresIn: '7d' });

    console.log('✅ New user (no plan):', email);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan // Will be null
      }
    });

  } catch (error) {
    console.error('❌ Signup error:', error);
    res.status(500).json({ error: 'Registration failed', message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash, business_name, plan FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, EFFECTIVE_JWT_SECRET, { expiresIn: '7d' });

    console.log('✅ User logged in:', email);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);

    const result = await pool.query(
      'SELECT id, email, business_name, plan FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan
      }
    });

  } catch (error) {
    console.error('❌ Verify error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  res.json({ 
    success: true, 
    message: 'Logged out successfully' 
  });
});

console.log('✅ Auth endpoints loaded (signup, login, verify, logout)');

/// ============================================
// WEBSITE PAGE SERVING ENDPOINT (SECURED)
// ============================================

app.get('/api/website/page/:pageName', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { pageName } = req.params;
    
    const result = await pool.query(
      'SELECT pages FROM websites WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Website not found' });
    }
    
    const pages = result.rows[0].pages || {};
    
    // If no pages object, this is an old single-page website
    if (Object.keys(pages).length === 0) {
      return res.status(404).json({ error: 'No pages found. Please regenerate your website.' });
    }
    
    // Get requested page or fall back to index
    const pageContent = pages[pageName] || pages['index.html'];
    
    if (!pageContent) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    res.send(pageContent);
  } catch (error) {
    console.error('Error serving page:', error);
    res.status(500).json({ error: 'Failed to serve page' });
  }
});

// Get list of all pages for a website
app.get('/api/website/pages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT pages FROM websites WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0 || !result.rows[0].pages) {
      return res.json({ pages: [] });
    }
    
    const pages = result.rows[0].pages;
    const pageList = Object.keys(pages).map(name => ({
      name: name,
      displayName: name.replace('.html', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())
    }));
    
    res.json({ pages: pageList });
  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

app.get('/api/website', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM websites WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        success: true,
        website: null 
      });
    }

    // Parse pages JSON if it exists
    const website = result.rows[0];
    if (website.pages && typeof website.pages === 'string') {
      website.pages = JSON.parse(website.pages);
    }

    res.json({ 
      success: true,
      website: website
    });
  } catch (error) {
    console.error('Error fetching website:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch website' 
    });
  }
});

console.log('✅ Multi-page website endpoints loaded');

app.post('/api/website', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { htmlContent, pages } = req.body; // Add pages parameter

    if (!htmlContent) {
      return res.status(400).json({ error: 'htmlContent required' });
    }

    const existing = await pool.query(
      'SELECT id FROM websites WHERE user_id = $1',
      [userId]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE websites 
         SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3
         RETURNING *`,
        [htmlContent, pages ? JSON.stringify(pages) : null, userId]
      );
    } else {
      result = await pool.query(
        `INSERT INTO websites (user_id, html_content, pages, is_published, created_at, updated_at)
         VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [userId, htmlContent, pages ? JSON.stringify(pages) : null]
      );
    }

    res.json({ 
      success: true,
      website: result.rows[0] 
    });
  } catch (error) {
    console.error('Error saving website:', error);
    res.status(500).json({ error: 'Failed to save website' });
  }
});

app.post('/api/website/publish', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { isPublished } = req.body;

    const result = await pool.query(
      `UPDATE websites 
       SET is_published = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2
       RETURNING *`,
      [isPublished, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Website not found' });
    }

    res.json({ 
      success: true,
      website: result.rows[0] 
    });
  } catch (error) {
    console.error('Error toggling publish:', error);
    res.status(500).json({ error: 'Failed to toggle publish' });
  }
});

app.post('/api/website/domain', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { customDomain } = req.body;

    const result = await pool.query(
      `UPDATE websites 
       SET custom_domain = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2
       RETURNING *`,
      [customDomain, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Website not found' });
    }

    res.json({ 
      success: true,
      website: result.rows[0] 
    });
  } catch (error) {
    console.error('Error saving domain:', error);
    res.status(500).json({ error: 'Failed to save domain' });
  }
});

// POST - Upgrade/Change Plan
app.post('/api/billing/upgrade', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { plan } = req.body;

    const validPlans = ['basic', 'pro', 'expert'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const result = await pool.query(
      'UPDATE users SET plan = $1 WHERE id = $2 RETURNING id, email, plan',
      [plan, userId]
    );

    console.log(`✅ User ${userId} upgraded to ${plan}`);

    res.json({
      success: true,
      plan: result.rows[0].plan,
      message: `Successfully upgraded to ${plan}!`
    });

  } catch (error) {
    console.error('Error upgrading plan:', error);
    res.status(500).json({ error: 'Failed to upgrade plan' });
  }
});

// ============================================
// WEBSITE EDITOR ENDPOINT (SECURED)
// ============================================

app.post('/api/website/ai-edit', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentHTML, userRequest } = req.body;

    if (!currentHTML || !userRequest) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const startTime = Date.now();
    const htmlSize = (currentHTML.length / 1024).toFixed(1);
    const safeUserRequest = sanitizeForPrompt(userRequest);
    
    console.log(`🎨 AI Edit for user ${userId}: "${safeUserRequest.substring(0, 60)}..." (${htmlSize}KB)`);

    const estimatedTokens = Math.ceil(currentHTML.length / 3);
    const maxTokens = Math.min(estimatedTokens + 500, 4000);

    const prompt = `You are an expert web developer. Modify this HTML based on the user's request.

USER REQUEST: ${safeUserRequest}

CURRENT HTML:
${currentHTML}

INSTRUCTIONS:
1. Make ONLY the changes requested - don't redesign the entire page
2. Preserve all existing functionality, classes, and structure
3. If changing text, update ONLY the specific text mentioned
4. If changing colors/styles, update ONLY those specific elements
5. Return the COMPLETE modified HTML (not just snippets)
6. Ensure the HTML is valid and properly formatted

Return ONLY the updated HTML with no explanation or markdown formatting.`;

    const apiStartTime = Date.now();
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ 
          role: 'user', 
          content: prompt 
        }]
      })
    });

    const apiTime = ((Date.now() - apiStartTime) / 1000).toFixed(1);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error:', response.status, errorText.substring(0, 200));
      return res.status(500).json({ 
        success: false,
        error: 'API request failed',
        message: 'Claude API returned an error. Please try again.'
      });
    }

    const data = await response.json();
    
    let updatedHTML = data.content[0].text
      .replace(/```html\n?/gi, '')
      .replace(/```\n?/g, '')
      .trim();

    if (!updatedHTML.includes('<!DOCTYPE') && !updatedHTML.includes('<html')) {
      console.error('❌ Invalid HTML returned');
      return res.json({
        success: false,
        error: 'Invalid HTML',
        message: "I couldn't make that change properly. Could you try rephrasing your request?"
      });
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    let message = "Done! ✨";
    const lowerRequest = safeUserRequest.toLowerCase();
    
    if (lowerRequest.includes('color') || lowerRequest.includes('colour')) {
      message = "Updated the colors! 🎨";
    } else if (lowerRequest.includes('text') || lowerRequest.includes('headline') || lowerRequest.includes('title')) {
      message = "Changed the text! ✏️";
    } else if (lowerRequest.includes('button')) {
      message = "Updated the button! 🔘";
    } else if (lowerRequest.includes('add') || lowerRequest.includes('new')) {
      message = "Added the new content! ➕";
    } else if (lowerRequest.includes('remove') || lowerRequest.includes('delete')) {
      message = "Removed it! 🗑️";
    } else if (lowerRequest.includes('image') || lowerRequest.includes('photo') || lowerRequest.includes('picture')) {
      message = "Updated the image! 🖼️";
    }

    console.log(`✅ Complete: ${totalTime}s (API: ${apiTime}s)`);

    res.json({
      success: true,
      updatedHTML: updatedHTML,
      message: message,
      _debug: process.env.NODE_ENV === 'development' ? {
        apiTime: `${apiTime}s`,
        totalTime: `${totalTime}s`,
        htmlSizeKB: htmlSize,
        maxTokens: maxTokens
      } : undefined
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Request failed',
      message: 'Something went wrong. Please try again.'
    });
  }
});

console.log('✅ AI editor endpoint loaded');

// ============================================
// GOOGLE BUSINESS PROFILE - AI REPLY GENERATOR (SECURED)
// ============================================

app.post('/api/google-business/generate-reply', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reviewText, rating, businessName, customerName } = req.body;

    if (!reviewText || !rating) {
      return res.status(400).json({ error: 'reviewText and rating required' });
    }

    const safeReviewText = sanitizeForPrompt(reviewText);
    const safeBusinessName = sanitizeForPrompt(businessName) || 'our business';
    const safeCustomerName = sanitizeForPrompt(customerName);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are replying to a Google Business review for ${safeBusinessName}.

Review (${rating}/5 stars): "${safeReviewText}"
${safeCustomerName ? `Customer: ${safeCustomerName}` : ''}

Write a professional, warm, personalized response (2-3 sentences). 
- If 4-5 stars: Thank them and encourage return visit
- If 1-3 stars: Apologize, show empathy, offer to make it right
- Use the business name naturally
${safeCustomerName ? `- Address ${safeCustomerName} by name if appropriate` : ''}
- Be authentic, not corporate

Return ONLY the reply text, no quotes or formatting.`
        }]
      })
    });
    
    const data = await response.json();
    const reply = data.content[0].text.trim();
    
    // **NEW: Increment the stats in the database**
    await pool.query(
      `INSERT INTO google_business_profiles (
        user_id, 
        replies_generated_today, 
        replies_generated_week, 
        replies_generated_month,
        last_reply_date
      )
      VALUES ($1, 1, 1, 1, CURRENT_DATE)
      ON CONFLICT (user_id) 
      DO UPDATE SET
        replies_generated_today = google_business_profiles.replies_generated_today + 1,
        replies_generated_week = google_business_profiles.replies_generated_week + 1,
        replies_generated_month = google_business_profiles.replies_generated_month + 1,
        last_reply_date = CURRENT_DATE`,
      [userId]
    );
    
    console.log(`✅ Generated review reply for user ${userId} and incremented stats`);
    
    res.json({
      success: true,
      reply
    });
    
  } catch (error) {
    console.error('AI reply generation error:', error);
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

console.log('✅ Google Business Profile AI reply generator loaded');

// ============================================
// HEALTH CHECK (NO AUTH NEEDED)
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

// ============================================
// CRON JOB
// ============================================

// Process review requests every minute
// Update the existing cron job in server.js
cron.schedule('* * * * *', async () => {
  try {
    // Process each step of active sequences
    for (let step = 1; step <= 5; step++) {
      const result = await pool.query(
        `SELECT * FROM review_request_sequences
         WHERE sequence_status = 'active'
         AND step${step}_status = 'pending'
         AND step${step}_scheduled_time <= CURRENT_TIMESTAMP
         AND (review_completed = false OR review_completed IS NULL)
         LIMIT 10`
      );

      for (const sequence of result.rows) {
        await sendReviewRequestStep(sequence, step);
      }

      if (result.rows.length > 0) {
        console.log(`✅ Processed ${result.rows.length} step ${step} review requests`);
      }
    }

    // Mark sequences as completed if review was left or all steps are done
    await pool.query(
      `UPDATE review_request_sequences
       SET sequence_status = 'completed'
       WHERE sequence_status = 'active'
       AND (
         review_completed = true
         OR (
           step1_status != 'pending' AND step2_status != 'pending' 
           AND step3_status != 'pending' AND step4_status != 'pending' 
           AND step5_status != 'pending'
         )
       )`
    );

  } catch (error) {
    console.error('Cron job error:', error);
  }
});

// Reset daily stats at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    await pool.query('UPDATE google_business_profiles SET replies_generated_today = 0');
    console.log('✅ Daily stats reset');
  } catch (error) {
    console.error('Daily reset error:', error);
  }
});

// Reset weekly stats on Sunday at midnight
cron.schedule('0 0 * * 0', async () => {
  try {
    await pool.query('UPDATE google_business_profiles SET replies_generated_week = 0');
    console.log('✅ Weekly stats reset');
  } catch (error) {
    console.error('Weekly reset error:', error);
  }
});

// Reset monthly stats on the 1st at midnight
cron.schedule('0 0 1 * *', async () => {
  try {
    await pool.query('UPDATE google_business_profiles SET replies_generated_month = 0');
    console.log('✅ Monthly stats reset');
  } catch (error) {
    console.error('Monthly reset error:', error);
  }
});

// 404 handler
app.use((req, res) => {
  sendError(res, 404, 'Endpoint not found');
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  sendError(res, 500, 'Internal server error');
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Database: ${pool ? 'Connected' : 'Not connected'}`);
  console.log(`📱 Twilio: ${twilioClient ? 'Ready' : 'Not configured'}`);
  console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? 'Ready' : 'Not configured'}`);
  console.log(`⏰ Cron scheduler: Active (checking every minute)`);
});






































