const { getImageGuidance } = require('./image_guidance');
const { getRecommendedTemplate, getTemplateInfo } = require('./templates');

// ============================================
// VISUAL SUPREMACY PROMPT - PREMIUM VERSION WITH TEMPLATES
// This includes all advanced styling for $10k+ website look
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
  
  // Calculate RGB values for color effects
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '37, 99, 235';
  };
 
  const primaryRgb = hexToRgb(primaryColor);
  const secondaryRgb = hexToRgb(accentColor);
  const imageGuide = getImageGuidance(safeBusinessType);

  return `You are an elite web designer creating a VISUALLY STUNNING, premium service business website with cutting-edge design and micro-interactions.

═══════════════════════════════════════════════════════════════════
🎨 RECOMMENDED TEMPLATE
═══════════════════════════════════════════════════════════════════

**Template:** ${templateInfo.name}
**Best For:** ${safeBusinessType}

${templateInfo.description}

**Key Features:**
${templateInfo.features.map(f => `- ${f}`).join('\n')}

**Template Color Palette:**
${Object.entries(templateInfo.colors).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

**Typography:**
- Headings: ${templateInfo.fonts.heading}
- Body: ${templateInfo.fonts.body}

**Pages Structure:**
${templateInfo.pages.map((p, i) => `${i + 1}. ${p}`).join('\n')}

⚠️ IMPORTANT: Use this template as your BASE DESIGN SYSTEM. Adapt the layout, animations, and styling patterns from this template while customizing the content for ${safeBusinessName}.

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
🎨 DESIGN SYSTEM (Based on ${templateInfo.name} Template)
═══════════════════════════════════════════════════════════════════

### CSS Variables (REQUIRED - Copy exactly and adapt template colors)
\`\`\`css
${templateInfo.cssVars}

/* Extended Design Tokens */
:root {
  /* User's Custom Colors (use these for primary branding) */
  --user-primary: ${primaryColor};
  --user-primary-rgb: ${primaryRgb};
  --user-secondary: ${accentColor};
  --user-secondary-rgb: ${secondaryRgb};
  
  /* Surface Colors */
  --background: #FFFFFF;
  --surface: #F9FAFB;
  --text-primary: #111827;
  --text-secondary: #6B7280;
  --border: #E5E7EB;
  
  /* Layered Shadow System (from template) */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04);
  --shadow-2xl: 0 25px 50px rgba(0,0,0,0.15), 0 15px 30px rgba(0,0,0,0.1);
  --shadow-primary: 0 10px 30px rgba(var(--user-primary-rgb), 0.3), 0 4px 12px rgba(var(--user-primary-rgb), 0.2);
  
  /* Spacing */
  --space-xs: 0.5rem;
  --space-sm: 0.75rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;
  --space-3xl: 4rem;
  
  /* Radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.5rem;
}

/* Glassmorphism */
.glass {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.glass-dark {
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
\`\`\`

### Typography (Responsive with clamp - use template fonts)
- **Font Family:** ${templateInfo.fonts.body}, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **Heading Font:** ${templateInfo.fonts.heading}
- **H1 Display:** clamp(2.5rem, 5vw, 4rem) / 1.1, weight 900, letter-spacing -0.02em
- **H2 Heading:** clamp(2rem, 4vw, 3rem) / 1.2, weight 800, letter-spacing -0.015em
- **H3 Subheading:** clamp(1.5rem, 3vw, 2rem) / 1.3, weight 700
- **Body Large:** clamp(1rem, 1.5vw, 1.125rem) / 1.7, weight 400
- **Body:** 1rem / 1.7, weight 400, max-width: 65ch for paragraphs

**OPTIONAL:** Gradient text for main headings:
\`\`\`css
.gradient-text {
  background: linear-gradient(135deg, var(--user-primary), var(--user-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
\`\`\`

═══════════════════════════════════════════════════════════════════
📸 IMAGES (Industry-Specific, High Quality)
═══════════════════════════════════════════════════════════════════

${imageGuide.guidelines}

**Specific Image URLs to Use:**

**Hero Background (1920x1080):**
https://source.unsplash.com/1920x1080/?${imageGuide.hero}

**Service Card Images (800x600):**
${imageGuide.serviceKeywords.map((keywords, i) => 
  `Service ${i + 1}: https://source.unsplash.com/800x600/?${keywords}`
).join('\n')}

