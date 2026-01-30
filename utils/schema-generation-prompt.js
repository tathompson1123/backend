// ============================================
// SCHEMA-BASED WEBSITE GENERATION PROMPT
// Generates JSON page schema for the visual editor
// ============================================

function buildSchemaGenerationPrompt({
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

  // Parse services into array if possible
  let servicesList = [];
  if (servicesInfo.hasData && servicesInfo.services) {
    // Try to extract service names and prices from the formatted string
    const serviceMatches = servicesInfo.services.match(/\*\*([^*]+)\*\*[^$]*\$(\d+(?:\.\d{2})?)/g);
    if (serviceMatches) {
      servicesList = serviceMatches.map(match => {
        const nameMatch = match.match(/\*\*([^*]+)\*\*/);
        const priceMatch = match.match(/\$(\d+(?:\.\d{2})?)/);
        return {
          name: nameMatch ? nameMatch[1] : 'Service',
          price: priceMatch ? priceMatch[1] : '99'
        };
      });
    }
  }

  return `You are a website content generator. Generate a JSON schema for a professional ${safeBusinessType} business website.

═══════════════════════════════════════════════════════════════════
🏢 BUSINESS INFORMATION
═══════════════════════════════════════════════════════════════════

**Company:** ${safeBusinessName}
**Industry:** ${safeBusinessType}
${safeTagline ? `**Tagline:** "${safeTagline}"` : ''}
${yearsInBusiness ? `**Experience:** ${yearsInBusiness} years` : ''}
${safeCertifications ? `**Credentials:** ${safeCertifications}` : ''}
${safeDescription ? `**About:** ${safeDescription}` : ''}
${safeUSPs ? `**Differentiators:** ${safeUSPs}` : ''}
${safeTargetCustomer ? `**Target Market:** ${safeTargetCustomer}` : ''}

**Phone:** ${phoneNumber}
**Email:** ${contactEmail}
${fullAddress ? `**Address:** ${fullAddress}` : ''}
${serviceAreaText ? `**Service Area:** ${serviceAreaText}` : ''}
${ownerName ? `**Owner:** ${ownerName}` : ''}
**Booking URL:** ${bookingUrl}

═══════════════════════════════════════════════════════════════════
💼 SERVICES
═══════════════════════════════════════════════════════════════════

${servicesInfo.services}

═══════════════════════════════════════════════════════════════════
🕐 BUSINESS HOURS
═══════════════════════════════════════════════════════════════════

${hoursInfo.hours}

═══════════════════════════════════════════════════════════════════
🎨 BRAND COLORS
═══════════════════════════════════════════════════════════════════

Primary Color: ${primaryColor}
Accent Color: ${accentColor}

═══════════════════════════════════════════════════════════════════
📋 OUTPUT FORMAT - JSON SCHEMA
═══════════════════════════════════════════════════════════════════

Generate a complete website as a JSON object following this EXACT structure.

**WIDGET TYPES AVAILABLE:**
- "text" - For headings (h1, h2, h3, h4) and paragraphs (p)
- "image" - For images (use Unsplash URLs like https://images.unsplash.com/photo-XXXXX?w=800)
- "button" - For call-to-action buttons
- "button-group" - For multiple buttons together
- "spacer" - For vertical spacing
- "divider" - For horizontal lines
- "form" - For contact forms
- "testimonial" - For customer reviews
- "icon" - For decorative icons

**SECTION TYPES:**
- "hero" - Main banner section
- "services" - Services showcase
- "about" - About the business
- "features" - Key features/benefits
- "testimonials" - Customer reviews
- "gallery" - Work/portfolio images
- "cta" - Call to action
- "contact" - Contact information and form
- "faq" - Frequently asked questions

**JSON STRUCTURE:**

{
  "id": "home-page",
  "name": "Home",
  "slug": "index",
  "title": "${safeBusinessName} - ${safeBusinessType}",
  "description": "Professional ${safeBusinessType} services...",
  "sections": [
    {
      "id": "section-unique-id",
      "type": "hero",
      "name": "Hero",
      "background": {
        "type": "gradient",
        "value": "linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)",
        "overlay": ""
      },
      "style": {
        "paddingTop": "100px",
        "paddingBottom": "100px",
        "paddingLeft": "20px",
        "paddingRight": "20px"
      },
      "rows": [
        {
          "id": "row-unique-id",
          "style": {
            "maxWidth": "1200px",
            "margin": "0 auto",
            "gap": "24px"
          },
          "columns": [
            {
              "id": "col-unique-id",
              "width": "100%",
              "widgets": [
                {
                  "id": "widget-unique-id",
                  "type": "text",
                  "content": {
                    "text": "Your Headline Here",
                    "tag": "h1",
                    "alignment": "center"
                  },
                  "style": {
                    "fontSize": "48px",
                    "fontWeight": "bold",
                    "color": "#ffffff",
                    "marginBottom": "24px"
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

═══════════════════════════════════════════════════════════════════
📄 REQUIRED SECTIONS (generate in this order)
═══════════════════════════════════════════════════════════════════

1. **HERO SECTION**
   - Compelling headline mentioning ${safeBusinessName}
   - Subheadline with value proposition
   - Two buttons: "Get Free Quote" (link to ${bookingUrl}) and "Call Now" (tel:${phoneNumberClean})
   - Background: gradient using ${primaryColor} and ${accentColor}

2. **SERVICES SECTION**
   - Section title: "Our Services"
   - 3-column layout on desktop
   - Each service card with: icon, title, description, price (if available)
   - Use the actual services provided above
   ${servicesList.length > 0 ? `
   - Services to include: ${servicesList.map(s => s.name).join(', ')}` : `
   - Generate 4-6 realistic ${safeBusinessType} services with prices`}

3. **ABOUT SECTION**
   - Two-column layout: text on left, image on right
   - Company story/description
   - Years in business, credentials
   - Image: Use relevant Unsplash image for ${safeBusinessType}

4. **TESTIMONIALS SECTION**
   - Section title: "What Our Customers Say"
   - 3 testimonial widgets
   - Generate realistic reviews for ${safeBusinessType} business
   - Include customer name, role (e.g., "Homeowner"), rating (5 stars), quote
   - Background: light gray (#f9fafb)

5. **CTA SECTION**
   - Compelling headline: "Ready to Get Started?"
   - Subheadline with urgency/value
   - Button: "Book Now" linking to ${bookingUrl}
   - Background: gradient using brand colors

6. **CONTACT SECTION**
   - Two-column layout
   - Left: Contact info (phone: ${phoneNumber}, email: ${contactEmail}${fullAddress ? `, address: ${fullAddress}` : ''})
   - Right: Contact form widget with fields for name, email, phone, message
   - Business hours: ${hoursInfo.hours}

═══════════════════════════════════════════════════════════════════
⚠️ CRITICAL RULES
═══════════════════════════════════════════════════════════════════

1. Every ID must be unique (use format: "section-1", "row-1-1", "col-1-1-1", "widget-1-1-1-1")
2. All button links to booking should use: "${bookingUrl}"
3. All phone links should use: "tel:${phoneNumberClean}"
4. Use brand colors: primary ${primaryColor}, accent ${accentColor}
5. Text on dark/gradient backgrounds should be white (#ffffff)
6. Text on light backgrounds should be dark (#1f2937)
7. Use realistic Unsplash image URLs (format: https://images.unsplash.com/photo-XXXXXXXXX?w=800)
8. Generate REAL, compelling copy - not placeholder text
9. Include the contact form in the contact section

═══════════════════════════════════════════════════════════════════
🎯 OUTPUT
═══════════════════════════════════════════════════════════════════

Return ONLY the JSON object. No markdown code fences, no explanation, no additional text.
Start your response with { and end with }

Generate the complete JSON schema now:`;
}

module.exports = { buildSchemaGenerationPrompt };
