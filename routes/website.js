const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { deployToVercel, addDomainToVercel, checkDomainVerification, removeDomainFromVercel } = require('../services/vercel');
const { searchDomains, purchaseDomain } = require('../services/domain');
const axios = require('axios');
const { generateChatWidgetCode } = require('../utils/chatWidget');

console.log('✅ Website routes module loaded');

router.use((req, res, next) => {
  console.log('🌐 Website route hit:', req.method, req.path);
  next();
});

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

// Add this helper function at the top, after const router = express.Router();
function makeMobileResponsive(html) {
  console.log('📱 Adding mobile overflow fixes with diagnostics...');
  
  // Check if already has our overflow fix
  if (html.includes('id="sorce-overflow-fix"')) {
    console.log('⏭️ Overflow fix already present');
    return html;
  }
  
  const overflowFix = `
<style id="sorce-overflow-fix">
@media (max-width: 768px) {
  /* AGGRESSIVE overflow prevention */
  html {
    max-width: 100vw !important;
    overflow-x: hidden !important;
    position: relative !important;
  }
  
  body {
    max-width: 100vw !important;
    overflow-x: hidden !important;
    margin: 0 !important;
    padding: 0 !important;
    position: relative !important;
  }
  
  /* Force EVERYTHING to fit */
  * {
    max-width: 100vw !important;
    box-sizing: border-box !important;
  }
  
  /* Extra aggressive container fixes */
  section, div, header, main, article, nav, footer, aside {
    max-width: 100% !important;
    overflow-x: hidden !important;
  }
  
  /* Responsive media */
  img, video, iframe, svg, canvas {
    max-width: 100% !important;
    height: auto !important;
  }
  
  /* Fix tables and code blocks */
  table {
    width: 100% !important;
    display: block !important;
    overflow-x: auto !important;
  }
  
  pre, code {
    max-width: 100% !important;
    overflow-x: auto !important;
    word-wrap: break-word !important;
  }
  
  /* Fix specific width declarations */
  [style*="width"] {
    max-width: 100% !important;
  }
  
  /* Hide horizontal scrollbar if it appears anyway */
  ::-webkit-scrollbar-horizontal {
    display: none !important;
  }
  
  /* Debug: Add red border to overflowing elements */
  /* Uncomment this to see what's overflowing: */
  /*
  * {
    outline: 1px solid rgba(255, 0, 0, 0.2) !important;
  }
  */
}
</style>

<script id="sorce-overflow-diagnostic">
// Mobile overflow diagnostic
if (window.innerWidth <= 768) {
  window.addEventListener('load', function() {
    console.log('📊 Mobile Overflow Diagnostic');
    console.log('Viewport width:', window.innerWidth);
    console.log('Body width:', document.body.scrollWidth);
    console.log('HTML width:', document.documentElement.scrollWidth);
    
    // Find elements wider than viewport
    const allElements = document.querySelectorAll('*');
    const overflowing = [];
    
    allElements.forEach(el => {
      if (el.scrollWidth > window.innerWidth) {
        overflowing.push({
          tag: el.tagName,
          class: el.className,
          id: el.id,
          width: el.scrollWidth,
          computedWidth: window.getComputedStyle(el).width
        });
      }
    });
    
    if (overflowing.length > 0) {
      console.log('⚠️ Found', overflowing.length, 'overflowing elements:');
      overflowing.slice(0, 10).forEach(el => {
        console.log('  -', el.tag, el.class || el.id || '', '→', el.width + 'px');
      });
    } else {
      console.log('✅ No overflowing elements found');
    }
  });
}
</script>`;
  
  // Add before </head>
  if (html.includes('</head>')) {
    html = html.replace('</head>', overflowFix + '\n</head>');
    console.log('✅ Overflow fix + diagnostics added');
  }
  
  return html;
}


// GET - Get website version history
router.get('/versions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      `SELECT id, html_content, pages, created_at, version_number, description
       FROM website_versions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );
    
    res.json({ versions: result.rows });
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

// POST - Mark website as unpublished (has pending changes)
router.post('/mark-unpublished', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    await pool.query(
      'UPDATE websites SET is_published = false WHERE user_id = $1',
      [userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking unpublished:', error);
    res.status(500).json({ error: 'Failed to mark unpublished' });
  }
});

// POST - Restore a specific version
router.post('/restore-version/:versionId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { versionId } = req.params;
    
    // Get the version
    const versionResult = await pool.query(
      'SELECT html_content, pages FROM website_versions WHERE id = $1 AND user_id = $2',
      [versionId, userId]
    );
    
    if (versionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }
    
    const version = versionResult.rows[0];
    
    // Update current website
    await pool.query(
      `UPDATE websites 
       SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $3`,
      [version.html_content, version.pages, userId]
    );
    
    res.json({ 
      success: true, 
      message: 'Version restored successfully',
      html_content: version.html_content,
      pages: version.pages
    });
  } catch (error) {
    console.error('Error restoring version:', error);
    res.status(500).json({ error: 'Failed to restore version' });
  }
});

