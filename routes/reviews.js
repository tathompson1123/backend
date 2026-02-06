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
    console.error('Error scraping Google reviews:', error);

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

module.exports = router;
