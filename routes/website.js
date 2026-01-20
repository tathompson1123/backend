const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { buildVisualSupremacyPrompt } = require('../utils/visual-supremacy-prompt');

// Helper functions
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// GET - Fetch user's website
router.get('/', authenticateToken, async (req, res) => {
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

// POST - Save website
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { htmlContent, pages } = req.body;

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

// POST - Toggle publish status
router.post('/publish', authenticateToken, async (req, res) => {
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

// POST - AI Website Generation
router.post('/generate', authenticateToken, async (req, res) => {
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

    const safeBusinessName = sanitizeForPrompt(businessName);
    const safeBusinessType = sanitizeForPrompt(businessType);
    const safeTagline = sanitizeForPrompt(tagline);
    const safeServices = sanitizeForPrompt(services);
    const safeCertifications = sanitizeForPrompt(certifications);
    const safeDescription = sanitizeForPrompt(description);
    const safeUSPs = sanitizeForPrompt(uniqueSellingPoints);
    const safeTargetCustomer = sanitizeForPrompt(targetCustomer);

    console.log('🎨 Generating website for:', safeBusinessName);

    if (!safeBusinessName || !safeBusinessType) {
      return res.status(400).json({ error: 'Business name and type are required' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ ANTHROPIC_API_KEY not set!');
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Fetch user data from database
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
        `SELECT bi.*, u.business_name, u.name as owner_name
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

      console.log('✅ Fetched user data');
    } catch (error) {
      console.error('⚠️ Error fetching user data:', error);
    }

    // Format services
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

    // Format business hours
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

    // Format team
    const teamInfo = userEmployees.length > 0
      ? {
          hasData: true,
          team: `Our team includes: ${userEmployees.map(e => sanitizeForPrompt(e.name)).join(', ')}`,
          instruction: 'You can mention these team members.'
        }
      : { hasData: false, team: null, instruction: '' };

    // Contact info
    const contactEmail = sanitizeForPrompt(userBusinessInfo?.email) || 'contact@example.com';
    const ownerName = sanitizeForPrompt(userBusinessInfo?.owner_name || userBusinessInfo?.name) || null;
    const phoneNumber = sanitizeForPrompt(userBusinessInfo?.phone) || '(555) 123-4567';
    const phoneNumberClean = phoneNumber.replace(/\D/g, '');

    const address = sanitizeForPrompt(userBusinessInfo?.address) || null;
    const city = sanitizeForPrompt(userBusinessInfo?.city) || null;
    const state = sanitizeForPrompt(userBusinessInfo?.state) || null;
    const zipCode = sanitizeForPrompt(userBusinessInfo?.zip_code) || null;

    const fullAddress = [address, city, state, zipCode].filter(Boolean).join(', ');

    const serviceAreaType = userBusinessInfo?.service_area_type || 'zipcodes';
    const serviceZipCodes = userBusinessInfo?.service_zip_codes || [];
    const serviceRadius = userBusinessInfo?.service_radius || 25;
    const centerZipCode = sanitizeForPrompt(userBusinessInfo?.center_zip_code) || zipCode;

    const serviceAreaText = serviceAreaType === 'radius'
      ? `We serve a ${serviceRadius} mile radius from ${centerZipCode || 'our location'}`
      : serviceZipCodes.length > 0
        ? `Service Areas: ${serviceZipCodes.slice(0, 10).join(', ')}${serviceZipCodes.length > 10 ? ' and more' : ''}`
        : null;

    const bookingUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/book/${userId}`;

    // Colors
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
    }

    // Build prompt
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

    // Call Claude API
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
      console.log('✅ Generated', Object.keys(files).length, 'pages');
    } else {
      const cleanContent = fullResponse.trim()
        .replace(/```html\n?/g, '')
        .replace(/```\n?$/g, '')
        .replace(/```/g, '');
      files['index.html'] = cleanContent;
      console.log('✅ Generated single-page website');
    }

    const htmlContent = files['index.html'];

    if (!htmlContent) {
      console.error('❌ No index.html generated');
      return res.status(500).json({ error: 'No homepage content generated' });
    }

    res.json({ 
      success: true, 
      html: htmlContent,
      pages: files,
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

module.exports = router;
