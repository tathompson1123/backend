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
  let mainSections, sectionOrder, contactId, footerId;
  switch (layout) {
    case 'organic':
      mainSections = organicSections({ businessName });
      sectionOrder = 'nav → hero → reviews → importance → services → transformations → benefits → cta → contact → footer';
      contactId    = 'contact';
      footerId     = 'footer';
      break;
    case 'autoDetailing':
      mainSections = autoDetailingSections({ businessName, phone, phoneClean });
      sectionOrder = 'reviews → nav → hero → features → services → benefits → gallery → testimonials → cta → contact → footer';
      contactId    = 'contact';
      footerId     = 'footer';
      break;
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

// ── Organic layout (landscaping, gardens, outdoor spaces) ───────────
function organicSections({ businessName }) {
  return `    {
      "id": "nav",
      "template": "nav-sticky-organic",
      "content": {
        "logo": "${businessName}",
        "links": [
          { "text": "Home",     "url": "#" },
          { "text": "Services", "url": "#services" },
          { "text": "Gallery",  "url": "#transformations" },
          { "text": "Contact",  "url": "#contact" }
        ],
        "ctaText": "Get a Quote",
        "ctaLink": "#contact"
      }
    },
    {
      "id": "hero",
      "template": "hero-split-portrait",
      "content": {
        "badge": "Welcome to ${businessName}",
        "headline": "Punchy headline WITHOUT the highlight word",
        "highlightText": "One key highlight word (e.g. Landscapes, Gardens)",
        "subtitle": "A compelling 2-3 sentence value proposition for the business",
        "ctaText": "Get a Free Quote",
        "ctaLink": "#contact",
        "ctaText2": "See Our Work",
        "ctaLink2": "#transformations",
        "portraitImage": "https://images.unsplash.com/RELEVANT-LANDSCAPE-PHOTO?w=800",
        "bgImage": "https://images.unsplash.com/RELEVANT-LANDSCAPE-PHOTO?w=1600",
        "floatBadge": "25+",
        "floatBadgeLabel": "Years Experience"
      }
    },
    {
      "id": "reviews",
      "template": "review-marquee",
      "content": {
        "reviews": [
          { "name": "Sarah M.",  "stars": 5, "text": "A realistic 5-star review about this business",      "date": "2 weeks ago",  "avatarColor": "#6b8f5e" },
          { "name": "James R.",  "stars": 5, "text": "Another realistic review specific to the services",  "date": "1 month ago", "avatarColor": "#85a378" },
          { "name": "Linda K.",  "stars": 5, "text": "A third review highlighting quality and care",       "date": "3 weeks ago", "avatarColor": "#506a4b" },
          { "name": "Tom & Pat", "stars": 5, "text": "Review about the transformation result",             "date": "2 months ago","avatarColor": "#3d4f39" },
          { "name": "Rachel W.", "stars": 5, "text": "Review about the experience from start to finish",   "date": "1 week ago",  "avatarColor": "#6b8f5e" },
          { "name": "Mike D.",   "stars": 4, "text": "A slightly more measured but still positive review", "date": "5 days ago",  "avatarColor": "#85a378" }
        ]
      }
    },
    {
      "id": "importance",
      "template": "importance-split",
      "content": {
        "badge": "Why ${businessName}?",
        "headline": "Why Your Outdoor Space Matters",
        "body1": "First paragraph: why a well-maintained outdoor space matters to the customer (property value, curb appeal, lifestyle)",
        "body2": "Second paragraph: what makes ${businessName} different — expertise, approach, and lasting results",
        "highlights": [
          { "icon": "🌿", "text": "Relevant highlight about native or quality plantings" },
          { "icon": "💧", "text": "Relevant highlight about water-smart or sustainable design" },
          { "icon": "🌞", "text": "Relevant highlight about year-round beauty" },
          { "icon": "🏡", "text": "Relevant highlight about property value or lifestyle improvement" }
        ],
        "image": "https://images.unsplash.com/RELEVANT-LANDSCAPE-PHOTO?w=800",
        "imageAlt": "Descriptive alt text for the image"
      }
    },
    {
      "id": "services",
      "template": "services-carousel",
      "content": {
        "title": "Our Services",
        "subtitle": "From concept to creation, we handle everything",
        "services": [
          {
            "title": "First service name from the list above",
            "category": "Appropriate category label",
            "price": "From $XXX",
            "image": "https://images.unsplash.com/RELEVANT-PHOTO?w=600",
            "features": ["Key feature 1", "Key feature 2", "Key feature 3"],
            "recommended": true
          },
          {
            "title": "Second service name from the list above",
            "category": "Appropriate category label",
            "price": "From $XXX",
            "image": "https://images.unsplash.com/RELEVANT-PHOTO?w=600",
            "features": ["Key feature 1", "Key feature 2", "Key feature 3"],
            "recommended": false
          },
          {
            "title": "Third service name from the list above",
            "category": "Appropriate category label",
            "price": "From $XXX",
            "image": "https://images.unsplash.com/RELEVANT-PHOTO?w=600",
            "features": ["Key feature 1", "Key feature 2", "Key feature 3"],
            "recommended": false
          }
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
          { "title": "Project type 1 (e.g. Backyard Oasis)", "description": "Brief description of the transformation", "beforeImage": "https://images.unsplash.com/BEFORE-PHOTO-1?w=600", "afterImage": "https://images.unsplash.com/AFTER-PHOTO-1?w=600" },
          { "title": "Project type 2 (e.g. Front Garden)",   "description": "Brief description of the transformation", "beforeImage": "https://images.unsplash.com/BEFORE-PHOTO-2?w=600", "afterImage": "https://images.unsplash.com/AFTER-PHOTO-2?w=600" },
          { "title": "Project type 3 (e.g. Pool Surround)",  "description": "Brief description of the transformation", "beforeImage": "https://images.unsplash.com/BEFORE-PHOTO-3?w=600", "afterImage": "https://images.unsplash.com/AFTER-PHOTO-3?w=600" }
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
          { "icon": "🌿", "title": "Benefit Title 1", "description": "Why this matters to the customer" },
          { "icon": "💚", "title": "Benefit Title 2", "description": "Why this matters to the customer" },
          { "icon": "🏆", "title": "Benefit Title 3", "description": "Why this matters to the customer" }
        ]
      }
    },
    {
      "id": "ctasection",
      "template": "cta-card",
      "content": {
        "headline": "Ready for a Stunning Transformation?",
        "subtitle": "Let us turn your vision into reality. Contact us today for a free consultation.",
        "ctaText": "Book a Consultation",
        "ctaLink": "#contact",
        "ctaText2": "View Our Work",
        "ctaLink2": "#transformations"
      }
    }`;
}

// ── Auto-detailing layout (cars, ceramic coatings, etc.) ────────────
function autoDetailingSections({ businessName, phone, phoneClean }) {
  return `    {
      "id": "reviews",
      "template": "review-marquee",
      "content": {
        "reviews": [
          { "name": "David K.",  "stars": 5, "text": "A realistic 5-star review about this auto detailing business", "date": "3 days ago",  "avatarColor": "#d97706" },
          { "name": "Maria S.",  "stars": 5, "text": "Another realistic review about the quality and finish",       "date": "1 week ago",  "avatarColor": "#f59e0b" },
          { "name": "Chris T.",  "stars": 5, "text": "Review highlighting ceramic coating or paint correction",      "date": "2 weeks ago", "avatarColor": "#b45309" },
          { "name": "Lisa R.",   "stars": 5, "text": "Review about interior cleaning or full detail package",        "date": "4 days ago",  "avatarColor": "#d97706" },
          { "name": "James W.",  "stars": 5, "text": "Review about how the car looks brand new after service",       "date": "1 month ago", "avatarColor": "#f59e0b" },
          { "name": "Karen M.",  "stars": 4, "text": "A measured but still positive review about the experience",    "date": "10 days ago", "avatarColor": "#92400e" }
        ]
      }
    },
    {
      "id": "nav",
      "template": "nav-sticky-dark",
      "content": {
        "logo": "${businessName}",
        "links": [
          { "text": "Services", "url": "#services" },
          { "text": "Gallery",  "url": "#gallery" },
          { "text": "Reviews",  "url": "#reviews" },
          { "text": "Contact",  "url": "#contact" }
        ],
        "ctaText": "Book Now",
        "ctaLink": "#contact"
      }
    },
    {
      "id": "hero",
      "template": "hero-fullscreen-dark",
      "content": {
        "headline": "Main headline WITHOUT the highlight word",
        "highlightText": "One or two highlight words",
        "subtitle": "A compelling subtitle (1-2 sentences) about the business value prop",
        "ctaText": "Book Your Detail",
        "ctaLink": "#contact",
        "ctaText2": "View Our Work",
        "ctaLink2": "#gallery",
        "backgroundImage": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=1920"
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
        "title": "Our Services",
        "subtitle": "Premium detailing packages for every need",
        "services": [
          {
            "title": "First service name from the list above",
            "category": "Appropriate category label",
            "price": "From $XXX",
            "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600",
            "features": ["Key feature 1", "Key feature 2", "Key feature 3"],
            "recommended": true
          },
          {
            "title": "Second service name from the list above",
            "category": "Appropriate category label",
            "price": "From $XXX",
            "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600",
            "features": ["Key feature 1", "Key feature 2", "Key feature 3"],
            "recommended": false
          },
          {
            "title": "Third service name from the list above",
            "category": "Appropriate category label",
            "price": "From $XXX",
            "image": "https://images.unsplash.com/RELEVANT-AUTO-PHOTO?w=600",
            "features": ["Key feature 1", "Key feature 2", "Key feature 3"],
            "recommended": false
          }
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
          { "icon": "✨", "title": "Benefit Title 1", "description": "Why this matters to the customer" },
          { "icon": "🛡️", "title": "Benefit Title 2", "description": "Why this matters to the customer" },
          { "icon": "🏆", "title": "Benefit Title 3", "description": "Why this matters to the customer" }
        ]
      }
    },
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
    },
    {
      "id": "cta",
      "template": "cta-gradient-full",
      "content": {
        "badge": "Limited Time",
        "headline": "Compelling CTA headline about the detailing service",
        "subtitle": "Supporting text that drives action",
        "ctaText": "Book Now",
        "ctaLink": "#contact",
        "ctaText2": "Call Now: ${phone}",
        "ctaLink2": "tel:${phoneClean}",
        "features": [
          { "text": "Feature pill 1 relevant to auto detailing" },
          { "text": "Feature pill 2 relevant to auto detailing" },
          { "text": "Feature pill 3 relevant to auto detailing" }
        ]
      }
    }`;
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

module.exports = { buildSchemaPrompt };
