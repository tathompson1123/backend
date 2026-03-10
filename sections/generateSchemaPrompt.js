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
  if ([
    'landscape', 'landscaping', 'lawn', 'garden', 'tree', 'outdoor', 'yard',
    'mow', 'mowing', 'mulch', 'sod', 'turf', 'irrigation', 'sprinkler',
    'hedge', 'shrub', 'bush', 'fertiliz', 'aerat', 'seeding', 'prune',
    'pruning', 'weed', 'planting', 'hardscape', 'pavers', 'groundskeep',
  ].some(kw => bt.includes(kw))) return 'organic';
  // ⚠️ Cleaning MUST be checked before autoDetailing —
  // 'car' in autoDetailing would incorrectly match 'carpet', 'car wash', etc.
  if ([
    'carpet', 'carpet clean', 'house clean', 'home clean', 'maid', 'janitorial',
    'deep clean', 'upholstery clean', 'tile clean', 'grout', 'rug clean',
    'cleaning service', 'cleaning company', 'cleaning business', 'cleaning co',
    'sanitiz', 'disinfect', 'pressure wash', 'power wash', 'steam clean',
    'window clean', 'office clean', 'commercial clean',
  ].some(kw => bt.includes(kw))) return 'cleaning';
  // Cleaning is ruled out above, so 'car'/'wash' are now safe to match for auto businesses
  if (['detailing', 'car', 'auto', 'vehicle', 'ceramic', 'paint', 'wash'].some(kw => bt.includes(kw))) return 'autoDetailing';
  if (['handyman', 'renovation', 'remodeling', 'remodel', 'contractor', 'construction', 'builder', 'repair'].some(kw => bt.includes(kw))) return 'renovation';
  if (['photography', 'photographer', 'portrait', 'wedding photo', 'headshot', 'boudoir', 'photoshoot'].some(kw => bt.includes(kw))) return 'photography';
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
    images = null,   // pre-fetched Pexels images: { hero: [], cards: [] }
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
    return buildAutoDetailingMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList, images });
  }
  if (layout === 'organic') {
    return buildOrganicMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList });
  }
  if (layout === 'renovation') {
    return buildHandymanMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList });
  }
  if (layout === 'photography') {
    return buildPhotographyMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList });
  }
  if (layout === 'cleaning') {
    return buildCleaningMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList, images });
  }

  let mainSections, sectionOrder, contactId, footerId;
  switch (layout) {
    default:
      mainSections = defaultSections({ businessName, phone, phoneClean, images });
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
2. ${images?.hero?.length ? 'Image URLs are already filled in — do NOT change any image URL in the JSON. Keep every "backgroundImage", "image", and "url" value exactly as provided.' : 'Use REAL Unsplash URLs. Format: https://images.unsplash.com/photo-XXXXX?w=1920 (hero) or ?w=800 (cards/gallery). Pick specific photo IDs that match ' + businessType + '.'}
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to ${businessType}.
4. Reviews and testimonials should sound realistic and specific to the services offered.
5. Include 3-6 services in the services section based on what was provided.
6. Keep the sections in the exact order shown above (${sectionOrder}).
7. Make the headline punchy and benefit-focused, not just the business name. Hero "headline" must be 3-5 words MAX (the highlight word is separate). Keep it short and bold.
8. Feature icons should be relevant emoji for the business type.
9. Gallery images should showcase different aspects of the work.
10. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

// ── Organic/Landscaping: content-only prompt + schema builder ────────
// Claude returns ONLY text content. We build the full schema structure.
// This prevents Claude from dropping multiPage, trust-banner injection, etc.

const LANDSCAPE_PHOTO_IDS = [
  'photo-1416879595882-3373a0480b5b',
  'photo-1558904541-efa843a96f01',
  'photo-1585320806297-9794b3e4eeae',
  'photo-1523348837708-15d4a09cfac2',
  'photo-1600585154340-be6161a56a0c',
  'photo-1558618666-fcd25c85cd64',
  'photo-1500937386664-56d1dfef3854',
  'photo-1506905925346-21bda4d32df4',
];
const AVATAR_COLORS = ['#6b8f5e', '#85a378', '#506a4b', '#3d4f39', '#6b8f5e', '#85a378'];

function buildOrganicSchemaFromContent(content, { businessName, phone, phoneClean, email, hoursText, areaText, servicesList }) {
  const hero = content.hero || {};
  const importance = content.importance || {};

  const services = (content.services || []).slice(0, 5).map((s, i) => ({
    title: s.title || servicesList[i] || `Service ${i + 1}`,
    category: s.category || 'Landscaping',
    price: s.price || 'Call for quote',
    image: `https://images.unsplash.com/${LANDSCAPE_PHOTO_IDS[i % LANDSCAPE_PHOTO_IDS.length]}?w=600`,
    features: s.features || ['Professional service', 'Quality results', 'Satisfaction guaranteed'],
    recommended: i === 0,
  }));

  const reviews = (content.reviews || []).map((r, i) => ({
    name: r.name || `Customer ${i + 1}`,
    stars: 5,
    text: r.text || 'Great work!',
    date: r.date || '1 month ago',
    avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
  }));

  const transformations = (content.transformations || []).slice(0, 3).map((t, i) => ({
    title: t.title || `Project ${i + 1}`,
    description: t.description || 'Beautiful transformation',
    beforeImage: `https://images.unsplash.com/${LANDSCAPE_PHOTO_IDS[i]}?w=600`,
    afterImage: `https://images.unsplash.com/${LANDSCAPE_PHOTO_IDS[(i + 3) % LANDSCAPE_PHOTO_IDS.length]}?w=600`,
  }));

  const footerServices = servicesList.slice(0, 6).map(s => ({ text: s }));
  const contactHighlights = content.contact?.highlights || [
    { text: 'Free consultations and detailed quotes' },
    { text: 'Licensed, insured, and experienced team' },
    { text: 'Satisfaction guaranteed on every project' },
  ];
  const benefits = content.servicesPage?.benefits || [
    { icon: '🌿', title: 'Expert Craftsmen', description: 'Years of experience in landscape design and maintenance' },
    { icon: '💚', title: 'Eco-Friendly', description: 'Sustainable methods that are good for your yard and environment' },
    { icon: '🏆', title: 'Guaranteed Results', description: 'We stand behind our work with satisfaction guarantees' },
  ];

  return {
    multiPage: true,
    meta: {
      title: `${businessName} - Professional Landscaping`,
      description: `Professional landscaping services by ${businessName}. Contact us today for a free quote.`,
    },
    nav: {
      id: 'nav', template: 'nav-sticky-organic',
      content: {
        logo: businessName,
        links: [
          { text: 'Home', url: '/' },
          { text: 'Services', url: '/services' },
          { text: 'Gallery', url: '/gallery' },
          { text: 'Contact', url: '/contact' },
        ],
        ctaText: 'Get a Quote', ctaLink: '/contact',
      },
    },
    footer: {
      id: 'footer', template: 'footer-4col-dark',
      content: { logo: businessName, tagline: content.footer?.tagline || `Professional landscaping you can trust`, services: footerServices, phone, email, hours: hoursText },
    },
    pages: [
      {
        filename: 'index.html',
        meta: { title: `${businessName} - Professional Landscaping`, description: 'Homepage' },
        sections: [
          { id: 'hero', template: 'hero-split-portrait', content: {
            badge: hero.badge || `Welcome to ${businessName}`,
            headline: hero.headline || 'Your Outdoor Space Deserves the Best',
            highlightText: hero.highlightText || 'Best',
            subtitle: hero.subtitle || `Professional landscaping services for your property.`,
            ctaText: 'Get a Free Quote', ctaLink: '/contact',
            ctaText2: 'See Our Work', ctaLink2: '/gallery',
            portraitImage: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800',
            bgImage: 'https://images.unsplash.com/photo-1558904541-efa843a96f01?w=1600',
            floatBadge: hero.floatBadge || '10+',
            floatBadgeLabel: hero.floatBadgeLabel || 'Years Experience',
          }},
          { id: 'estimate', template: 'lead-magnet-teaser-landscaping', content: {
            badge: 'AI Design Preview',
            headline: hero.leadMagnetHeadline || 'See Your Dream Yard Before We Break Ground',
            subheadline: hero.leadMagnetSubheadline || 'Enter your address, pick your features, and get an AI-generated design plus instant cost estimate.',
            ctaText: hero.leadMagnetCtaText || 'Design My Yard',
          }},
          { id: 'importance', template: 'importance-split', content: {
            badge: importance.badge || 'Why It Matters',
            headline: importance.headline || 'Why Your Outdoor Space Matters',
            body1: importance.body1 || `Your outdoor space is an extension of your home.`,
            body2: importance.body2 || `At ${businessName}, we bring expertise to every project.`,
            highlights: importance.highlights || [
              { icon: '🌿', text: 'Expert plant selection and care' },
              { icon: '💧', text: 'Water-smart irrigation solutions' },
              { icon: '🌞', text: 'Year-round beauty guaranteed' },
              { icon: '🏡', text: 'Increases property value' },
            ],
            image: 'https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800',
            imageAlt: 'Beautiful landscaped outdoor space',
          }},
          { id: 'services', template: 'services-carousel', content: {
            title: 'What We Do',
            subtitle: 'Comprehensive outdoor services for every property',
            services,
          }},
          { id: 'reviews', template: 'review-marquee', content: { reviews } },
          { id: 'transformations', template: 'before-after-cards', content: {
            title: 'Our Transformations',
            subtitle: 'Click each card to reveal the stunning before & after',
            cards: transformations,
          }},
          { id: 'cta', template: 'cta-card', content: {
            headline: 'Ready for a Stunning Transformation?',
            subtitle: `Let us turn your vision into reality. Contact us today for a free consultation.`,
            ctaText: 'Get a Free Quote', ctaLink: '/contact',
            ctaText2: 'View Our Work', ctaLink2: '/gallery',
          }},
        ],
      },
      {
        filename: 'services.html',
        meta: { title: `Services | ${businessName}`, description: 'Services page' },
        sections: [
          { id: 'services', template: 'services-carousel', content: { title: 'Our Services', subtitle: 'From concept to creation, we handle everything', services } },
          { id: 'benefits', template: 'benefits-cards', content: { title: `Why Choose ${businessName}`, subtitle: 'We bring more than just great service', benefits } },
          { id: 'cta', template: 'cta-card', content: { headline: 'Not Sure Which Service You Need?', subtitle: 'Our team will help you figure out the right plan. Reach out for a free consultation.', ctaText: 'Get a Free Quote', ctaLink: '/contact', ctaText2: 'View Our Work', ctaLink2: '/gallery' } },
        ],
      },
      {
        filename: 'gallery.html',
        meta: { title: `Gallery | ${businessName}`, description: 'Gallery page' },
        sections: [
          { id: 'gallery', template: 'gallery-filtered', content: {
            title: 'Recent Projects', subtitle: 'Browse our finest work across all service categories', highlight: 'Projects',
            categories: ['All', 'Garden Design', 'Hardscape', 'Lawn Care', 'Lighting', 'Maintenance'],
            items: LANDSCAPE_PHOTO_IDS.map((id, i) => ({
              url: `https://images.unsplash.com/${id}?w=800`,
              title: transformations[i % transformations.length]?.title || `Project ${i + 1}`,
              category: ['Garden Design', 'Hardscape', 'Lawn Care', 'Lighting', 'Garden Design', 'Maintenance', 'Garden Design', 'Hardscape'][i % 8],
            })),
          }},
          { id: 'cta', template: 'cta-card', content: { headline: 'Ready to Transform Your Space?', subtitle: "Book a free consultation and let's design your dream outdoor space.", ctaText: 'Get a Free Quote', ctaLink: '/contact', ctaText2: 'View Services', ctaLink2: '/services' } },
        ],
      },
      {
        filename: 'contact.html',
        meta: { title: `Contact | ${businessName}`, description: 'Contact page' },
        sections: [
          { id: 'contact', template: 'contact-split', content: {
            formTitle: 'Tell Us About Your Project',
            formSubtitle: "Fill out the form and we'll get back to you within 24 hours",
            submitText: 'Request Free Quote',
            phone, phoneClean, email, hours: hoursText, serviceArea: areaText, businessName,
            highlights: contactHighlights,
          }},
        ],
      },
    ],
  };
}

function buildOrganicMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList }) {
  const servicesHint = servicesList.slice(0, 5).join(', ');

  return `You are a website copywriter for landscaping and outdoor service businesses. Return ONLY text content as JSON — no HTML, no structure, just the words.

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation.

== BUSINESS INFO ==
${businessInfo}

Return this exact JSON with real, compelling content for this specific business:

{
  "hero": {
    "badge": "3-4 word welcome line",
    "headline": "Main headline (without the highlight word)",
    "highlightText": "One key word to highlight (e.g. Landscapes, Gardens, Outdoors)",
    "subtitle": "2-3 sentence value proposition specific to this business",
    "floatBadge": "10+",
    "floatBadgeLabel": "Years Experience",
    "leadMagnetHeadline": "See Your Dream Yard Before We Break Ground",
    "leadMagnetSubheadline": "Enter your address, pick your features, and get an AI-generated design plus instant cost estimate.",
    "leadMagnetCtaText": "Design My Yard"
  },
  "importance": {
    "badge": "Why It Matters",
    "headline": "Why Your Outdoor Space Matters",
    "body1": "First paragraph about property value, curb appeal, or lifestyle quality",
    "body2": "Second paragraph about what makes this business different",
    "highlights": [
      { "icon": "🌿", "text": "Highlight about quality or plant health" },
      { "icon": "💧", "text": "Highlight about water-smart or sustainable practices" },
      { "icon": "🌞", "text": "Highlight about year-round care" },
      { "icon": "🏡", "text": "Highlight about property value or lifestyle" }
    ]
  },
  "services": [
    { "title": "Service name", "category": "Category", "price": "From $XXX", "features": ["Feature 1", "Feature 2", "Feature 3"] }
  ],
  "reviews": [
    { "name": "Sarah M.", "text": "Realistic review mentioning a specific service", "date": "2 weeks ago" },
    { "name": "James R.", "text": "Review about outdoor results and quality", "date": "1 month ago" },
    { "name": "Linda K.", "text": "Review about attention to detail", "date": "3 weeks ago" },
    { "name": "Tom & Pat", "text": "Review about transformation of outdoor space", "date": "2 months ago" },
    { "name": "Rachel W.", "text": "Review about experience from start to finish", "date": "1 week ago" },
    { "name": "Mike D.", "text": "Positive review about the overall experience", "date": "5 days ago" }
  ],
  "transformations": [
    { "title": "Project type (e.g. Backyard Oasis)", "description": "Brief description of transformation" },
    { "title": "Project type (e.g. Front Garden Redesign)", "description": "Brief description" },
    { "title": "Project type (e.g. Patio & Hardscape)", "description": "Brief description" }
  ],
  "footer": { "tagline": "Short compelling tagline for this business" },
  "contact": {
    "highlights": [
      { "text": "Why choose us point 1 specific to this business" },
      { "text": "Why choose us point 2" },
      { "text": "Why choose us point 3" }
    ]
  },
  "servicesPage": {
    "benefits": [
      { "icon": "🌿", "title": "Benefit title", "description": "Why this matters to the customer" },
      { "icon": "💚", "title": "Benefit title", "description": "Why this matters" },
      { "icon": "🏆", "title": "Benefit title", "description": "Why this matters" }
    ]
  }
}

RULES:
1. Return ONLY the JSON object. No other text.
2. Write specific, compelling content tailored to ${businessName} and their services: ${servicesHint}.
3. Services array must use the provided services (3-5 items).
4. Reviews must sound realistic and mention specific services or outcomes.
5. JSON must be parseable by JSON.parse().`;
}

