// ============================================
// REVIEWS ROUTES
// Import Google Business reviews via web scraping
// ============================================

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../config/middleware');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

router.post('/import-google', authenticateToken, async (req, res) => {
  let browser;

  try {
    const { googleUrl } = req.body;

    if (!googleUrl) {
      return res.status(400).json({ error: 'Google Business URL is required' });
    }

    // Validate it's a Google Maps URL
    if (!googleUrl.includes('google.com/maps') && !googleUrl.includes('maps.google.com')) {
      return res.status(400).json({
        error: 'Please provide a valid Google Maps URL'
      });
    }

    console.log('Launching browser to scrape reviews...');

    // Launch headless browser
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: await chromium.executablePath(),
      headless: 'new',
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('Navigating to:', googleUrl);
    await page.goto(googleUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for reviews to load
    await page.waitForTimeout(3000);

    // Try to click "See all reviews" button if it exists
    try {
      const moreReviewsButton = await page.$('button[aria-label*="reviews"]');
      if (moreReviewsButton) {
        await moreReviewsButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('No "more reviews" button found, continuing...');
    }

    // Scroll to load more reviews
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const scrollable = document.querySelector('div[role="main"]') ||
                          document.querySelector('.m6QErb') ||
                          document.documentElement;
        scrollable.scrollTop = scrollable.scrollHeight;
      });
      await page.waitForTimeout(1500);
    }

    // Extract reviews from the page
    const reviews = await page.evaluate(() => {
      const reviewElements = document.querySelectorAll('div.jftiEf, div.gws-localreviews__google-review, [data-review-id], div[aria-label*="stars"]');
      const extracted = [];

      // Try multiple selectors for different Google Maps layouts
      const allPossibleReviews = Array.from(document.querySelectorAll('div[jslog*="review"], div[data-review-id], .gws-localreviews__google-review'));

      for (const elem of allPossibleReviews) {
        try {
          const nameEl = elem.querySelector('div.d4r55, .TSUbDb a, button.WNxzHc span') || elem.querySelector('[class*="name"]');
          const textEl = elem.querySelector('span.wiI7pd, .Jtu6Td span, .MyEned span.wiI7pd') || elem.querySelector('[class*="review-text"]');
          const starsAttr = elem.querySelector('[aria-label*="stars"]') || elem;
          const dateEl = elem.querySelector('span.rsqaWe, .DU9Pgb') || elem.querySelector('[class*="date"]');

          const name = nameEl?.textContent?.trim();
          let stars = 5;

          // Extract star rating from aria-label
          const ariaLabel = starsAttr?.getAttribute('aria-label') || '';
          const starsMatch = ariaLabel.match(/(\d+)\s*star/);
          if (starsMatch) {
            stars = parseInt(starsMatch[1]);
          }

          const text = textEl?.textContent?.trim();
          const date = dateEl?.textContent?.trim();

          if (name && text) {
            extracted.push({ name, text, stars, date: date || 'Recently' });
          }
        } catch (err) {
          // Skip this review if extraction fails
        }
      }

      return extracted;
    });

    await browser.close();
    browser = null;

    if (reviews.length === 0) {
      return res.json({
        reviews: [],
        message: 'No reviews found. Try using the full Google Maps link with reviews visible.'
      });
    }

    // Transform to our format
    const transformedReviews = reviews.map(review => ({
      name: review.name,
      date: review.date,
      text: review.text,
      stars: review.stars || 5,
      avatarColor: getRandomColor(),
      author: review.name,
      rating: review.stars || 5
    }));

    res.json({
      reviews: transformedReviews,
      totalReviews: reviews.length,
      averageRating: (reviews.reduce((acc, r) => acc + (r.stars || 5), 0) / reviews.length).toFixed(1)
    });

  } catch (error) {
    console.error('Error scraping Google reviews:', error.message);

    if (browser) {
      await browser.close().catch(e => console.error('Error closing browser:', e));
    }

    res.status(500).json({
      error: 'Failed to scrape reviews. Please ensure the URL is correct and accessible.',
      details: error.message
    });
  }
});

