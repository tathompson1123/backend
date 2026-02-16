const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_BASE = 'https://places.googleapis.com/v1';

// ─── Helper: Parse Google Maps URL ──────────────────────────
function parseGoogleUrl(url) {
  const result = { name: null, lat: null, lng: null };
  try {
    // Format: /maps/place/Business+Name/@lat,lng,...
    const placeMatch = url.match(/\/maps\/place\/([^/@]+)/);
    if (placeMatch) {
      result.name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    }
    const coordMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (coordMatch) {
      result.lat = parseFloat(coordMatch[1]);
      result.lng = parseFloat(coordMatch[2]);
    }
  } catch {}
  return result;
}

// ─── Helper: Places API Text Search ─────────────────────────
async function searchPlace(query, lat, lng) {
  const body = { textQuery: query, maxResultCount: 1 };
  if (lat && lng) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 5000 }
    };
  }
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return data.places?.[0] || null;
}

// ─── Helper: Places API Details ─────────────────────────────
async function getPlaceDetails(placeId) {
  const fields = [
    'id', 'displayName', 'formattedAddress', 'nationalPhoneNumber',
    'internationalPhoneNumber', 'websiteUri', 'regularOpeningHours',
    'photos', 'reviews', 'rating', 'userRatingCount', 'types',
    'primaryType', 'primaryTypeDisplayName', 'businessStatus',
    'editorialSummary', 'googleMapsUri', 'location'
  ].join(',');

  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': fields
    }
  });
  return res.json();
}