router.get('/my-ip', async (req, res) => {
  try {
    const axios = require('axios');
    const ipResponse = await axios.get('https://api.ipify.org?format=json');
    res.json({ 
      railwayIp: ipResponse.data.ip,
      message: 'Add this IP to Porkbun: https://porkbun.com/account/api'
    });
  } catch (error) {
    res.json({ error: 'Could not get IP' });
  }
});

// GET - Fetch user's website
router.get('/', authenticateToken, async (req, res) => {
  res.set('Cache-Control', 'no-store');
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

router.post('/save', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let { html_content, pages } = req.body;
    
    // ONLY make index.html mobile responsive
    if (html_content) {
      console.log('📱 Making index.html mobile responsive');
      html_content = makeMobileResponsive(html_content);
    }
    
    // Get current version number
    const versionResult = await pool.query(
      'SELECT COALESCE(MAX(version_number), 0) as max_version FROM website_versions WHERE user_id = $1',
      [userId]
    );
    
    const nextVersion = versionResult.rows[0].max_version + 1;
    
    // Save current state as a version BEFORE updating
    const currentWebsite = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );
    
    if (currentWebsite.rows.length > 0) {
      await pool.query(
        `INSERT INTO website_versions (user_id, html_content, pages, version_number, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId, 
          currentWebsite.rows[0].html_content, 
          currentWebsite.rows[0].pages,
          nextVersion,
          `Saved ${new Date().toLocaleString()}`
        ]
      );
    }
    
    // Update current website
    await pool.query(
      `UPDATE websites 
       SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $3`,
      [html_content, pages, userId]
    );
    
    res.json({ success: true, message: 'Changes saved', version: nextVersion });
  } catch (error) {
    console.error('Error saving website:', error);
    res.status(500).json({ error: 'Failed to save website' });
  }
});

// ============================================
// POST - Save website V2 (JSON schema + HTML)
// ============================================
router.post('/save-v2', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page_data, html_content } = req.body;

    if (!page_data) {
      return res.status(400).json({ error: 'page_data required' });
    }

    // Make HTML mobile responsive
    let responsiveHtml = html_content;
    if (html_content) {
      responsiveHtml = makeMobileResponsive(html_content);
    }

    // Get current version number
    const versionResult = await pool.query(
      'SELECT COALESCE(MAX(version_number), 0) as max_version FROM website_versions WHERE user_id = $1',
      [userId]
    );
    const nextVersion = versionResult.rows[0].max_version + 1;

    // Save current state as a version BEFORE updating
    const currentWebsite = await pool.query(
      'SELECT html_content, pages, page_data FROM websites WHERE user_id = $1',
      [userId]
    );

    if (currentWebsite.rows.length > 0 && currentWebsite.rows[0].html_content) {
      await pool.query(
        `INSERT INTO website_versions (user_id, html_content, pages, version_number, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          currentWebsite.rows[0].html_content,
          currentWebsite.rows[0].pages,
          nextVersion,
          `Auto-save ${new Date().toLocaleString()}`
        ]
      );
    }

    // Check if website exists
    const existing = await pool.query(
      'SELECT id FROM websites WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE websites 
         SET page_data = $1, 
             html_content = $2, 
             is_published = false,
             updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = $3`,
        [JSON.stringify(page_data), responsiveHtml, userId]
      );
    } else {
      // Insert new
      await pool.query(
        `INSERT INTO websites (user_id, page_data, html_content, is_published, created_at, updated_at)
         VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, JSON.stringify(page_data), responsiveHtml]
      );
    }

    console.log(`✅ Saved V2 website for user ${userId}`);

    res.json({ 
      success: true, 
      message: 'Website saved',
      version: nextVersion
    });

  } catch (error) {
    console.error('Error saving V2 website:', error);
    res.status(500).json({ error: 'Failed to save website' });
  }
});

// ============================================
// GET - Get website with V2 page_data
// ============================================
router.get('/v2', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT id, page_data, html_content, vercel_url, is_published, custom_domain FROM websites WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        success: true,
        website: null,
        page_data: null
      });
    }

    const website = result.rows[0];
    
    // Parse page_data if it's a string
    let pageData = website.page_data;
    if (pageData && typeof pageData === 'string') {
      pageData = JSON.parse(pageData);
    }

    res.json({ 
      success: true,
      website: website,
      page_data: pageData
    });

  } catch (error) {
    console.error('Error fetching V2 website:', error);
    res.status(500).json({ error: 'Failed to fetch website' });
  }
});