function getRandomColor() {
  const colors = ['#d97706', '#059669', '#dc2626', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ============================================
// FETCH REVIEWS VIA GOOGLE PLACES API
// ============================================

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_BASE = 'https://places.googleapis.com/v1';

router.post('/fetch-reviews', authenticateToken, async (req, res) => {
  try {
    const { placeId, query } = req.body;

    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Google Places API key not configured' });
    }

    let targetPlaceId = placeId;

    // If no placeId, search by query
    if (!targetPlaceId && query) {
      const searchRes = await fetch(`${PLACES_BASE}/places:searchText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName'
        },
        body: JSON.stringify({ textQuery: query, maxResultCount: 1 })
      });
      const searchData = await searchRes.json();
      targetPlaceId = searchData.places?.[0]?.id;

      if (!targetPlaceId) {
        return res.status(404).json({ error: 'Business not found. Try a more specific search.' });
      }
    }

    if (!targetPlaceId) {
      return res.status(400).json({ error: 'Please provide a Place ID or search query' });
    }

    // Fetch place details with reviews
    const detailRes = await fetch(`${PLACES_BASE}/places/${targetPlaceId}`, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'id,displayName,reviews,rating,userRatingCount'
      }
    });
    const place = await detailRes.json();

    if (!place.reviews || place.reviews.length === 0) {
      return res.json({ reviews: [], message: 'No reviews found for this business.', placeId: targetPlaceId });
    }

    const transformedReviews = place.reviews.map(r => ({
      name: r.authorAttribution?.displayName || 'Customer',
      text: r.text?.text || r.originalText?.text || '',
      stars: r.rating || 5,
      date: r.relativePublishTimeDescription || 'Recently',
      avatarColor: getRandomColor(),
      author: r.authorAttribution?.displayName || 'Customer',
      rating: r.rating || 5
    })).filter(r => r.text);

    res.json({
      reviews: transformedReviews,
      totalReviews: place.userRatingCount || transformedReviews.length,
      averageRating: place.rating || 0,
      businessName: place.displayName?.text || '',
      placeId: targetPlaceId
    });
  } catch (error) {
    console.error('Error fetching Google reviews:', error.message);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// ============================================
// REVIEW REPLY GENERATION
// ============================================

const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('../utils/claudeUsage');
const { pool } = require('../config/database');

// GET - Stats for reply generation
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const todayResult = await pool.query(
      `SELECT COUNT(*) as count FROM review_replies
       WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
      [req.user.userId]
    );

    const weekResult = await pool.query(
      `SELECT COUNT(*) as count FROM review_replies
       WHERE user_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'`,
      [req.user.userId]
    );

    res.json({
      success: true,
      stats: {
        today: parseInt(todayResult.rows[0]?.count || 0),
        week: parseInt(weekResult.rows[0]?.count || 0)
      }
    });
  } catch (error) {
    console.error('Error fetching review stats:', error.message);
    res.json({ success: true, stats: { today: 0, week: 0 } });
  }
});

// GET - Review requests history
// GET /api/google-business/review-diagnostics
// Why a booking did or didn't get its review text, for the signed-in business.
// Walks the same gates the two crons apply, so a customer who was skipped shows a
// reason in the dashboard instead of just being absent.
router.get('/review-diagnostics', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const days = parseInt(req.query.days, 10) || 30;

    const cfg = (await pool.query(
      `SELECT auto_send_enabled, send_trigger, send_delay FROM review_configs WHERE user_id = $1`,
      [userId]
    )).rows[0] || null;

    const rows = (await pool.query(
      `SELECT b.id AS booking_id, b.status AS booking_status, b.booking_date,
              b.start_time, b.end_time, b.customer_id,
              c.name AS customer_name, c.phone AS customer_phone, c.sms_unsubscribed,
              rr.id AS review_request_id, rr.status AS rr_status, rr.sms_sent,
              rr.scheduled_send_time
       FROM bookings b
       LEFT JOIN customers c ON c.id = b.customer_id
       LEFT JOIN review_requests rr ON rr.booking_id = b.id
       WHERE b.user_id = $1 AND b.booking_date >= CURRENT_DATE - ($2::int)
       ORDER BY b.booking_date DESC, b.start_time DESC`,
      [userId, days]
    )).rows;

    const bookings = rows.map(b => {
      let status, reason;
      if (b.sms_sent) { status = 'sent'; reason = 'Review text sent'; }
      else if (!cfg?.auto_send_enabled) { status = 'blocked'; reason = 'Auto-send is turned off'; }
      else if (b.booking_status === 'cancelled') { status = 'skipped'; reason = 'Booking was cancelled'; }
      else if (!b.customer_id) { status = 'blocked'; reason = 'No customer attached to this booking, so there is nobody to text'; }
      else if (!b.review_request_id) {
        if (cfg.send_trigger === 'booking_completed' && b.booking_status !== 'completed') {
          status = 'waiting'; reason = `Mark this booking completed to trigger the request (currently "${b.booking_status}")`;
        } else {
          status = 'waiting'; reason = 'Not due yet — the service end time plus your delay has not passed';
        }
      }
      else if (!b.customer_phone) { status = 'blocked'; reason = 'This customer has no phone number on file'; }
      else if (b.sms_unsubscribed) { status = 'blocked'; reason = 'This customer replied STOP and cannot be texted'; }
      else if (b.rr_status === 'sms_limit_reached') { status = 'blocked'; reason = 'Monthly SMS limit reached on your plan'; }
      else if (b.rr_status === 'skipped') { status = 'blocked'; reason = 'Your plan has no SMS allowance'; }
      else if (b.scheduled_send_time && new Date(b.scheduled_send_time) > new Date()) {
        status = 'waiting'; reason = `Queued — sends ${new Date(b.scheduled_send_time).toLocaleString('en-US')}`;
      }
      else { status = 'waiting'; reason = 'Queued and due — should send within a few minutes'; }
      return { ...b, diagnostic_status: status, reason };
    });

    res.json({ success: true, config: cfg, bookings });
  } catch (error) {
    console.error('Review diagnostics error:', error.message);
    res.status(500).json({ error: 'Failed to load review diagnostics' });
  }
});

