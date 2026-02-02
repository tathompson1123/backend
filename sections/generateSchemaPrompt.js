// ============================================
// AI SCHEMA GENERATION PROMPT
// Tells Claude to output a page schema (JSON)
// instead of raw HTML
// ============================================

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

  // Build services list for the prompt
  const servicesList = Array.isArray(services) && services.length > 0
    ? services.map(s => typeof s === 'string' ? s : s.name || s.title || '').filter(Boolean)
    : ['Service 1', 'Service 2', 'Service 3'];

  return `You are a website content generator for service-based businesses. Your job is to generate a JSON page schema that will be fed into a template rendering system.

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation. Just the JSON object.

== BUSINESS INFO ==
Name: ${businessName}
Type: ${businessType}
Phone: ${phone}
Email: ${email}
${address ? `Address: ${address}` : ''}
${city ? `City: ${city}` : ''}
${state ? `State: ${state}` : ''}
Services: ${servicesList.join(', ')}
${description ? `Description: ${description}` : ''}
${hours ? `Hours: ${hours}` : ''}
${serviceArea ? `Service Area: ${serviceArea}` : ''}

== YOUR TASK ==
Generate a JSON object with this exact structure. Fill in compelling, professional content for this specific business.

{
  "meta": {
    "title": "${businessName} - Professional ${businessType} Services",
    "description": "SEO meta description for the business (150-160 chars)"
  },
  "sections": [
    {
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
        "ctaLink2": "tel:${phone.replace(/\\D/g, '')}",
        "features": [
          { "text": "Feature pill 1" },
          { "text": "Feature pill 2" },
          { "text": "Feature pill 3" }
        ]
      }
    },
    {
      "id": "s10",
      "template": "contact-split",
      "content": {
        "formTitle": "Get Your Free Quote",
        "formSubtitle": "Fill out the form and we'll get back to you within 24 hours",
        "submitText": "Request Quote",
        "phone": "${phone}",
        "phoneClean": "${phone.replace(/\\D/g, '')}",
        "email": "${email}",
        "hours": "${hours || 'Mon-Fri: 8AM-6PM\\nSat: 9AM-4PM\\nSun: Closed'}",
        "serviceArea": "${serviceArea || city + ', ' + state + ' and surrounding areas'}",
        "businessName": "${businessName}",
        "highlights": [
          { "text": "Why choose us point 1" },
          { "text": "Why choose us point 2" },
          { "text": "Why choose us point 3" }
        ]
      }
    },
    {
      "id": "s11",
      "template": "footer-4col-dark",
      "content": {
        "logo": "${businessName}",
        "tagline": "Short tagline for the business",
        "services": ${JSON.stringify(servicesList.slice(0, 6).map(s => ({ text: s })))},
        "phone": "${phone}",
        "email": "${email}",
        "hours": "${hours || 'Mon-Fri: 8AM-6PM\\nSat: 9AM-4PM\\nSun: Closed'}"
      }
    }
  ]
}

== RULES ==
1. Return ONLY the JSON object. No other text.
2. Use REAL Unsplash URLs that match the business type. Format: https://images.unsplash.com/photo-XXXXX?w=1920 (hero) or ?w=800 (cards/gallery). Pick specific photo IDs that relate to ${businessType}.
3. Write compelling, specific copy — not generic placeholder text. Tailor everything to ${businessType}.
4. Reviews and testimonials should sound realistic and specific to the services offered.
5. Include 3-6 services in the services section based on what was provided.
6. Keep the sections in the exact order shown above (trust → nav → hero → features → services → benefits → gallery → testimonials → cta → contact → footer).
7. Make the headline punchy and benefit-focused, not just the business name.
8. Feature icons should be relevant emoji for the business type.
9. Gallery images should showcase different aspects of the work.
10. The JSON must be parseable by JSON.parse() — no trailing commas, no comments.`;
}

module.exports = { buildSchemaPrompt };
