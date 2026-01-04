// server-review-automation.js - Complete Review Automation System
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';

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

async function createReviewRequest(job) {
  try {
    const userResult = await pool.query(
      'SELECT review_buffer_hours, google_place_id FROM users WHERE id = $1',
      [job.user_id]
    );

    if (userResult.rows.length === 0) return;

    const user = userResult.rows[0];
    const bufferHours = user.review_buffer_hours || 1;
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

async function sendReviewRequest(reviewRequest) {
  try {
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

// ============================================
// SERVICES ENDPOINTS
// ============================================

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

app.post('/api/jobs', async (req, res) => {
  try {
    const { userId, customerId, serviceId, scheduledStart, notes } = req.body;

    if (!userId || !customerId || !serviceId || !scheduledStart) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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

    const result = await pool.query(
      `INSERT INTO jobs (user_id, customer_id, service_id, service_name, scheduled_start, duration_hours, calculated_end, price, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, customerId, serviceId, service.name, scheduledStart, service.duration_hours, calculatedEnd, service.price, notes]
    );

    await createReviewRequest(result.rows[0]);

    res.json({ job: result.rows[0] });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

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
// ANALYTICS ENDPOINTS
// ============================================

app.get('/api/analytics/reviews', async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

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
// BUSINESS HOURS ENDPOINTS
// ============================================

app.get('/api/business-hours', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const result = await pool.query(
      'SELECT * FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
      [userId]
    );

    if (result.rows.length === 0) {
      const defaults = [
        { day_of_week: 0, is_open: false, open_time: null, close_time: null, day_name: 'Sunday' },
        { day_of_week: 1, is_open: true, open_time: '09:00', close_time: '17:00', day_name: 'Monday' },
        { day_of_week: 2, is_open: true, open_time: '09:00', close_time: '17:00', day_name: 'Tuesday' },
        { day_of_week: 3, is_open: true, open_time: '09:00', close_time: '17:00', day_name: 'Wednesday' },
        { day_of_week: 4, is_open: true, open_time: '09:00', close_time: '17:00', day_name: 'Thursday' },
        { day_of_week: 5, is_open: true, open_time: '09:00', close_time: '17:00', day_name: 'Friday' },
        { day_of_week: 6, is_open: true, open_time: '10:00', close_time: '14:00', day_name: 'Saturday' },
      ];
      return res.json({ businessHours: defaults });
    }

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const hoursWithNames = result.rows.map(row => ({
      ...row,
      day_name: daysOfWeek[row.day_of_week]
    }));

    res.json({ businessHours: hoursWithNames });
  } catch (error) {
    console.error('Error fetching business hours:', error);
    res.status(500).json({ error: 'Failed to fetch business hours' });
  }
});

app.post('/api/business-hours', async (req, res) => {
  try {
    const { userId, hours } = req.body;
    if (!userId || !hours || !Array.isArray(hours)) {
      return res.status(400).json({ error: 'userId and hours array required' });
    }

    await pool.query('DELETE FROM business_hours WHERE user_id = $1', [userId]);

    for (const day of hours) {
      await pool.query(
        `INSERT INTO business_hours (user_id, day_of_week, is_open, open_time, close_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, day.day_of_week, day.is_open, day.open_time, day.close_time]
      );
    }

    res.json({ success: true, message: 'Business hours updated' });
  } catch (error) {
    console.error('Error updating business hours:', error);
    res.status(500).json({ error: 'Failed to update business hours' });
  }
});

// ============================================
// BOOKING SETTINGS ENDPOINTS
// ============================================

app.get('/api/booking-settings', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

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

app.post('/api/booking-settings', async (req, res) => {
  try {
    const { userId, ...settings } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

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
// BOOKINGS ENDPOINTS
// ============================================

app.get('/api/bookings', async (req, res) => {
  try {
    const { userId, startDate, endDate, status } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

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

app.post('/api/bookings/create', async (req, res) => {
  try {
    const { userId, serviceId, bookingDate, startTime, customerInfo, customerNotes, employeeId } = req.body;

    if (!userId || !serviceId || !bookingDate || !startTime || !customerInfo) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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
        customer_phone, customer_notes, status, employee_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        userId, customerIdToUse, bookingNumber, bookingDate, startTime, endTime,
        service.price, service.price, customerInfo.name, customerInfo.email,
        customerInfo.phone, customerNotes || null, 'confirmed', assignedEmployeeId
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

// ============================================
// EMPLOYEE ENDPOINTS
// ============================================

app.get('/api/employees', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

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

app.post('/api/employees', async (req, res) => {
  try {
    const { userId, name, email, phone, color, serviceIds } = req.body;
    if (!userId || !name) {
      return res.status(400).json({ error: 'userId and name required' });
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

app.put('/api/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, color, active, serviceIds } = req.body;

    const result = await pool.query(
      `UPDATE employees
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           color = COALESCE($4, color),
           active = COALESCE($5, active)
       WHERE id = $6
       RETURNING *`,
      [name, email, phone, color, active, id]
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

app.delete('/api/employees/:id', async (req, res) => {
  try {
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

    await pool.query('DELETE FROM employees WHERE id = $1', [id]);
    res.json({ success: true, message: 'Employee deleted' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// ============================================
// AVAILABILITY CALCULATOR
// ============================================

app.get('/api/availability', async (req, res) => {
  try {
    const { userId, serviceId, date } = req.query;
    if (!userId || !serviceId || !date) {
      return res.status(400).json({ error: 'userId, serviceId, and date required' });
    }

    const serviceResult = await pool.query(
      'SELECT duration_hours FROM services WHERE id = $1',
      [serviceId]
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

    const bookingsResult = await pool.query(
      `SELECT employee_id, start_time, end_time 
       FROM bookings 
       WHERE user_id = $1 
       AND booking_date = $2 
       AND status NOT IN ('cancelled', 'no_show')
       AND employee_id IN (${availableEmployees.map((_, i) => `$${i + 3}`).join(',')})`,
      [userId, date, ...availableEmployees.map(e => e.id)]
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
// AI WEBSITE GENERATION ENDPOINT
// ============================================

app.post('/api/generate', async (req, res) => {
  try {
    const { businessName, businessType, services, description } = req.body;

    console.log('🎨 Generating website for:', businessName);

    if (!businessName || !businessType) {
      return res.status(400).json({ error: 'Business name and type are required' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ ANTHROPIC_API_KEY not set!');
      return res.status(500).json({ error: 'API key not configured' });
    }

    console.log('📡 Calling Anthropic API...');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: `You are an expert web designer creating high-converting, visually stunning websites for service-based businesses. Every website you generate must be production-ready, mobile-responsive, and optimized for conversions.

### CORE REQUIREMENTS

Every website MUST include these sections in order:

1. **Navigation Header** (sticky)
2. **Hero Section** with primary CTA
3. **Trust Indicators** (badges, stats, or social proof)
4. **Services Section**
5. **Why Choose Us / Features**
6. **Reviews / Testimonials**
7. **Book Online / CTA Section**
8. **Footer**

---

### SECTION SPECIFICATIONS

#### 1. NAVIGATION HEADER
Requirements:
- Sticky/fixed position with backdrop blur
- Logo on left
- Navigation links centered or right-aligned
- Primary CTA button (e.g., "Book Now") with accent color
- Mobile hamburger menu for responsive
- Subtle shadow or border on scroll

Links to include:
- Home
- Services
- Reviews
- Book Online (as button)
- Contact

#### 2. HERO SECTION
Requirements:
- Full viewport height (100vh) or near-full (90vh)
- High-quality background image with overlay
- Bold headline using display font (max 8 words)
- Supporting subheadline (1-2 sentences)
- Primary CTA button (large, high contrast)
- Optional: Secondary CTA or scroll indicator

Image Guidelines:
- Use professional stock from Unsplash/Pexels
- Show service in action or happy customers
- Apply dark gradient overlay (rgba(0,0,0,0.5)) for text readability

#### 3. TRUST INDICATORS
Requirements:
- Immediately after hero
- Display 3-5 key stats or trust badges
- Use icons or numbers prominently
- Examples: "500+ Happy Customers", "5-Star Rated", "Licensed & Insured", "Same Day Service"

Layout: Horizontal row with equal spacing, icon above text

#### 4. SERVICES SECTION
Requirements:
- Clear section heading
- Grid of service cards (2-4 columns)
- Each card includes:
  - High-quality image (4:3 or 1:1 ratio)
  - Service name
  - Brief description (2-3 sentences max)
  - Price or "Starting at $X" (optional)
  - "Learn More" or "Book Now" link
- Hover effects on cards (subtle lift/shadow)

Image Guidelines:
- Consistent aspect ratios across all cards
- Show the actual service being performed
- Use object-fit: cover for consistent sizing

#### 5. WHY CHOOSE US / FEATURES
Requirements:
- 3-6 key differentiators
- Icon + Headline + Description format
- Use meaningful icons (not generic)
- Keep descriptions under 30 words each

Common features for service businesses:
- Fast/Same-Day Service
- Licensed & Insured
- Satisfaction Guaranteed
- Transparent Pricing
- Professional Team
- 24/7 Availability
- Local & Trusted
- Eco-Friendly Options

#### 6. REVIEWS / TESTIMONIALS
Requirements:
- Minimum 3 reviews displayed
- Include: Customer name, review text, star rating
- Optional: Customer photo, date, service used
- Link to external reviews (Google, Yelp)

Layout: Card grid (3 columns)

Styling:
- Quote marks or icons
- Star ratings visually prominent
- Subtle card backgrounds
- Customer names in bold

#### 7. BOOK ONLINE / CTA SECTION
Requirements:
- High-contrast background (dark or accent color)
- Compelling headline ("Ready to Get Started?")
- Brief value reminder
- Prominent booking form OR booking button
- Phone number as alternative

Form fields (if inline form):
- Name, Email, Phone
- Service type (dropdown)
- Preferred date/time
- Message (optional)
- Submit button

#### 8. FOOTER
Requirements:
- Company logo and brief description
- Navigation links
- Contact information (address, phone, email)
- Business hours
- Social media icons
- Copyright notice

Layout: Multi-column grid

---

### DESIGN SPECIFICATIONS

#### Typography
Use Google Fonts - pair display + body fonts

Display fonts (headings): 
- Bebas Neue, Oswald, Montserrat, Poppins (700), Anton

Body fonts:
- DM Sans, Source Sans Pro, Open Sans, Lato, Nunito

Hierarchy:
- H1: 48-72px (mobile: 32-48px)
- H2: 36-48px (mobile: 28-36px)
- H3: 24-32px (mobile: 20-24px)
- Body: 16-18px

Line heights:
- Headings: 1.1-1.2
- Body: 1.5-1.7

#### Color System
Define CSS variables for consistency:

:root {
  --color-primary: /* Brand's main color */;
  --color-secondary: /* Supporting color */;
  --color-accent: /* CTA/highlight color - high contrast */;
  --color-dark: /* Near black for text */;
  --color-light: /* Off-white for backgrounds */;
  --color-gray: /* For secondary text */;
  --color-success: #10b981;
  --color-warning: #f59e0b;
}

Avoid:
- Pure black (#000000) - use #0a0a0a or similar
- Pure white backgrounds - use #f8f9fa or similar
- Low contrast text
- More than 3-4 colors total

#### Spacing System
Use consistent spacing scale:
--space-xs: 0.25rem;  /* 4px */
--space-sm: 0.5rem;   /* 8px */
--space-md: 1rem;     /* 16px */
--space-lg: 2rem;     /* 32px */
--space-xl: 4rem;     /* 64px */
--space-2xl: 6rem;    /* 96px */

#### Buttons
Primary CTA:
- background: var(--color-accent)
- color: white
- padding: 1rem 2rem
- border-radius: 8px
- font-weight: 600
- text-transform: uppercase
- letter-spacing: 0.05em
- transition: all 0.3s ease
- box-shadow: 0 4px 14px rgba(accent-color, 0.3)

Hover:
- transform: translateY(-2px)
- Enhanced shadow

#### Cards
- background: white
- border-radius: 12px
- box-shadow: 0 4px 6px rgba(0,0,0,0.05)
- transition: all 0.3s ease

Hover:
- transform: translateY(-4px)
- box-shadow: 0 12px 24px rgba(0,0,0,0.1)

---

### IMAGE REQUIREMENTS

- Use ONLY images that directly relate to the business type
- For auto detailing: cars being detailed, paint protection, ceramic coating application
- For ${businessType}: show the actual service being performed
- NEVER use generic stock photos of people or offices
- Search Unsplash for: "${businessType} service professional work"
- All images must show the SERVICE, not just people or buildings
Sources (use placeholder URLs):
Unsplash: https://images.unsplash.com/photo-[ID]?w=800&q=80

Always include:
- width parameter (w=800, w=1200, etc.)
- quality parameter (q=80)

Image Optimization:
<img 
  src="image-url" 
  alt="Descriptive alt text"
  loading="lazy"
  width="800"
  height="600"
  style="object-fit: cover;"
>

Recommended sizes:
- Hero background: 1920x1080 minimum
- Service cards: 800x600 (4:3) or 800x800 (1:1)
- Testimonial avatars: 100x100

---

### RESPONSIVE DESIGN

Mobile first approach:

Base styles: Mobile (< 640px)

@media (min-width: 640px) { /* Tablet */ }
@media (min-width: 1024px) { /* Desktop */ }
@media (min-width: 1280px) { /* Large desktop */ }

Mobile considerations:
- Stack all grid columns
- Reduce font sizes by 20-30%
- Full-width buttons
- Hamburger menu navigation
- Reduce padding/margins
- Single column testimonials
- Touch-friendly tap targets (min 44px)

---

### ANIMATIONS & INTERACTIONS

Smooth scroll:
html { scroll-behavior: smooth; }

Base transition:
transition: all 0.3s ease;

Hover effects:
- Buttons: translateY(-2px) + enhanced shadow
- Cards: translateY(-4px) + enhanced shadow
- Links: color change + optional underline

---

### ACCESSIBILITY REQUIREMENTS

1. Color contrast: Minimum 4.5:1 for body text
2. Alt text on all images
3. Semantic HTML (header, nav, main, section, footer)
4. Keyboard navigation support
5. Focus states visible on all interactive elements
6. Form labels associated with inputs

---

### SEO ESSENTIALS

<head>
  <title>Business Name | Primary Service | Location</title>
  <meta name="description" content="150-160 character description">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>

Use semantic headings: One H1, logical H2/H3 hierarchy

---

### OUTPUT FORMAT

Output a single HTML file with:
1. Embedded CSS in <style> tags
2. Embedded JavaScript in <script> tags at end of body
3. Google Fonts linked in head
4. All sections complete and functional
5. Real placeholder images from Unsplash
6. Placeholder text matching business type (not lorem ipsum)
7. Working navigation links (anchor links)
8. Mobile responsive design

---

### BUSINESS TYPE CUSTOMIZATION

Home Services (cleaning, landscaping, HVAC, plumbing):
- Before/after imagery
- "Licensed & Insured" badges
- Emergency service availability
- Service area map

Health & Wellness (spa, salon, massage, fitness):
- Calming, luxurious imagery
- Online booking prominent
- Service menu with pricing
- Team/practitioner profiles

Professional Services (consulting, legal, financial):
- Professional headshots
- Credentials/certifications
- Case studies or results
- Consultation booking

Automotive (detailing, repair, towing):
- Action shots of services
- Pricing packages
- Fleet/commercial services
- Location/hours prominent

Food & Hospitality (catering, restaurants):
- High-quality food photography
- Menus/packages
- Event booking
- Dietary accommodations

---

### QUALITY CHECKLIST

Verify:
- All navigation links work
- CTA buttons are prominent and high-contrast
- Mobile responsive (test at 375px width)
- Images have alt text
- Contact information is visible
- Booking/CTA is easy to find
- Typography is readable
- Consistent spacing throughout
- No horizontal scroll on mobile
- Forms have proper labels
- Professional, cohesive visual design

---

Now generate a website for: ${businessName}
Business Type: ${businessType}
Services: ${services}
Description: ${description}

Return ONLY the complete HTML code. No markdown, no explanations, just the HTML starting with <!DOCTYPE html>.`
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
    console.log('✅ API Response received');
    console.log('Content blocks:', data.content?.length);

    const htmlContent = data.content?.[0]?.text;
    
console.log('📏 Raw HTML length:', htmlContent?.length);
console.log('🔍 Starts with DOCTYPE?', htmlContent?.startsWith('<!DOCTYPE'));
console.log('🔍 Contains ```html?', htmlContent?.includes('```html'));
console.log('🔍 First 300 chars:', htmlContent?.substring(0, 300));
    
    if (!htmlContent) {
      console.error('❌ No HTML content in response:', data);
      return res.status(500).json({ error: 'No content generated', details: 'API returned empty response' });
    }

    // Clean up any markdown formatting that Claude might add
    let cleanHtml = htmlContent.trim();

    // Remove markdown code blocks if present
    if (cleanHtml.includes('```html')) {
      cleanHtml = cleanHtml.replace(/```html\n?/g, '').replace(/```\n?$/g, '');
      console.log('🧹 Removed markdown code blocks');
    }

    // Remove any remaining triple backticks
    cleanHtml = cleanHtml.replace(/```/g, '');

    // Verify HTML starts correctly
    if (!cleanHtml.startsWith('<!DOCTYPE')) {
      console.warn('⚠️ HTML does not start with DOCTYPE');
      console.log('First 100 chars:', cleanHtml.substring(0, 100));
    }

    console.log('✅ HTML generated, length:', cleanHtml.length);
    console.log('✅ Preview (first 200 chars):', cleanHtml.substring(0, 200));

    res.json({ 
      success: true, 
      html: cleanHtml,
      businessName
    });

  } catch (error) {
    console.error('❌ Error generating website:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

console.log('✅ Generate endpoint loaded');

// ============================================
// AUTHENTICATION ENDPOINTS
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

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, business_name, plan, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       RETURNING id, email, name, business_name, plan`,
      [
        email.toLowerCase(), 
        hashedPassword, 
        fullName || businessName || 'User',
        businessName || 'My Business', 
        'free'
      ]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    console.log('✅ New user:', email);

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

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

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

    const decoded = jwt.verify(token, JWT_SECRET);

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
  try {
    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      error: 'Logout failed',
      message: error.message 
    });
  }
});

console.log('✅ Auth endpoints loaded (signup, login, verify, logout)');

// ============================================
// WEBSITE ENDPOINTS
// ============================================

app.get('/api/website', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const result = await pool.query(
      'SELECT * FROM websites WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    res.json({ 
      website: result.rows[0] || null 
    });
  } catch (error) {
    console.error('Error fetching website:', error);
    res.status(500).json({ error: 'Failed to fetch website' });
  }
});

app.post('/api/website', async (req, res) => {
  try {
    const { userId, htmlContent } = req.body;

    if (!userId || !htmlContent) {
      return res.status(400).json({ error: 'userId and htmlContent required' });
    }

    const existing = await pool.query(
      'SELECT id FROM websites WHERE user_id = $1',
      [userId]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE websites 
         SET html_content = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2
         RETURNING *`,
        [htmlContent, userId]
      );
    } else {
      result = await pool.query(
        `INSERT INTO websites (user_id, html_content, is_published, created_at, updated_at)
         VALUES ($1, $2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [userId, htmlContent]
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

app.post('/api/website/publish', async (req, res) => {
  try {
    const { userId, isPublished } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

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

app.post('/api/website/domain', async (req, res) => {
  try {
    const { userId, customDomain } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

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
// ============================================
// WEBSITE EDITOR ENDPOINTS
// ============================================

// Simple AI-powered website editor
app.post('/api/website/ai-edit', async (req, res) => {
  try {
    const { userId, currentHTML, userRequest } = req.body;

    if (!userId || !currentHTML || !userRequest) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    console.log(`🎨 AI Editor Request from user ${userId}: "${userRequest}"`);

    // Call Claude API to modify the website
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `You are a website editor AI. The user wants to modify their website HTML.

Current HTML:
${currentHTML}

User's Request: ${userRequest}

Please modify the HTML according to the user's request and return ONLY the complete updated HTML.

INSTRUCTIONS:
1. Make ONLY the changes requested
2. Keep all existing styling, scripts, and functionality
3. Return the COMPLETE updated HTML
4. Make sure all HTML tags are properly closed
5. DO NOT add markdown formatting or code blocks
6. Return ONLY the HTML starting with <!DOCTYPE html>

Return the updated HTML now.`
        }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Claude API error:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to process edit request' 
      });
    }

    const data = await response.json();
    let updatedHTML = data.content[0].text;

    // Clean up any markdown formatting
    if (updatedHTML.includes('```html')) {
      updatedHTML = updatedHTML.replace(/```html\n?/g, '').replace(/```\n?$/g, '');
    }
    updatedHTML = updatedHTML.replace(/```/g, '').trim();

    console.log(`✅ Website edited successfully, length: ${updatedHTML.length}`);

    // Generate a simple explanation message
    const message = `I've updated your website as requested. Check the preview to see the changes!`;

    res.json({
      success: true,
      updatedHTML: updatedHTML,
      message: message
    });

  } catch (error) {
    console.error('❌ AI edit error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process AI edit request',
      message: error.message
    });
  }
});

console.log('✅ Website endpoints loaded');
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

// ============================================
// CRON JOB
// ============================================

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
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Database: ${pool ? 'Connected' : 'Not connected'}`);
  console.log(`📱 Twilio: ${twilioClient ? 'Ready' : 'Not configured'}`);
  console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? 'Ready' : 'Not configured'}`);
  console.log(`⏰ Cron scheduler: Active (checking every minute)`);
});








