const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requirePlan } = require('../config/middleware');
const Anthropic = require('@anthropic-ai/sdk');

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const PLACES_BASE = 'https://places.googleapis.com/v1';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// All market research routes require Expert plan
router.use(authenticateToken);
router.use(requirePlan('expert'));

// ─── GET /competitors/latest — Return cached competitor report ───
router.get('/competitors/latest', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM competitor_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user.userId]
    );
    res.json({ report: result.rows[0]?.report_data || null, generatedAt: result.rows[0]?.created_at || null });
  } catch (error) {
    console.error('Error fetching competitor report:', error);
    res.status(500).json({ error: 'Failed to fetch competitor report' });
  }
});

// ─── POST /competitors — Run competitor analysis ───
router.post('/competitors', async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user's business info from multiple tables
    const userResult = await pool.query(
      'SELECT business_name, email FROM users WHERE id = $1',
      [userId]
    );
    const userRow = userResult.rows[0];
    if (!userRow) return res.status(404).json({ error: 'User not found' });

    // Get business_type from websites table
    const websiteResult = await pool.query(
      'SELECT business_type FROM websites WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    // Get city/state from business_information table
    const bizInfoResult = await pool.query(
      'SELECT * FROM business_information WHERE user_id = $1',
      [userId]
    );
    const bizInfo = bizInfoResult.rows[0] || {};

    const servicesResult = await pool.query(
      'SELECT name, description, price, duration_hours FROM services WHERE user_id = $1 AND active = true',
      [userId]
    );
    const userServices = servicesResult.rows;

    const city = bizInfo.city || '';
    const state = bizInfo.state || '';
    const businessType = websiteResult.rows[0]?.business_type || '';
    const businessName = userRow.business_name || '';

    if (!businessType || !city) {
      return res.status(400).json({ error: 'Business type and city are required. Please update your business settings.' });
    }

    // Search for competitors via Google Places API
    const searchQuery = `${businessType} in ${city}, ${state}`;
    let competitors = [];

    if (GOOGLE_API_KEY) {
      try {
        const searchRes = await fetch(`${PLACES_BASE}/places:searchText`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri'
          },
          body: JSON.stringify({ textQuery: searchQuery, maxResultCount: 10 })
        });
        const searchData = await searchRes.json();

        // Filter out the user's own business and take top 5
        const allPlaces = searchData.places || [];
        competitors = allPlaces
          .filter(p => {
            const name = (p.displayName?.text || '').toLowerCase();
            return !name.includes(businessName.toLowerCase());
          })
          .slice(0, 5)
          .map(p => ({
            name: p.displayName?.text || 'Unknown',
            placeId: p.id,
            address: p.formattedAddress || '',
            rating: p.rating || 0,
            totalReviews: p.userRatingCount || 0,
            phone: p.nationalPhoneNumber || '',
            website: p.websiteUri || '',
            mapsUrl: p.googleMapsUri || ''
          }));
      } catch (gErr) {
        console.error('Google Places search error:', gErr);
      }
    }

    if (competitors.length === 0) {
      return res.status(404).json({ error: `No competitors found for "${businessType}" in ${city}, ${state}. Try updating your business type.` });
    }

    // Use Claude to analyze competitors and generate insights
    const userAvgPrice = userServices.length > 0
      ? (userServices.reduce((s, sv) => s + parseFloat(sv.price || 0), 0) / userServices.length).toFixed(0)
      : 'Unknown';

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are a competitive business analyst. Analyze these competitors for a "${businessType}" business called "${businessName}" in ${city}, ${state}.

YOUR BUSINESS:
- Services: ${userServices.map(s => `${s.name} ($${s.price})`).join(', ') || 'Not listed'}
- Average Price: $${userAvgPrice}

COMPETITORS FOUND ON GOOGLE:
${competitors.map((c, i) => `${i + 1}. ${c.name} — Rating: ${c.rating}/5 (${c.totalReviews} reviews), Address: ${c.address}, Website: ${c.website || 'None'}`).join('\n')}

For EACH competitor, provide:
1. estimatedServices: Array of 3-6 likely services they offer (educated guess based on business type and their name/location)
2. estimatedPricing: Pricing tier ("$" budget, "$$" moderate, "$$$" premium, "$$$$" luxury)
3. advantages: Array of 2-3 things this competitor likely does better than "${businessName}"
4. disadvantages: Array of 2-3 weaknesses or areas where "${businessName}" has the edge

Also provide an overall "summary" of the competitive landscape (2-3 sentences).