router.get('/review-requests', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM review_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.userId]
    );

    res.json({ success: true, requests: result.rows });
  } catch (error) {
    console.error('Error fetching review requests:', error.message);
    res.json({ success: true, requests: [] });
  }
});

// POST - Generate AI reply to a review
router.post('/generate-reply', authenticateToken, async (req, res) => {
  try {
    const { reviewText, rating, businessName, customerName } = req.body;

    if (!reviewText) {
      return res.status(400).json({ success: false, error: 'Review text is required' });
    }

    const anthropic = new Anthropic();

    const sentiment = rating >= 4 ? 'positive' : rating >= 3 ? 'neutral' : 'negative';

    const prompt = `You are a professional business owner responding to a customer review. Generate a warm, authentic reply.

Business Name: ${businessName || 'Our Business'}
Customer Name: ${customerName || 'Customer'}
Star Rating: ${rating}/5 (${sentiment} review)
Review Text: "${reviewText}"

Guidelines:
- Be genuine and personal, not corporate
- Thank them for their feedback
- If positive: express gratitude and invite them back
- If negative: apologize sincerely, offer to make it right, provide contact info
- Keep it concise (2-4 sentences)
- Don't be overly formal or use generic phrases
- Match the tone to the review sentiment

Generate ONLY the reply text, no quotes or labels.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    logClaudeUsage(req.user.userId, 'claude-sonnet-4-6', message.usage, 'review_reply');
    const reply = message.content[0].text.trim();

    // Log the reply generation
    try {
      await pool.query(
        `INSERT INTO review_replies (user_id, review_text, rating, generated_reply, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [req.user.userId, reviewText.substring(0, 500), rating, reply]
      );
    } catch (dbErr) {
      console.warn('Could not log review reply:', dbErr.message);
    }

    console.log(`✅ Generated review reply for user ${req.user.userId}`);
    res.json({ success: true, reply });

  } catch (error) {
    console.error('Error generating review reply:', error.message);
    res.status(500).json({ success: false, error: 'Failed to generate reply' });
  }
});

