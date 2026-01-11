const { getRecommendedTemplate, getTemplateInfo, TEMPLATES } = require('./templates-enhanced.js');
const fs = require('fs');
const path = require('path');

// ============================================
// VISUAL SUPREMACY PROMPT - WITH TEMPLATE FILES
// This loads actual HTML templates and uses them as base
// ============================================

function buildVisualSupremacyPrompt({
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
}) {
  
  // Get recommended template based on business type
  const recommendedTemplateKey = getRecommendedTemplate(safeBusinessType);

  // LOAD ACTUAL TEMPLATE HTML FILES
  const templateInfo = TEMPLATES[recommendedTemplateKey];
  
  // Debug logging
  console.log('🔍 __dirname:', __dirname);
  console.log('🔍 templateInfo.folder:', templateInfo.folder);
  console.log('🔍 recommendedTemplateKey:', recommendedTemplateKey);
  
  // Try listing what's actually in __dirname
  try {
    const filesInDir = fs.readdirSync(__dirname);
    console.log('🔍 Files in __dirname:', filesInDir);
  } catch (e) {
    console.log('🔍 Cannot read __dirname:', e.message);
  }
  
  // Try multiple possible template locations
  const possiblePaths = [
    path.join(__dirname, 'templates', templateInfo.folder),  // /app/templates/dental
    path.join(__dirname, '..', 'templates', templateInfo.folder),  // /templates/dental (if server.js is in /app)
    path.join(__dirname, templateInfo.folder),  // /app/dental
  ];
  
  let templateDir = null;
  for (const testPath of possiblePaths) {
    console.log('🔍 Testing path:', testPath, '- Exists?', fs.existsSync(testPath));
    if (fs.existsSync(testPath)) {
      templateDir = testPath;
      console.log('✅ Found templates at:', templateDir);
      break;
    }
  }
  
  if (!templateDir) {
    console.log(`⚠️ Template directory not found for ${recommendedTemplateKey}`);
    console.log('⚠️ Tried paths:', possiblePaths);
  }
  
  let templateFiles = {};
  if (templateDir) {
    try {
      // Read all HTML files from template directory
      const files = fs.readdirSync(templateDir).filter(f => f.endsWith('.html'));
      
      files.forEach(file => {
        const filePath = path.join(templateDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const pageName = file.replace('.html', '');
        templateFiles[pageName] = content;
      });
      
      console.log('✅ Loaded', Object.keys(templateFiles).length, 'template files');
    } catch (error) {
      console.error('❌ Error loading template files:', error);
    }
  }
  
  // Calculate RGB values for color effects
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '37, 99, 235';
  };
 
  const primaryRgb = hexToRgb(primaryColor);
  const secondaryRgb = hexToRgb(accentColor);
  
  // Build template HTML section if files were loaded
  const templateHTMLSection = Object.keys(templateFiles).length > 0 ? `
═══════════════════════════════════════════════════════════════════
📄 BASE TEMPLATE HTML FILES
═══════════════════════════════════════════════════════════════════

You have been provided with COMPLETE HTML TEMPLATE FILES from the ${templateInfo.name} template.

**CRITICAL INSTRUCTIONS:**
1. Use these templates as your BASE - do NOT generate from scratch
2. Maintain the EXACT structure, animations, and styling
3. Replace ALL placeholder content with real business data
4. Update colors to match user's brand (${primaryColor} and ${accentColor})
5. Keep all CSS classes, IDs, and JavaScript functionality intact

**Available Template Files:**
${Object.keys(templateFiles).map(name => `- ${name}.html`).join('\n')}

**Replacement Guide:**
${recommendedTemplateKey === 'landscaping' ? `
- "Green Valley Landscaping" → ${safeBusinessName}
- "(555) 847-2900" → ${phoneNumber}
- "info@greenvalley.com" → ${contactEmail}
- All "#" href links → ${bookingUrl}
- Service cards → Use provided services data
- Recent work locations → Use ${serviceAreaText || 'your service area'}
` : `
- "Precision Auto" → ${safeBusinessName}
- "(555) CAR-WASH" → ${phoneNumber}
- "info@precisionauto.com" → ${contactEmail}
- All "#" href links → ${bookingUrl}
- Service/package cards → Use provided services data
`}

═══════════════════════════════════════════════════════════════════
📂 TEMPLATE FILES CONTENT
═══════════════════════════════════════════════════════════════════

${Object.entries(templateFiles).map(([name, content]) => `
### ${name}.html
\`\`\`html
${content}
\`\`\`
`).join('\n\n')}

