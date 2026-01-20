const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

// GET - Fetch review requests
router.get('/review-requests', authenticateToken, async (req, res) => {
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

    const requests = result.rows.map(row => ({
      id: row.id,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      customer_phone: row.customer_phone,
      service_name: row.service_name,
      incentive_code: row.incentive_code,
      status: row.review_completed ? 'completed' : 
              (row.step1_status === 'sent' || row.step2_status === 'sent') ? 'sent' : 'pending',
      scheduled_send_time: row.step1_scheduled_time,
      actual_send_time: row.step1_sent_time || row.step2_sent_time,
      sms_sent: row.step1_sms_sent || row.step2_sms_sent,
      email_sent: row.step3_email_sent || row.step4_email_sent,
      link_clicked: row.link_clicked,
      review_completed: row.review_completed
    }));

    res.json({ success: true, requests });
  } catch (error) {
    console.error('Error fetching review requests:', error);
    res.status(500).json({ error: 'Failed to fetch review requests' });
  }
});

// GET - Fetch Google Business profile
router.get('/profile', authenticateToken, async (req, res) => {
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

// POST - Create/update Google Business profile
router.post('/profile', authenticateToken, async (req, res) => {
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

// GET - Review reply statistics
router.get('/stats', authenticateToken, async (req, res) => {
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
        stats: { today: 0, week: 0, month: 0, lastReplyDate: null }
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

// POST - Generate AI reply for Google review
router.post('/generate-reply', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reviewText, rating, businessName, customerName } = req.body;

    if (!reviewText || !rating) {
      return res.status(400).json({ error: 'reviewText and rating required' });
    }

    const safeReviewText = reviewText.substring(0, 500);
    const safeBusinessName = businessName || 'our business';
    const safeCustomerName = customerName || '';
    
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
    
    // Increment stats
    await pool.query(
      `INSERT INTO google_business_profiles (
        user_id, replies_generated_today, replies_generated_week, 
        replies_generated_month, last_reply_date
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
    
    console.log(`✅ Generated review reply for user ${userId}`);
    
    res.json({ success: true, reply });
    
  } catch (error) {
    console.error('AI reply generation error:', error);
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

// POST - Save user's Google review link
router.post('/review-link', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reviewLink } = req.body;

    if (!reviewLink || !reviewLink.trim()) {
      return res.status(400).json({ error: 'Review link is required' });
    }

    const link = reviewLink.toLowerCase();
    if (!link.includes('g.page') && !link.includes('google.com')) {
      return res.status(400).json({ 
        error: 'Invalid link. Must be a Google review link (g.page or google.com)' 
      });
    }

    await pool.query(
      'UPDATE users SET google_review_link = $1 WHERE id = $2',
      [reviewLink.trim(), userId]
    );

    res.json({
      success: true,
      message: 'Google review link saved successfully',
      reviewLink: reviewLink.trim()
    });
  } catch (error) {
    console.error('Error saving Google review link:', error);
    res.status(500).json({ error: 'Failed to save Google review link' });
  }
});

module.exports = router;
