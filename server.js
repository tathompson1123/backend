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
const { getRecommendedTemplate, getTemplateInfo } = require('./templates');
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
// PUBLIC BOOKING ENDPOINTS (No auth required)
// ============================================

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

// Google Business Profile API Endpoints

// ============================================
// GOOGLE BUSINESS PROFILE ENDPOINTS (SECURED)
// ============================================

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
          repliesToday: 0,
          repliesWeek: 0,
          repliesMonth: 0,
          lastReplyDate: null
        }
      });
    }

    res.json({
      success: true,
      stats: {
        repliesToday: result.rows[0].replies_generated_today || 0,
        repliesWeek: result.rows[0].replies_generated_week || 0,
        repliesMonth: result.rows[0].replies_generated_month || 0,
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

    await createReviewRequest(result.rows[0]);

    res.json({ job: result.rows[0] });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Failed to create job' });
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

app.put('/api/bookings/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { serviceId, bookingDate, startTime, customerInfo, notes, employeeId, groupId } = req.body;

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
           job_notes = $8,
           employee_id = $9,
           group_id = $10,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11 AND user_id = $12
       RETURNING *`,
      [
        bookingDate,
        startTime,
        endTime,
        customerInfo.name,
        customerInfo.email,
        customerInfo.phone,
        customerInfo.address,
        notes,
        employeeId,
        groupId || null,
        id,
        userId
      ]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (bookingResult.rows[0].customer_id) {
      await pool.query(
        `UPDATE customers 
         SET name = $1, email = $2, phone = $3
         WHERE id = $4`,
        [customerInfo.name, customerInfo.email, customerInfo.phone, bookingResult.rows[0].customer_id]
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
      message: 'Booking updated successfully'
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
    const htmlContent = data.content?.[0]?.text;
    
    if (!htmlContent) {
      console.error('❌ No HTML content in response');
      return res.status(500).json({ error: 'No content generated' });
    }

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
      businessName: safeBusinessName,
      bookingUrl,
      phoneNumber,
      address: fullAddress || null,
      serviceArea: serviceAreaText || null,
      pages: ['Home', 'Services', 'Gift Cards', 'Contact'],
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
    const token = jwt.sign({ userId: user.id, email: user.email }, EFFECTIVE_JWT_SECRET, { expiresIn: '7d' });

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

// ============================================
// WEBSITE ENDPOINTS (SECURED)
// ============================================

app.get('/api/website', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

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

app.post('/api/website', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { htmlContent } = req.body;

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
    
    console.log(`✅ Generated review reply for user ${userId}`);
    
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