═══════════════════════════════════════════════════════════════════
🔧 YOUR TASK
═══════════════════════════════════════════════════════════════════

1. Take the index.html (homepage) template above
2. Replace ALL business-specific content with ${safeBusinessName}'s information
3. Update contact details (phone, email, address)
4. Replace services with: ${servicesInfo.services}
5. Update business hours: ${hoursInfo.hours}
6. Change color scheme from template colors to user's colors:
   - Primary: ${templateInfo.colorScheme.primary} → ${primaryColor}
   - Accent: ${templateInfo.colorScheme.accent} → ${accentColor}
7. Generate authentic testimonials for ${safeBusinessType}
8. Update all images to be industry-appropriate using Unsplash keywords

**OUTPUT:** Return the COMPLETE, CUSTOMIZED HTML file with all replacements made.

` : `
═══════════════════════════════════════════════════════════════════
⚠️ NO TEMPLATE FILES LOADED
═══════════════════════════════════════════════════════════════════

Template files could not be loaded. Generate website from scratch following ${templateInfo.name} design specifications below.

`;

  return `You are an elite web designer creating a VISUALLY STUNNING, premium service business website.

${templateHTMLSection}

═══════════════════════════════════════════════════════════════════
🏢 BUSINESS PROFILE
═══════════════════════════════════════════════════════════════════

**Company:** ${safeBusinessName}
**Industry:** ${safeBusinessType}
${safeTagline ? `**Tagline:** "${safeTagline}"` : ''}
${yearsInBusiness ? `**Experience:** ${yearsInBusiness} years` : ''}
${safeCertifications ? `**Credentials:** ${safeCertifications}` : ''}
${safeDescription ? `**About:** ${safeDescription}` : ''}
${safeUSPs ? `**Differentiators:** ${safeUSPs}` : ''}
${safeTargetCustomer ? `**Target Market:** ${safeTargetCustomer}` : ''}

═══════════════════════════════════════════════════════════════════
📞 CONTACT & LOCATION
═══════════════════════════════════════════════════════════════════

**Phone:** ${phoneNumber} (tel:${phoneNumberClean})
**Email:** ${contactEmail}
${fullAddress ? `**Address:** ${fullAddress}` : ''}
${serviceAreaText ? `**Coverage:** ${serviceAreaText}` : ''}
${ownerName ? `**Owner:** ${ownerName}` : ''}

🔗 **ALL booking buttons → ${bookingUrl}?source=website**

═══════════════════════════════════════════════════════════════════
💼 SERVICES
═══════════════════════════════════════════════════════════════════

${servicesInfo.services}
⚠️ ${servicesInfo.instruction}

═══════════════════════════════════════════════════════════════════
🕐 BUSINESS HOURS
═══════════════════════════════════════════════════════════════════

${hoursInfo.hours}
${hoursInfo.instruction}

${teamInfo.team ? `═══════════════════════════════════════════════════════════════════
👥 TEAM
═══════════════════════════════════════════════════════════════════

${teamInfo.team}
${teamInfo.instruction}` : ''}

═══════════════════════════════════════════════════════════════════
📸 IMAGES
═══════════════════════════════════════════════════════════════════

**Note:** The template includes placeholder image URLs. Users will replace these with their own business photos.
- Hero images should showcase the business service/results
- Service cards should show specific services being performed
- About section should show the team/equipment/facility

═══════════════════════════════════════════════════════════════════
📝 CONTACT FORM - CRITICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════

**MANDATORY CONTACT FORM STRUCTURE:**

Every website MUST include a contact form with these EXACT elements:

### Required Form Fields:
1. **Name** (required) - ID: "contactName"
2. **Email** (required) - ID: "contactEmail"  
3. **Phone** (required) - ID: "contactPhone"
4. **Service Interest** (required) - ID: "contactService" (dropdown with actual services)
5. **Message** (optional) - ID: "contactMessage"

### MANDATORY SMS CONSENT CHECKBOX (CRITICAL - LEGAL REQUIREMENT):

**This is NON-NEGOTIABLE and MUST be included:**