router.post('/publish', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let { html_content, pages } = req.body;
    
    // Make HTML mobile responsive before publishing
    html_content = makeMobileResponsive(html_content);
    
    if (pages) {
      Object.keys(pages).forEach(pageName => {
        pages[pageName] = makeMobileResponsive(pages[pageName]);
      });
    }
    // Save to database first
    await pool.query(
      'UPDATE websites SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
      [html_content, pages, userId]
    );

    // Deploy to Vercel
    const vercelToken = process.env.VERCEL_TOKEN;
    
    if (!vercelToken) {
      throw new Error('Vercel token not configured');
    }

    // Prepare files for deployment
    const files = [];
    const addedFiles = new Set();

    // Add all pages from the pages object
    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        if (!addedFiles.has(pageKey)) {
          files.push({
            file: pageKey,
            data: Buffer.from(pages[pageKey]).toString('base64')
          });
          addedFiles.add(pageKey);
          console.log(`📄 Added ${pageKey} to deployment`);
        }
      });
    }

    // Only add index.html from html_content if it wasn't already added from pages
    if (html_content && !addedFiles.has('index.html')) {
      files.push({
        file: 'index.html',
        data: Buffer.from(html_content).toString('base64')
      });
      addedFiles.add('index.html');
      console.log(`📄 Added index.html to deployment`);
    }

    console.log(`📦 Total files to deploy: ${files.length}`);

    if (files.length === 0) {
      throw new Error('No files to deploy');
    }

    // Create deployment
    const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `website-${userId}`,
        files: files,
        projectSettings: {
          framework: null
        }
      })
    });

    if (!deployResponse.ok) {
      const errorText = await deployResponse.text();
      console.error('Vercel deployment error:', errorText);
      throw new Error('Deployment failed: ' + errorText);
    }

    const deployData = await deployResponse.json();
    const deploymentUrl = `https://${deployData.url}`;

    // Update database with new deployment info
    await pool.query(
      'UPDATE websites SET vercel_url = $1, vercel_deployment_id = $2, is_published = true WHERE user_id = $3',
      [deploymentUrl, deployData.id, userId]
    );

    console.log(`✅ Published for user ${userId}: ${deploymentUrl}`);
    
    res.json({ 
      success: true, 
      url: deploymentUrl,
      message: 'Website published successfully'
    });

  } catch (error) {
    console.error('Error publishing website:', error);
    res.status(500).json({ error: 'Failed to publish website', details: error.message });
  }
});

router.post('/save-schema', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page_data } = req.body;

    if (!page_data) {
      return res.status(400).json({ error: 'page_data is required' });
    }

    const { renderPage } = require('../sections/renderer');
    const { getThemeForBusinessType } = require('../sections/themes');

    const existing = await pool.query(
      'SELECT business_type FROM websites WHERE user_id = $1',
      [userId]
    );

    if (!page_data.theme || Object.keys(page_data.theme).length === 0) {
      const businessType = existing.rows[0]?.business_type || 'general';
      page_data.theme = getThemeForBusinessType(businessType);
    }

    if (!page_data.meta) page_data.meta = {};
    page_data.meta.userId = userId;

    console.log('🎨 Re-rendering HTML from updated schema...');
    let html = renderPage(page_data);
    console.log('✅ Rendered HTML:', html.length, 'chars');

    // Auto-inject chat widget if deployed
    const { injectAgents } = require('../utils/injectAgents');
    html = await injectAgents(html, userId, pool, page_data.theme);

    const pages = { 'index.html': html };

    await pool.query(
      `UPDATE websites 
       SET html_content = $1, page_data = $2, pages = $3, updated_at = NOW()
       WHERE user_id = $4`,
      [html, JSON.stringify(page_data), JSON.stringify(pages), userId]
    );

    console.log('✅ Saved schema and HTML for user', userId);

    res.json({ 
      success: true, 
      html,
      message: 'Schema saved and HTML regenerated'
    });

  } catch (error) {
    console.error('❌ Save schema error:', error);
    res.status(500).json({ error: 'Failed to save', details: error.message });
  }
});