// ─── Helper: Compute Audit ──────────────────────────────────
function computeAudit(profile) {
  const good = [];
  const improvements = [];
  const scores = { completeness: 0, contentMedia: 0, reviews: 0, engagement: 0 };

  // ── Profile Completeness (30% weight) ──
  let completenessPoints = 0;
  const completenessMax = 6;

  if (profile.business_name) {
    good.push({ title: 'Business Name', value: profile.business_name, note: 'Name is set and visible' });
    completenessPoints++;
  } else {
    improvements.push({ title: 'Business Name', currentStatus: 'Missing', recommendation: 'Add your business name', priority: 'critical' });
  }

  if (profile.primary_category) {
    good.push({ title: 'Primary Category', value: profile.primary_category, note: 'Category helps you appear in relevant searches' });
    completenessPoints++;
  } else {
    improvements.push({ title: 'Primary Category', currentStatus: 'Not set', recommendation: 'Choose the most relevant primary category for your business', priority: 'critical' });
  }

  const additionalCats = profile.additional_categories || [];
  if (additionalCats.length >= 2) {
    good.push({ title: 'Additional Categories', value: `${additionalCats.length} categories`, note: 'Multiple categories increase search visibility' });
    completenessPoints++;
  } else {
    improvements.push({ title: 'Additional Categories', currentStatus: `${additionalCats.length} set`, recommendation: 'Add 2-5 relevant secondary categories to appear in more searches', priority: 'high' });
  }

  if (profile.phone) {
    good.push({ title: 'Phone Number', value: profile.phone, note: 'Customers can call you directly from search' });
    completenessPoints++;
  } else {
    improvements.push({ title: 'Phone Number', currentStatus: 'Missing', recommendation: 'Add a phone number so customers can reach you', priority: 'critical' });
  }

  if (profile.website) {
    good.push({ title: 'Website', value: profile.website, note: 'Website linked to your profile' });
    completenessPoints++;
    if (profile.has_website_utm) {
      good.push({ title: 'UTM Tracking', value: 'Enabled', note: 'You can track GBP traffic separately in analytics' });
    } else {
      improvements.push({ title: 'UTM Tracking', currentStatus: 'Not configured', recommendation: 'Add UTM parameters to your GBP website URL to track traffic in Google Analytics (e.g. ?utm_source=google&utm_medium=organic&utm_campaign=gbp)', priority: 'medium' });
    }
  } else {
    improvements.push({ title: 'Website', currentStatus: 'Missing', recommendation: 'Add your website URL to drive traffic from your profile', priority: 'critical' });
  }

  if (profile.hours_complete) {
    good.push({ title: 'Business Hours', value: 'Complete', note: 'Customers know when you\'re available' });
    completenessPoints++;
  } else {
    improvements.push({ title: 'Business Hours', currentStatus: 'Incomplete or missing', recommendation: 'Set complete business hours including special/holiday hours', priority: 'high' });
  }

  if (profile.description) {
    good.push({ title: 'Description', value: `${profile.description.length} chars`, note: 'Helps customers understand your business' });
  } else {
    improvements.push({ title: 'Business Description', currentStatus: 'Not set', recommendation: 'Write a compelling 750-character description with relevant keywords describing your services and area', priority: 'high' });
  }

  scores.completeness = Math.round((completenessPoints / completenessMax) * 100);

  // ── Content & Media (25% weight) ──
  let contentPoints = 0;
  const contentMax = 3;

  const photoCount = profile.total_photos || 0;
  if (photoCount >= 10) {
    good.push({ title: 'Photos', value: `${photoCount} photos`, note: 'Good photo count — keep adding regularly' });
    contentPoints += 2;
  } else if (photoCount >= 3) {
    improvements.push({ title: 'Photos', currentStatus: `${photoCount} photos`, recommendation: `Upload ${10 - photoCount} more high-quality photos of your business, team, and services (target: 10+)`, priority: 'high' });
    contentPoints += 1;
  } else {
    improvements.push({ title: 'Photos', currentStatus: photoCount === 0 ? 'No photos' : `Only ${photoCount} photo(s)`, recommendation: 'Upload at least 10 high-quality photos of your business, team, products, and services', priority: 'critical' });
  }

  if (profile.website && profile.has_website_utm) {
    contentPoints++;
  }

  scores.contentMedia = Math.round((contentPoints / contentMax) * 100);

  // ── Reviews & Reputation (30% weight) ──
  let reviewPoints = 0;
  const reviewMax = 5;

  const reviewCount = profile.total_reviews || 0;
  const rating = profile.average_rating || 0;
  const responseRate = profile.review_response_rate || 0;

  if (reviewCount >= 50) {
    good.push({ title: 'Review Count', value: `${reviewCount} reviews`, note: 'Strong review count — keep building consistently' });
    reviewPoints += 2;
  } else if (reviewCount >= 20) {
    good.push({ title: 'Review Count', value: `${reviewCount} reviews`, note: 'Decent review count — target 50+ for strong authority' });
    reviewPoints += 1;
  } else {
    improvements.push({ title: 'Review Count', currentStatus: `${reviewCount} reviews`, recommendation: `Build up to 20+ reviews by asking 3-5 customers per week. Target: consistently gain 8-10 reviews per month.`, priority: reviewCount < 5 ? 'critical' : 'high' });
  }

  if (rating >= 4.5) {
    good.push({ title: 'Star Rating', value: `${rating} ★`, note: 'Excellent rating — this strongly influences click-through rates' });
    reviewPoints += 2;
  } else if (rating >= 4.0) {
    good.push({ title: 'Star Rating', value: `${rating} ★`, note: 'Good rating — aim for 4.5+ for maximum impact' });
    reviewPoints += 1;
  } else if (rating > 0) {
    improvements.push({ title: 'Star Rating', currentStatus: `${rating} ★`, recommendation: 'Focus on customer experience to improve your rating toward 4.5+', priority: 'high' });
  }

  if (responseRate >= 80) {
    good.push({ title: 'Review Responses', value: `${responseRate}% response rate`, note: 'Responding to reviews shows you care and boosts rankings' });
    reviewPoints += 1;
  } else {
    improvements.push({ title: 'Review Responses', currentStatus: responseRate > 0 ? `${responseRate}% response rate` : 'No responses detected', recommendation: 'Respond to ALL reviews (positive and negative) within 24-48 hours', priority: 'high' });
  }

  scores.reviews = Math.round((reviewPoints / reviewMax) * 100);

  // ── Engagement (15% weight) ──
  let engagementPoints = 0;
  const engagementMax = 3;

  if (profile.latest_review_date) {
    const daysSinceReview = Math.floor((Date.now() - new Date(profile.latest_review_date).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceReview <= 14) {
      good.push({ title: 'Recent Reviews', value: `${daysSinceReview} days ago`, note: 'Active review flow signals a thriving business' });
      engagementPoints += 2;
    } else if (daysSinceReview <= 30) {
      engagementPoints += 1;
    } else {
      improvements.push({ title: 'Review Freshness', currentStatus: `Last review ${daysSinceReview} days ago`, recommendation: 'Ramp up review requests — aim for at least 1-2 new reviews per week', priority: 'high' });
    }
  }

  // Profile freshness (are they actively managing it?)
  if (profile.total_photos >= 5 && profile.total_reviews >= 10 && profile.hours_complete) {
    engagementPoints += 1;
  }

  scores.engagement = Math.round((engagementPoints / engagementMax) * 100);

  // Items we can't check via API — add as action plan suggestions
  improvements.push({ title: 'Google Business Posts', currentStatus: 'Cannot verify via API', recommendation: 'Post at least 2-4 times per month with images and calls-to-action (Call Now, Learn More, Order Online)', priority: 'medium' });
  improvements.push({ title: 'Q&A Section', currentStatus: 'Cannot verify via API', recommendation: 'Pre-populate Q&A with 5-10 common customer questions and answer them yourself', priority: 'medium' });
  improvements.push({ title: 'Products / Services', currentStatus: 'Cannot verify via API', recommendation: 'Add all products/services with photos, descriptions, categories, and pricing', priority: 'medium' });
  improvements.push({ title: 'Attributes', currentStatus: 'Cannot verify via API', recommendation: 'Fill out ALL relevant attributes (accessibility, amenities, payments accepted, service options)', priority: 'medium' });
  improvements.push({ title: 'Social Profiles', currentStatus: 'Cannot verify via API', recommendation: 'Link all your social media profiles (Facebook, Instagram, LinkedIn) in GBP settings', priority: 'medium' });

  // ── Overall Score ──
  const overallScore = Math.round(
    scores.completeness * 0.30 +
    scores.contentMedia * 0.25 +
    scores.reviews * 0.30 +
    scores.engagement * 0.15
  );

  return {
    overallScore,
    categoryScores: scores,
    goodItems: good,
    improvementItems: improvements
  };
}

// ─── Helper: Generate Action Items ──────────────────────────
function generateActionItems(audit) {
  const items = [];
  const now = new Date();

  for (const imp of audit.improvementItems) {
    const daysOffset = imp.priority === 'critical' ? 1 : imp.priority === 'high' ? 7 : imp.priority === 'medium' ? 14 : 30;
    const dueDate = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000);

    let cadence = 'one-time';
    let category = 'profile';
    if (imp.title.includes('Review') || imp.title.includes('review') || imp.title.includes('Rating') || imp.title.includes('Response')) {
      category = 'reviews';
      if (imp.title.includes('Count') || imp.title.includes('Freshness')) cadence = 'weekly';
      if (imp.title.includes('Response')) cadence = 'daily';
    } else if (imp.title.includes('Photo') || imp.title.includes('Content') || imp.title.includes('UTM') || imp.title.includes('Products') || imp.title.includes('Services')) {
      category = 'content';
      if (imp.title.includes('Photo')) cadence = 'monthly';
    } else if (imp.title.includes('Post') || imp.title.includes('Q&A') || imp.title.includes('Social')) {
      category = 'engagement';
      if (imp.title.includes('Post')) cadence = 'biweekly';
    }

    items.push({
      title: imp.title,
      description: imp.recommendation,
      why_it_matters: getWhyItMatters(imp.title),
      priority: imp.priority,
      cadence,
      category,
      due_date: dueDate.toISOString().split('T')[0]
    });
  }

  // Add standard ongoing items
  items.push({
    title: 'Weekly Review Generation',
    description: 'Ask 3-5 customers for reviews each week using your review request link. Make it a consistent business process.',
    why_it_matters: 'Consistent review velocity is one of the top ranking factors. Reviews also heavily influence customer decisions.',
    priority: 'ongoing',
    cadence: 'weekly',
    category: 'reviews',
    due_date: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  items.push({
    title: 'Monthly Photo Upload',
    description: 'Upload 2-3 new high-quality photos of your business, team, or completed work each month.',
    why_it_matters: 'Regular photo uploads signal an active business and provide fresh visual content for potential customers.',
    priority: 'ongoing',
    cadence: 'monthly',
    category: 'content',
    due_date: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  items.push({
    title: 'Respond to New Reviews',
    description: 'Respond to all new reviews (positive and negative) within 24-48 hours.',
    why_it_matters: 'Responding shows engagement, helps with rankings, and demonstrates excellent customer care.',
    priority: 'ongoing',
    cadence: 'daily',
    category: 'reviews',
    due_date: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  return items;
}

function getWhyItMatters(title) {
  const reasons = {
    'Business Name': 'Your name is the first thing customers see. Having a keyword naturally in your name is a ranking factor.',
    'Primary Category': 'Categories directly control which searches you appear for. Wrong category = invisible for target keywords.',
    'Additional Categories': 'Each category opens up new keyword searches where your business can appear.',
    'Phone Number': 'Customers who find you on Google often call directly — missing phone means missed leads.',
    'Website': 'Your website drives conversions and gives Google more signals about your business relevance.',
    'UTM Tracking': 'Without UTM tracking you can\'t measure how much traffic and conversions come from your GBP listing.',
    'Business Hours': 'Incomplete hours make customers unsure if you\'re open. Google also uses hours for ranking during searches.',
    'Business Description': 'A keyword-rich description helps with relevance and tells potential customers what sets you apart.',
    'Photos': 'Listings with more photos get 42% more requests for directions and 35% more clicks to websites.',
    'Review Count': 'More reviews = stronger ranking signal. Businesses with 20+ reviews significantly outperform those with fewer.',
    'Star Rating': 'Star rating influences click-through rates. Even position #3 can get more clicks than #1 with a better rating.',
    'Review Responses': 'Google values businesses that engage with their reviews. Responding also builds customer trust.',
    'Review Freshness': 'Recent reviews signal an active, thriving business. Stale reviews suggest the business may not be active.',
    'Google Business Posts': 'Posts keep your profile active and give you conversion elements (CTAs) right in search results.',
    'Q&A Section': 'Pre-populated Q&As answer customer concerns before they contact you, improving conversion rates.',
    'Products / Services': 'Product listings create browsable categories on your profile and help with keyword relevance.',
    'Attributes': 'Complete attributes help Google match your business to specific customer queries.',
    'Social Profiles': 'Social links help establish your brand entity and provide additional trust signals.'
  };
  return reasons[title] || 'This optimization helps improve your Google Business Profile visibility and customer engagement.';
}

// ─── Helper: Extract profile fields from Places API response ──
function extractProfile(place, googleUrl) {
  const hours = place.regularOpeningHours;
  let hoursComplete = false;
  if (hours?.periods?.length >= 5) hoursComplete = true; // at least 5 days covered

  const website = place.websiteUri || '';
  const hasUtm = website.includes('utm_') || website.includes('UTM_');

  // Check review response rate from available reviews
  const reviews = place.reviews || [];
  let responsesFound = 0;
  for (const r of reviews) {
    if (r.authorAttribution?.displayName === place.displayName?.text) continue;
    // Places API (New) doesn't expose owner responses directly in reviews
    // We'll estimate 0 and let the user self-report
  }
  const responseRate = reviews.length > 0 ? Math.round((responsesFound / reviews.length) * 100) : 0;

  let latestReviewDate = null;
  if (reviews.length > 0) {
    const dates = reviews.map(r => r.publishTime).filter(Boolean).sort().reverse();
    if (dates.length > 0) latestReviewDate = dates[0];
  }

  const primaryType = place.primaryTypeDisplayName?.text || place.primaryType || null;
  const types = (place.types || []).filter(t => t !== place.primaryType);

  return {
    place_id: place.id || place.name?.split('/').pop(),
    google_url: googleUrl || place.googleMapsUri || '',
    business_name: place.displayName?.text || '',
    primary_category: primaryType,
    additional_categories: types,
    address: place.formattedAddress || '',
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
    website: website,
    has_website_utm: hasUtm,
    description: place.editorialSummary?.text || '',
    hours: hours || null,
    hours_complete: hoursComplete,
    total_photos: place.photos?.length || 0,
    total_reviews: place.userRatingCount || 0,
    average_rating: place.rating || 0,
    review_response_rate: responseRate,
    latest_review_date: latestReviewDate,
    lat: place.location?.latitude || null,
    lng: place.location?.longitude || null,
    profile_data: place
  };
}

// ─── Helper: Ranking Grid Scan ──────────────────────────────
function generateGridCoords(centerLat, centerLng, gridSize, radiusMiles) {
  const points = [];
  const radiusKm = radiusMiles * 1.60934;
  const latDeg = radiusKm / 111.32;
  const lngDeg = radiusKm / (111.32 * Math.cos(centerLat * Math.PI / 180));

  const step = 2 / (gridSize - 1); // -1 to +1 range
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const latOffset = (-1 + i * step) * latDeg;
      const lngOffset = (-1 + j * step) * lngDeg;
      points.push({
        lat: centerLat + latOffset,
        lng: centerLng + lngOffset
      });
    }
  }
  return points;
}

async function rankAtPoint(keyword, lat, lng, targetPlaceId) {
  const body = {
    textQuery: keyword,
    maxResultCount: 20,
    locationBias: {
      circle: { center: { latitude: lat, longitude: lng }, radius: 5000 }
    }
  };

  try {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const places = data.places || [];

    let rank = null;
    const competitors = [];
    for (let i = 0; i < places.length; i++) {
      const pid = places[i].id || places[i].name?.split('/').pop();
      if (pid === targetPlaceId) {
        rank = i + 1;
      }
      if (i < 3 && pid !== targetPlaceId) {
        competitors.push({ name: places[i].displayName?.text || 'Unknown', rank: i + 1 });
      }
    }

    return { lat, lng, rank, competitors };
  } catch (err) {
    console.error('Rank check failed at point:', err.message);
    return { lat, lng, rank: null, competitors: [] };
  }
}

// ─── Routes ─────────────────────────────────────────────────

// All routes require authentication
router.use(authenticateToken);

// GET /maps-key — Return API key for frontend Google Maps display
router.get('/maps-key', (req, res) => {
  if (!GOOGLE_API_KEY) {
    return res.json({ key: null });
  }
  res.json({ key: GOOGLE_API_KEY });
});

// GET /search — Autocomplete business search
router.get('/search', async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Google Places API key not configured' });
    }
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ results: [] });
    }

    const body = { textQuery: q, maxResultCount: 5 };
    const apiRes = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName'
      },
      body: JSON.stringify(body)
    });
    const data = await apiRes.json();
    const results = (data.places || []).map(p => ({
      placeId: p.id || p.name?.split('/').pop(),
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      category: p.primaryTypeDisplayName?.text || ''
    }));
    res.json({ results });
  } catch (error) {
    console.error('GBP search error:', error.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /analyze — Analyze a Google Business Profile
router.post('/analyze', async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Google Places API key not configured' });
    }

    const { googleUrl, placeId: directPlaceId } = req.body;
    if (!googleUrl && !directPlaceId) {
      return res.status(400).json({ error: 'googleUrl or placeId is required' });
    }

    let placeId = directPlaceId;

    if (!placeId) {
      // Parse URL for search hints
      const parsed = parseGoogleUrl(googleUrl);
      const searchQuery = parsed.name || googleUrl;

      // Find the place
      const found = await searchPlace(searchQuery, parsed.lat, parsed.lng);
      if (!found) {
        return res.status(404).json({ error: 'Could not find a business at that URL. Try pasting the full Google Maps URL.' });
      }
      placeId = found.id || found.name?.split('/').pop();
    }

    // Get full details
    const details = await getPlaceDetails(placeId);
    if (!details || details.error) {
      return res.status(500).json({ error: 'Failed to fetch business details from Google' });
    }

    // Extract profile fields
    const profile = extractProfile(details, googleUrl);

    // Compute audit
    const audit = computeAudit(profile);

    // Upsert profile
    await pool.query(`
      INSERT INTO gbp_profiles (
        user_id, place_id, google_url, business_name, primary_category,
        additional_categories, address, phone, website, has_website_utm,
        description, hours, hours_complete, total_photos, total_reviews,
        average_rating, review_response_rate, latest_review_date,
        profile_data, audit_scores, audit_good, audit_improvements,
        overall_score, last_analyzed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        place_id=$2, google_url=$3, business_name=$4, primary_category=$5,
        additional_categories=$6, address=$7, phone=$8, website=$9, has_website_utm=$10,
        description=$11, hours=$12, hours_complete=$13, total_photos=$14, total_reviews=$15,
        average_rating=$16, review_response_rate=$17, latest_review_date=$18,
        profile_data=$19, audit_scores=$20, audit_good=$21, audit_improvements=$22,
        overall_score=$23, last_analyzed_at=NOW()
    `, [
      req.user.userId, profile.place_id, profile.google_url, profile.business_name,
      profile.primary_category, JSON.stringify(profile.additional_categories),
      profile.address, profile.phone, profile.website, profile.has_website_utm,
      profile.description, JSON.stringify(profile.hours), profile.hours_complete,
      profile.total_photos, profile.total_reviews, profile.average_rating,
      profile.review_response_rate, profile.latest_review_date,
      JSON.stringify(profile.profile_data), JSON.stringify(audit.categoryScores),
      JSON.stringify(audit.goodItems), JSON.stringify(audit.improvementItems),
      audit.overallScore
    ]);

    // Generate and store action items (clear old ones first)
    await pool.query('DELETE FROM gbp_action_items WHERE user_id = $1', [req.user.userId]);
    const actionItems = generateActionItems(audit);
    for (const item of actionItems) {
      await pool.query(`
        INSERT INTO gbp_action_items (user_id, title, description, why_it_matters, priority, cadence, category, due_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [req.user.userId, item.title, item.description, item.why_it_matters, item.priority, item.cadence, item.category, item.due_date]);
    }

    // Fetch the stored action items with IDs
    const storedItems = await pool.query(
      'SELECT * FROM gbp_action_items WHERE user_id = $1 ORDER BY CASE priority WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'ongoing\' THEN 4 END, created_at',
      [req.user.userId]
    );

    res.json({
      profile: { ...profile, lat: profile.lat, lng: profile.lng },
      audit,
      actionItems: storedItems.rows
    });
  } catch (error) {
    console.error('GBP analyze error:', error.message);
    res.status(500).json({ error: 'Failed to analyze Google Business Profile' });
  }
});

// GET /profile — Get stored profile
router.get('/profile', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM gbp_profiles WHERE user_id = $1', [req.user.userId]);
    if (result.rows.length === 0) {
      return res.json({ profile: null });
    }
    const p = result.rows[0];
    res.json({
      profile: {
        ...p,
        lat: p.profile_data?.location?.latitude || null,
        lng: p.profile_data?.location?.longitude || null
      },
      audit: {
        overallScore: p.overall_score,
        categoryScores: p.audit_scores,
        goodItems: p.audit_good,
        improvementItems: p.audit_improvements
      }
    });
  } catch (error) {
    console.error('GBP profile fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST /re-analyze — Re-run analysis using stored place_id
router.post('/re-analyze', async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Google Places API key not configured' });
    }

    const existing = await pool.query('SELECT place_id, google_url FROM gbp_profiles WHERE user_id = $1', [req.user.userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'No profile to re-analyze. Run an initial analysis first.' });
    }

    const { place_id, google_url } = existing.rows[0];
    const details = await getPlaceDetails(place_id);
    if (!details || details.error) {
      return res.status(500).json({ error: 'Failed to fetch updated details from Google' });
    }

    const profile = extractProfile(details, google_url);
    const audit = computeAudit(profile);

    await pool.query(`
      UPDATE gbp_profiles SET
        business_name=$2, primary_category=$3, additional_categories=$4,
        address=$5, phone=$6, website=$7, has_website_utm=$8,
        description=$9, hours=$10, hours_complete=$11, total_photos=$12,
        total_reviews=$13, average_rating=$14, review_response_rate=$15,
        latest_review_date=$16, profile_data=$17, audit_scores=$18,
        audit_good=$19, audit_improvements=$20, overall_score=$21,
        last_analyzed_at=NOW()
      WHERE user_id=$1
    `, [
      req.user.userId, profile.business_name, profile.primary_category,
      JSON.stringify(profile.additional_categories), profile.address,
      profile.phone, profile.website, profile.has_website_utm,
      profile.description, JSON.stringify(profile.hours), profile.hours_complete,
      profile.total_photos, profile.total_reviews, profile.average_rating,
      profile.review_response_rate, profile.latest_review_date,
      JSON.stringify(profile.profile_data), JSON.stringify(audit.categoryScores),
      JSON.stringify(audit.goodItems), JSON.stringify(audit.improvementItems),
      audit.overallScore
    ]);

    // Regenerate action items (preserve completed status)
    const completedItems = await pool.query(
      "SELECT title FROM gbp_action_items WHERE user_id = $1 AND status = 'completed'",
      [req.user.userId]
    );
    const completedTitles = new Set(completedItems.rows.map(r => r.title));

    await pool.query('DELETE FROM gbp_action_items WHERE user_id = $1', [req.user.userId]);
    const actionItems = generateActionItems(audit);
    for (const item of actionItems) {
      const status = completedTitles.has(item.title) ? 'completed' : 'not_started';
      await pool.query(`
        INSERT INTO gbp_action_items (user_id, title, description, why_it_matters, priority, cadence, category, status, due_date, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [req.user.userId, item.title, item.description, item.why_it_matters, item.priority, item.cadence, item.category, status, item.due_date, status === 'completed' ? new Date() : null]);
    }

    const storedItems = await pool.query(
      'SELECT * FROM gbp_action_items WHERE user_id = $1 ORDER BY CASE priority WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'ongoing\' THEN 4 END, created_at',
      [req.user.userId]
    );

    res.json({
      profile: { ...profile, lat: profile.lat, lng: profile.lng },
      audit,
      actionItems: storedItems.rows
    });
  } catch (error) {
    console.error('GBP re-analyze error:', error.message);
    res.status(500).json({ error: 'Failed to re-analyze profile' });
  }
});