// ============================================
// MONTHLY REVIEW RAFFLE
// ============================================
const reviewRaffle = require('../utils/reviewRaffle');

// GET - Raffle history (past monthly draws)
router.get('/raffles', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, period, winner_name, winner_phone, reward, consolation,
              pool_size, texts_sent, status, notes, created_at
       FROM review_raffles
       WHERE user_id = $1
       ORDER BY period DESC, created_at DESC
       LIMIT 36`,
      [req.user.userId]
    );
    res.json({ success: true, raffles: result.rows });
  } catch (error) {
    console.error('Error fetching raffles:', error.message);
    res.json({ success: true, raffles: [] });
  }
});

// GET - Current month's raffle pool (preview, no draw)
router.get('/raffle/pool', authenticateToken, async (req, res) => {
  try {
    const period = req.query.period || reviewRaffle.periodOf();
    const pool_ = await reviewRaffle.previewPool(req.user.userId, period);
    res.json({
      success: true,
      period,
      poolSize: pool_.length,
      verifiedCount: pool_.filter(p => p.verified).length,
      pool: pool_
    });
  } catch (error) {
    console.error('Error previewing raffle pool:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load raffle pool' });
  }
});

// POST - Manually draw a raffle now (defaults to previous month).
// Pass { dryRun: true } to preview the winner without sending texts.
router.post('/raffle/run', authenticateToken, async (req, res) => {
  try {
    const period = req.body.period || reviewRaffle.previousPeriod();
    const dryRun = !!req.body.dryRun;
    const result = await reviewRaffle.runRaffleForUser(req.user.userId, period, { dryRun });
    res.json({ success: true, result });
  } catch (error) {
    console.error('Error running raffle:', error.message);
    res.status(500).json({ success: false, error: 'Failed to run raffle' });
  }
});

// GET - list Google Review SMS conversations (grouped by review_request)
router.get('/review-sms-conversations', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rr.id AS review_request_id,
              COALESCE(NULLIF(rr.customer_name, ''), c.name) AS customer_name,
              COALESCE(NULLIF(rr.customer_phone, ''), c.phone) AS customer_phone,
              rr.status,
              COUNT(s.id)::int AS message_count,
              MAX(s.created_at) AS last_message_at,
              (SELECT s2.message FROM sms_messages s2 WHERE s2.review_request_id = rr.id ORDER BY s2.created_at DESC LIMIT 1) AS last_message,
              (SELECT s2.direction FROM sms_messages s2 WHERE s2.review_request_id = rr.id ORDER BY s2.created_at DESC LIMIT 1) AS last_direction
       FROM review_requests rr
       JOIN sms_messages s ON s.review_request_id = rr.id
       LEFT JOIN customers c ON c.id = rr.customer_id
       WHERE rr.user_id = $1
       GROUP BY rr.id, rr.customer_name, c.name, rr.customer_phone, c.phone, rr.status
       ORDER BY MAX(s.created_at) DESC`,
      [req.user.userId]
    );
    res.json({ success: true, conversations: result.rows });
  } catch (error) {
    console.error('Error fetching review SMS conversations:', error.message);
    res.status(500).json({ error: 'Failed to fetch review conversations' });
  }
});

// GET - full thread for one review conversation
router.get('/review-sms-conversation/:id', authenticateToken, async (req, res) => {
  try {
    const own = await pool.query('SELECT id FROM review_requests WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (own.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    const messages = await pool.query(
      `SELECT direction, to_number, from_number, message, created_at
       FROM sms_messages
       WHERE review_request_id = $1 AND user_id = $2
       ORDER BY created_at ASC`,
      [req.params.id, req.user.userId]
    );
    res.json({ success: true, messages: messages.rows });
  } catch (error) {
    console.error('Error fetching review SMS conversation:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

module.exports = router;