router.get('/check-contact-form', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const websiteResult = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.json({ isValid: false, issues: ['No website found'] });
    }

    const website = websiteResult.rows[0];
    const htmlContent = website.html_content || '';
    const pages = website.pages || {};

    // Combine all HTML to check
    const allHtml = htmlContent + Object.values(pages).join('');

    const issues = [];
    let isValid = true;

    // Check for ANY contact form - much more flexible patterns
    const hasContactForm = 
      /id=["']contact/i.test(allHtml) ||
      /id=["'].*form["']/i.test(allHtml) ||
      /class=["'].*contact.*form["']/i.test(allHtml) ||
      /<form[^>]*>/i.test(allHtml);  // ANY form element
    
    if (!hasContactForm) {
      issues.push('No contact form found');
      isValid = false;
    }

    // Check for SMS consent checkbox - look for multiple patterns
    const hasSmsConsent = 
      /name=["']sms_consent["']/i.test(allHtml) ||
      /sms.{0,20}consent/i.test(allHtml) ||
      /receive.{0,30}text.{0,30}message/i.test(allHtml) ||
      /agree.{0,50}SMS/i.test(allHtml);
    
    if (!hasSmsConsent) {
      issues.push('No SMS consent checkbox found');
      isValid = false;
    }

    // Check for form submission handler
    const hasFormHandler = 
      /addEventListener.*submit/i.test(allHtml) ||
      /\.submit/i.test(allHtml) ||
      /onsubmit/i.test(allHtml);
    
    if (!hasFormHandler) {
      issues.push('No form submission handler found');
      isValid = false;
    }

    // Check if form posts to correct endpoint
    const hasCorrectEndpoint = /\/api\/leads\/public\//i.test(allHtml);
    if (!hasCorrectEndpoint) {
      issues.push('Form not configured to submit to lead endpoint');
      isValid = false;
    }

    console.log('Contact form check:', { 
      isValid, 
      issues, 
      hasContactForm, 
      hasSmsConsent, 
      hasFormHandler, 
      hasCorrectEndpoint 
    });

    res.json({ isValid, issues });

  } catch (error) {
    console.error('Error checking contact form:', error);
    res.status(500).json({ error: 'Failed to check contact form' });
  }
});

router.get('/check-chat-widget', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const websiteResult = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.json({ 
        hasWebsite: false,
        hasWidget: false,
        message: 'No website found'
      });
    }

    const website = websiteResult.rows[0];
    let pages = website.pages || {};

    const widgetMarker = 'sorce-chat-widget';
    let pagesWithWidget = [];
    let pagesWithoutWidget = [];

    // Check all pages
    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        const html = pages[pageKey];
        if (html && html.includes(widgetMarker)) {
          pagesWithWidget.push(pageKey);
        } else {
          pagesWithoutWidget.push(pageKey);
        }
      });
    }

    // Check main html_content
    if (website.html_content) {
      if (website.html_content.includes(widgetMarker)) {
        pagesWithWidget.push('index.html (main)');
      } else {
        pagesWithoutWidget.push('index.html (main)');
      }
    }

    res.json({
      hasWebsite: true,
      hasWidget: pagesWithWidget.length > 0,
      pagesWithWidget,
      pagesWithoutWidget,
      totalPages: pagesWithWidget.length + pagesWithoutWidget.length
    });

  } catch (error) {
    console.error('Error checking chat widget:', error);
    res.status(500).json({ error: 'Failed to check chat widget' });
  }
});

