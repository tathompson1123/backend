const { getImageGuidance } = require('./image_guidance');

// ============================================
// VISUAL SUPREMACY PROMPT - PREMIUM VERSION
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
🎨 PREMIUM DESIGN SYSTEM
═══════════════════════════════════════════════════════════════════

### CSS Variables (REQUIRED - Copy exactly)
\`\`\`css
:root {
  /* Colors */
  --primary: ${primaryColor};
  --primary-rgb: ${primaryRgb};
  --secondary: ${accentColor};
  --secondary-rgb: ${secondaryRgb};
  --background: #FFFFFF;
  --surface: #F9FAFB;
  --text-primary: #111827;
  --text-secondary: #6B7280;
  --border: #E5E7EB;
  
  /* Layered Shadow System */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04);
  --shadow-2xl: 0 25px 50px rgba(0,0,0,0.15), 0 15px 30px rgba(0,0,0,0.1);
  --shadow-primary: 0 10px 30px rgba(var(--primary-rgb), 0.3), 0 4px 12px rgba(var(--primary-rgb), 0.2);
  
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

### Typography (Responsive with clamp)
- **Font:** 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **H1 Display:** clamp(2.5rem, 5vw, 4rem) / 1.1, weight 900, letter-spacing -0.02em
- **H2 Heading:** clamp(2rem, 4vw, 3rem) / 1.2, weight 800, letter-spacing -0.015em
- **H3 Subheading:** clamp(1.5rem, 3vw, 2rem) / 1.3, weight 700
- **Body Large:** clamp(1rem, 1.5vw, 1.125rem) / 1.7, weight 400
- **Body:** 1rem / 1.7, weight 400, max-width: 65ch for paragraphs

**OPTIONAL:** Gradient text for main headings:
\`\`\`css
.gradient-text {
  background: linear-gradient(135deg, var(--primary), var(--secondary));
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
```
═══════════════════════════════════════════════════════════════════
✨ PREMIUM INTERACTIONS (REQUIRED)
═══════════════════════════════════════════════════════════════════