// ── Auto-detailing: multi-page prompt ────────────────────────────────
function buildAutoDetailingMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList, images }) {
  const DEFAULT_AUTO_SERVICES = [
    'Full Detail', 'Ceramic Coating', 'Paint Correction', 'Interior Detail',
    'Exterior Detail', 'Window Tint', 'Headlight Restoration', 'Engine Bay Clean',
  ];
  const heroBg = images?.hero?.[0] || 'https://images.unsplash.com/photo-1552519507-da3b142a6f3e?w=1920';
  const cards  = images?.cards || [];
  const gc = (i) => cards[i] || images?.hero?.[i + 1] || null;

  // Auto-detailing fallback Unsplash IDs (verified car photos, no cleaning images)
  const AUTO_GALLERY_FALLBACKS = [
    'photo-1552519507-da3b142a6f3e',
    'photo-1601362840469-51e4d8d58785',
    'photo-1502877338535-766e1452684a',
    'photo-1616455579100-2ceaa4eb2d37',
    'photo-1549317661-bd32c8ce0db2',
    'photo-1580273916550-e323be2ae537',
  ];
  // Gallery images: use Pexels cards[6-11], fall back to known auto-detailing Unsplash IDs
  const gg = (i) => cards[6 + i] || `https://images.unsplash.com/${AUTO_GALLERY_FALLBACKS[i % AUTO_GALLERY_FALLBACKS.length]}?w=800`;

  const paddedServicesList = [...servicesList];
  for (const svc of DEFAULT_AUTO_SERVICES) {
    if (paddedServicesList.length >= 6) break;
    const alreadyHas = paddedServicesList.some(s => s.toLowerCase().includes(svc.toLowerCase().split(' ')[0]));
    if (!alreadyHas) paddedServicesList.push(svc);
  }
  const servicesJson = JSON.stringify(paddedServicesList.slice(0, 6).map(s => ({ text: s })));

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
        { "text": "Home",     "url": "/" },
        { "text": "Services", "url": "/services" },
        { "text": "Gallery",  "url": "/gallery" },
        { "text": "Contact",  "url": "/contact" }
      ],
      "ctaText": "Book Now",
      "ctaLink": "/booking"
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
          "template": "hero-auto-split",
          "content": {
            "badge": "Premium Auto Detailing",
            "headline": "Main headline WITHOUT the highlight word (3-5 words max, e.g. 'Your Car, Perfectly')",
            "highlightText": "One highlight word (e.g. 'Detailed')",
            "subtitle": "Compelling subtitle 1-2 sentences about this business",
            "ctaText": "Book Your Detail",
            "ctaLink": "/booking",
            "ctaText2": "View Our Work",
            "ctaLink2": "/gallery",
            "backgroundImage": "${heroBg}",
            "heroImage1": "${gc(0) || 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=600&q=80'}",
            "heroImage2": "${gc(1) || 'https://images.unsplash.com/photo-1616455579100-2ceaa4eb2d37?w=600&q=80'}",
            "yearsText": "10+ Years",
            "locationText": "Serving ${areaText || 'Your Area'}"
          }
        },
        {
          "id": "estimate",
          "template": "lead-magnet-teaser-auto",
          "content": {
            "badge": "Free Instant Quote",
            "headline": "See Exactly What Your Detail Will Cost",
            "subheadline": "Click the areas of your vehicle you want detailed — get an itemized price breakdown in seconds.",
            "ctaText": "Build My Custom Quote"
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
          "id": "services",
          "template": "services-carousel",
          "content": {
            "title": "Our Detailing Packages",
            "subtitle": "Premium services tailored to your vehicle",
            "services": [
              { "title": "First service from list", "category": "Category", "price": "From $XXX", "image": "${gc(0) || 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=600'}", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": true },
              { "title": "Second service from list", "category": "Category", "price": "From $XXX", "image": "${gc(1) || 'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=600'}", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false },
              { "title": "Third service from list", "category": "Category", "price": "From $XXX", "image": "${gc(2) || 'https://images.unsplash.com/photo-1616455579100-2ceaa4eb2d37?w=600'}", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false }
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
          "id": "benefits",
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
          "id": "cta",
          "template": "cta-gradient-full",
          "content": {
            "badge": "Limited Time",
            "headline": "Compelling CTA headline for auto detailing",
            "subtitle": "Supporting text that drives action",
            "ctaText": "Book Now",
            "ctaLink": "/booking",
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
              { "title": "First service from list", "category": "Category", "price": "From $XXX", "image": "${gc(3) || gc(0) || 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=600'}", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": true },
              { "title": "Second service from list", "category": "Category", "price": "From $XXX", "image": "${gc(4) || gc(1) || 'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=600'}", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false },
              { "title": "Third service from list", "category": "Category", "price": "From $XXX", "image": "${gc(5) || gc(2) || 'https://images.unsplash.com/photo-1616455579100-2ceaa4eb2d37?w=600'}", "features": ["Feature 1", "Feature 2", "Feature 3"], "recommended": false }
            ]
          }
        },
        {
          "id": "benefits",
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
              { "url": "${gg(0)}", "title": "Project description 1", "category": "Full Detail" },
              { "url": "${gg(1)}", "title": "Project description 2", "category": "Ceramic Coating" },
              { "url": "${gg(2)}", "title": "Project description 3", "category": "Paint Correction" },
              { "url": "${gg(3)}", "title": "Project description 4", "category": "Interior" },
              { "url": "${gg(4)}", "title": "Project description 5", "category": "Full Detail" },
              { "url": "${gg(5)}", "title": "Project description 6", "category": "Ceramic Coating" }
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
2. All image URLs ("backgroundImage", "image", "url") are pre-filled with verified car/auto photos — do NOT modify any URL field. Keep every URL exactly as-is. Only write the text fields (titles, descriptions, categories, quotes, etc.).
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to this business.
4. Reviews and testimonials should sound realistic and specific to the services offered.
5. Include 3-4 services based on what was provided.
6. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

// ── Default layout (dark theme, generic service businesses) ─────────
function defaultSections({ businessName, phone, phoneClean, images }) {
  // Use pre-fetched Pexels URLs when available; fall back to placeholder for Claude to fill
  const heroImg  = images?.hero?.[0]  || 'https://images.unsplash.com/RELEVANT-PHOTO?w=1920';
  const cards    = images?.cards      || [];
  const gc = (i) => cards[i] || 'https://images.unsplash.com/RELEVANT-PHOTO?w=800';

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
        "backgroundImage": "${heroImg}"
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
            "image": "${gc(0)}",
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
          { "image": "${gc(1)}", "title": "Project type", "caption": "Brief caption", "large": true },
          { "image": "${gc(2)}", "title": "Project type", "caption": "Brief caption", "large": false },
          { "image": "${gc(3)}", "title": "Project type", "caption": "Brief caption", "large": false },
          { "image": "${gc(4)}", "title": "Project type", "caption": "Brief caption", "large": false },
          { "image": "${gc(5)}", "title": "Project type", "caption": "Brief caption", "large": true }
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
  const DEFAULT_HANDYMAN_SERVICES = [
    'Kitchen Remodel', 'Bathroom Remodel', 'Flooring', 'Painting',
    'Deck Building', 'Drywall', 'Plumbing Repair', 'Electrical',
  ];
  const paddedServicesList = [...servicesList];
  for (const svc of DEFAULT_HANDYMAN_SERVICES) {
    if (paddedServicesList.length >= 6) break;
    const alreadyHas = paddedServicesList.some(s => s.toLowerCase().includes(svc.toLowerCase().split(' ')[0]));
    if (!alreadyHas) paddedServicesList.push(svc);
  }
  const servicesJson = JSON.stringify(paddedServicesList.slice(0, 6).map(s => ({ text: s })));

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
        { "text": "Home",     "url": "/" },
        { "text": "Services", "url": "/services" },
        { "text": "Projects", "url": "/gallery" },
        { "text": "Contact",  "url": "/contact" }
      ],
      "ctaText": "Get an Estimate",
      "ctaLink": "/contact"
    }
  },
  "footer": {
    "id": "footer",
    "template": "footer-4col-dark",
    "content": {
      "logo": "${businessName}",
      "tagline": "Craftsmanship you can trust.",
      "services": ${servicesJson},
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
            "ctaLink": "/contact",
            "ctaText2": "Our Work",
            "ctaLink2": "/gallery",
            "backgroundImage": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1920"
          }
        },
        {
          "id": "estimate",
          "template": "lead-magnet-teaser-renovation",
          "content": {
            "badge": "Instant Project Estimate",
            "headline": "Get a Ballpark Before You Commit to Anything",
            "subheadline": "Answer a few quick questions about your project and get an honest cost range — no sales pressure.",
            "ctaText": "Estimate My Project"
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
            "ctaLink": "/contact"
          }
        },
        {
          "id": "ctacard",
          "template": "cta-card",
          "content": {
            "headline": "READY TO GET STARTED?",
            "subtitle": "Contact us today for a free, no-obligation estimate for your project.",
            "ctaText": "Request Estimate",
            "ctaLink": "/contact",
            "ctaText2": "View Portfolio",
            "ctaLink2": "/gallery"
          }
        }
      ]
    },
    {
      "filename": "services.html",
      "meta": { "title": "Services | ${businessName}", "description": "Services page SEO description" },
      "sections": [
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
            "ctaLink2": "/contact"
          }
        }
      ]
    },
    {
      "filename": "gallery.html",
      "meta": { "title": "Projects | ${businessName}", "description": "Gallery page SEO description" },
      "sections": [
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
            "ctaLink": "/contact",
            "ctaText2": "View Services",
            "ctaLink2": "/services"
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

// ── Photography: 3 style variants, chosen randomly at generation time ──
// Variant is embedded as "themeId" in the schema so re-renders stay consistent.
// generateV2.js reads themeId → picks the matching sub-theme from themes.js.
//
// Warm  — hero-fullscreen-light, masonry gallery, services-cards-3col
// Dark  — hero-fullscreen-dark, gallery-filtered, services-carousel, features-icon-row
// Clean — hero-split-portrait, masonry gallery, services-cards-3col

const PHOTOGRAPHY_PHOTO_IDS = [
  'photo-1519741497674-611481863552', // golden hour wedding
  'photo-1519225421980-715cb0215aed', // natural light portrait
  'photo-1606216794074-735e91aa2c92', // studio session
  'photo-1542038784456-1ea8e935640e', // commercial product
  'photo-1494790108377-be9c29b29330', // editorial headshot
  'photo-1537633552985-df8429e8048b', // live event
  'photo-1511285560929-80b456fea0bc', // wedding ceremony
  'photo-1534528741775-53994a69daeb', // fashion portrait
  'photo-1465495976277-4387d4b0b4c6', // reception details
  'photo-1529634597503-139d3726fed5', // engagement shoot
  'photo-1606800052052-a08af7148866', // moody lighting
  'photo-1583939003579-730e3918a45a', // outdoor lifestyle
];

function buildPhotographyMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList }) {
  const servicesJson = JSON.stringify(servicesList.slice(0, 5).map(s => ({ text: s })));
  const masonryItemsJson = JSON.stringify(
    PHOTOGRAPHY_PHOTO_IDS.slice(0, 9).map((id, i) => ({
      url: `https://images.unsplash.com/${id}?w=800`,
      caption: ['Golden Hour Romance', 'Natural Light Portrait', 'Studio Session', 'Commercial Shoot', 'Editorial Headshot', 'Live Event', 'Wedding Ceremony', 'Fashion Portrait', 'Reception Details'][i],
    }))
  );

  // Pick a random style variant — stored in schema so re-renders stay consistent
  const variant = 'warm'; // locked to warm — consistent colors across all photography generations

  const themeId = `photography-${variant}`;

  // ── Variant-specific home page sections ──────────────────────────────

  const warmHomeSections = `[
        {
          "id": "hero",
          "template": "hero-fullscreen-light",
          "content": {
            "headline": "Short poetic photography tagline (4-6 words, uppercase-friendly, e.g. 'Photography is Poetry')",
            "subtitle": "4-6 word descriptor e.g. 'Modern Portrait & Wedding Photography'",
            "backgroundImage": "https://images.unsplash.com/photo-1519741497674-611481863552?w=1920",
            "overlayOpacity": "0.12"
          }
        },
        {
          "id": "estimate",
          "template": "lead-magnet-photography",
          "content": {
            "headline": "Find Your Perfect Package",
            "subheadline": "Answer 4 quick questions and discover which package fits your vision.",
            "ctaText": "Find My Package"
          }
        },
        {
          "id": "gallery-home",
          "template": "gallery-masonry-full-width",
          "content": {
            "eyebrow": "Portfolio",
            "title": "Recent Work",
            "ctaText": "View Full Portfolio",
            "ctaLink": "/portfolio",
            "items": ${masonryItemsJson}
          }
        },
        {
          "id": "reviews",
          "template": "review-marquee",
          "content": {
            "reviews": [
              { "name": "Sarah & James", "stars": 5, "text": "Specific 5-star wedding/portrait review for this business", "date": "2 weeks ago", "avatarColor": "#c2410c" },
              { "name": "Michael T.", "stars": 5, "text": "Review about professional headshots or corporate work", "date": "1 week ago", "avatarColor": "#1d4ed8" },
              { "name": "The Johnson Family", "stars": 5, "text": "Family portrait review — mention comfort and natural shots", "date": "3 weeks ago", "avatarColor": "#7c3aed" },
              { "name": "Emily R.", "stars": 5, "text": "Review about creative direction and final photos", "date": "4 days ago", "avatarColor": "#b45309" },
              { "name": "David K.", "stars": 5, "text": "Review about event coverage being unobtrusive", "date": "1 month ago", "avatarColor": "#92400e" }
            ]
          }
        },
        {
          "id": "packages",
          "template": "services-cards-3col",
          "content": {
            "title": "Photography Packages",
            "subtitle": "Tailored packages for every occasion",
            "services": [
              { "title": "Portrait Session",   "category": "Portraits",  "price": "From $350",   "image": "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800", "features": ["1 Hour Session", "30 Edited Photos", "Online Gallery"], "link": "/services", "recommended": false },
              { "title": "Wedding Collection", "category": "Weddings",   "price": "From $2,500", "image": "https://images.unsplash.com/photo-1519741497674-611481863552?w=800", "features": ["8 Hours Coverage", "500+ Edited Photos", "Engagement Session"], "link": "/services", "recommended": true },
              { "title": "Commercial Shoot",   "category": "Commercial", "price": "From $800",   "image": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=800", "features": ["Half-Day Shoot", "Commercial Licensing", "Retouched Images"], "link": "/services", "recommended": false }
            ]
          }
        },
        {
          "id": "cta-home",
          "template": "cta-gradient-full",
          "content": {
            "badge": "Limited Availability",
            "headline": "Compelling urgency headline about booking (7-10 words)",
            "subtitle": "1-2 sentence value proposition",
            "ctaText": "Book Now",
            "ctaLink": "/booking",
            "ctaText2": "See All Packages",
            "ctaLink2": "/services",
            "features": [
              { "text": "Same-week booking available" },
              { "text": "Online gallery delivery" },
              { "text": "Print-ready files included" }
            ]
          }
        }
      ]`;

  const darkHomeSections = `[
        {
          "id": "hero",
          "template": "hero-fullscreen-dark",
          "content": {
            "headline": "Main dramatic headline WITHOUT the highlight word (e.g. 'Moments That Last')",
            "highlightText": "One cinematic word to highlight in color (e.g. 'Last' or 'Forever')",
            "subtitle": "1-2 sentences about the studio's cinematic, documentary style",
            "ctaText": "Book Your Session",
            "ctaLink": "/contact",
            "ctaText2": "View Portfolio",
            "ctaLink2": "/portfolio",
            "backgroundImage": "https://images.unsplash.com/photo-1606800052052-a08af7148866?w=1920"
          }
        },
        {
          "id": "reviews",
          "template": "review-marquee",
          "content": {
            "reviews": [
              { "name": "Sarah & James", "stars": 5, "text": "Specific 5-star wedding/portrait review for this business", "date": "2 weeks ago", "avatarColor": "#c2410c" },
              { "name": "Michael T.", "stars": 5, "text": "Review about professional headshots or corporate work", "date": "1 week ago", "avatarColor": "#1d4ed8" },
              { "name": "The Johnson Family", "stars": 5, "text": "Family portrait review — mention comfort and natural shots", "date": "3 weeks ago", "avatarColor": "#7c3aed" },
              { "name": "Emily R.", "stars": 5, "text": "Review about creative direction and final photos", "date": "4 days ago", "avatarColor": "#b45309" },
              { "name": "David K.", "stars": 5, "text": "Review about event coverage being unobtrusive", "date": "1 month ago", "avatarColor": "#92400e" }
            ]
          }
        },
        {
          "id": "features",
          "template": "features-icon-row",
          "content": {
            "features": [
              { "icon": "📷", "title": "Cinematic Style", "text": "Short description of the studio's signature editing and visual approach" },
              { "icon": "🎨", "title": "Hand-Edited", "text": "Every image individually color-graded for our signature look" },
              { "icon": "⚡", "title": "Fast Delivery", "text": "Online gallery delivered within 7 days of your session" },
              { "icon": "🏆", "title": "Award-Winning", "text": "Recognized nationally for creative vision and technical excellence" }
            ]
          }
        },
        {
          "id": "packages",
          "template": "services-carousel",
          "content": {
            "title": "Photography Packages",
            "subtitle": "Tailored packages for every occasion",
            "services": [
              { "title": "Portrait Session",   "category": "Portraits",  "price": "From $350",   "image": "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800", "features": ["1 Hour Session", "30 Edited Photos", "Online Gallery", "Print Release"], "recommended": false },
              { "title": "Wedding Collection", "category": "Weddings",   "price": "From $2,500", "image": "https://images.unsplash.com/photo-1519741497674-611481863552?w=800", "features": ["8 Hours Coverage", "500+ Edited Photos", "Engagement Session", "Second Shooter"], "recommended": true },
              { "title": "Commercial Shoot",   "category": "Commercial", "price": "From $800",   "image": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=800", "features": ["Half-Day Shoot", "Commercial Licensing", "Retouched Images", "Brand Consultation"], "recommended": false },
              { "title": "Event Coverage",     "category": "Events",     "price": "From $600",   "image": "https://images.unsplash.com/photo-1537633552985-df8429e8048b?w=800", "features": ["4 Hours Coverage", "200+ Edited Photos", "Fast Turnaround", "Online Gallery"], "recommended": false }
            ]
          }
        },
        {
          "id": "gallery-home",
          "template": "gallery-filtered",
          "content": {
            "title": "Our Work",
            "highlight": "Work",
            "subtitle": "A glimpse into our latest sessions",
            "categories": ["All", "Weddings", "Portraits", "Events", "Commercial"],
            "items": [
              { "url": "https://images.unsplash.com/photo-1519741497674-611481863552?w=800", "title": "Golden Hour Romance",      "category": "Weddings"   },
              { "url": "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800", "title": "Natural Light Portrait",   "category": "Portraits"  },
              { "url": "https://images.unsplash.com/photo-1606800052052-a08af7148866?w=800", "title": "Portrait Moody Lighting",  "category": "Portraits"  },
              { "url": "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=800", "title": "Wedding Ceremony",         "category": "Weddings"   },
              { "url": "https://images.unsplash.com/photo-1537633552985-df8429e8048b?w=800", "title": "Live Events",              "category": "Events"     },
              { "url": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=800", "title": "Commercial Shoot",         "category": "Commercial" }
            ]
          }
        },
        {
          "id": "cta-home",
          "template": "cta-gradient-full",
          "content": {
            "badge": "Limited Availability",
            "headline": "Compelling urgency headline about booking (7-10 words)",
            "subtitle": "1-2 sentence value proposition",
            "ctaText": "Book Now",
            "ctaLink": "/booking",
            "ctaText2": "See All Packages",
            "ctaLink2": "/services",
            "features": [
              { "text": "Same-week booking available" },
              { "text": "Online gallery delivery" },
              { "text": "Print-ready files included" }
            ]
          }
        }
      ]`;

  const cleanHomeSections = `[
        {
          "id": "hero",
          "template": "hero-split-portrait",
          "content": {
            "badge": "3-4 word welcome line e.g. 'Portrait & Wedding Studio'",
            "headline": "Main headline WITHOUT the highlight word (short, elegant, e.g. 'Stories Worth')",
            "highlightText": "One word to italicize/highlight (e.g. 'Telling')",
            "subtitle": "2-3 sentences about the studio's personal, relaxed approach to photography",
            "ctaText": "Book a Session",
            "ctaLink": "/contact",
            "ctaText2": "View Portfolio",
            "ctaLink2": "/portfolio",
            "portraitImage": "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800",
            "floatBadge": "500+",
            "floatBadgeLabel": "Sessions Completed"
          }
        },
        {
          "id": "reviews",
          "template": "review-marquee",
          "content": {
            "reviews": [
              { "name": "Sarah & James", "stars": 5, "text": "Specific 5-star wedding/portrait review for this business", "date": "2 weeks ago", "avatarColor": "#c2410c" },
              { "name": "Michael T.", "stars": 5, "text": "Review about professional headshots or corporate work", "date": "1 week ago", "avatarColor": "#1d4ed8" },
              { "name": "The Johnson Family", "stars": 5, "text": "Family portrait review — mention comfort and natural shots", "date": "3 weeks ago", "avatarColor": "#7c3aed" },
              { "name": "Emily R.", "stars": 5, "text": "Review about creative direction and final photos", "date": "4 days ago", "avatarColor": "#b45309" },
              { "name": "David K.", "stars": 5, "text": "Review about event coverage being unobtrusive", "date": "1 month ago", "avatarColor": "#92400e" }
            ]
          }
        },
        {
          "id": "packages",
          "template": "services-cards-3col",
          "content": {
            "title": "Photography Packages",
            "subtitle": "Tailored packages for every occasion",
            "services": [
              { "title": "Portrait Session",   "category": "Portraits",  "price": "From $350",   "image": "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800", "features": ["1 Hour Session", "30 Edited Photos", "Online Gallery"], "link": "/services", "recommended": false },
              { "title": "Wedding Collection", "category": "Weddings",   "price": "From $2,500", "image": "https://images.unsplash.com/photo-1519741497674-611481863552?w=800", "features": ["8 Hours Coverage", "500+ Edited Photos", "Engagement Session"], "link": "/services", "recommended": true },
              { "title": "Commercial Shoot",   "category": "Commercial", "price": "From $800",   "image": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=800", "features": ["Half-Day Shoot", "Commercial Licensing", "Retouched Images"], "link": "/services", "recommended": false }
            ]
          }
        },
        {
          "id": "gallery-home",
          "template": "gallery-masonry-full-width",
          "content": {
            "eyebrow": "Portfolio",
            "title": "Recent Work",
            "ctaText": "View Full Portfolio",
            "ctaLink": "/portfolio",
            "items": ${masonryItemsJson}
          }
        },
        {
          "id": "cta-home",
          "template": "cta-gradient-full",
          "content": {
            "badge": "Now Booking",
            "headline": "Compelling headline inviting client to start their photography journey",
            "subtitle": "1-2 sentence warm, personal invitation to book",
            "ctaText": "Book Now",
            "ctaLink": "/booking",
            "ctaText2": "See All Packages",
            "ctaLink2": "/services",
            "features": [
              { "text": "Personalized consultation included" },
              { "text": "Online gallery delivery" },
              { "text": "Print-ready files" }
            ]
          }
        }
      ]`;

  const homeSections = variant === 'dark' ? darkHomeSections
    : variant === 'clean' ? cleanHomeSections
    : warmHomeSections;

  return `You are a website content generator for photography businesses. Generate a JSON object for a MULTI-PAGE website with 5 separate pages.

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation. Just the JSON object.

== BUSINESS INFO ==
${businessInfo}

== YOUR TASK ==
Generate a JSON object with this EXACT structure. Fill in compelling, professional content for this specific photography business.

{
  "meta": { "title": "${businessName} - Professional Photography", "description": "SEO meta description 150-160 chars" },
  "multiPage": true,
  "themeId": "${themeId}",
  "nav": {
    "id": "nav",
    "template": "nav-sticky-dark",
    "content": {
      "logo": "${businessName}",
      "links": [
        { "text": "Home",      "url": "/" },
        { "text": "Portfolio", "url": "/portfolio" },
        { "text": "Services",  "url": "/services" },
        { "text": "About",     "url": "/about" },
        { "text": "Contact",   "url": "/contact" }
      ],
      "ctaText": "Book a Session",
      "ctaLink": "/contact"
    }
  },
  "footer": {
    "id": "footer",
    "template": "footer-4col-dark",
    "content": {
      "logo": "${businessName}",
      "tagline": "Short poetic tagline for this photography business",
      "services": ${servicesJson},
      "phone": "${phone}",
      "email": "${email}",
      "hours": "${hoursText}"
    }
  },
  "pages": [
    {
      "filename": "index.html",
      "meta": { "title": "${businessName} — Photography", "description": "Homepage description" },
      "sections": ${homeSections}
    },
    {
      "filename": "about.html",
      "meta": { "title": "About | ${businessName}", "description": "About page description" },
      "sections": [
        {
          "id": "about-banner",
          "template": "hero-page-banner",
          "content": {
            "title": "About Us",
            "subtitle": "The story behind the lens",
            "bgImage": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=1920"
          }
        },
        {
          "id": "about-split",
          "template": "importance-split",
          "content": {
            "badge": "Our Philosophy",
            "headline": "We Don't Just Take Photos — We Tell Stories",
            "body1": "First paragraph: personal photography philosophy, approach to capturing authentic moments",
            "body2": "Second paragraph: what makes this studio distinctive — style, process, dedication",
            "highlights": [
              { "icon": "📷", "text": "10+ years professional photography experience" },
              { "icon": "🏆", "text": "Award-winning work in national publications" },
              { "icon": "⚡", "text": "Online gallery delivery within 7 days" },
              { "icon": "❤️", "text": "Personal, relaxed sessions tailored to you" }
            ],
            "image": "https://images.unsplash.com/photo-1606216794074-735e91aa2c92?w=800",
            "imageAlt": "Photographer at work"
          }
        },
        {
          "id": "about-stats",
          "template": "features-icon-row",
          "content": {
            "features": [
              { "icon": "📷", "title": "500+", "text": "Sessions Completed" },
              { "icon": "❤️", "title": "50+",  "text": "5-Star Reviews" },
              { "icon": "⏱️", "title": "7-Day", "text": "Delivery Time" },
              { "icon": "🏆", "title": "100%",  "text": "Satisfaction Guaranteed" }
            ]
          }
        },
        {
          "id": "about-cta",
          "template": "cta-card",
          "content": {
            "headline": "Let's Work Together",
            "subtitle": "We'd love to be part of your story.",
            "ctaText": "Book a Session",
            "ctaLink": "/contact"
          }
        }
      ]
    },
    {
      "filename": "portfolio.html",
      "meta": { "title": "Portfolio | ${businessName}", "description": "Portfolio page description" },
      "sections": [
        {
          "id": "portfolio-banner",
          "template": "hero-page-banner",
          "content": {
            "title": "Portfolio",
            "subtitle": "Weddings · Portraits · Events · Commercial",
            "bgImage": "https://images.unsplash.com/photo-1519741497674-611481863552?w=1920"
          }
        },
        {
          "id": "gallery-full",
          "template": "gallery-filtered",
          "content": {
            "title": "Our Work",
            "highlight": "Work",
            "categories": ["All", "Weddings", "Portraits", "Events", "Commercial", "Family"],
            "items": [
              { "url": "https://images.unsplash.com/photo-1519741497674-611481863552?w=800", "title": "Golden Hour Romance",       "category": "Weddings"   },
              { "url": "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800", "title": "Natural Light Portraits",  "category": "Portraits"  },
              { "url": "https://images.unsplash.com/photo-1606216794074-735e91aa2c92?w=800", "title": "Studio Session",           "category": "Commercial" },
              { "url": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=800", "title": "Product & Commercial",     "category": "Commercial" },
              { "url": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800", "title": "Editorial Headshots",      "category": "Portraits"  },
              { "url": "https://images.unsplash.com/photo-1537633552985-df8429e8048b?w=800", "title": "Live Events",              "category": "Events"     },
              { "url": "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=800", "title": "Wedding Ceremony",         "category": "Weddings"   },
              { "url": "https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=800", "title": "Family Portrait Outdoor",  "category": "Family"     },
              { "url": "https://images.unsplash.com/photo-1529634597503-139d3726fed5?w=800", "title": "Engagement Shoot",         "category": "Weddings"   },
              { "url": "https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=800", "title": "Wedding Reception Details","category": "Weddings"   },
              { "url": "https://images.unsplash.com/photo-1606800052052-a08af7148866?w=800", "title": "Portrait Moody Lighting",  "category": "Portraits"  },
              { "url": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800", "title": "Fashion Portrait",         "category": "Portraits"  }
            ]
          }
        },
        {
          "id": "portfolio-cta",
          "template": "cta-card",
          "content": {
            "headline": "Like What You See?",
            "subtitle": "Let's create something stunning together.",
            "ctaText": "Book a Session",
            "ctaLink": "/contact",
            "ctaText2": "View Packages",
            "ctaLink2": "/services"
          }
        }
      ]
    },
    {
      "filename": "services.html",
      "meta": { "title": "Services | ${businessName}", "description": "Services page description" },
      "sections": [
        {
          "id": "services-banner",
          "template": "hero-page-banner",
          "content": {
            "title": "Services & Packages",
            "subtitle": "Find the perfect package for your moment",
            "bgImage": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=1920"
          }
        },
        {
          "id": "services-list",
          "template": "services-carousel",
          "content": {
            "title": "Photography Packages",
            "subtitle": "Tailored packages for every occasion",
            "services": [
              { "title": "Portrait Session",   "category": "Portraits",  "price": "From $350",   "image": "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800", "features": ["1 Hour Session", "30 Edited Photos", "Online Gallery", "Print Release"], "recommended": false },
              { "title": "Wedding Collection", "category": "Weddings",   "price": "From $2,500", "image": "https://images.unsplash.com/photo-1519741497674-611481863552?w=800", "features": ["8 Hours Coverage", "500+ Edited Photos", "Engagement Session", "Second Shooter"], "recommended": true },
              { "title": "Commercial Shoot",   "category": "Commercial", "price": "From $800",   "image": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=800", "features": ["Half-Day Shoot", "Commercial Licensing", "Retouched Images", "Brand Consultation"], "recommended": false },
              { "title": "Event Coverage",     "category": "Events",     "price": "From $600",   "image": "https://images.unsplash.com/photo-1537633552985-df8429e8048b?w=800", "features": ["4 Hours Coverage", "200+ Edited Photos", "Fast Turnaround", "Online Gallery"], "recommended": false }
            ]
          }
        },
        {
          "id": "services-benefits",
          "template": "benefits-numbered",
          "content": {
            "title": "What's Included With Every Session",
            "subtitle": "Every booking comes with our full commitment to quality",
            "benefits": [
              { "title": "Professional Editing", "description": "Every image is hand-edited for color, exposure, and our signature cinematic style." },
              { "title": "Online Gallery", "description": "A beautiful, private online gallery to view, share, and download your high-res images." },
              { "title": "Print-Ready Files", "description": "Full-resolution files with a print release so you can create albums and wall art." },
              { "title": "Personal Consultation", "description": "Pre-shoot planning to ensure we capture exactly what you're looking for." }
            ]
          }
        },
        {
          "id": "services-testimonials",
          "template": "testimonials-3col",
          "content": {
            "title": "What Clients Say",
            "testimonials": [
              { "quote": "Specific wedding package testimonial about quality and experience", "author": "Sarah M.", "role": "Bride, June 2024", "rating": 5 },
              { "quote": "Portrait session testimonial about feeling comfortable and professional results", "author": "James L.", "role": "Actor Headshots", "rating": 5 },
              { "quote": "Corporate event testimonial about turnaround time and quality", "author": "Elena R.", "role": "Marketing Director", "rating": 5 }
            ]
          }
        },
        {
          "id": "services-cta",
          "template": "cta-card",
          "content": {
            "headline": "Ready to Book Your Session?",
            "subtitle": "Reach out for a free consultation — no pressure, just a conversation.",
            "ctaText": "Get in Touch",
            "ctaLink": "/contact"
          }
        }
      ]
    },
    {
      "filename": "contact.html",
      "meta": { "title": "Contact | ${businessName}", "description": "Contact page description" },
      "sections": [
        {
          "id": "contact",
          "template": "contact-split",
          "content": {
            "formTitle": "Book Your Session",
            "formSubtitle": "Tell us about your vision and we'll be in touch within 24 hours.",
            "submitText": "Send Inquiry",
            "phone": "${phone}",
            "phoneClean": "${phoneClean}",
            "email": "${email}",
            "hours": "${hoursText}",
            "serviceArea": "${areaText}",
            "businessName": "${businessName}",
            "highlights": [
              { "text": "Secure online booking and payment" },
              { "text": "Personalized pre-shoot consultation" },
              { "text": "Guaranteed delivery timelines" }
            ]
          }
        }
      ]
    }
  ]
}

== RULES ==
1. Return ONLY the JSON object. No other text.
2. Use the EXACT Unsplash photo IDs provided — do not invent new ones. You may adapt captions and titles.
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to ${businessName} and their services: ${servicesList.slice(0, 5).join(', ')}.
4. Reviews must sound realistic and mention specific photography services or outcomes.
5. Adjust package pricing based on the services provided if different from defaults.
6. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

// ============================================
// CLEANING MULTI-PAGE PROMPT
// 4 pages: Home, About, Services, Contact
// Sections modeled on Apex Carpet & Home Care template
// ============================================

function buildCleaningMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList, images }) {
  // Always generate 6 services — pad with common cleaning services if user provided fewer
  const DEFAULT_CLEANING_SERVICES = [
    'House Cleaning', 'Carpet Cleaning', 'Deep Cleaning',
    'Window Cleaning', 'Upholstery Cleaning', 'Tile & Grout Cleaning',
    'Move-In/Out Cleaning', 'Commercial Cleaning',
  ];
  const paddedServicesList = [...servicesList];
  for (const svc of DEFAULT_CLEANING_SERVICES) {
    if (paddedServicesList.length >= 6) break;
    const alreadyHas = paddedServicesList.some(s => s.toLowerCase().includes(svc.toLowerCase().split(' ')[0]));
    if (!alreadyHas) paddedServicesList.push(svc);
  }

  const servicesJson = JSON.stringify(paddedServicesList.slice(0, 6).map(s => ({ text: s })));

  // Verified cleaning Unsplash photo IDs (confirmed to load)
  const serviceImages = [
    'photo-1581578731548-c64695cc6952', // house cleaning
    'photo-1527515637-60eab1b86d1a',    // cleaning detail / supplies
    'photo-1584622650111-993a426fbf0a', // professional cleaner
    'photo-1581578731548-c64695cc6952', // house cleaning (rotate)
    'photo-1527515637-60eab1b86d1a',    // cleaning detail (rotate)
    'photo-1584622650111-993a426fbf0a', // professional cleaner (rotate)
  ];

  // Use Pexels card images for service carousel if available, otherwise fall back to Unsplash
  const pexelsCards = images?.cards || [];
  const serviceCarouselJson = JSON.stringify(
    paddedServicesList.slice(0, 6).map((svc, i) => ({
      title: svc,
      category: 'Cleaning',
      price: 'Call for Quote',
      image: pexelsCards[i + 2] || pexelsCards[i] || `https://images.unsplash.com/${serviceImages[i % serviceImages.length]}?w=800`,
      features: ['Certified Technicians', 'Eco-Friendly Products', 'Fast Dry Times', 'Satisfaction Guaranteed'],
      recommended: i === 0,
    }))
  );

  // Hero background + side images: Pexels if available, otherwise verified Unsplash cleaning photos
  const heroBg   = images?.hero?.[0]   || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1920&q=80';
  const heroImg1 = images?.cards?.[0]  || images?.hero?.[1] || 'https://images.unsplash.com/photo-1556909211-36987daf7b4d?w=600&q=80';
  const heroImg2 = images?.cards?.[1]  || 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80';
  const locationSnippet = [areaText].filter(Boolean)[0] || 'Your Area';

  return `You are a website content generator for professional cleaning businesses. Generate a JSON object for a MULTI-PAGE website with 4 separate pages.

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation. Just the JSON object.
IMPORTANT: Do NOT change any image URLs that are already provided in the template below — keep them exactly as-is.
IMPORTANT: Only fill in text fields that contain placeholder instructions like "Write a headline here".

== BUSINESS INFO ==
${businessInfo}

== YOUR TASK ==
Generate a JSON object with this EXACT structure. Fill in compelling, professional content tailored to this specific cleaning business.

{
  "meta": { "title": "${businessName} - Professional Cleaning Services", "description": "SEO meta description 150-160 chars" },
  "multiPage": true,
  "nav": {
    "id": "nav",
    "template": "nav-sticky-dark",
    "content": {
      "logo": "${businessName}",
      "links": [
        { "text": "Home",     "url": "/" },
        { "text": "About",    "url": "/about" },
        { "text": "Services", "url": "/services" },
        { "text": "Contact",  "url": "/contact" }
      ],
      "ctaText": "Get a Free Quote",
      "ctaLink": "/contact"
    }
  },
  "footer": {
    "id": "footer",
    "template": "footer-4col-dark",
    "content": {
      "logo": "${businessName}",
      "tagline": "Short trustworthy tagline for this cleaning business (10-15 words)",
      "services": ${servicesJson},
      "phone": "${phone}",
      "email": "${email}",
      "hours": "${hoursText}"
    }
  },
  "pages": [
    {
      "filename": "index.html",
      "meta": { "title": "${businessName} - Professional Cleaning", "description": "Homepage SEO description" },
      "sections": [
        {
          "id": "hero",
          "template": "hero-cleaning-split",
          "content": {
            "badge": "Professional Cleaning Services",
            "headline": "Punchy 4-6 word headline WITHOUT the highlight word",
            "highlightText": "1-2 highlight/accent words",
            "subtitle": "2-sentence description: what they clean, area served, key differentiator",
            "ctaText": "Get a Free Quote",
            "ctaLink": "/contact",
            "ctaText2": "Call ${phone}",
            "ctaLink2": "tel:${phoneClean}",
            "backgroundImage": "${heroBg}",
            "heroImage1": "${heroImg1}",
            "heroImage2": "${heroImg2}",
            "yearsText": "10+ Years",
            "locationText": "Serving ${locationSnippet}"
          }
        },
        {
          "id": "estimate",
          "template": "lead-magnet-teaser-cleaning",
          "content": {
            "badge": "Home Health Analyzer",
            "headline": "What's Hiding in Your Carpet?",
            "subheadline": "Drag the slider to see how much builds up over time — then claim your exclusive discount.",
            "ctaText": "Check My Carpet Health"
          }
        },
        {
          "id": "services",
          "template": "services-carousel",
          "content": {
            "title": "Our Services",
            "subtitle": "Professional cleaning solutions tailored to your needs",
            "services": ${serviceCarouselJson}
          }
        },
        {
          "id": "reviews",
          "template": "review-marquee",
          "content": {
            "reviews": [
              { "name": "Sarah J.", "stars": 5, "text": "Specific 5-star carpet or upholstery cleaning review mentioning before/after results", "date": "1 week ago", "avatarColor": "#1d4ed8" },
              { "name": "Michael T.", "stars": 5, "text": "Review about tile & grout or house cleaning — mention punctuality and professionalism", "date": "3 days ago", "avatarColor": "#059669" },
              { "name": "The Johnson Family", "stars": 5, "text": "Family review mentioning pet stain/odor removal or recurring cleaning service", "date": "2 weeks ago", "avatarColor": "#7c3aed" },
              { "name": "Emily R.", "stars": 5, "text": "Review about how thorough the technicians were — mention a specific room or area", "date": "5 days ago", "avatarColor": "#b45309" },
              { "name": "David K.", "stars": 5, "text": "Review praising communication, fair pricing, and outstanding final results", "date": "1 month ago", "avatarColor": "#0891b2" }
            ]
          }
        },
        {
          "id": "why-us",
          "template": "importance-split",
          "content": {
            "badge": "The ${businessName} Difference",
            "headline": "Why Hundreds of Local Families Choose Us",
            "body1": "First paragraph: company story, years in business, core mission of quality and trust",
            "body2": "Second paragraph: what sets this business apart — methods, certifications, customer care approach",
            "highlights": [
              { "icon": "🏆", "text": "IICRC Certified cleaning technicians" },
              { "icon": "🌿", "text": "Eco-friendly, pet-safe cleaning solutions" },
              { "icon": "⚡", "text": "State-of-the-art truck-mounted equipment" },
              { "icon": "💰", "text": "Transparent pricing with no hidden fees" }
            ],
            "image": "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800",
            "imageAlt": "Professional cleaning technician at work"
          }
        },
        {
          "id": "cta-home",
          "template": "cta-gradient-full",
          "content": {
            "badge": "Limited Availability",
            "headline": "Urgency headline about booking a cleaning (7-10 words)",
            "subtitle": "1-2 sentences with a compelling reason to call today",
            "ctaText": "Schedule Online",
            "ctaLink": "/contact",
            "ctaText2": "Call ${phone}",
            "ctaLink2": "tel:${phoneClean}",
            "features": [
              { "text": "Free no-obligation estimates" },
              { "text": "Flexible scheduling available" },
              { "text": "100% satisfaction guarantee" }
            ]
          }
        }
      ]
    },
    {
      "filename": "about.html",
      "meta": { "title": "About | ${businessName}", "description": "About page SEO description" },
      "sections": [
        {
          "id": "about-banner",
          "template": "hero-page-banner",
          "content": {
            "title": "About Us",
            "subtitle": "Your trusted local cleaning experts",
            "bgImage": "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1920"
          }
        },
        {
          "id": "about-story",
          "template": "importance-split",
          "content": {
            "badge": "Our Story",
            "headline": "A Tradition of Excellence — Serving ${areaText}",
            "body1": "First paragraph: founding story, how many years in business, original mission of serving the community with honest, high-quality cleaning",
            "body2": "Second paragraph: ongoing commitment to technology, eco-friendly products, rigorous technician training — why customers keep coming back year after year",
            "highlights": [
              { "icon": "✅", "text": "Fully licensed, bonded, and insured" },
              { "icon": "🏅", "text": "IICRC Certified Master Textile Cleaners" },
              { "icon": "🏘️", "text": "Family-owned and locally operated" },
              { "icon": "🌿", "text": "Committed to eco-friendly practices" }
            ],
            "image": "https://images.unsplash.com/photo-1527515637-ed21c8286a0c?w=800",
            "imageAlt": "Cleaning professional at work"
          }
        },
        {
          "id": "about-stats",
          "template": "features-icon-row",
          "content": {
            "features": [
              { "icon": "📅", "title": "Years in Business", "text": "Serving homeowners and businesses with trusted cleaning services" },
              { "icon": "😊", "title": "Happy Customers", "text": "Thousands of satisfied clients across ${areaText}" },
              { "icon": "⏱️", "title": "Fast Dry Times", "text": "Advanced extraction removes 95% of moisture for quick drying" },
              { "icon": "🏆", "title": "100% Guarantee", "text": "If you're not satisfied, we'll re-clean at no charge" }
            ]
          }
        },
        {
          "id": "about-cta",
          "template": "cta-card",
          "content": {
            "headline": "Experience the ${businessName} Difference",
            "subtitle": "Join thousands of satisfied customers who trust us with their homes.",
            "ctaText": "Schedule Service",
            "ctaLink": "/contact"
          }
        }
      ]
    },
    {
      "filename": "services.html",
      "meta": { "title": "Services | ${businessName}", "description": "Services page SEO description" },
      "sections": [
        {
          "id": "services-banner",
          "template": "hero-page-banner",
          "content": {
            "title": "Our Cleaning Services",
            "subtitle": "Professional care for every surface in your home",
            "bgImage": "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1920"
          }
        },
        {
          "id": "services-list",
          "template": "services-carousel",
          "content": {
            "title": "Comprehensive Home Care",
            "subtitle": "From deep carpet extraction to routine house cleaning",
            "services": ${serviceCarouselJson}
          }
        },
        {
          "id": "services-benefits",
          "template": "benefits-numbered",
          "content": {
            "title": "What's Included With Every Service",
            "subtitle": "Our commitment to quality goes beyond just showing up",
            "benefits": [
              { "title": "Pre-Inspection & Spot Testing", "description": "We assess your surfaces and test products before starting to ensure the safest, most effective approach for your specific materials." },
              { "title": "Professional-Grade Equipment", "description": "Our truck-mounted and portable equipment delivers deeper cleaning and faster drying than rental machines." },
              { "title": "Eco-Friendly Solutions", "description": "All our cleaning products are non-toxic, pet-safe, and environmentally responsible — powerful on dirt, gentle on your home." },
              { "title": "Post-Clean Walkthrough", "description": "We won't leave until you've inspected the work and are completely satisfied with the results." }
            ]
          }
        },
        {
          "id": "services-testimonials",
          "template": "testimonials-3col",
          "content": {
            "title": "What Our Clients Say",
            "testimonials": [
              { "quote": "Specific testimonial about carpet cleaning results — mention stains removed or freshness", "author": "Robert M.", "role": "Homeowner", "rating": 5 },
              { "quote": "Testimonial about recurring house cleaning — mention consistency and trustworthiness of team", "author": "Jessica T.", "role": "Working Parent", "rating": 5 },
              { "quote": "Commercial or tile/grout cleaning testimonial — mention before/after transformation", "author": "David L.", "role": "Business Owner", "rating": 5 }
            ]
          }
        },
        {
          "id": "services-cta",
          "template": "cta-card",
          "content": {
            "headline": "Ready to Book Your Cleaning?",
            "subtitle": "Get a free, no-obligation estimate — we'll respond within 24 hours.",
            "ctaText": "Get a Free Quote",
            "ctaLink": "/contact",
            "ctaText2": "Call ${phone}",
            "ctaLink2": "tel:${phoneClean}"
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
            "formSubtitle": "Tell us about your cleaning needs and we'll provide a transparent, competitive estimate.",
            "submitText": "Request Estimate",
            "phone": "${phone}",
            "phoneClean": "${phoneClean}",
            "email": "${email}",
            "hours": "${hoursText}",
            "serviceArea": "${areaText}",
            "businessName": "${businessName}",
            "highlights": [
              { "text": "Free, no-obligation estimates" },
              { "text": "Flexible scheduling to fit your life" },
              { "text": "100% satisfaction guarantee" }
            ]
          }
        }
      ]
    }
  ]
}

== RULES ==
1. Return ONLY the JSON object. No other text.
2. Use the EXACT Unsplash photo IDs provided — do not invent new ones.
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to ${businessName} and their services: ${servicesList.slice(0, 6).join(', ')}.
4. Reviews and testimonials must sound realistic and mention specific cleaning services or outcomes.
5. Adjust any pricing or service names to match what this business actually offers.
6. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

module.exports = { buildSchemaPrompt, detectLayout, buildOrganicSchemaFromContent };