// ============================================
// POST - Fix/Update Contact Form in Existing Website
// ============================================
router.post('/fix-contact-form', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get website with pages AND colors
    const websiteResult = await pool.query(
      'SELECT html_content, pages, vercel_url, vercel_deployment_id, primary_color, accent_color, text_color FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.status(404).json({ error: 'No website found' });
    }

    const website = websiteResult.rows[0];
    
    // Get colors with defaults
    const primaryColor = website.primary_color || '#667eea';
    const accentColor = website.accent_color || '#764ba2';
    const textColor = website.text_color || '#1f2937';
    
    let pages = website.pages || {};

    // Get REAL API URL
    const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
      : process.env.API_URL || 'https://backend-production-ab50.up.railway.app';

    console.log('🔧 Using API URL:', apiUrl);

    // Helper function to check if page has a contact form
function hasContactForm(html) {
  // Look for ANY form element
  return /<form[^>]*>/i.test(html);
}

function fixContactFormHTML(html, pageName) {
  if (!hasContactForm(html)) return html;

  console.log(`🔧 Fixing contact form in ${pageName}`);

  // Ensure meta tag exists
  if (!html.includes('meta name="user-id"')) {
    html = html.replace('</head>', `  <meta name="user-id" content="${userId}">\n</head>`);
  } else {
    html = html.replace(/<meta name="user-id" content="[^"]*"/, `<meta name="user-id" content="${userId}"`);
  }

  // Find ANY form - try multiple patterns
  let formMatch = html.match(/<form[^>]*id=["']contact-form["'][^>]*>[\s\S]*?<\/form>/i);
  
  if (!formMatch) {
    // Try to find any form with "contact" in the id
    formMatch = html.match(/<form[^>]*id=["'][^"']*contact[^"']*["'][^>]*>[\s\S]*?<\/form>/i);
  }
  
  if (!formMatch) {
    // Try to find any form element at all
    formMatch = html.match(/<form[^>]*>[\s\S]*?<\/form>/i);
  }
  
  if (!formMatch) {
    console.log(`⚠️ Could not find any form element in ${pageName}`);
    return html;
  }

  let form = formMatch[0];
  const originalForm = form;

  // Add id="contact-form" if it doesn't have it
  if (!form.includes('id="contact-form"') && !form.includes("id='contact-form'")) {
    form = form.replace(/<form/, '<form id="contact-form"');
    console.log(`✅ Added id="contact-form" to form in ${pageName}`);
  }

  // Check if SMS consent already exists
  if (!form.includes('sms-consent') && !form.includes('sms_consent')) {
    // Find the submit button
    const buttonMatch = form.match(/<button[^>]*type=["']submit["'][^>]*>[\s\S]*?<\/button>/i) ||
                       form.match(/<input[^>]*type=["']submit["'][^>]*>/i) ||
                       form.match(/<button[^>]*>[\s\S]*?submit[\s\S]*?<\/button>/i);
    
    if (buttonMatch) {
      const smsConsentHTML = `
  <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
    <input type="checkbox" id="sms-consent" name="sms_consent" required style="width: 20px; height: 20px; margin-top: 2px; flex-shrink: 0; cursor: pointer;">
    <label for="sms-consent" style="font-size: 14px; line-height: 1.5; color: ${textColor}; cursor: pointer;">
      I agree to receive text messages at the number provided. Message and data rates may apply. Reply STOP to opt out.
    </label>
  </div>
  `;
      
      form = form.replace(buttonMatch[0], smsConsentHTML + buttonMatch[0]);
      console.log(`✅ Added SMS consent to ${pageName}`);
    } else {
      console.log(`⚠️ Could not find submit button in form in ${pageName}`);
    }
  } else {
    console.log(`✅ SMS consent already exists in ${pageName}`);
  }

  // Add form status div if missing
  if (!form.includes('form-status')) {
    form = form.replace('</form>', '  <div id="form-status" style="display: none; margin-top: 16px; padding: 12px; border-radius: 8px; text-align: center; font-weight: 500;"></div>\n</form>');
  }

  // Replace form in HTML
  html = html.replace(originalForm, form);
  
  // Remove any existing contact form scripts
  html = html.replace(/<script[^>]*>[\s\S]*?contact.*form[\s\S]*?<\/script>/gi, '');

  const submissionScript = `
<script>
(function() {
  const form = document.getElementById('contact-form');
  if (!form) {
    console.error('Contact form not found!');
    return;
  }
  
  // Remove any existing event listeners
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);
  
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const button = e.target.querySelector('button[type="submit"]') || e.target.querySelector('.submit-button') || e.target.querySelector('button');
    const statusEl = document.getElementById('form-status');
    
    const smsConsent = formData.get('sms_consent') === 'on';
    if (!smsConsent) {
      if (statusEl) {
        statusEl.textContent = '⚠️ Please agree to receive text messages to continue.';
        statusEl.style.display = 'block';
        statusEl.style.background = '#fef3c7';
        statusEl.style.color = '#92400e';
        statusEl.style.border = '2px solid #fbbf24';
      } else {
        alert('Please agree to receive text messages to continue.');
      }
      return;
    }
    
    const originalButtonText = button ? button.textContent : '';
    if (button) {
      button.textContent = 'Sending...';
      button.disabled = true;
    }
    
    try {
      const userId = document.querySelector('meta[name="user-id"]')?.content || '${userId}';
      
      if (!userId || userId === 'USER_ID_PLACEHOLDER') {
        throw new Error('User ID not configured');
      }
      
      const name = formData.get('name') || formData.get('full_name') || formData.get('fullname') || '';
      const email = formData.get('email') || formData.get('email_address') || '';
      const phone = formData.get('phone') || formData.get('phone_number') || formData.get('tel') || '';
      const service = formData.get('service') || formData.get('service_interested_in') || formData.get('vehicle_make_model') || formData.get('service_type') || '';
      const message = formData.get('message') || formData.get('additional_details') || formData.get('comments') || '';
      
      const response = await fetch('${apiUrl}/api/leads/public/' + userId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
          service: service,
          message: message,
          sms_consent: true,
          source: 'lead_form'
        })
      });
      
      if (response.ok) {
        if (statusEl) {
          statusEl.textContent = '✅ Thanks! We\\'ll be in touch soon.';
          statusEl.style.display = 'block';
          statusEl.style.background = '#d1fae5';
          statusEl.style.color = '#065f46';
          statusEl.style.border = '2px solid #6ee7b7';
        } else {
          alert('✅ Thanks! We\\'ll be in touch soon.');
        }
        e.target.reset();
      } else {
        throw new Error('Submission failed');
      }
    } catch (error) {
      console.error('Form error:', error);
      if (statusEl) {
        statusEl.textContent = '❌ Something went wrong. Please try again or call us directly.';
        statusEl.style.display = 'block';
        statusEl.style.background = '#fee2e2';
        statusEl.style.color = '#991b1b';
        statusEl.style.border = '2px solid #fca5a5';
      } else {
        alert('❌ Something went wrong. Please try again or call us directly.');
      }
    } finally {
      if (button) {
        button.textContent = originalButtonText;
        button.disabled = false;
      }
    }
  });
})();
</script>`;

  html = html.replace('</body>', submissionScript + '\n</body>');
  console.log(`✅ Updated form submission script in ${pageName}`);
  
  return html;
}

    const pagesFixed = [];
    let updatedPages = { ...pages };
    let updatedHtmlContent = website.html_content;

    // Fix contact forms in ALL pages
    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        const originalHTML = pages[pageKey];
        const fixedHTML = fixContactFormHTML(originalHTML, pageKey);
        
        if (fixedHTML !== originalHTML) {
          updatedPages[pageKey] = fixedHTML;
          pagesFixed.push(pageKey);
        }
      });
    }

    // Also check html_content (main page)
    if (website.html_content) {
      const fixedMainPage = fixContactFormHTML(website.html_content, 'index.html (main)');
      
      if (fixedMainPage !== website.html_content) {
        updatedHtmlContent = fixedMainPage;
        pagesFixed.push('index.html');
      }
    }

    if (pagesFixed.length === 0) {
      return res.status(404).json({ 
        error: 'No contact forms found on any pages',
        message: 'Your website does not appear to have any contact forms to fix'
      });
    }

    // Update database with ALL changes at once
    await pool.query(
      'UPDATE websites SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
      [updatedHtmlContent, updatedPages, userId]
    );

    console.log(`✅ Fixed contact forms on ${pagesFixed.length} page(s): ${pagesFixed.join(', ')}`);

    // AUTO-REDEPLOY - Call the publish endpoint internally
    let redeployed = false;
    let deployUrl = website.vercel_url;

    try {
      console.log('🚀 Auto-triggering publish...');
      
      const vercelToken = process.env.VERCEL_TOKEN;
      
      if (!vercelToken) {
        console.warn('⚠️ No Vercel token - skipping auto-deploy');
      } else {
        // Prepare files for deployment
        const files = [];
        const addedFiles = new Set();

        // Add all pages
        if (updatedPages && Object.keys(updatedPages).length > 0) {
          Object.keys(updatedPages).forEach(pageKey => {
            if (!addedFiles.has(pageKey)) {
              files.push({
                file: pageKey,
                data: Buffer.from(updatedPages[pageKey]).toString('base64')
              });
              addedFiles.add(pageKey);
            }
          });
        }

        // Add index.html if not already added
        if (updatedHtmlContent && !addedFiles.has('index.html')) {
          files.push({
            file: 'index.html',
            data: Buffer.from(updatedHtmlContent).toString('base64')
          });
          addedFiles.add('index.html');
        }

        console.log(`📦 Auto-deploy: ${files.length} files`);

        if (files.length > 0) {
          const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${vercelToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: `website-${userId}`,
              files: files,
              projectSettings: {
                framework: null
              }
            })
          });

          if (deployResponse.ok) {
            const deployData = await deployResponse.json();
            deployUrl = `https://${deployData.url}`;
            
            await pool.query(
              'UPDATE websites SET vercel_url = $1, vercel_deployment_id = $2 WHERE user_id = $3',
              [deployUrl, deployData.id, userId]
            );
            
            redeployed = true;
            console.log(`✅ Auto-deployed to ${deployUrl}`);
          } else {
            const errorText = await deployResponse.text();
            console.error('❌ Auto-deploy failed:', errorText);
          }
        }
      }
    } catch (error) {
      console.error('Auto-deploy error:', error);
      // Don't fail the whole request - just mark as not redeployed
    }

    res.json({
      success: true,
      pagesFixed,
      message: redeployed 
        ? `Contact form(s) updated and published! Live at ${deployUrl}` 
        : `Contact form(s) updated. Click "Publish Changes" to go live.`,
      redeployed,
      deployUrl
    });

  } catch (error) {
    console.error('Error fixing contact form:', error);
    res.status(500).json({ error: 'Failed to fix contact form' });
  }
});
 