Return ONLY valid JSON in this exact format:
{
  "competitors": [
    {
      "index": 0,
      "estimatedServices": ["Service 1", "Service 2"],
      "estimatedPricing": "$$",
      "advantages": ["Advantage 1", "Advantage 2"],
      "disadvantages": ["Disadvantage 1", "Disadvantage 2"]
    }
  ],
  "summary": "Overall competitive analysis summary..."
}`
      }]
    });

    const aiText = aiResponse.content[0].text.trim();
    let aiAnalysis;
    try {
      aiAnalysis = JSON.parse(aiText);
    } catch {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      aiAnalysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { competitors: [], summary: '' };
    }

    // Merge AI analysis into competitor data
    const enrichedCompetitors = competitors.map((comp, i) => {
      const ai = (aiAnalysis.competitors || []).find(c => c.index === i) || {};
      return {
        ...comp,
        estimatedServices: ai.estimatedServices || [],
        estimatedPricing: ai.estimatedPricing || '$$',
        advantages: ai.advantages || [],
        disadvantages: ai.disadvantages || []
      };
    });

    const report = {
      generatedAt: new Date().toISOString(),
      competitors: enrichedCompetitors,
      yourStats: {
        name: businessName,
        services: userServices.map(s => s.name),
        serviceDetails: userServices,
        avgPrice: parseFloat(userAvgPrice) || 0,
        city,
        state
      },
      summary: aiAnalysis.summary || ''
    };

    // Cache the report
    await pool.query(
      'INSERT INTO competitor_reports (user_id, report_data) VALUES ($1, $2)',
      [userId, JSON.stringify(report)]
    );

    res.json({ report });
  } catch (error) {
    console.error('Error running competitor analysis:', error);
    res.status(500).json({ error: 'Failed to run competitor analysis' });
  }
});

// ─── GET /upsells/latest — Return cached upsell report ───
router.get('/upsells/latest', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM upsell_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user.userId]
    );
    res.json({ analysis: result.rows[0]?.report_data || null, generatedAt: result.rows[0]?.created_at || null });
  } catch (error) {
    console.error('Error fetching upsell report:', error);
    res.status(500).json({ error: 'Failed to fetch upsell report' });
  }
});

// ─── POST /upsells — Run upsell/revenue growth analysis ───
router.post('/upsells', async (req, res) => {
  try {
    const userId = req.user.userId;

    const userResult = await pool.query(
      'SELECT business_name FROM users WHERE id = $1',
      [userId]
    );
    const userRow = userResult.rows[0];
    if (!userRow) return res.status(404).json({ error: 'User not found' });

    // Get business_type from websites table
    const websiteResult = await pool.query(
      'SELECT business_type FROM websites WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    const user = {
      business_name: userRow.business_name || '',
      business_type: websiteResult.rows[0]?.business_type || ''
    };

    const servicesResult = await pool.query(
      'SELECT name, description, price, duration_hours FROM services WHERE user_id = $1 AND active = true ORDER BY price DESC',
      [userId]
    );
    const services = servicesResult.rows;

    if (services.length === 0) {
      return res.status(400).json({ error: 'You need to add services first. Go to Business Settings > Services.' });
    }

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are a revenue optimization expert. Analyze this "${user.business_type}" business called "${user.business_name}" and recommend upsells.

CURRENT SERVICES:
${services.map(s => `- ${s.name}: $${s.price} (${s.duration_hours} hours) ${s.description ? '— ' + s.description : ''}`).join('\n')}

For each main service, suggest 2-3 practical upsell opportunities that are:
- Easy to implement (don't require major new equipment or skills)
- Natural extensions of the existing service
- Something customers would see immediate value in

For each upsell provide:
- forService: The name of the existing service this upsell goes with
- forServicePrice: The price of that existing service
- upsellName: Name of the upsell
- description: What it includes (1-2 sentences)
- suggestedPrice: Recommended price (number only)
- bestTimeToAsk: The exact best moment to offer this upsell to the customer
- whyItWorks: Why customers say yes to this (1 sentence)
- estimatedConversion: Expected conversion rate as a string like "40-60%"
- revenueImpact: Estimated additional revenue per customer, e.g. "$40-60 per customer on average"

Also provide:
- totalMonthlyPotential: Estimated additional monthly revenue if all upsells are implemented (assuming ~20 customers/month)
- topRecommendation: The single best upsell to start with and why (2 sentences)

Return ONLY valid JSON:
{
  "upsells": [...],
  "totalMonthlyPotential": 2500,
  "topRecommendation": "..."
}`
      }]
    });

    const aiText = aiResponse.content[0].text.trim();
    let analysis;
    try {
      analysis = JSON.parse(aiText);
    } catch {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { upsells: [], totalMonthlyPotential: 0, topRecommendation: '' };
    }

    analysis.generatedAt = new Date().toISOString();

    // Cache the report
    await pool.query(
      'INSERT INTO upsell_reports (user_id, report_data) VALUES ($1, $2)',
      [userId, JSON.stringify(analysis)]
    );

    res.json({ analysis });
  } catch (error) {
    console.error('Error running upsell analysis:', error);
    res.status(500).json({ error: 'Failed to run upsell analysis' });
  }
});

module.exports = router;