// POST /rank-scan — Run a ranking grid scan
router.post('/rank-scan', async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Google Places API key not configured' });
    }

    const { keyword, gridSize = 5, radiusMiles = 5 } = req.body;
    if (!keyword) {
      return res.status(400).json({ error: 'keyword is required' });
    }

    // Get stored profile for coordinates
    const profileResult = await pool.query('SELECT place_id, profile_data FROM gbp_profiles WHERE user_id = $1', [req.user.userId]);
    if (profileResult.rows.length === 0) {
      return res.status(400).json({ error: 'Analyze your profile first before running a ranking scan' });
    }

    const { place_id, profile_data } = profileResult.rows[0];
    const centerLat = profile_data?.location?.latitude;
    const centerLng = profile_data?.location?.longitude;

    if (!centerLat || !centerLng) {
      return res.status(400).json({ error: 'Could not determine business location coordinates' });
    }

    const clampedGrid = Math.min(Math.max(gridSize, 3), 7);

    // Generate grid and scan
    const coords = generateGridCoords(centerLat, centerLng, clampedGrid, radiusMiles);
    const gridPoints = [];

    // Process in batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < coords.length; i += batchSize) {
      const batch = coords.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(c => rankAtPoint(keyword, c.lat, c.lng, place_id))
      );
      gridPoints.push(...results);

      // Small delay between batches
      if (i + batchSize < coords.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Compute stats
    const rankedPoints = gridPoints.filter(p => p.rank !== null);
    const top3Count = gridPoints.filter(p => p.rank !== null && p.rank <= 3).length;
    const averageRank = rankedPoints.length > 0
      ? Math.round((rankedPoints.reduce((sum, p) => sum + p.rank, 0) / rankedPoints.length) * 10) / 10
      : null;

    // Store scan
    const scanResult = await pool.query(`
      INSERT INTO gbp_ranking_scans (user_id, keyword, grid_size, radius_miles, center_lat, center_lng, grid_points, average_rank, top3_count, total_points)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [req.user.userId, keyword, clampedGrid, radiusMiles, centerLat, centerLng, JSON.stringify(gridPoints), averageRank, top3Count, gridPoints.length]);

    res.json({ scan: scanResult.rows[0] });
  } catch (error) {
    console.error('GBP rank scan error:', error.message);
    res.status(500).json({ error: 'Failed to run ranking scan' });
  }
});

// GET /rank-scans — Get scan history
router.get('/rank-scans', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM gbp_ranking_scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT 12',
      [req.user.userId]
    );
    res.json({ scans: result.rows });
  } catch (error) {
    console.error('GBP scan history error:', error.message);
    res.status(500).json({ error: 'Failed to fetch scan history' });
  }
});

// GET /action-items — Get action items
router.get('/action-items', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM gbp_action_items WHERE user_id = $1
       ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'ongoing' THEN 4 END,
       CASE status WHEN 'in_progress' THEN 1 WHEN 'not_started' THEN 2 WHEN 'completed' THEN 3 END,
       created_at`,
      [req.user.userId]
    );
    res.json({ actionItems: result.rows });
  } catch (error) {
    console.error('GBP action items error:', error.message);
    res.status(500).json({ error: 'Failed to fetch action items' });
  }
});