// POST - Toggle publish status
router.post('/publish', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Fetch fresh data from database instead of using request body
    const websiteResult = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );
    
    if (websiteResult.rows.length === 0) {
      return res.status(404).json({ error: 'No website found' });
    }
    
    let { html_content, pages } = websiteResult.rows[0];
    
    // Make HTML mobile responsive before publishing
    html_content = makeMobileResponsive(html_content);
    
    if (pages) {
      Object.keys(pages).forEach(pageName => {
        pages[pageName] = makeMobileResponsive(pages[pageName]);
      });
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

// POST - AI Website Generation (Schema-based)
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

    // Import the new prompt builder and HTML renderer
    const { buildSchemaGenerationPrompt } = require('../utils/schema-generation-prompt');
    const { renderPageToHtml } = require('../utils/htmlRenderer');

    const safeBusinessName = sanitizeForPrompt(businessName);
    const safeBusinessType = sanitizeForPrompt(businessType);
    const safeTagline = sanitizeForPrompt(tagline);
    const safeServices = sanitizeForPrompt(services);
    const safeCertifications = sanitizeForPrompt(certifications);
    const safeDescription = sanitizeForPrompt(description);
    const safeUSPs = sanitizeForPrompt(uniqueSellingPoints);
    const safeTargetCustomer = sanitizeForPrompt(targetCustomer);

    console.log('🎨 Generating website schema for:', safeBusinessName);

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
          instruction: `Use these EXACT ${userServices.length} services with their real names, descriptions, and prices.`
        }
      : {
          hasData: false,
          services: safeServices || `General ${safeBusinessType} services`,
          instruction: `Create 4-6 SPECIFIC ${safeBusinessType} services with realistic names and prices.`
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
            instruction: 'Use these EXACT business hours.'
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

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const bookingUrl = `${frontendUrl}/book/${userId}`;

    // Colors based on business type
    const businessTypeLower = safeBusinessType.toLowerCase();
    let primaryColor = '#2563eb';
    let accentColor = '#10b981';
    
    if (businessTypeLower.includes('auto') || businessTypeLower.includes('detail')) {
      primaryColor = '#1f2937';
      accentColor = '#f59e0b';
    } else if (businessTypeLower.includes('land')) {
      primaryColor = '#047857';
      accentColor = '#16a34a';
    } else if (businessTypeLower.includes('plumb')) {
      primaryColor = '#1e40af';
      accentColor = '#f97316';
    }

    // Build the schema generation prompt
    const prompt = buildSchemaGenerationPrompt({
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

    console.log('📏 Prompt size:', (prompt.length / 1024).toFixed(2), 'KB');

    // Call Claude API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: prompt
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        timeout: 120000
      }
    );

    const data = response.data;
    let fullResponse = data.content?.[0]?.text;

    if (!fullResponse) {
      console.error('❌ No content in response');
      return res.status(500).json({ error: 'No content generated' });
    }

    // Clean up JSON response
    fullResponse = fullResponse.trim();
    if (fullResponse.startsWith('```json')) {
      fullResponse = fullResponse.slice(7);
    }
    if (fullResponse.startsWith('```')) {
      fullResponse = fullResponse.slice(3);
    }
    if (fullResponse.endsWith('```')) {
      fullResponse = fullResponse.slice(0, -3);
    }
    fullResponse = fullResponse.trim();

    // Parse JSON schema
    let pageData;
    try {
      pageData = JSON.parse(fullResponse);
      console.log('✅ Parsed JSON schema with', pageData.sections?.length || 0, 'sections');
    } catch (parseError) {
      console.error('❌ Failed to parse JSON:', parseError);
      console.error('Response was:', fullResponse.substring(0, 500));
      return res.status(500).json({ error: 'Failed to parse generated content' });
    }

    // Generate HTML from schema
    let htmlContent = renderPageToHtml(pageData, { userId });
    console.log('✅ Generated HTML:', (htmlContent.length / 1024).toFixed(2), 'KB');

    // Inject chat widget if deployed
    const chatAgentResult = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    const chatAgentDeployed = chatAgentResult.rows.length > 0 && 
                              chatAgentResult.rows[0].config?.enabled === true;

    if (chatAgentDeployed) {
      console.log('💬 Injecting chat widget');
      const websiteColors = { primaryColor, accentColor, textColor: '#1f2937' };
      const chatWidgetCode = generateChatWidgetCode(userId, chatAgentResult.rows[0].config, websiteColors);
      
      if (htmlContent.includes('</body>')) {
        htmlContent = htmlContent.replace('</body>', chatWidgetCode + '\n</body>');
        console.log('✅ Chat widget injected');
      }
    }

    // Save to database
    const existing = await pool.query(
      'SELECT id FROM websites WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE websites 
         SET html_content = $1, 
             page_data = $2, 
             pages = NULL,
             is_published = false,
             primary_color = $3,
             accent_color = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $5`,
        [htmlContent, JSON.stringify(pageData), primaryColor, accentColor, userId]
      );
    } else {
      await pool.query(
        `INSERT INTO websites (user_id, html_content, page_data, is_published, primary_color, accent_color, created_at, updated_at)
         VALUES ($1, $2, $3, false, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, htmlContent, JSON.stringify(pageData), primaryColor, accentColor]
      );
    }

    console.log('✅ Website saved for user', userId);

    res.json({ 
      success: true, 
      html: htmlContent,
      page_data: pageData,
      businessName: safeBusinessName,
      bookingUrl,
      phoneNumber,
      address: fullAddress || null,
      serviceArea: serviceAreaText || null,
      chatWidgetInjected: chatAgentDeployed,
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
// POST - Search for available domains
router.post('/search-domains', authenticateToken, async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required' });
    }

    console.log('🔍 Searching domains for:', query.trim());

    // Search for available domains
    const domains = await searchDomains(query.trim());

    console.log('📋 Search results:', domains);

    res.json({ success: true, domains });
  } catch (error) {
    console.error('Error searching domains:', error);
    res.status(500).json({ error: 'Failed to search domains' });
  }
});

