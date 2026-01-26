const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { buildVisualSupremacyPrompt } = require('../utils/visual-supremacy-prompt');
const { deployToVercel, addDomainToVercel, checkDomainVerification, removeDomainFromVercel } = require('../services/vercel');
const { searchDomains, purchaseDomain } = require('../services/domain');
const axios = require('axios');

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

// ============================================
// GET - Check if contact form is properly configured IN DATABASE
// ============================================
router.get('/check-contact-form', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const websiteResult = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.json({ 
        hasWebsite: false, 
        isValid: false,
        message: 'No website found'
      });
    }

    const website = websiteResult.rows[0];
    let pages = website.pages || {};

    // Get expected API URL
    const expectedApiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
      : process.env.API_URL || 'https://backend-production-ab50.up.railway.app';

    // Helper to check a single HTML string
    function checkHTML(html) {
      if (!html) return { isValid: false, issues: ['No HTML content'] };
      
      const hasContactForm = html.includes('id="contact-form"');
      const hasSMSConsent = html.includes('id="sms-consent"') && html.includes('name="sms_consent"');
      const hasMetaTag = html.includes(`meta name="user-id" content="${userId}"`);
      const hasSubmitScript = html.includes('/api/leads/public/');
      const hasCorrectApiUrl = html.includes(expectedApiUrl);
      const hasPhoneRequired = html.includes('name="phone" placeholder="Phone Number" required');
      
      const scriptMatches = html.match(/<script>\s*\(function\(\) {[\s\S]*?contact-form[\s\S]*?}\)\(\);\s*<\/script>/g);
      const hasDuplicateScripts = scriptMatches && scriptMatches.length > 1;
      const hasPlaceholderUrl = html.includes('https://your-backend.railway.app');

      const issues = [];
      if (!hasContactForm) issues.push('Missing contact form');
      if (!hasSMSConsent) issues.push('Missing SMS consent');
      if (!hasMetaTag) issues.push('Missing user-id meta tag');
      if (!hasSubmitScript) issues.push('Missing submission script');
      if (!hasCorrectApiUrl) issues.push('Wrong API URL');
      if (!hasPhoneRequired) issues.push('Phone not required');
      if (hasDuplicateScripts) issues.push('Duplicate scripts');
      if (hasPlaceholderUrl) issues.push('Placeholder URL');

      const isValid = hasContactForm && hasSMSConsent && hasMetaTag && hasSubmitScript && hasCorrectApiUrl && hasPhoneRequired && !hasDuplicateScripts && !hasPlaceholderUrl;

      return { isValid, issues };
    }

    // Check all pages that have contact forms
    let anyFormValid = false;
    const allIssues = [];

    // Check pages
    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        const html = pages[pageKey];
        if (html && (html.includes('id="contact-form"') || html.includes('contact'))) {
          const result = checkHTML(html);
          if (result.isValid) {
            anyFormValid = true;
          } else {
            allIssues.push(`${pageKey}: ${result.issues.join(', ')}`);
          }
        }
      });
    }

    // Check main html_content
    if (website.html_content && (website.html_content.includes('id="contact-form"') || website.html_content.includes('contact'))) {
      const result = checkHTML(website.html_content);
      if (result.isValid) {
        anyFormValid = true;
      } else {
        allIssues.push(`index.html: ${result.issues.join(', ')}`);
      }
    }

    res.json({
      hasWebsite: true,
      isValid: anyFormValid,
      message: anyFormValid 
        ? 'Contact form is properly configured in database (may take 1-2 min to deploy)' 
        : 'Contact form needs fixing',
      issues: allIssues.length > 0 ? allIssues : null
    });

  } catch (error) {
    console.error('Error checking contact form:', error);
    res.status(500).json({ error: 'Failed to check contact form' });
  }
});