**About Section Image (1200x800):**
https://source.unsplash.com/1200x800/?${imageGuide.about}

**Testimonial Avatars (150x150):**
https://i.pravatar.cc/150?img=[1-70] (use different numbers for variety)

**CRITICAL IMAGE REQUIREMENTS:**
1. Use the EXACT URLs above with the specific keywords
2. All images must be directly relevant to ${safeBusinessType}
3. Show professional work in action, not generic stock photos
4. Use multiple specific keywords for better results
5. Images should match the service description perfectly

═══════════════════════════════════════════════════════════════════
✨ TEMPLATE-SPECIFIC ANIMATIONS & INTERACTIONS
═══════════════════════════════════════════════════════════════════

### From ${templateInfo.name} Template:

**Wave Transitions (if template uses them):**
Use smooth SVG wave transitions between sections with the template's color scheme.

**Scroll Animations:**
Implement scroll-triggered fade-in and slide animations as shown in the template.

**Button Effects:**
\`\`\`css
.btn-primary {
  position: relative;
  overflow: hidden;
  padding: 1rem 2rem;
  background: var(--user-primary);
  color: white;
  border: none;
  border-radius: var(--radius-lg);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--shadow-md);
}

.btn-primary::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transform: translate(-50%, -50%);
  transition: width 0.6s, height 0.6s;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-primary);
}

.btn-primary:hover::before {
  width: 300px;
  height: 300px;
}
\`\`\`

### Card Hover Effects (from template)
\`\`\`css
.card {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--shadow-md);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: var(--shadow-2xl);
}

.card img {
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.card:hover img {
  transform: scale(1.08);
}
\`\`\`

### Scroll Animations (Use Intersection Observer - REQUIRED)
\`\`\`css
.fade-in-up {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.fade-in-up.visible {
  opacity: 1;
  transform: translateY(0);
}

/* Stagger delays */
.stagger-1 { transition-delay: 0.1s; }
.stagger-2 { transition-delay: 0.2s; }
.stagger-3 { transition-delay: 0.3s; }
.stagger-4 { transition-delay: 0.4s; }
\`\`\`

\`\`\`javascript
// Intersection Observer for scroll animations (REQUIRED)
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, observerOptions);

document.querySelectorAll('.fade-in-up').forEach(el => observer.observe(el));
\`\`\`

═══════════════════════════════════════════════════════════════════
🏗️ SITE STRUCTURE (Following ${templateInfo.name} Layout)
═══════════════════════════════════════════════════════════════════

## NAVIGATION (Sticky with template styling)
- Logo/Name | Home | Services | Gift Cards | Contact
- Phone: ${phoneNumber} (desktop: text, mobile: clickable)
- "Book Now" button (primary color, template styling)
- Mobile: Hamburger with smooth slide-in

\`\`\`javascript
// Add glass/scroll effect on scroll (if template uses it)
window.addEventListener('scroll', () => {
  const nav = document.querySelector('nav');
  if (window.scrollY > 100) {
    nav.classList.add('scrolled');
    nav.style.boxShadow = 'var(--shadow-lg)';
  } else {
    nav.classList.remove('scrolled');
    nav.style.boxShadow = 'none';
  }
});
\`\`\`

═══════════════════════════════════════════════════════════════════
📄 PAGE 1: HOME (ID: page-home)
═══════════════════════════════════════════════════════════════════

Follow the ${templateInfo.name} template structure:

### 1. HERO (Full viewport with template styling)
**Layout:**
- min-height: 100vh
- Background image with gradient overlay using template colors
- Use template's wave transition if applicable

**Content (centered):**
- H1: Powerful headline${safeTagline ? ` - Use: "${safeTagline}"` : ''}
  * Apply template's heading style
  * Add template's text effects if applicable
- Tagline (H2, styled per template)
- Two CTAs with template button styles
${yearsInBusiness ? `- Trust badge: "${yearsInBusiness}+ Years" (template style)` : ''}
- Animated scroll indicator (template style)

### 2. FEATURES/TRUST BAR (template style)
**Grid: 4 columns (2 on mobile)**
${yearsInBusiness ? `- "${yearsInBusiness}+ Years"` : '- "10+ Years"'}
- "500+ Happy Customers"
- "4.9/5 Stars"
${safeCertifications ? `- "${safeCertifications}"` : '- "Licensed & Insured"'}

Use template's feature card styling with icons/animations.

### 3. SERVICES GRID (template layout)
**Use template's service card design**
**Grid: Responsive per template**

Each service card follows template structure with:
- Image with hover effects
- Service name and description
- Pricing display
- "Book Now" button
- Template's card hover animations

${servicesInfo.hasData ? 
`**Use ALL ${servicesInfo.services.split('\n\n').filter(s => s.includes('**')).length} services exactly as provided**` :
`**Create 4-6 realistic ${safeBusinessType} services**`}

### 4. WHY CHOOSE US / BENEFITS (template style)
Follow template's benefits section layout:
${safeUSPs ? `- Display your USPs with template styling` : '- Create 3-4 compelling benefits'}
- Use template's card/grid layout
- Apply template's animations
- Include relevant icon or image per template

### 5. TESTIMONIALS (template style)
Follow template's testimonial design:
- Layout per template (carousel, grid, etc.)
- Template's card styling
- Star ratings with animations

**Create 3-6 authentic ${safeBusinessType} testimonials:**
- Specific details about service received
- Customer name + service type
- Avatar images

### 6. FINAL CTA (template style)
Follow template's CTA section:
- Use template's background/styling
- Large headline and subheading
- Primary CTA button
- Secondary contact option

═══════════════════════════════════════════════════════════════════
📄 ADDITIONAL PAGES (Following Template Structure)
═══════════════════════════════════════════════════════════════════

Create additional pages based on the ${templateInfo.name} template structure:
- Services detail page
- Gallery/Portfolio page
- Gift Cards page
- Contact page with form

Each page should maintain template's design language, animations, and styling.

═══════════════════════════════════════════════════════════════════
📝 CONTACT FORM - CRITICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════

**MANDATORY CONTACT FORM STRUCTURE:**

Every website MUST include a contact form with these EXACT elements:

### Required Form Fields:
1. **Name** (required)
   - Label: "Your Name *"
   - Input type: text
   - ID: "contactName"
   - Placeholder: "John Smith"

2. **Email** (required)
   - Label: "Email Address *"
   - Input type: email
   - ID: "contactEmail"
   - Placeholder: "john@example.com"

3. **Phone** (required)
   - Label: "Phone Number *"
   - Input type: tel
   - ID: "contactPhone"
   - Placeholder: "(555) 123-4567"

4. **Service Interest** (required)
   - Label: "Service Interested In *"
   - Select dropdown with ID: "contactService"
   - Options: Include actual services from the website

5. **Message** (optional)
   - Label: "Message (Optional)"
   - Textarea with ID: "contactMessage"
   - Placeholder: "Tell us more about what you need..."

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
<!-- Contact Preference -->
<div style="background: #f0f9ff; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #3b82f6;">
  <h4 style="color: #1e40af; margin: 0 0 15px 0; font-size: 16px;">How would you prefer to be contacted?</h4>
  <div style="display: flex; gap: 15px;">
    <div style="flex: 1;">
      <input type="radio" id="preferEmail" name="preferredContact" value="email" checked style="position: absolute; opacity: 0;">
      <label for="preferEmail" style="display: block; padding: 15px 20px; background: white; border: 2px solid #e5e7eb; border-radius: 10px; cursor: pointer; text-align: center; font-weight: 600;">
        📧 Email<br><small style="font-weight: normal; opacity: 0.8;">Recommended</small>
      </label>
    </div>
    <div style="flex: 1;">
      <input type="radio" id="preferSMS" name="preferredContact" value="sms" style="position: absolute; opacity: 0;">
      <label for="preferSMS" style="display: block; padding: 15px 20px; background: white; border: 2px solid #e5e7eb; border-radius: 10px; cursor: pointer; text-align: center; font-weight: 600;">
        💬 Text<br><small style="font-weight: normal; opacity: 0.8;">Fast response</small>
      </label>
    </div>
  </div>
</div>
\`\`\`

### JavaScript Validation (REQUIRED):

The form MUST include this JavaScript to validate SMS consent:

\`\`\`javascript
// Contact form submission
const contactForm = document.getElementById('contactForm');
const smsConsentCheckbox = document.getElementById('smsConsent');
const consentError = document.getElementById('consentError');

// Hide error when checkbox is clicked
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
  
  // Get form data
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
  
  // Show success message (placeholder - will be replaced with actual API call)
  alert('Thank you! We\\'ll be in touch soon.');
  contactForm.reset();
});
\`\`\`

### Form Styling Requirements:

- Clean, modern design matching template
- Clear labels with asterisks (*) for required fields
- Proper spacing and padding
- Focus states with blue outline
- Submit button with gradient or template color
- Mobile-responsive (stacks on small screens)
- Accessibility: proper labels and ARIA attributes

**⚠️ CRITICAL:** The SMS consent checkbox MUST be:
- ✅ Visible and prominent
- ✅ Required to submit
- ✅ Validated before form submission
- ✅ Styled to stand out (yellow/gold background)
- ✅ Include exact legal text provided above

═══════════════════════════════════════════════════════════════════
🎯 CRITICAL JAVASCRIPT FEATURES
═══════════════════════════════════════════════════════════════════

### 1. Intersection Observer (REQUIRED)
- Animate scroll-triggered elements
- Template-specific animations
- Lazy load images

### 2. Navigation & Scroll Effects
- Sticky nav with template styling
- Smooth scrolling
- Mobile menu with template animations

### 3. Interactive Elements
- Button hover effects per template
- Card interactions per template
- Form validation with template styling

═══════════════════════════════════════════════════════════════════
📱 RESPONSIVE (Mobile-First - Template Standards)
═══════════════════════════════════════════════════════════════════

- Follow template's responsive breakpoints
- Touch targets: min 44px
- Phone links: clickable only on mobile
- Template's mobile navigation
- Max content width per template

═══════════════════════════════════════════════════════════════════
🚫 AVOID
═══════════════════════════════════════════════════════════════════

❌ Deviating from template's design language
❌ Generic testimonials
❌ Lorem ipsum
❌ Broken links
❌ Missing template animations
❌ Ignoring template's color scheme
❌ Generic stock photos
❌ Poor mobile experience
❌ **MISSING SMS CONSENT CHECKBOX (CRITICAL - LEGAL VIOLATION)**
❌ **Contact form without required fields**
❌ **Pre-checked SMS consent (illegal)**
❌ **Missing form validation**

═══════════════════════════════════════════════════════════════════
📋 OUTPUT
═══════════════════════════════════════════════════════════════════

Return SINGLE, COMPLETE HTML file based on ${templateInfo.name} template with:
✅ Template's layout structure
✅ Template's color scheme (adapted with user's colors)
✅ Template's typography and fonts
✅ Template's animations and transitions
✅ All CSS in <style> (organized by section)
✅ All JavaScript in <script> (modern ES6+)
✅ Intersection Observer animations
✅ Template-specific interactions
✅ Responsive design per template
✅ Mobile-first approach

**START WITH:** <!DOCTYPE html>

Generate the premium website now following the ${templateInfo.name} template design system.`;
}

module.exports = { buildVisualSupremacyPrompt };