### Button Ripple Effect
\`\`\`css
.btn-primary {
  position: relative;
  overflow: hidden;
  padding: 1rem 2rem;
  background: var(--primary);
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

### Card Hover Effects
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

### Scroll Animations (Use Intersection Observer)
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
// Intersection Observer for scroll animations
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
🏗️ SITE STRUCTURE (Single Page App)
═══════════════════════════════════════════════════════════════════

## NAVIGATION (Sticky with glass effect on scroll)
- Logo/Name | Home | Services | Gift Cards | Contact
- Phone: ${phoneNumber} (desktop: text, mobile: clickable)
- "Book Now" button (primary, shadow-primary)
- Mobile: Hamburger with smooth slide-in

\`\`\`javascript
// Add glass effect on scroll
window.addEventListener('scroll', () => {
  const nav = document.querySelector('nav');
  if (window.scrollY > 100) {
    nav.classList.add('glass-dark');
    nav.style.boxShadow = 'var(--shadow-lg)';
  } else {
    nav.classList.remove('glass-dark');
    nav.style.boxShadow = 'none';
  }
});
\`\`\`

═══════════════════════════════════════════════════════════════════
📄 PAGE 1: HOME (ID: page-home)
═══════════════════════════════════════════════════════════════════

### 1. HERO (Full viewport with parallax)
**Layout:**
- min-height: 100vh
- Background image with animated gradient overlay:
  \`\`\`css
  background: linear-gradient(135deg, 
    rgba(var(--primary-rgb), 0.9), 
    rgba(var(--primary-rgb), 0.7)
  ), url(...);
  \`\`\`

**Content (centered):**
- H1: Powerful headline${safeTagline ? ` - Use: "${safeTagline}"` : ''}
  * Add .gradient-text class for gradient effect
  * Add subtle text-shadow: 0 2px 8px rgba(0,0,0,0.1)
- Tagline (H2, white, opacity 0.9)
- Two CTAs:
  * "Book Now" (.btn-primary with ripple)
  * "View Services" (outline button, glass effect)
${yearsInBusiness ? `- Trust badge: "${yearsInBusiness}+ Years" (glass effect, absolute bottom)` : ''}
- Animated scroll indicator (↓ bounce animation)

\`\`\`javascript
// Parallax hero background
window.addEventListener('scroll', () => {
  const hero = document.querySelector('.hero-background');
  hero.style.transform = \`translateY(\${window.pageYOffset * 0.5}px)\`;
});
\`\`\`

### 2. TRUST BAR (.fade-in-up)
**Grid: 4 columns (2 on mobile)**
${yearsInBusiness ? `- "${yearsInBusiness}+ Years"` : '- "10+ Years"'}
- "500+ Happy Customers"
- "4.9/5 Stars"
${safeCertifications ? `- "${safeCertifications}"` : '- "Licensed & Insured"'}

**Style:** Each stat is a card with animated counter
\`\`\`javascript
// Animate counters when visible
const animateCounter = (el, target) => {
  let count = 0;
  const increment = target / 60;
  const timer = setInterval(() => {
    count += increment;
    if (count >= target) {
      el.textContent = target;
      clearInterval(timer);
    } else {
      el.textContent = Math.floor(count);
    }
  }, 16);
};

document.querySelectorAll('[data-count]').forEach(el => {
  observer.observe(el);
  el.addEventListener('visible', () => {
    animateCounter(el, parseInt(el.dataset.count));
  });
});
\`\`\`

### 3. SERVICES GRID (.fade-in-up.stagger-X)
**Grid: 2 cols mobile, 3 cols desktop**
**Gap: 2rem**

**Each card:**
\`\`\`html
<div class="card service-card fade-in-up stagger-1">
  <div class="card-image">
    <img src="..." alt="Service name">
    <div class="price-badge">$XXX</div>
  </div>
  <div class="card-content">
    <h3>Service Name</h3>
    <p>Description (2-3 lines)</p>
    <div class="service-meta">
      <span>⏱ X hours</span>
    </div>
    <button class="btn-primary">Book Now</button>
  </div>
</div>
\`\`\`

**Card styling:**
- .card hover: translateY(-8px) scale(1.02)
- Image zoom on hover
- Price badge: absolute top-right, pulse animation
- shadow-md → shadow-2xl on hover

${servicesInfo.hasData ? 
`**Use ALL ${servicesInfo.services.split('\n\n').filter(s => s.includes('**')).length} services exactly as provided**` :
`**Create 4-6 realistic ${safeBusinessType} services**`}

### 4. WHY CHOOSE US (.fade-in-up)
**Layout: Two columns (image left, content right)**

**Left:** 
- Image with border-radius: var(--radius-2xl)
- Image zoom on scroll (scale 1 → 1.05)

**Right:**
- H2 (gradient-text optional)
${safeUSPs ? `- Your USPs as cards with icons` : '- 4-6 benefit cards'}
- Each benefit:
  * Icon (circle background, primary color)
  * Heading (H4)
  * Description (1-2 sentences)
  * .fade-in-up.stagger-X
- CTA button

### 5. PROCESS (.fade-in-up)
**4-step timeline (horizontal desktop, vertical mobile)**

Each step:
\`\`\`html
<div class="step-card glass">
  <div class="step-number">1</div>
  <h3>Book Online</h3>
  <p>Quick scheduling in minutes</p>
</div>
\`\`\`

**Connection line:** Gradient between steps (primary → secondary)

### 6. TESTIMONIALS (.fade-in-up)
**Carousel with auto-rotation (6s intervals)**

**Card design:**
\`\`\`css
.testimonial-card {
  background: white;
  padding: 2.5rem;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  position: relative;
}

.testimonial-card::before {
  content: '"';
  position: absolute;
  top: -20px;
  left: 20px;
  font-size: 6rem;
  color: var(--primary);
  opacity: 0.1;
  font-family: Georgia, serif;
}
\`\`\`

**Create 3-6 authentic ${safeBusinessType} testimonials:**
- 5 animated stars (pop in sequence)
- Quote (2-3 sentences, specific details)
- Customer name + service type
- Avatar: https://i.pravatar.cc/100?img=X

**Example:** "The team was incredible! They spent extra time on the stubborn stains in my truck and used eco-friendly products. My interior looks factory-new. Professional, punctual, and worth every dollar. - Mike T., Full Interior Detail"

❌ Avoid: "Great service!" "Highly recommend!"

### 7. FINAL CTA (.fade-in-up)
**Full-width section, animated gradient background**

\`\`\`css
background: linear-gradient(-45deg, 
  var(--primary), var(--secondary), 
  var(--primary), var(--secondary)
);
background-size: 400% 400%;
animation: gradientShift 15s ease infinite;
\`\`\`

**Content (white text, centered):**
- H2: "Ready to Get Started?"
- Subheading
- Large "Book Your Service" button (white bg, primary text, shadow-glow)
- Secondary: "Or call ${phoneNumber}"

═══════════════════════════════════════════════════════════════════
📄 PAGE 2: SERVICES (ID: page-services)
═══════════════════════════════════════════════════════════════════

- Hero banner (smaller, 50vh)
- Detailed service cards (larger, more info)
- Hover reveal: Hidden details slide up
- FAQ accordion (smooth expand/collapse)
- CTA at bottom

═══════════════════════════════════════════════════════════════════
📄 PAGE 3: GIFT CARDS (ID: page-gift-cards)
═══════════════════════════════════════════════════════════════════

- Animated gift card visual (3D tilt on hover)
- Amount buttons with active state (shadow-primary)
- Purchase → Alert: "Call ${phoneNumber}"

═══════════════════════════════════════════════════════════════════
📄 PAGE 4: CONTACT (ID: page-contact)
═══════════════════════════════════════════════════════════════════

**Left:** Contact cards + map
**Right:** Premium form with floating labels

\`\`\`css
.form-group {
  position: relative;
  margin-bottom: 2rem;
}

.form-input {
  width: 100%;
  padding: 1rem;
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  transition: all 0.3s ease;
}

.form-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px rgba(var(--primary-rgb), 0.1);
}

.form-label {
  position: absolute;
  left: 1rem;
  top: 1rem;
  transition: all 0.3s ease;
  pointer-events: none;
}

.form-input:focus + .form-label,
.form-input:not(:placeholder-shown) + .form-label {
  top: -0.75rem;
  left: 0.75rem;
  font-size: 0.875rem;
  color: var(--primary);
  background: white;
  padding: 0 0.5rem;
}
\`\`\`

═══════════════════════════════════════════════════════════════════
🎯 CRITICAL JAVASCRIPT FEATURES
═══════════════════════════════════════════════════════════════════

### 1. SPA Navigation with Page Transition
\`\`\`javascript
// Smooth page transitions
const transitionPage = (targetPage) => {
  const overlay = document.createElement('div');
  overlay.style.cssText = \`
    position: fixed;
    inset: 0;
    background: var(--primary);
    z-index: 9999;
    opacity: 0;
    transition: opacity 0.3s;
  \`;
  document.body.appendChild(overlay);
  
  setTimeout(() => overlay.style.opacity = '1', 10);
  
  setTimeout(() => {
    // Switch pages
    document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
    document.getElementById(targetPage).style.display = 'block';
    window.scrollTo(0, 0);
    
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }, 300);
};
\`\`\`

### 2. Intersection Observer (Required)
- Animate .fade-in-up elements
- Trigger counter animations
- Lazy load images

### 3. Parallax & Scroll Effects
- Hero background parallax
- Nav glass effect on scroll
- Image zoom on scroll

### 4. Form Validation & Animation
- Floating labels
- Success animation
- Error shake

═══════════════════════════════════════════════════════════════════
📱 RESPONSIVE (Mobile-First)
═══════════════════════════════════════════════════════════════════

- Breakpoints: 320px, 768px, 1024px
- Touch targets: min 44px
- Phone links: clickable only on mobile
- Hamburger menu with slide-in animation
- Max content width: 1280px

\`\`\`css
@media (min-width: 768px) {
  .phone-link {
    pointer-events: none;
    cursor: default;
  }
}
\`\`\`

═══════════════════════════════════════════════════════════════════
🚫 AVOID
═══════════════════════════════════════════════════════════════════

❌ Generic testimonials
❌ Lorem ipsum
❌ Broken links
❌ Missing animations
❌ No hover states
❌ Flat design (needs depth via shadows)
❌ Generic stock photos
❌ Poor mobile experience

═══════════════════════════════════════════════════════════════════
📋 OUTPUT
═══════════════════════════════════════════════════════════════════

Return SINGLE, COMPLETE HTML file with:
✅ All CSS in <style> (organized by section)
✅ All JavaScript in <script> (modern ES6+)
✅ All 4 pages with smooth transitions
✅ Intersection Observer animations
✅ Premium micro-interactions
✅ Glassmorphism effects
✅ Layered shadows
✅ Responsive typography (clamp)
✅ Mobile-first design

**START WITH:** <!DOCTYPE html>

Generate the premium website now with ALL visual enhancements.`;
}

module.exports = { buildVisualSupremacyPrompt };
