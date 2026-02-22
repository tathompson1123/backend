// ============================================
// AI SCHEMA GENERATION PROMPT
// Tells Claude to output a page schema (JSON)
// instead of raw HTML.
// Layout auto-selected from businessType:
//   organic       — landscaping, lawn, garden…
//   autoDetailing — car, detailing, ceramic…
//   default       — everything else (dark theme)
// ============================================

function detectLayout(businessType) {
  const bt = (businessType || '').toLowerCase();
  if (['landscaping', 'lawn', 'garden', 'tree', 'outdoor', 'yard'].some(kw => bt.includes(kw))) return 'organic';
  if (['detailing', 'car', 'auto', 'vehicle', 'ceramic', 'paint', 'wash'].some(kw => bt.includes(kw))) return 'autoDetailing';
  if (['handyman', 'renovation', 'remodeling', 'remodel', 'contractor', 'construction', 'builder', 'repair'].some(kw => bt.includes(kw))) return 'renovation';
  return 'default';
}

function buildSchemaPrompt(businessData) {
  const {
    businessName = 'My Business',
    businessType = 'service business',
    phone = '(555) 555-5555',
    email = 'info@business.com',
    address = '',
    city = '',
    state = '',
    services = [],
    description = '',
    hours = '',
    serviceArea = '',
  } = businessData;

  // Handle services arriving as comma-separated string from form textarea
  let parsedServices = services;
  if (typeof services === 'string' && services.trim()) {
    parsedServices = services.split(',').map(s => s.trim()).filter(Boolean);
  }
  const servicesList = Array.isArray(parsedServices) && parsedServices.length > 0
    ? parsedServices.map(s => typeof s === 'string' ? s : s.name || s.title || '').filter(Boolean)
    : ['Service 1', 'Service 2', 'Service 3'];

  const layout     = detectLayout(businessType);
  const phoneClean = phone.replace(/\D/g, '');
  const hoursText  = hours || 'Mon-Fri: 8AM-6PM\\nSat: 9AM-4PM\\nSun: Closed';
  const areaText   = serviceArea || ((city || state) ? [city, state].filter(Boolean).join(', ') + ' and surrounding areas' : 'Local and surrounding areas');

  // ── business info block (shared) ──────────────────
  const businessInfo = [
    `Name: ${businessName}`,
    `Type: ${businessType}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    address     && `Address: ${address}`,
    city        && `City: ${city}`,
    state       && `State: ${state}`,
    `Services: ${servicesList.join(', ')}`,
    description && `Description: ${description}`,
    hours       && `Hours: ${hours}`,
    serviceArea && `Service Area: ${serviceArea}`,
  ].filter(Boolean).join('\n');

  // ── layout dispatch ───────────────────────────────
  // Multi-page layouts return early with their own full prompt
  if (layout === 'autoDetailing') {
    return buildAutoDetailingMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList });
  }
  if (layout === 'organic') {
    return buildOrganicMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList });
  }
  if (layout === 'renovation') {
    return buildHandymanMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList });
  }

  let mainSections, sectionOrder, contactId, footerId;
  switch (layout) {
    default:
      mainSections = defaultSections({ businessName, phone, phoneClean });
      sectionOrder = 'trust → nav → hero → features → services → benefits → gallery → testimonials → cta → contact → footer';
      contactId    = 's10';
      footerId     = 's11';
      break;
  }

  // ── shared contact + footer tail ──────────────────
  const sharedTail = `    {
      "id": "${contactId}",
      "template": "contact-split",
      "content": {
        "formTitle": "Get Your Free Quote",
        "formSubtitle": "Fill out the form and we'll get back to you within 24 hours",
        "submitText": "Request Quote",
        "phone": "${phone}",
        "phoneClean": "${phoneClean}",
        "email": "${email}",
        "hours": "${hoursText}",
        "serviceArea": "${areaText}",
        "businessName": "${businessName}",
        "highlights": [
          { "text": "Why choose us point 1 — tailor to ${businessType}" },
          { "text": "Why choose us point 2 — tailor to ${businessType}" },
          { "text": "Why choose us point 3 — tailor to ${businessType}" }
        ]
      }
    },
    {
      "id": "${footerId}",
      "template": "footer-4col-dark",
      "content": {
        "logo": "${businessName}",
        "tagline": "Short compelling tagline for the business",
        "services": ${JSON.stringify(servicesList.slice(0, 6).map(s => ({ text: s })))},
        "phone": "${phone}",
        "email": "${email}",
        "hours": "${hoursText}"
      }
    }`;

  return `You are a website content generator for service-based businesses. Your job is to generate a JSON page schema that will be fed into a template rendering system.

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation. Just the JSON object.

== BUSINESS INFO ==
${businessInfo}

== YOUR TASK ==
Generate a JSON object with this exact structure. Fill in compelling, professional content for this specific business.

{
  "meta": {
    "title": "${businessName} - Professional ${businessType} Services",
    "description": "SEO meta description for the business (150-160 chars)"
  },
  "sections": [
${mainSections},
${sharedTail}
  ]
}

== RULES ==
1. Return ONLY the JSON object. No other text.
2. Use REAL Unsplash URLs that match the business type. Format: https://images.unsplash.com/photo-XXXXX?w=1920 (hero) or ?w=800 (cards/gallery). Pick specific photo IDs that relate to ${businessType}.
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to ${businessType}.
4. Reviews and testimonials should sound realistic and specific to the services offered.
5. Include 3-6 services in the services section based on what was provided.
6. Keep the sections in the exact order shown above (${sectionOrder}).
7. Make the headline punchy and benefit-focused, not just the business name.
8. Feature icons should be relevant emoji for the business type.
9. Gallery images should showcase different aspects of the work.
10. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

// ── Organic/Landscaping: multi-page prompt ───────────────────────────
// 4 pages: index · services · gallery · contact
// Section mapping mirrors the Eden Landscapes template design
function buildOrganicMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList }) {
  const servicesJson = JSON.stringify(servicesList.slice(0, 6).map(s => ({ text: s })));

  return `You are a website content generator for landscaping and outdoor service businesses. Generate a JSON object for a MULTI-PAGE website with 4 separate pages.

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation. Just the JSON object.

== BUSINESS INFO ==
${businessInfo}

== YOUR TASK ==
Generate a JSON object with this EXACT structure. Fill in compelling, professional content for this specific business.

{
  "meta": { "title": "${businessName} - Professional Landscaping", "description": "SEO meta description 150-160 chars" },
  "multiPage": true,
  "nav": {
    "id": "nav",
    "template": "nav-sticky-organic",
    "content": {
      "logo": "${businessName}",
      "links": [
        { "text": "Home",     "url": "index.html" },
        { "text": "Services", "url": "services.html" },
        { "text": "Gallery",  "url": "gallery.html" },
        { "text": "Contact",  "url": "contact.html" }
      ],
      "ctaText": "Get a Quote",
      "ctaLink": "contact.html"
    }
  },
  "footer": {
    "id": "footer",
    "template": "footer-4col-dark",
    "content": {
      "logo": "${businessName}",
      "tagline": "Short compelling tagline for this landscaping business",
      "services": ${servicesJson},
      "phone": "${phone}",
      "email": "${email}",
      "hours": "${hoursText}"
    }
  },
  "pages": [
    {
      "filename": "index.html",
      "meta": { "title": "${businessName} - Professional Landscaping", "description": "Homepage SEO description" },
      "sections": [
        {
          "id": "hero",
          "template": "hero-split-portrait",
          "content": {
            "badge": "Welcome to ${businessName}",
            "headline": "Punchy headline WITHOUT the highlight word",
            "highlightText": "One key highlight word (e.g. Landscapes, Gardens, Outdoor)",
            "subtitle": "A compelling 2-3 sentence value proposition for this landscaping business",
            "ctaText": "Get a Free Quote",
            "ctaLink": "contact.html",
            "ctaText2": "See Our Work",
            "ctaLink2": "gallery.html",
            "portraitImage": "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800",
            "bgImage": "https://images.unsplash.com/photo-1558904541-efa843a96f01?w=1600",
            "floatBadge": "10+",
            "floatBadgeLabel": "Years Experience"
          }
        },
        {
          "id": "importance",
          "template": "importance-split",
          "content": {
            "badge": "Why It Matters",
            "headline": "Why Your Outdoor Space Matters",
            "body1": "First paragraph: why a well-maintained outdoor space matters to the customer (property value, curb appeal, lifestyle quality)",
            "body2": "Second paragraph: what makes ${businessName} different — expertise, approach, and the lasting results clients love",
            "highlights": [
              { "icon": "🌿", "text": "Highlight about quality plantings or plant health" },
              { "icon": "💧", "text": "Highlight about water-smart or sustainable practices" },
              { "icon": "🌞", "text": "Highlight about year-round beauty and care" },
              { "icon": "🏡", "text": "Highlight about property value or lifestyle improvement" }
            ],
            "image": "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800",
            "imageAlt": "Beautiful landscaped outdoor space"
          }
        },
        {
          "id": "services",
          "template": "services-carousel",
          "content": {
            "title": "What We Do",
            "subtitle": "Comprehensive outdoor services for every property",
            "services": [
              { "title": "First service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": true },
              { "title": "Second service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false },
              { "title": "Third service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false }
            ]
          }
        },
        {
          "id": "reviews",
          "template": "review-marquee",
          "content": {
            "reviews": [
              { "name": "Sarah M.",  "stars": 5, "text": "Realistic 5-star review about this landscaping business",     "date": "2 weeks ago",  "avatarColor": "#6b8f5e" },
              { "name": "James R.",  "stars": 5, "text": "Review specific to the outdoor/garden services provided",     "date": "1 month ago",  "avatarColor": "#85a378" },
              { "name": "Linda K.",  "stars": 5, "text": "Review highlighting quality, care, and attention to detail",  "date": "3 weeks ago",  "avatarColor": "#506a4b" },
              { "name": "Tom & Pat", "stars": 5, "text": "Review about the transformation of their outdoor space",     "date": "2 months ago", "avatarColor": "#3d4f39" },
              { "name": "Rachel W.", "stars": 5, "text": "Review about the experience from consultation to completion", "date": "1 week ago",   "avatarColor": "#6b8f5e" },
              { "name": "Mike D.",   "stars": 4, "text": "Measured but positive review about the overall experience",   "date": "5 days ago",   "avatarColor": "#85a378" }
            ]
          }
        },
        {
          "id": "transformations",
          "template": "before-after-cards",
          "content": {
            "title": "Our Transformations",
            "subtitle": "Click each card to reveal the stunning before & after",
            "cards": [
              { "title": "Project type 1 (e.g. Backyard Oasis)",  "description": "Brief description of what was done", "beforeImage": "https://images.unsplash.com/photo-1558904541-efa843a96f01?w=600", "afterImage": "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600" },
              { "title": "Project type 2 (e.g. Front Garden)",    "description": "Brief description of what was done", "beforeImage": "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=600", "afterImage": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600" },
              { "title": "Project type 3 (e.g. Patio & Hardscape)","description": "Brief description of what was done", "beforeImage": "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600", "afterImage": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=600" }
            ]
          }
        },
        {
          "id": "cta",
          "template": "cta-card",
          "content": {
            "headline": "Ready for a Stunning Transformation?",
            "subtitle": "Let us turn your vision into reality. Contact us today for a free consultation.",
            "ctaText": "Get a Free Quote",
            "ctaLink": "contact.html",
            "ctaText2": "View Our Work",
            "ctaLink2": "gallery.html"
          }
        }
      ]
    },
    {
      "filename": "services.html",
      "meta": { "title": "Services | ${businessName}", "description": "Services page SEO description" },
      "sections": [
        {
          "id": "page-header",
          "template": "hero-page-banner",
          "content": {
            "title": "Our Services",
            "subtitle": "From concept to creation — we handle everything your outdoor space needs"
          }
        },
        {
          "id": "services",
          "template": "services-carousel",
          "content": {
            "title": "Our Services",
            "subtitle": "From concept to creation, we handle everything",
            "services": [
              { "title": "First service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": true },
              { "title": "Second service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false },
              { "title": "Third service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false }
            ]
          }
        },
        {
          "id": "benefits",
          "template": "benefits-cards",
          "content": {
            "title": "Why Choose ${businessName}",
            "subtitle": "We bring more than just great service",
            "benefits": [
              { "icon": "🌿", "title": "Benefit 1 Title", "description": "Why this matters to the customer" },
              { "icon": "💚", "title": "Benefit 2 Title", "description": "Why this matters to the customer" },
              { "icon": "🏆", "title": "Benefit 3 Title", "description": "Why this matters to the customer" }
            ]
          }
        },
        {
          "id": "cta",
          "template": "cta-card",
          "content": {
            "headline": "Not Sure Which Service You Need?",
            "subtitle": "Our team will help you figure out the right plan for your property. Reach out for a free consultation.",
            "ctaText": "Get a Free Quote",
            "ctaLink": "contact.html",
            "ctaText2": "View Our Work",
            "ctaLink2": "gallery.html"
          }
        }
      ]
    },
    {
      "filename": "gallery.html",
      "meta": { "title": "Gallery | ${businessName}", "description": "Gallery page SEO description" },
      "sections": [
        {
          "id": "page-header",
          "template": "hero-page-banner",
          "content": {
            "title": "Our Portfolio",
            "subtitle": "A showcase of outdoor spaces we've designed, built, and maintained"
          }
        },
        {
          "id": "gallery",
          "template": "gallery-filtered",
          "content": {
            "title": "Recent Projects",
            "subtitle": "Browse our finest work across all service categories",
            "highlight": "Projects",
            "categories": ["All", "Garden Design", "Hardscape", "Lawn Care", "Lighting", "Maintenance"],
            "items": [
              { "url": "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800", "title": "Project description 1", "category": "Garden Design" },
              { "url": "https://images.unsplash.com/photo-1558904541-efa843a96f01?w=800", "title": "Project description 2", "category": "Hardscape" },
              { "url": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=800", "title": "Project description 3", "category": "Lawn Care" },
              { "url": "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800", "title": "Project description 4", "category": "Lighting" },
              { "url": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800", "title": "Project description 5", "category": "Garden Design" },
              { "url": "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800", "title": "Project description 6", "category": "Maintenance" }
            ]
          }
        },
        {
          "id": "cta",
          "template": "cta-card",
          "content": {
            "headline": "Ready to Transform Your Space?",
            "subtitle": "Book a free consultation and let's design your dream outdoor space.",
            "ctaText": "Get a Free Quote",
            "ctaLink": "contact.html",
            "ctaText2": "View Services",
            "ctaLink2": "services.html"
          }
        }
      ]
    },
    {
      "filename": "contact.html",
      "meta": { "title": "Contact | ${businessName}", "description": "Contact page SEO description" },
      "sections": [
        {
          "id": "page-header",
          "template": "hero-page-banner",
          "content": {
            "title": "Get a Free Quote",
            "subtitle": "Tell us about your project and we'll get back to you within 24 hours"
          }
        },
        {
          "id": "contact",
          "template": "contact-split",
          "content": {
            "formTitle": "Tell Us About Your Project",
            "formSubtitle": "Fill out the form and we'll get back to you within 24 hours",
            "submitText": "Request Free Quote",
            "phone": "${phone}",
            "phoneClean": "${phoneClean}",
            "email": "${email}",
            "hours": "${hoursText}",
            "serviceArea": "${areaText}",
            "businessName": "${businessName}",
            "highlights": [
              { "text": "Why choose us point 1 — tailor to this landscaping business" },
              { "text": "Why choose us point 2 — tailor to this landscaping business" },
              { "text": "Why choose us point 3 — tailor to this landscaping business" }
            ]
          }
        }
      ]
    }
  ]
}

== RULES ==
1. Return ONLY the JSON object. No other text.
2. CRITICAL — every image URL MUST be a real Unsplash photo ID. Format: https://images.unsplash.com/photo-XXXXXXXXXXXXXXXXXX?w=1600 (hero/bg) or ?w=800 (gallery/portrait) or ?w=600 (service cards). You MUST replace every placeholder with a real ID. Real landscaping photo IDs to use: photo-1416879595882-3373a0480b5b, photo-1558904541-efa843a96f01, photo-1585320806297-9794b3e4eeae, photo-1523348837708-15d4a09cfac2, photo-1600585154340-be6161a56a0c, photo-1558618666-fcd25c85cd64, photo-1500937386664-56d1dfef3854, photo-1506905925346-21bda4d32df4.
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to this business.
4. Reviews should sound realistic and specific to the services offered.
5. Include 3-5 services based on what was provided.
6. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

// ── Auto-detailing: multi-page prompt ────────────────────────────────
function buildAutoDetailingMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList }) {
  const servicesJson = JSON.stringify(servicesList.slice(0, 6).map(s => ({ text: s })));

  return `You are a website content generator for auto detailing businesses. Generate a JSON object for a MULTI-PAGE website with 4 separate pages.

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation. Just the JSON object.

== BUSINESS INFO ==
${businessInfo}

== YOUR TASK ==
Generate a JSON object with this EXACT structure. Fill in compelling, professional content for this specific business.

{
  "meta": { "title": "${businessName} - Premium Auto Detailing", "description": "SEO meta description 150-160 chars" },
  "multiPage": true,
  "nav": {
    "id": "nav",
    "template": "nav-sticky-dark",
    "content": {
      "logo": "${businessName}",
      "links": [
        { "text": "Home",     "url": "index.html" },
        { "text": "Services", "url": "services.html" },
        { "text": "Gallery",  "url": "gallery.html" },
        { "text": "Contact",  "url": "contact.html" }
      ],
      "ctaText": "Book Now",
      "ctaLink": "contact.html"
    }
  },
  "footer": {
    "id": "footer",
    "template": "footer-4col-dark",
    "content": {
      "logo": "${businessName}",
      "tagline": "Short compelling tagline",
      "services": ${servicesJson},
      "phone": "${phone}",
      "email": "${email}",
      "hours": "${hoursText}"
    }
  },
  "pages": [
    {
      "filename": "index.html",
      "meta": { "title": "${businessName} - Premium Auto Detailing", "description": "Homepage SEO description" },
      "sections": [
        {
          "id": "hero",
          "template": "hero-fullscreen-dark",
          "content": {
            "headline": "Main headline WITHOUT the highlight word",
            "highlightText": "One or two highlight words",
            "subtitle": "Compelling subtitle 1-2 sentences about this business",
            "ctaText": "Book Your Detail",
            "ctaLink": "contact.html",
            "ctaText2": "View Our Work",
            "ctaLink2": "gallery.html",
            "backgroundImage": "https://images.unsplash.com/photo-1552519507-da3b142a6f3e?w=1920"
          }
        },
        {
          "id": "reviews",
          "template": "review-marquee",
          "content": {
            "reviews": [
              { "name": "David K.",  "stars": 5, "text": "Realistic 5-star review about this auto detailing business", "date": "3 days ago",  "avatarColor": "#d97706" },
              { "name": "Maria S.",  "stars": 5, "text": "Review about quality and finish",                            "date": "1 week ago",  "avatarColor": "#f59e0b" },
              { "name": "Chris T.",  "stars": 5, "text": "Review highlighting ceramic coating or paint correction",    "date": "2 weeks ago", "avatarColor": "#b45309" },
              { "name": "Lisa R.",   "stars": 5, "text": "Review about interior cleaning or full detail package",      "date": "4 days ago",  "avatarColor": "#d97706" },
              { "name": "James W.",  "stars": 5, "text": "Review about car looking brand new after service",           "date": "1 month ago", "avatarColor": "#f59e0b" },
              { "name": "Karen M.",  "stars": 4, "text": "Measured but positive review about the overall experience",  "date": "10 days ago", "avatarColor": "#92400e" }
            ]
          }
        },
        {
          "id": "features",
          "template": "features-icon-row",
          "content": {
            "features": [
              { "icon": "⭐", "title": "Feature 1 Title", "text": "Short description relevant to auto detailing" },
              { "icon": "🛡️", "title": "Feature 2 Title", "text": "Short description relevant to auto detailing" },
              { "icon": "⚡", "title": "Feature 3 Title", "text": "Short description relevant to auto detailing" },
              { "icon": "🏆", "title": "Feature 4 Title", "text": "Short description relevant to auto detailing" }
            ]
          }
        },
        {
          "id": "services",
          "template": "services-carousel",
          "content": {
            "title": "Our Detailing Packages",
            "subtitle": "Premium services tailored to your vehicle",
            "services": [
              { "title": "First service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": true },
              { "title": "Second service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false },
              { "title": "Third service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false }
            ]
          }
        },
        {
          "id": "benefits",
          "template": "benefits-cards",
          "content": {
            "title": "Why Choose ${businessName}",
            "subtitle": "Premium quality you can see and feel",
            "benefits": [
              { "icon": "✨", "title": "Benefit 1 Title", "description": "Why this matters to the customer" },
              { "icon": "🛡️", "title": "Benefit 2 Title", "description": "Why this matters to the customer" },
              { "icon": "🏆", "title": "Benefit 3 Title", "description": "Why this matters to the customer" }
            ]
          }
        },
        {
          "id": "cta",
          "template": "cta-gradient-full",
          "content": {
            "badge": "Limited Time",
            "headline": "Compelling CTA headline for auto detailing",
            "subtitle": "Supporting text that drives action",
            "ctaText": "Book Now",
            "ctaLink": "contact.html",
            "ctaText2": "Call Now: ${phone}",
            "ctaLink2": "tel:${phoneClean}",
            "features": [
              { "text": "Feature pill 1 for auto detailing" },
              { "text": "Feature pill 2 for auto detailing" },
              { "text": "Feature pill 3 for auto detailing" }
            ]
          }
        }
      ]
    },
    {
      "filename": "services.html",
      "meta": { "title": "Services | ${businessName}", "description": "Services page SEO description" },
      "sections": [
        {
          "id": "services",
          "template": "services-carousel",
          "content": {
            "title": "Our Services",
            "subtitle": "Premium detailing packages for every need",
            "services": [
              { "title": "First service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": true },
              { "title": "Second service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false },
              { "title": "Third service from list", "category": "Category", "price": "From $XXX", "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false }
            ]
          }
        },
        {
          "id": "benefits",
          "template": "benefits-cards",
          "content": {
            "title": "Why Choose ${businessName}",
            "subtitle": "Premium quality you can see and feel",
            "benefits": [
              { "icon": "✨", "title": "Benefit 1 Title", "description": "Why this matters to the customer" },
              { "icon": "🛡️", "title": "Benefit 2 Title", "description": "Why this matters to the customer" },
              { "icon": "🏆", "title": "Benefit 3 Title", "description": "Why this matters to the customer" }
            ]
          }
        },
        {
          "id": "testimonials",
          "template": "testimonials-3col",
          "content": {
            "title": "What Our Clients Say",
            "testimonials": [
              { "quote": "Detailed realistic testimonial about the detailing service", "author": "First Last", "role": "Car Owner / Context", "rating": 5 },
              { "quote": "Detailed realistic testimonial about the detailing service", "author": "First Last", "role": "Car Owner / Context", "rating": 5 },
              { "quote": "Detailed realistic testimonial about the detailing service", "author": "First Last", "role": "Car Owner / Context", "rating": 5 }
            ]
          }
        }
      ]
    },
    {
      "filename": "gallery.html",
      "meta": { "title": "Gallery | ${businessName}", "description": "Gallery page SEO description" },
      "sections": [
        {
          "id": "gallery",
          "template": "gallery-filtered",
          "content": {
            "title": "Our Work",
            "subtitle": "Check out some of our finest detailing projects",
            "highlight": "Work",
            "categories": ["All", "Full Detail", "Ceramic Coating", "Paint Correction", "Interior"],
            "items": [
              { "url": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO-1?w=800", "title": "Project description 1", "category": "Full Detail" },
              { "url": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO-2?w=800", "title": "Project description 2", "category": "Ceramic Coating" },
              { "url": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO-3?w=800", "title": "Project description 3", "category": "Paint Correction" },
              { "url": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO-4?w=800", "title": "Project description 4", "category": "Interior" },
              { "url": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO-5?w=800", "title": "Project description 5", "category": "Full Detail" },
              { "url": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO-6?w=800", "title": "Project description 6", "category": "Ceramic Coating" }
            ]
          }
        }
      ]
    },
    {
      "filename": "contact.html",
      "meta": { "title": "Contact | ${businessName}", "description": "Contact page SEO description" },
      "sections": [
        {
          "id": "contact",
          "template": "contact-split",
          "content": {
            "formTitle": "Get Your Free Quote",
            "formSubtitle": "Fill out the form and we'll get back to you within 24 hours",
            "submitText": "Request Quote",
            "phone": "${phone}",
            "phoneClean": "${phoneClean}",
            "email": "${email}",
            "hours": "${hoursText}",
            "serviceArea": "${areaText}",
            "businessName": "${businessName}",
            "highlights": [
              { "text": "Why choose us point 1 — tailor to auto detailing" },
              { "text": "Why choose us point 2 — tailor to auto detailing" },
              { "text": "Why choose us point 3 — tailor to auto detailing" }
            ]
          }
        }
      ]
    }
  ]
}

== RULES ==
1. Return ONLY the JSON object. No other text.
2. CRITICAL — every image URL MUST be a real Unsplash photo ID. Format: https://images.unsplash.com/photo-XXXXXXXXXXXXXXXXXX?w=1920 (hero/bg) or ?w=800 (cards) or ?w=600 (service images). You MUST replace every placeholder with a real ID. Real auto-detailing photo IDs to use: photo-1552519507-da3b142a6f3e, photo-1601362840469-51e4d8d58785, photo-1558618666-fcd25c85cd64, photo-1502877338535-766e1452684a, photo-1616455579100-2ceaa4eb2d37, photo-1503376780353-7e6692767b70, photo-1549317661-bd32c8ce0db2, photo-1580273916550-e323be2ae537.
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to this business.
4. Reviews and testimonials should sound realistic and specific to the services offered.
5. Include 3-4 services based on what was provided.
6. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

// ── Default layout (dark theme, generic service businesses) ─────────
function defaultSections({ businessName, phone, phoneClean }) {
  return `    {
      "id": "s1",
      "template": "trust-banner-scroll",
      "content": {
        "reviews": [
          { "text": "A realistic 5-star review about this business", "author": "First L.", "rating": 5 },
          { "text": "Another realistic review", "author": "First L.", "rating": 5 },
          { "text": "Another realistic review", "author": "First L.", "rating": 5 },
          { "text": "Another realistic review", "author": "First L.", "rating": 5 },
          { "text": "Another realistic review", "author": "First L.", "rating": 5 }
        ]
      }
    },
    {
      "id": "s2",
      "template": "nav-sticky-dark",
      "content": {
        "logo": "${businessName}",
        "links": [
          { "text": "Services", "url": "#services" },
          { "text": "Gallery", "url": "#gallery" },
          { "text": "Reviews", "url": "#reviews" },
          { "text": "Contact", "url": "#contact" }
        ],
        "ctaText": "Get Free Quote",
        "ctaLink": "#contact"
      }
    },
    {
      "id": "s3",
      "template": "hero-fullscreen-dark",
      "content": {
        "headline": "Main headline WITHOUT the highlight word ",
        "highlightText": "One or two highlight words",
        "subtitle": "A compelling subtitle (1-2 sentences) about the business value prop",
        "ctaText": "Primary CTA text",
        "ctaLink": "#contact",
        "ctaText2": "Secondary CTA text",
        "ctaLink2": "#services",
        "backgroundImage": "https://images.unsplash.com/RELEVANT-PHOTO?w=1920"
      }
    },
    {
      "id": "s4",
      "template": "features-icon-row",
      "content": {
        "features": [
          { "icon": "⭐", "title": "Feature 1 Title", "text": "Short description" },
          { "icon": "🛡️", "title": "Feature 2 Title", "text": "Short description" },
          { "icon": "⚡", "title": "Feature 3 Title", "text": "Short description" },
          { "icon": "🏆", "title": "Feature 4 Title", "text": "Short description" }
        ]
      }
    },
    {
      "id": "s5",
      "template": "services-cards-3col",
      "content": {
        "title": "Our Services",
        "ctaText": "View All Services",
        "ctaLink": "#contact",
        "services": [
          {
            "name": "Service name from list",
            "description": "2-3 sentence description of this service",
            "price": "From $XX",
            "image": "https://images.unsplash.com/RELEVANT-PHOTO?w=800",
            "link": "#contact"
          }
        ]
      }
    },
    {
      "id": "s6",
      "template": "benefits-numbered",
      "content": {
        "title": "Why Choose ${businessName}",
        "benefits": [
          { "title": "Benefit 1 Title", "description": "Why this matters to the customer" },
          { "title": "Benefit 2 Title", "description": "Why this matters to the customer" },
          { "title": "Benefit 3 Title", "description": "Why this matters to the customer" }
        ]
      }
    },
    {
      "id": "s7",
      "template": "gallery-mixed-grid",
      "content": {
        "title": "Our Work",
        "items": [
          { "image": "https://images.unsplash.com/RELEVANT?w=800", "title": "Project type", "caption": "Brief caption", "large": true },
          { "image": "https://images.unsplash.com/RELEVANT?w=800", "title": "Project type", "caption": "Brief caption", "large": false },
          { "image": "https://images.unsplash.com/RELEVANT?w=800", "title": "Project type", "caption": "Brief caption", "large": false },
          { "image": "https://images.unsplash.com/RELEVANT?w=800", "title": "Project type", "caption": "Brief caption", "large": false },
          { "image": "https://images.unsplash.com/RELEVANT?w=800", "title": "Project type", "caption": "Brief caption", "large": true }
        ]
      }
    },
    {
      "id": "s8",
      "template": "testimonials-3col",
      "content": {
        "title": "What Our Clients Say",
        "testimonials": [
          { "quote": "Detailed realistic testimonial", "author": "First Last", "role": "Role/Context", "rating": 5 },
          { "quote": "Detailed realistic testimonial", "author": "First Last", "role": "Role/Context", "rating": 5 },
          { "quote": "Detailed realistic testimonial", "author": "First Last", "role": "Role/Context", "rating": 5 }
        ]
      }
    },
    {
      "id": "s9",
      "template": "cta-gradient-full",
      "content": {
        "badge": "Limited Time",
        "headline": "Compelling CTA headline",
        "subtitle": "Supporting text that drives action",
        "ctaText": "Primary CTA",
        "ctaLink": "#contact",
        "ctaText2": "Call Now: ${phone}",
        "ctaLink2": "tel:${phoneClean}",
        "features": [
          { "text": "Feature pill 1" },
          { "text": "Feature pill 2" },
          { "text": "Feature pill 3" }
        ]
      }
    }`;
}

// ── Handyman / Contractor / Renovation: multi-page prompt ────────────────────
function buildHandymanMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList }) {
  return `You are a website content generator for handyman, contractor, and home renovation businesses. Generate a JSON object for a MULTI-PAGE website with 4 separate pages.

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation. Just the JSON object.

== BUSINESS INFO ==
${businessInfo}

== YOUR TASK ==
Generate a JSON object with this EXACT structure. Fill in compelling, professional content for this specific business.

{
  "meta": { "title": "${businessName} — Expert Home Renovation & Repair", "description": "SEO meta description 150-160 chars" },
  "multiPage": true,
  "nav": {
    "id": "nav",
    "template": "nav-sticky-dark",
    "content": {
      "logo": "${businessName}",
      "links": [
        { "text": "Home",     "url": "index.html" },
        { "text": "Services", "url": "services.html" },
        { "text": "Projects", "url": "gallery.html" },
        { "text": "Contact",  "url": "contact.html" }
      ],
      "ctaText": "Get an Estimate",
      "ctaLink": "contact.html"
    }
  },
  "footer": {
    "id": "footer",
    "template": "footer-4col-dark",
    "content": {
      "logo": "${businessName}",
      "tagline": "Craftsmanship you can trust.",
      "services": ["Service 1 from list", "Service 2 from list", "Service 3 from list", "Service 4 from list"],
      "address": "123 Builder Ave\\n${areaText}",
      "hours": "${hoursText}",
      "phone": "${phone}",
      "email": "${email}"
    }
  },
  "pages": [
    {
      "filename": "index.html",
      "meta": { "title": "${businessName} — Home Remodeling & Repair", "description": "Homepage SEO description" },
      "sections": [
        {
          "id": "hero",
          "template": "hero-fullscreen-dark",
          "content": {
            "headline": "Short punchy headline WITHOUT the highlight word",
            "highlightText": "One bold highlight word (e.g. LAST. or RIGHT. or DONE.)",
            "subtitle": "2-3 sentence value proposition specific to this business — quality, trust, experience",
            "ctaText": "Request Estimate",
            "ctaLink": "contact.html",
            "ctaText2": "Our Work",
            "ctaLink2": "gallery.html",
            "backgroundImage": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1920"
          }
        },
        {
          "id": "importance",
          "template": "importance-split",
          "content": {
            "badge": "Quality & Craftsmanship",
            "headline": "YOUR HOME, DONE RIGHT.",
            "body1": "First paragraph: why quality matters in home renovation — impact on value, safety, and comfort",
            "body2": "Second paragraph: what makes ${businessName} different — experience, approach, and commitment to excellence",
            "highlights": [
              { "icon": "🔨", "text": "Expert craftsmanship highlight" },
              { "icon": "📐", "text": "Precision and detail highlight" },
              { "icon": "⏱", "text": "On-time and reliable highlight" },
              { "icon": "🛡", "text": "Licensed and insured highlight" }
            ],
            "image": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800",
            "imageAlt": "Professional craftsman at work"
          }
        },
        {
          "id": "carousel",
          "template": "services-carousel",
          "content": {
            "title": "Our Services",
            "subtitle": "From quick fixes to complete transformations",
            "services": [
              { "title": "First service from list", "category": "Renovation", "price": "Custom", "image": "https://images.unsplash.com/photo-1556910103-1c02745a872f?w=600", "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"], "recommended": true },
              { "title": "Second service from list", "category": "Repair", "price": "Custom", "image": "https://images.unsplash.com/photo-1620626011761-996317b8d101?w=600", "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"], "recommended": false },
              { "title": "Third service from list", "category": "Installation", "price": "Custom", "image": "https://images.unsplash.com/photo-1581858726788-75bc0f6a952d?w=600", "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"], "recommended": false }
            ]
          }
        },
        {
          "id": "reviews",
          "template": "review-marquee",
          "content": {
            "reviews": [
              { "name": "Robert C.",   "stars": 5, "text": "Realistic 5-star review about renovation quality and craftsmanship",   "date": "1 week ago",   "avatarColor": "#b45309" },
              { "name": "Amanda F.",   "stars": 5, "text": "Review about reliability, timeliness, and clean work environment",       "date": "3 weeks ago",  "avatarColor": "#1e293b" },
              { "name": "David M.",    "stars": 5, "text": "Review about handyman or repair work — specific and realistic",          "date": "1 month ago",  "avatarColor": "#475569" },
              { "name": "Sarah J.",    "stars": 5, "text": "Review about a major project like a deck, kitchen, or bathroom",         "date": "2 months ago", "avatarColor": "#0f172a" },
              { "name": "Michael T.",  "stars": 5, "text": "Review praising communication, transparency, and final result",          "date": "2 months ago", "avatarColor": "#d97706" },
              { "name": "Emily W.",    "stars": 5, "text": "Review about honest pricing and the quality of the finished work",       "date": "3 months ago", "avatarColor": "#334155" }
            ]
          }
        },
        {
          "id": "benefits",
          "template": "benefits-cards",
          "content": {
            "title": "The ${businessName} Difference",
            "benefits": [
              { "icon": "📋", "title": "Transparent Pricing", "description": "No hidden fees or surprise charges. Detailed, itemized estimates before any work begins." },
              { "icon": "🤝", "title": "Reliable Communication", "description": "We answer our phones, show up when we say we will, and keep you updated throughout." },
              { "icon": "⭐", "title": "Quality Guarantee", "description": "We stand behind our craftsmanship. If something isn't right, we'll make it right." }
            ]
          }
        },
        {
          "id": "splitcta",
          "template": "split-image-cta",
          "content": {
            "image": "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800",
            "imageAlt": "Beautiful home renovation result",
            "headline": "TURN YOUR HOUSE INTO YOUR DREAM HOME",
            "body": "Compelling 2-3 sentence pitch about why now is the time to do those renovations — reference the business's specific services",
            "checkpoints": [
              "Licensed, bonded, and insured",
              "Clean and respectful work environment",
              "Premium materials and hardware",
              "Dedicated project management"
            ],
            "ctaText": "Start Your Project",
            "ctaLink": "contact.html"
          }
        },
        {
          "id": "ctacard",
          "template": "cta-card",
          "content": {
            "headline": "READY TO GET STARTED?",
            "subtitle": "Contact us today for a free, no-obligation estimate for your project.",
            "ctaText": "Request Estimate",
            "ctaLink": "contact.html",
            "ctaText2": "View Portfolio",
            "ctaLink2": "gallery.html"
          }
        }
      ]
    },
    {
      "filename": "services.html",
      "meta": { "title": "Services | ${businessName}", "description": "Services page SEO description" },
      "sections": [
        {
          "id": "page-header",
          "template": "hero-page-banner",
          "content": {
            "title": "Our Services",
            "subtitle": "Expert solutions for every area of your home"
          }
        },
        {
          "id": "carousel",
          "template": "services-carousel",
          "content": {
            "title": "What We Do",
            "subtitle": "Expert solutions for every area of your home",
            "services": [
              { "title": "First service from list", "category": "Renovation", "price": "Custom", "image": "https://images.unsplash.com/photo-1556910103-1c02745a872f?w=600", "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4", "Feature 5"], "recommended": true },
              { "title": "Second service from list", "category": "Repair", "price": "Custom", "image": "https://images.unsplash.com/photo-1620626011761-996317b8d101?w=600", "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4", "Feature 5"], "recommended": false },
              { "title": "Third service from list", "category": "Installation", "price": "Custom", "image": "https://images.unsplash.com/photo-1581858726788-75bc0f6a952d?w=600", "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4", "Feature 5"], "recommended": false },
              { "title": "Fourth service from list", "category": "Exterior", "price": "Custom", "image": "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=600", "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"], "recommended": false }
            ]
          }
        },
        {
          "id": "ctacard",
          "template": "cta-card",
          "content": {
            "headline": "Don't See What You Need?",
            "subtitle": "We handle a wide variety of custom projects. Reach out to discuss your specific needs.",
            "ctaText": "Call Us",
            "ctaLink": "tel:${phoneClean}",
            "ctaText2": "Contact Form",
            "ctaLink2": "contact.html"
          }
        }
      ]
    },
    {
      "filename": "gallery.html",
      "meta": { "title": "Projects | ${businessName}", "description": "Gallery page SEO description" },
      "sections": [
        {
          "id": "page-header",
          "template": "hero-page-banner",
          "content": {
            "title": "Our Projects",
            "subtitle": "A showcase of renovations, repairs, and craftsmanship"
          }
        },
        {
          "id": "galfilter",
          "template": "gallery-filtered",
          "content": {
            "title": "Recent Projects",
            "subtitle": "Take a look at some of our recent renovations and repairs.",
            "highlight": "Portfolio",
            "categories": ["All", "Kitchens", "Bathrooms", "Exteriors", "Carpentry"],
            "items": [
              { "url": "https://images.unsplash.com/photo-1556910103-1c02745a872f?w=800", "title": "Project title 1", "category": "Kitchens" },
              { "url": "https://images.unsplash.com/photo-1620626011761-996317b8d101?w=800", "title": "Project title 2", "category": "Bathrooms" },
              { "url": "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800", "title": "Project title 3", "category": "Exteriors" },
              { "url": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800", "title": "Project title 4", "category": "Carpentry" },
              { "url": "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800", "title": "Project title 5", "category": "Kitchens" },
              { "url": "https://images.unsplash.com/photo-1584622781564-1d987f7333c1?w=800", "title": "Project title 6", "category": "Bathrooms" },
              { "url": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=800", "title": "Project title 7", "category": "Exteriors" },
              { "url": "https://images.unsplash.com/photo-1581858726788-75bc0f6a952d?w=800", "title": "Project title 8", "category": "Carpentry" }
            ]
          }
        },
        {
          "id": "ctacard",
          "template": "cta-card",
          "content": {
            "headline": "Like What You See?",
            "subtitle": "Let's add your home to our portfolio. Contact us to discuss your vision.",
            "ctaText": "Request Estimate",
            "ctaLink": "contact.html",
            "ctaText2": "View Services",
            "ctaLink2": "services.html"
          }
        }
      ]
    },
    {
      "filename": "contact.html",
      "meta": { "title": "Contact | ${businessName}", "description": "Contact page SEO description" },
      "sections": [
        {
          "id": "page-header",
          "template": "hero-page-banner",
          "content": {
            "title": "Get a Free Estimate",
            "subtitle": "Tell us about your project and we'll get back to you within 24 hours"
          }
        },
        {
          "id": "contact",
          "template": "contact-split",
          "content": {
            "formTitle": "Request an Estimate",
            "formSubtitle": "Tell us about your project and we'll get back to you within 24 hours to schedule a walkthrough.",
            "submitText": "Send Request",
            "phone": "${phone}",
            "phoneClean": "${phoneClean}",
            "email": "${email}",
            "hours": "${hoursText}",
            "serviceArea": "${areaText}",
            "businessName": "${businessName}",
            "highlights": [
              { "text": "Licensed, bonded & insured" },
              { "text": "Transparent pricing — no surprises" },
              { "text": "Quality craftsmanship guaranteed" },
              { "text": "Free initial estimates" }
            ]
          }
        }
      ]
    }
  ]
}

== RULES ==
1. Return ONLY the JSON object. No other text.
2. CRITICAL — every image URL MUST use a real Unsplash photo ID. Format: https://images.unsplash.com/photo-XXXXXXXXXXXXXXXXXX?w=SIZE. Real renovation/handyman photo IDs to use: photo-1504307651254-35680f356dfd, photo-1556910103-1c02745a872f, photo-1620626011761-996317b8d101, photo-1581141849291-1125c7b692b5, photo-1513694203232-719a280e022f, photo-1581858726788-75bc0f6a952d, photo-1589939705384-5185137a7f0f, photo-1503387762-592deb58ef4e, photo-1584622650111-993a426fbf0a, photo-1584622781564-1d987f7333c1.
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to this business type and the services listed.
4. Reviews should sound realistic and specific to the type of work done.
5. List 3-6 services based on what was provided. Match services to relevant photo IDs.
6. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

module.exports = { buildSchemaPrompt };