// TEST - Check Porkbun API connection
router.get('/test-porkbun', authenticateToken, async (req, res) => {
  try {
    const axios = require('axios');
    
    // Test API connection
    const response = await axios.post(
      'https://porkbun.com/api/json/v3/ping',
      {
        apikey: process.env.PORKBUN_API_KEY,
        secretapikey: process.env.PORKBUN_SECRET_KEY
      }
    );
    
    res.json({ 
      success: true, 
      message: 'Porkbun API is accessible',
      data: response.data,
      serverIp: req.ip
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Porkbun API blocked',
      message: error.message,
      serverIp: req.ip,
      hint: 'You need to whitelist your Railway IP in Porkbun settings'
    });
  }
});

// POST - Purchase domain (managed by us)
router.post('/purchase-domain', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ error: 'Domain required' });
    }

    // Get user info
    const userResult = await pool.query(
      'SELECT email, business_name FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Purchase domain through domain registrar
    const purchaseResult = await purchaseDomain(domain, {
      email: user.email,
      businessName: user.business_name
    });

    // Add domain to Vercel
    await addDomainToVercel(domain, userId);

    // Save to database
    await pool.query(
      `UPDATE websites 
       SET custom_domain = $1, 
           domain_verified = true, 
           domain_managed_by_us = true,
           domain_purchase_date = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $2`,
      [domain, userId]
    );

    // Create subscription record for $15/year billing
    await pool.query(
      `INSERT INTO domain_subscriptions (user_id, domain, price_yearly, status, next_billing_date)
       VALUES ($1, $2, 15.00, 'active', CURRENT_DATE + INTERVAL '1 year')`,
      [userId, domain]
    );

    res.json({ 
      success: true, 
      domain,
      message: 'Domain purchased and configured successfully'
    });
  } catch (error) {
    console.error('Error purchasing domain:', error);
    res.status(500).json({ error: error.message || 'Failed to purchase domain' });
  }
});