// ============================================
// POST - Fix/Update Contact Form in Existing Website
// ============================================
router.post('/fix-contact-form', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get website with pages
    const websiteResult = await pool.query(
      'SELECT html_content, pages, vercel_url FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.status(404).json({ error: 'No website found' });
    }

    const website = websiteResult.rows[0];
    
    // pages is already an object (PostgreSQL returns jsonb/json as objects)
    let pages = website.pages || {};

    // Get REAL API URL
    const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
      : process.env.API_URL || 'https://backend-production-ab50.up.railway.app';

    console.log('🔧 Using API URL:', apiUrl);

    // Working contact form HTML
    const workingContactFormHTML = `
<form id="contact-form" style="background: white; padding: 40px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
  <input type="text" name="name" placeholder="Your Name" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px;">
  <input type="email" name="email" placeholder="Email Address" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px;">
  <input type="tel" name="phone" placeholder="Phone Number" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px;">
  <input type="text" name="service" placeholder="Service Interested In" style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px;">
  <textarea name="message" rows="4" placeholder="Tell us about your project..." style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; resize: vertical;"></textarea>
  
  <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
    <input type="checkbox" id="sms-consent" name="sms_consent" required style="width: 20px; height: 20px; margin-top: 2px; flex-shrink: 0; cursor: pointer;">
    <label for="sms-consent" style="font-size: 14px; line-height: 1.5; color: #374151; cursor: pointer;">
      I agree to receive text messages at the number provided. Message and data rates may apply. Reply STOP to opt out.
    </label>
  </div>
  
  <button type="submit" style="width: 100%; padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: 600; cursor: pointer; transition: transform 0.2s;">
    Send Message
  </button>
  <div id="form-status" style="display: none; margin-top: 16px; padding: 12px; border-radius: 8px; text-align: center; font-weight: 500;"></div>
</form>`;

    const workingContactFormScript = `
<script>
(function() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const button = e.target.querySelector('button[type="submit"]');
    const statusEl = document.getElementById('form-status');
    
    const smsConsent = formData.get('sms_consent') === 'on';
    if (!smsConsent) {
      statusEl.textContent = '⚠️ Please agree to receive text messages to continue.';
      statusEl.style.display = 'block';
      statusEl.style.background = '#fef3c7';
      statusEl.style.color = '#92400e';
      statusEl.style.border = '2px solid #fbbf24';
      return;
    }
    
    button.textContent = 'Sending...';
    button.disabled = true;
    
    try {
      const userId = document.querySelector('meta[name="user-id"]')?.content || '${userId}';
      
      const response = await fetch('${apiUrl}/api/leads/public/' + userId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          phone: formData.get('phone') || '',
          service: formData.get('service') || '',
          message: formData.get('message') || '',
          sms_consent: true,
          source: 'lead_form'
        })
      });
      
      if (response.ok) {
        statusEl.textContent = '✅ Thanks! We\\'ll be in touch soon.';
        statusEl.style.display = 'block';
        statusEl.style.background = '#d1fae5';
        statusEl.style.color = '#065f46';
        statusEl.style.border = '2px solid #6ee7b7';
        e.target.reset();
      } else {
        throw new Error('Submission failed');
      }
    } catch (error) {
      console.error('Form error:', error);
      statusEl.textContent = '❌ Something went wrong. Please call us directly.';
      statusEl.style.display = 'block';
      statusEl.style.background = '#fee2e2';
      statusEl.style.color = '#991b1b';
      statusEl.style.border = '2px solid #fca5a5';
    } finally {
      button.textContent = 'Send Message';
      button.disabled = false;
    }
  });
})();
</script>`;

    // Helper function to check if page has a contact form
    function hasContactForm(html) {
      return html.includes('id="contact-form"') || 
             html.includes('class="contact-form"') ||
             /<form[^>]*>[\s\S]*?(contact|email|phone|message)[\s\S]*?<\/form>/i.test(html);
    }

   function fixContactFormHTML(html, pageName) {
  if (!hasContactForm(html)) return html;

  console.log(`🔧 Fixing contact form in ${pageName}`);

  // First, detect the existing form's styling/theme
  const isDarkTheme = html.includes('background: #0a0a0a') || html.includes('background: black') || html.includes('bg-black');
  
  // Remove ALL existing forms and contact sections MORE AGGRESSIVELY
  // Remove forms first
  html = html.replace(/<form[^>]*id=["']contact-form["'][^>]*>[\s\S]*?<\/form>/gi, '');
  html = html.replace(/<form[^>]*class=["'][^"']*contact[^"']*["'][^>]*>[\s\S]*?<\/form>/gi, '');
  html = html.replace(/<form[^>]*name=["'][^"']*contact[^"']*["'][^>]*>[\s\S]*?<\/form>/gi, '');
  
  // Remove any form with contact-related fields
  html = html.replace(/<form[^>]*>[\s\S]*?(email|phone|message)[\s\S]*?<\/form>/gi, '');
  
  // Remove contact sections
  html = html.replace(/<section[^>]*id=["']contact["'][^>]*>[\s\S]*?<\/section>/gi, '');
  html = html.replace(/<section[^>]*class=["'][^"']*contact[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, '');
  
  // Remove any div with contact-form class or id
  html = html.replace(/<div[^>]*id=["']contact-form["'][^>]*>[\s\S]*?<\/div>/gi, '');
  html = html.replace(/<div[^>]*class=["'][^"']*contact[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
  
  // Remove scripts
  html = html.replace(/<script>\s*\(function\(\) {[\s\S]*?contact-form[\s\S]*?}\)\(\);\s*<\/script>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?contact-form[\s\S]*?<\/script>/gi, '');

  // Ensure meta tag
  if (!html.includes('meta name="user-id"')) {
    html = html.replace('</head>', `  <meta name="user-id" content="${userId}">\n</head>`);
  } else {
    html = html.replace(/<meta name="user-id" content="[^"]*"/, `<meta name="user-id" content="${userId}"`);
  }

  // Create styled form that matches the theme
  const workingContactFormHTML = `
<form id="contact-form" style="background: white; padding: 40px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 450px; margin: 0 auto;">
  <input type="text" name="name" placeholder="Your Name" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; box-sizing: border-box;">
  <input type="email" name="email" placeholder="Email Address" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; box-sizing: border-box;">
  <input type="tel" name="phone" placeholder="Phone Number" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; box-sizing: border-box;">
  <input type="text" name="service" placeholder="Service Interested In" style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; box-sizing: border-box;">
  <textarea name="message" rows="4" placeholder="Tell us about your project..." style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; resize: vertical; box-sizing: border-box;"></textarea>
  
  <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
    <input type="checkbox" id="sms-consent" name="sms_consent" required style="width: 20px; height: 20px; margin-top: 2px; flex-shrink: 0; cursor: pointer;">
    <label for="sms-consent" style="font-size: 14px; line-height: 1.5; color: #374151; cursor: pointer;">
      I agree to receive text messages at the number provided. Message and data rates may apply. Reply STOP to opt out.
    </label>
  </div>
  
  <button type="submit" style="width: 100%; padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: 600; cursor: pointer; transition: transform 0.2s;">
    Send Message
  </button>
  <div id="form-status" style="display: none; margin-top: 16px; padding: 12px; border-radius: 8px; text-align: center; font-weight: 500;"></div>
</form>`;

  const workingContactFormScript = `
<script>
(function() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const button = e.target.querySelector('button[type="submit"]');
    const statusEl = document.getElementById('form-status');
    
    const smsConsent = formData.get('sms_consent') === 'on';
    if (!smsConsent) {
      statusEl.textContent = '⚠️ Please agree to receive text messages to continue.';
      statusEl.style.display = 'block';
      statusEl.style.background = '#fef3c7';
      statusEl.style.color = '#92400e';
      statusEl.style.border = '2px solid #fbbf24';
      return;
    }
    
    button.textContent = 'Sending...';
    button.disabled = true;
    
    try {
      const userId = document.querySelector('meta[name="user-id"]')?.content || '${userId}';
      
      const response = await fetch('${apiUrl}/api/leads/public/' + userId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          phone: formData.get('phone') || '',
          service: formData.get('service') || '',
          message: formData.get('message') || '',
          sms_consent: true,
          source: 'lead_form'
        })
      });
      
      if (response.ok) {
        statusEl.textContent = '✅ Thanks! We\\'ll be in touch soon.';
        statusEl.style.display = 'block';
        statusEl.style.background = '#d1fae5';
        statusEl.style.color = '#065f46';
        statusEl.style.border = '2px solid #6ee7b7';
        e.target.reset();
      } else {
        throw new Error('Submission failed');
      }
    } catch (error) {
      statusEl.textContent = '❌ Something went wrong. Please call us directly.';
      statusEl.style.display = 'block';
      statusEl.style.background = '#fee2e2';
      statusEl.style.color = '#991b1b';
      statusEl.style.border = '2px solid #fca5a5';
    } finally {
      button.textContent = 'Send Message';
      button.disabled = false;
    }
  });
})();
</script>`;

  // Find where to insert the new form
  // Look for an existing contact section or create one
  const contactSectionPattern = /<section[^>]*>[\s\S]*?(get in touch|contact|reach out)[\s\S]*?<\/section>/gi;
  
  if (contactSectionPattern.test(html)) {
    // Replace the existing contact section
    html = html.replace(contactSectionPattern, (match) => {
      return `
<section id="contact" style="padding: 80px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
  <div style="max-width: 600px; margin: 0 auto;">
    <h2 style="text-align: center; color: white; font-size: 36px; margin-bottom: 40px;">Get In Touch</h2>
    ${workingContactFormHTML}
  </div>
</section>
${workingContactFormScript}`;
    });
  } else {
    // Add before closing body tag if no contact section exists
    const newContactSection = `
<section id="contact" style="padding: 80px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
  <div style="max-width: 600px; margin: 0 auto;">
    <h2 style="text-align: center; color: white; font-size: 36px; margin-bottom: 40px;">Get In Touch</h2>
    ${workingContactFormHTML}
  </div>
</section>
${workingContactFormScript}`;
    
    html = html.replace('</body>', newContactSection + '\n</body>');
  }

  return html;
}

    const pagesFixed = [];
    let updatedPages = { ...pages }; // Create a copy
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

      if (pagesFixed.length > 0) {
        // Update pages in database - NO JSON.stringify needed
        await pool.query(
          'UPDATE websites SET pages = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
          [updatedPages, userId]
        );

        console.log(`✅ Fixed contact forms on ${pagesFixed.length} page(s): ${pagesFixed.join(', ')}`);
      }
    }

    // Also check html_content (main page) if it exists
    if (website.html_content) {
      const fixedMainPage = fixContactFormHTML(website.html_content, 'index.html (main)');
      
      if (fixedMainPage !== website.html_content) {
        await pool.query(
          'UPDATE websites SET html_content = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
          [fixedMainPage, userId]
        );
        updatedHtmlContent = fixedMainPage;
        pagesFixed.push('index.html');
        console.log(`✅ Fixed contact form in main html_content`);
      }
    }

    if (pagesFixed.length === 0) {
      return res.status(404).json({ 
        error: 'No contact forms found on any pages',
        message: 'Your website does not appear to have any contact forms to fix'
      });
    }

    // AUTO-REDEPLOY TO VERCEL
    let redeploySuccess = false;
let deployUrl = null;

try {
  const vercelToken = process.env.VERCEL_TOKEN;
  
  if (vercelToken) {
    const files = [];
    const addedFiles = new Set(); // Track which files we've added
    
    // Add all pages from the pages object
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
    
    // Only add index.html from html_content if it wasn't already added from pages
    if (updatedHtmlContent && !addedFiles.has('index.html')) {
      files.push({
        file: 'index.html',
        data: Buffer.from(updatedHtmlContent).toString('base64')
      });
      addedFiles.add('index.html');
    }

    console.log(`📦 Total files to deploy: ${files.length}`);

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
          'UPDATE websites SET vercel_url = $1, vercel_deployment_id = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
          [deployUrl, deployData.id, userId]
        );
        
        redeploySuccess = true;
        console.log(`✅ Deployed to ${deployUrl}`);
      } else {
        const errorText = await deployResponse.text();
        console.error('❌ Vercel deploy failed:', errorText);
      }
    }
  }
} catch (deployError) {
  console.error('Deploy error:', deployError.message);
}
    
// Helper function to generate working contact form
function getWorkingContactForm(userId) {
  const apiUrl = process.env.API_URL || 'https://your-backend.railway.app';
  
  return `
<form id="contact-form" style="background: white; padding: 40px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
  <input type="text" name="name" placeholder="Your Name" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px;">
  <input type="email" name="email" placeholder="Email Address" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px;">
  <input type="tel" name="phone" placeholder="Phone Number" required style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px;">
  <input type="text" name="service" placeholder="Service Interested In" style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px;">
  <textarea name="message" rows="4" placeholder="Tell us about your project..." style="width: 100%; padding: 16px; margin-bottom: 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; resize: vertical;"></textarea>
  
  <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
    <input type="checkbox" id="sms-consent" name="sms_consent" required style="width: 20px; height: 20px; margin-top: 2px; flex-shrink: 0; cursor: pointer;">
    <label for="sms-consent" style="font-size: 14px; line-height: 1.5; color: #374151; cursor: pointer;">
      I agree to receive text messages at the number provided. Message and data rates may apply. Reply STOP to opt out.
    </label>
  </div>
  
  <button type="submit" style="width: 100%; padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: 600; cursor: pointer; transition: transform 0.2s;">
    Send Message
  </button>
  <div id="form-status" style="display: none; margin-top: 16px; padding: 12px; border-radius: 8px; text-align: center; font-weight: 500;"></div>
</form>

<script>
(function() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const button = e.target.querySelector('button');
    const statusEl = document.getElementById('form-status');
    
    const smsConsent = formData.get('sms_consent') === 'on';
    if (!smsConsent) {
      statusEl.textContent = '⚠️ Please agree to receive text messages to continue.';
      statusEl.style.display = 'block';
      statusEl.style.background = '#fef3c7';
      statusEl.style.color = '#92400e';
      statusEl.style.border = '2px solid #fbbf24';
      return;
    }
    
    button.textContent = 'Sending...';
    button.disabled = true;
    
    try {
      const userId = document.querySelector('meta[name="user-id"]')?.content || '${userId}';
      
      const response = await fetch('${apiUrl}/api/leads/public/' + userId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          phone: formData.get('phone') || '',
          service: formData.get('service') || '',
          message: formData.get('message') || '',
          sms_consent: true,
          source: 'lead_form'
        })
      });
      
      if (response.ok) {
        statusEl.textContent = '✅ Thanks! We\\'ll be in touch soon.';
        statusEl.style.display = 'block';
        statusEl.style.background = '#d1fae5';
        statusEl.style.color = '#065f46';
        statusEl.style.border = '2px solid #6ee7b7';
        e.target.reset();
      } else {
        throw new Error('Submission failed');
      }
    } catch (error) {
      statusEl.textContent = '❌ Something went wrong. Please call us directly.';
      statusEl.style.display = 'block';
      statusEl.style.background = '#fee2e2';
      statusEl.style.color = '#991b1b';
      statusEl.style.border = '2px solid #fca5a5';
    } finally {
      button.textContent = 'Send Message';
      button.disabled = false;
    }
  });
})();
</script>`;
}

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

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const bookingUrl = `${frontendUrl}/book/${userId}`;

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

    console.log('📏 Prompt size:', prompt.length, 'characters');
console.log('📏 Prompt size:', (prompt.length / 1024).toFixed(2), 'KB');

    // Call Claude API using axios (no timeout limits)
const response = await axios.post(
  'https://api.anthropic.com/v1/messages',
  {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 40000,
    temperature: 0.5,
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
    timeout: 0
  }
);

const data = response.data;
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

// POST - Deploy website to Vercel
// POST - Deploy website to Vercel
router.post('/deploy', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get website content AND pages
    const websiteResult = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Website not found' });
    }

    const htmlContent = websiteResult.rows[0].html_content;
    const pagesJson = websiteResult.rows[0].pages;
    
    // Parse pages if they exist
    let pages = null;
    if (pagesJson) {
      pages = typeof pagesJson === 'string' ? JSON.parse(pagesJson) : pagesJson;
    }

    // Deploy to Vercel with all pages
    const deploymentUrl = await deployToVercel(userId, htmlContent, pages);

    // Save Vercel URL to database
    await pool.query(
      'UPDATE websites SET vercel_url = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [deploymentUrl, userId]
    );

    res.json({ success: true, url: deploymentUrl });
  } catch (error) {
    console.error('Error deploying website:', error);
    res.status(500).json({ error: 'Failed to deploy website' });
  }
});
// POST - Connect existing website
router.post('/connect-existing', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    let websiteUrl;
    try {
      websiteUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Fetch the website HTML
    const response = await fetch(websiteUrl.href);
    if (!response.ok) {
      return res.status(400).json({ error: 'Failed to fetch website. Make sure the URL is accessible.' });
    }

    const htmlContent = await response.text();

    // Save to database
    const result = await pool.query(
      `INSERT INTO websites (user_id, html_content, url, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET 
         html_content = $2,
         url = $3,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, html_content, url`,
      [userId, htmlContent, websiteUrl.href]
    );

    console.log('✅ Connected existing website for user:', userId);

    res.json({
      success: true,
      html_content: result.rows[0].html_content,
      url: result.rows[0].url,
      website_id: result.rows[0].id
    });

  } catch (error) {
    console.error('❌ Connect website error:', error);
    res.status(500).json({ error: 'Failed to connect website' });
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