// PUT /action-items/:id/status — Update action item status
router.put('/action-items/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['not_started', 'in_progress', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const completedAt = status === 'completed' ? new Date() : null;
    await pool.query(
      'UPDATE gbp_action_items SET status = $1, completed_at = $2 WHERE id = $3 AND user_id = $4',
      [status, completedAt, id, req.user.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('GBP action item update error:', error.message);
    res.status(500).json({ error: 'Failed to update action item' });
  }
});

// GET /monitoring — Get monitoring dashboard data
router.get('/monitoring', async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get profile data
    const profileResult = await pool.query('SELECT * FROM gbp_profiles WHERE user_id = $1', [userId]);
    const profile = profileResult.rows[0] || null;

    // Get latest 2 scans for trend
    const scansResult = await pool.query(
      'SELECT average_rank, top3_count, total_points, created_at FROM gbp_ranking_scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2',
      [userId]
    );
    const latestScan = scansResult.rows[0] || null;
    const prevScan = scansResult.rows[1] || null;

    // Get action item stats
    const actionStats = await pool.query(
      `SELECT status, COUNT(*) as count FROM gbp_action_items WHERE user_id = $1 GROUP BY status`,
      [userId]
    );
    const actionCounts = { not_started: 0, in_progress: 0, completed: 0 };
    for (const row of actionStats.rows) {
      actionCounts[row.status] = parseInt(row.count);
    }
    const totalActions = actionCounts.not_started + actionCounts.in_progress + actionCounts.completed;
    const completionRate = totalActions > 0 ? Math.round((actionCounts.completed / totalActions) * 100) : 0;

    // Compute alerts
    const alerts = [];
    if (profile) {
      const daysSinceAnalysis = Math.floor((Date.now() - new Date(profile.last_analyzed_at).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceAnalysis > 30) {
        alerts.push({ type: 'stale_profile', severity: 'warning', title: 'Profile data is outdated', description: `Last analyzed ${daysSinceAnalysis} days ago. Re-analyze to check for changes.`, action: 'Re-analyze your profile' });
      }

      if (profile.total_reviews < 10) {
        alerts.push({ type: 'low_reviews', severity: 'critical', title: 'Low review count', description: `Only ${profile.total_reviews} reviews. Target at least 20 for strong visibility.`, action: 'Ramp up review requests' });
      }

      if (profile.average_rating && profile.average_rating < 4.0) {
        alerts.push({ type: 'low_rating', severity: 'warning', title: 'Rating below 4.0', description: `Current rating: ${profile.average_rating}. Focus on customer experience to improve.`, action: 'Address customer concerns' });
      }

      const overdueItems = await pool.query(
        "SELECT COUNT(*) as count FROM gbp_action_items WHERE user_id = $1 AND status != 'completed' AND due_date < CURRENT_DATE",
        [userId]
      );
      if (parseInt(overdueItems.rows[0].count) > 0) {
        alerts.push({ type: 'overdue_items', severity: 'warning', title: `${overdueItems.rows[0].count} action items overdue`, description: 'You have overdue optimization tasks.', action: 'Review your action plan' });
      }
    }

    // Determine overall health
    let health = 'healthy';
    if (alerts.some(a => a.severity === 'critical')) health = 'critical';
    else if (alerts.length > 0) health = 'needs_attention';

    res.json({
      health,
      profile: profile ? {
        lastAnalyzedAt: profile.last_analyzed_at,
        overallScore: profile.overall_score,
        totalReviews: profile.total_reviews,
        averageRating: profile.average_rating,
        totalPhotos: profile.total_photos
      } : null,
      ranking: {
        latest: latestScan,
        previous: prevScan,
        trend: latestScan && prevScan ? {
          rankChange: prevScan.average_rank - latestScan.average_rank,
          top3Change: latestScan.top3_count - prevScan.top3_count
        } : null
      },
      actionItems: {
        ...actionCounts,
        total: totalActions,
        completionRate
      },
      alerts
    });
  } catch (error) {
    console.error('GBP monitoring error:', error.message);
    res.status(500).json({ error: 'Failed to fetch monitoring data' });
  }
});

module.exports = router;
