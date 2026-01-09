const { getImageGuidance } = require('./image_guidance');
const { getRecommendedTemplate, getTemplateInfo } = require('./templates-enhanced');
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
  const templateInfo = getTemplateInfo(recommendedTemplateKey);
  
  // LOAD ACTUAL TEMPLATE HTML FILES
  const templateDir = path.join(__dirname, 'templates', recommendedTemplateKey === 'landscaping' ? 'landscaping-template' : 'auto-detailing-template');
  
  let templateFiles = {};
  try {
    // Read all HTML files from template directory
    const files = fs.readdirSync(templateDir).filter(f => f.endsWith('.html'));
    
    files.forEach(file => {
      const filePath = path.join(templateDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const pageName = file.replace('.html', '');
      templateFiles[pageName] = content;
    });
  } catch (error) {
    console.error('Error loading template files:', error);
    // Continue without template files - will generate from scratch
  }
  
  // Calculate RGB values for color effects
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '37, 99, 235';
  };
 
  const primaryRgb = hexToRgb(primaryColor);
  const secondaryRgb = hexToRgb(accentColor);
  const imageGuide = getImageGuidance(safeBusinessType);
  
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
   - Primary: ${templateInfo.colors.primary} → ${primaryColor}
   - Accent: ${templateInfo.colors.accent} → ${accentColor}
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

${imageGuide.guidelines}

**Hero Background:** https://source.unsplash.com/1920x1080/?${imageGuide.hero}
**Service Images:** https://source.unsplash.com/800x600/?${imageGuide.serviceKeywords.join(',')}
**About Image:** https://source.unsplash.com/1200x800/?${imageGuide.about}

═══════════════════════════════════════════════════════════════════
📋 OUTPUT
═══════════════════════════════════════════════════════════════════

Return the COMPLETE, CUSTOMIZED HTML file based on the template provided above.

**START WITH:** <!DOCTYPE html>`;
}

module.exports = { buildVisualSupremacyPrompt };
