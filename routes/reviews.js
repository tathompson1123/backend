// ============================================
// REVIEWS ROUTES  
// Import Google Business reviews
// ============================================

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

router.post('/import-google', authenticateToken, async (req, res) => {
  try {
    const { googleUrl } = req.body;

    if (!googleUrl) {
      return res.status(400).json({ error: 'Google Business URL is required' });
    }

    let placeId = null;

    if (googleUrl.includes('maps.google.com') || googleUrl.includes('google.com/maps')) {
      const dataMatch = googleUrl.match(/!1s([A-Za-z0-9_-]+)/);
      if (dataMatch) {
        placeId = dataMatch[1];
      }

      const cidMatch = googleUrl.match(/cid=(d+)/);
      if (cidMatch && !placeId) {
        return res.status(400).json({
          error: 'CID format detected. Please use a direct Google Maps link or place ID.'
        });
      }
    } else {
      placeId = googleUrl.trim();
    }

    if (!placeId) {
      return res.status(400).json({
        error: 'Could not extract Place ID. Please provide a valid Google Business Profile link.'
      });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: 'Google Places API key not configured. Add GOOGLE_PLACES_API_KEY to .env'
      });
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,user_ratings_total&key=${apiKey}`
    );

    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(400).json({
        error: `Google API error: ${data.status}. ${data.error_message || ''}`
      });
    }

    const googleReviews = data.result?.reviews || [];

    if (googleReviews.length === 0) {
      return res.json({ reviews: [], message: 'No reviews found.' });
    }

    const transformedReviews = googleReviews.map(review => ({
      name: review.author_name,
      date: review.relative_time_description || 'Recently',
      text: review.text,
      stars: review.rating,
      avatarColor: getRandomColor(),
      author: review.author_name,
      rating: review.rating
    }));

    res.json({
      reviews: transformedReviews,
      totalReviews: data.result.user_ratings_total,
      averageRating: data.result.rating,
      placeId: placeId
    });

  } catch (error) {
    console.error('Error importing Google reviews:', error);
    res.status(500).json({ error: 'Failed to import reviews: ' + error.message });
  }
});

function getRandomColor() {
  const colors = ['#d97706', '#059669', '#dc2626', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a'];
  return colors[Math.floor(Math.random() * colors.length)];
}

module.exports = router;