// POST - Add custom domain (user already owns it)
router.post('/add-domain', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ error: 'Domain required' });
    }

    // Validate domain format
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
    if (!domainRegex.test(domain.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }

    // Add domain to Vercel
    await addDomainToVercel(domain, userId);

    // Save to database
    await pool.query(
      `UPDATE websites 
       SET custom_domain = $1, 
           domain_verified = false, 
           domain_managed_by_us = false,
           updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $2`,
      [domain, userId]
    );

    res.json({ success: true, domain });
  } catch (error) {
    console.error('Error adding domain:', error);
    res.status(500).json({ error: 'Failed to add domain' });
  }
});

// GET - Check domain verification status
router.get('/domain-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT custom_domain, domain_verified FROM websites WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].custom_domain) {
      return res.json({ verified: false });
    }

    const domain = result.rows[0].custom_domain;
    
    // If already verified in DB, return true
    if (result.rows[0].domain_verified) {
      return res.json({ verified: true });
    }

    // Check with Vercel
    const isVerified = await checkDomainVerification(domain, userId);

    // Update database if now verified
    if (isVerified) {
      await pool.query(
        'UPDATE websites SET domain_verified = true, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1',
        [userId]
      );
    }

    res.json({ verified: isVerified });
  } catch (error) {
    console.error('Error checking domain status:', error);
    res.status(500).json({ error: 'Failed to check domain status' });
  }
});

// DELETE - Remove domain
router.delete('/remove-domain', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get current domain
    const result = await pool.query(
      'SELECT custom_domain, domain_managed_by_us FROM websites WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].custom_domain) {
      return res.status(404).json({ error: 'No domain found' });
    }

    const domain = result.rows[0].custom_domain;
    const managedByUs = result.rows[0].domain_managed_by_us;

    // Try to remove from Vercel (don't fail if project doesn't exist)
    try {
      await removeDomainFromVercel(domain, userId);
    } catch (error) {
      console.warn('Could not remove from Vercel (continuing anyway):', error.message);
      // Don't fail the whole operation - just log it
    }

    // If we manage the domain, cancel subscription
    if (managedByUs) {
      await pool.query(
        `UPDATE domain_subscriptions 
         SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP 
         WHERE user_id = $1 AND domain = $2`,
        [userId, domain]
      );
    }

    // Clear domain from database
    await pool.query(
      `UPDATE websites 
       SET custom_domain = NULL, 
           domain_verified = false, 
           domain_managed_by_us = false,
           updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1`,
      [userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing domain:', error);
    res.status(500).json({ error: 'Failed to remove domain' });
  }
});

module.exports = router;