\`\`\`html
<!-- SMS CONSENT - MANDATORY -->
<div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 20px; margin: 25px 0;">
  <label style="display: flex; align-items: flex-start; cursor: pointer; margin: 0;">
    <input 
      type="checkbox" 
      id="smsConsent" 
      name="smsConsent" 
      required
      style="width: 22px; height: 22px; margin-right: 12px; margin-top: 2px; cursor: pointer; flex-shrink: 0; accent-color: #f59e0b;"
    >
    <span style="color: #92400e; font-size: 14px; line-height: 1.6;">
      <strong style="display: block; margin-bottom: 8px; font-size: 15px;">SMS Consent Required *</strong>
      I consent to receive text messages from this business at the phone number provided above. 
      I understand that message and data rates may apply, and I can opt out at any time by replying STOP.
    </span>
  </label>
  <div id="consentError" style="color: #dc2626; font-size: 13px; margin-top: 10px; padding: 10px; background: #fee2e2; border-radius: 8px; display: none;">
    ⚠️ You must consent to receive text messages to submit this form
  </div>
</div>
\`\`\`

### Contact Preference Selection:

\`\`\`html
<div style="background: #f0f9ff; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #3b82f6;">
  <h4 style="color: #1e40af; margin: 0 0 15px 0;">How would you prefer to be contacted?</h4>
  <div style="display: flex; gap: 15px;">
    <div style="flex: 1;">
      <input type="radio" id="preferEmail" name="preferredContact" value="email" checked style="position: absolute; opacity: 0;">
      <label for="preferEmail" style="display: block; padding: 15px; background: white; border: 2px solid #e5e7eb; border-radius: 10px; cursor: pointer; text-align: center; font-weight: 600;">
        📧 Email<br><small>Recommended</small>
      </label>
    </div>
    <div style="flex: 1;">
      <input type="radio" id="preferSMS" name="preferredContact" value="sms" style="position: absolute; opacity: 0;">
      <label for="preferSMS" style="display: block; padding: 15px; background: white; border: 2px solid #e5e7eb; border-radius: 10px; cursor: pointer; text-align: center; font-weight: 600;">
        💬 Text<br><small>Fast response</small>
      </label>
    </div>
  </div>
</div>
\`\`\`

### JavaScript Validation (REQUIRED):

\`\`\`javascript
// Contact form SMS consent validation
const contactForm = document.getElementById('contactForm');
const smsConsentCheckbox = document.getElementById('smsConsent');
const consentError = document.getElementById('consentError');

smsConsentCheckbox.addEventListener('change', () => {
  if (smsConsentCheckbox.checked) {
    consentError.style.display = 'none';
  }
});

contactForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // VALIDATE SMS CONSENT - MANDATORY
  if (!smsConsentCheckbox.checked) {
    consentError.style.display = 'block';
    smsConsentCheckbox.focus();
    smsConsentCheckbox.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  
  consentError.style.display = 'none';
  
  const formData = new FormData(contactForm);
  const data = {
    businessId: 'BUSINESS_ID_PLACEHOLDER',
    customerName: formData.get('name'),
    customerEmail: formData.get('email'),
    customerPhone: formData.get('phone'),
    preferredContact: formData.get('preferredContact'),
    serviceInterest: formData.get('service'),
    message: formData.get('message'),
    smsConsent: true
  };
  
  alert('Thank you! We\\'ll be in touch soon.');
  contactForm.reset();
});
\`\`\`

**⚠️ CRITICAL:** The SMS consent checkbox MUST be:
- ✅ Visible and prominent (yellow background)
- ✅ Required to submit
- ✅ NOT pre-checked
- ✅ Validated before form submission
- ✅ Include exact legal text provided above

═══════════════════════════════════════════════════════════════════
📋 OUTPUT - MULTI-PAGE FORMAT
═══════════════════════════════════════════════════════════════════

Return ALL pages using the FILE_SEPARATOR format shown above.

**CRITICAL:** Each page must be preceded by: <!-- FILE_SEPARATOR: filename.html -->

**Required pages:**
1. index.html (homepage)
2. services.html (all services detailed)
3. gallery.html or portfolio.html (work showcase)
4. contact.html (contact form + info)

**START FIRST PAGE WITH:** 
<!-- FILE_SEPARATOR: index.html -->
<!DOCTYPE html>`;
}

module.exports = { buildVisualSupremacyPrompt };
