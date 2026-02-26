# Photography Website Template — Gemini Generation Spec

Use this prompt with Gemini to generate a new **photography** layout for SORCE.
The output is a JavaScript function that gets added to `sections/generateSchemaPrompt.js`.

---

## What Gemini will output

Three things:
1. A `buildPhotographyMultiPagePrompt()` function
2. The keyword list to add to `detectLayout()`
3. The dispatch line to add to `buildSchemaPrompt()`

---

## How to add it after Gemini outputs the code

1. In `sections/generateSchemaPrompt.js`, find `detectLayout()` and add the photography keywords:
   ```js
   if (['photography', 'photographer', 'photo', 'portrait', 'wedding', 'headshot', 'videography'].some(kw => bt.includes(kw))) return 'photography';
   ```
   Add this line BEFORE the `return 'default'` line.

2. In `buildSchemaPrompt()`, find the layout dispatch block and add:
   ```js
   if (layout === 'photography') {
     return buildPhotographyMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList });
   }
   ```
   Add it alongside the other `if (layout === ...)` dispatches.

3. Paste Gemini's `buildPhotographyMultiPagePrompt()` function anywhere in the file
   (before `module.exports`).

4. Push to Railway — no restart needed, the function is called dynamically.

---

## Full Gemini Prompt

Copy and paste everything below into Gemini:

---

```
You are writing a JavaScript function for a website builder called SORCE.
The function builds a prompt string that gets sent to Claude AI to generate
the full JSON content for a multi-page photography business website.

OUTPUT: A single JavaScript function. No explanation, no markdown fences —
just the raw JS function.

═══════════════════════════════════════════════════════
FUNCTION SIGNATURE (must match exactly):

function buildPhotographyMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList }) {
  const servicesJson = JSON.stringify(servicesList.slice(0, 6).map(s => ({ text: s })));

  return `...the prompt string...`;
}
═══════════════════════════════════════════════════════

THE PROMPT STRING THIS FUNCTION RETURNS must instruct Claude to output a
JSON object with this EXACT top-level structure:

{
  "multiPage": true,
  "meta": { "title": "...", "description": "..." },
  "nav": {
    "id": "nav",
    "template": "nav-sticky-dark",
    "content": {
      "logo": "[businessName]",
      "links": [
        { "text": "Portfolio", "url": "/portfolio" },
        { "text": "Services", "url": "/services" },
        { "text": "About", "url": "/about" },
        { "text": "Contact", "url": "/contact" }
      ],
      "ctaText": "Book a Session",
      "ctaLink": "/contact"
    }
  },
  "footer": {
    "id": "footer",
    "template": "footer-4col-dark",
    "content": {
      "logo": "[businessName]",
      "tagline": "Short cinematic tagline",
      "services": [array of { text: serviceName } from servicesList],
      "phone": "[phone]",
      "email": "[email]",
      "hours": "[hoursText]"
    }
  },
  "pages": [ ... 5 pages described below ... ]
}

═══════════════════════════════════════════════════════
THE 5 PAGES — each page has filename, meta, sections[]:
═══════════════════════════════════════════════════════

PAGE 1 — index.html (Home)
Sections in order:
  1. hero-fullscreen-dark
     - Dramatic, editorial headline (e.g. "Moments That Last" with highlight "Last")
     - backgroundImage: a real Unsplash photography URL (see photo IDs below)
     - ctaText: "Book Your Session", ctaLink: "/contact"
     - ctaText2: "View Portfolio", ctaLink2: "/portfolio"

  2. review-marquee
     - 6 realistic 5-star reviews specific to photography
     - Mix of wedding, portrait, event, commercial clients
     - avatarColors: use warm tones like "#c2410c", "#b45309", "#92400e", "#1d4ed8", "#7c3aed"

  3. features-icon-row
     - 4 feature tiles: e.g. 📷 Full-Res Delivery, 🎨 Signature Editing Style,
       ⚡ Fast Turnaround, 🏆 Award-Winning Quality

  4. services-cards-3col
     - 3 photography packages from servicesList (wedding, portrait, commercial, etc.)
     - Each has: title, category, price ("From $XXX"), image (real Unsplash photo ID),
       features array (3 items), recommended: true on the most popular

  5. gallery-mixed-grid
     - title: "Recent Work", subtitle: "A glimpse into our latest sessions"
     - 6 gallery items, each with a real Unsplash photo URL and caption
     - Use ONLY these real photography Unsplash IDs:
       photo-1519741497674-611481863552, photo-1519225421980-715cb0215aed,
       photo-1606216794074-735e91aa2c92, photo-1542038784456-1ea8e935640e,
       photo-1494790108377-be9c29b29330, photo-1537633552985-df8429e8048b

  6. cta-gradient-full
     - badge: "Limited Availability"
     - Urgency-driven headline (e.g. "Only 3 Sessions Left This Month")
     - ctaText: "Book Now", ctaLink: "/contact"
     - ctaText2: "See Packages", ctaLink2: "/services"
     - 3 feature pills: e.g. "Same-week booking", "Online gallery delivery", "Print-ready files"

───────────────────────────────────────────────────────

PAGE 2 — portfolio.html (Portfolio)
Sections in order:
  1. hero-page-banner
     - title: "Portfolio", subtitle: "Weddings · Portraits · Events · Commercial"
     - backgroundImage: real Unsplash photography URL

  2. gallery-filtered
     - title: "Our Work", highlight: "Work"
     - categories: ["All", "Weddings", "Portraits", "Events", "Commercial", "Family"]
     - 12 items, each with real Unsplash photo URL, title, category
     - Use these real photography Unsplash IDs (pick 12 from the combined list):
       photo-1519741497674-611481863552, photo-1519225421980-715cb0215aed,
       photo-1606216794074-735e91aa2c92, photo-1542038784456-1ea8e935640e,
       photo-1494790108377-be9c29b29330, photo-1537633552985-df8429e8048b,
       photo-1511285560929-80b456fea0bc, photo-1583939003579-730e3918a45a,
       photo-1529634597503-139d3726fed5, photo-1532712938310-34cb3982ef74,
       photo-1465495976277-4387d4b0b4c6, photo-1606800052052-a08af7148866

  3. cta-card
     - headline: "Like What You See?"
     - subtitle: "Let's create something stunning together."
     - ctaText: "Book a Session", ctaLink: "/contact"
     - ctaText2: "View Packages", ctaLink2: "/services"

───────────────────────────────────────────────────────

PAGE 3 — services.html (Services & Packages)
Sections in order:
  1. hero-page-banner
     - title: "Services & Packages", subtitle: "Find the perfect package for your moment"
     - backgroundImage: real Unsplash URL

  2. services-carousel
     - title: "Photography Packages"
     - subtitle: "Tailored packages for every occasion"
     - 3-5 services from servicesList with realistic pricing and 3-4 feature bullets each

  3. benefits-numbered
     - title: "What's Included With Every Session"
     - subtitle: "Every booking comes with our full commitment to quality"
     - 4 benefits: e.g. 1) Professional editing, 2) Online gallery, 3) Print-ready files, 4) Personal consultation

  4. testimonials-3col
     - title: "What Clients Say"
     - 3 detailed, realistic testimonials from wedding/portrait/event clients
     - author + role (e.g. "Sarah M. — Bride, June 2024")

  5. cta-card
     - headline: "Ready to Book Your Session?"
     - ctaText: "Get in Touch", ctaLink: "/contact"

───────────────────────────────────────────────────────

PAGE 4 — about.html (About)
Sections in order:
  1. hero-page-banner
     - title: "About Us", subtitle: "The story behind the lens"
     - backgroundImage: real Unsplash URL

  2. importance-split
     - badge: "Our Philosophy"
     - headline: "We Don't Just Take Photos — We Tell Stories"
     - body1: 2-3 sentences about the photographer's mission and approach
     - body2: 2-3 sentences about what makes their style unique
     - 4 highlight bullets: e.g. 📷 10+ years experience, 🏆 Award-winning work,
       💻 Online delivery within 7 days, 🤝 Personal, relaxed sessions
     - image: real Unsplash photography portrait/studio URL

  3. features-icon-row
     - 4 stats or differentiators: e.g. 500+ Sessions, 50+ 5-Star Reviews,
       7-Day Delivery, 100% Satisfaction

  4. cta-card
     - headline: "Let's Work Together"
     - ctaText: "Book a Session", ctaLink: "/contact"

───────────────────────────────────────────────────────

PAGE 5 — contact.html (Contact)
Sections in order:
  1. contact-split
     - formTitle: "Book Your Session"
     - formSubtitle: "Tell us about your vision and we'll be in touch within 24 hours"
     - submitText: "Send Inquiry"
     - phone, phoneClean, email, hours, serviceArea, businessName from params
     - highlights: 3 trust bullets relevant to photography booking

═══════════════════════════════════════════════════════
INTERPOLATION RULES
═══════════════════════════════════════════════════════

Inside the returned template string, use these interpolations:
  ${businessName}   — business name
  ${phone}          — formatted phone e.g. (555) 123-4567
  ${phoneClean}     — digits only e.g. 5551234567
  ${email}          — email address
  ${hoursText}      — hours string
  ${areaText}       — service area string
  ${servicesJson}   — pre-built JSON array of { text: serviceName }

For Claude to fill in content, use placeholder text in quotes that
instructs Claude what to write, e.g.:
  "headline": "Dramatic headline WITHOUT the highlight word — make it cinematic"
  "text": "Realistic 5-star wedding photography review — mention emotion and quality"

═══════════════════════════════════════════════════════
RULES YOU MUST FOLLOW
═══════════════════════════════════════════════════════

1. The function must return a template literal string (backticks).
2. The prompt string must begin with:
   "You are a website content generator for photography businesses.
    Return ONLY valid JSON. No markdown, no backticks, no explanation."
3. The prompt must include the full JSON structure with ALL 5 pages,
   nav, footer, and meta — Claude fills in the content, not the structure.
4. Every image URL must use a REAL Unsplash photo ID from the lists above.
   Format: https://images.unsplash.com/photo-XXXX?w=1920 (hero/banner)
           https://images.unsplash.com/photo-XXXX?w=800 (cards/gallery)
5. All nav links use absolute paths: /portfolio, /services, /about, /contact
6. The footer uses ${servicesJson} (already a JSON string) — do NOT
   wrap it in quotes or JSON.stringify it again.
7. Include at the end of the prompt:
   "== RULES ==
    1. Return ONLY the JSON object. No other text.
    2. All image URLs must use the exact Unsplash photo IDs provided.
    3. Write compelling, specific copy for this photography business.
    4. Reviews and testimonials must sound realistic and personal.
    5. All nav/CTA links must use absolute paths (/portfolio, /services, etc.)
    6. The JSON must be parseable by JSON.parse() — no trailing commas."
8. NO placeholder comments — write complete, working code.
```

---

## After Gemini Outputs the Function

1. Paste `buildPhotographyMultiPagePrompt()` into `sections/generateSchemaPrompt.js`
2. Add the keyword detection line to `detectLayout()`:
   ```js
   if (['photography', 'photographer', 'photo', 'portrait', 'wedding photo', 'headshot', 'videography'].some(kw => bt.includes(kw))) return 'photography';
   ```
3. Add the dispatch in `buildSchemaPrompt()`:
   ```js
   if (layout === 'photography') {
     return buildPhotographyMultiPagePrompt({ businessInfo, businessName, phone, phoneClean, email, hoursText, areaText, servicesList });
   }
   ```
4. Test by generating a site with businessType = "photography"
5. Verify all 5 pages render, nav links work, images load

---

## Photography Unsplash Photo IDs (reference)

All verified real IDs — use these in the prompt so Claude picks from known-good URLs:

| ID | Description |
|---|---|
| photo-1519741497674-611481863552 | Wedding couple, romantic |
| photo-1519225421980-715cb0215aed | Portrait session, natural light |
| photo-1606216794074-735e91aa2c92 | Photography studio, camera |
| photo-1542038784456-1ea8e935640e | Camera gear, flat lay |
| photo-1494790108377-be9c29b29330 | Portrait woman, bokeh |
| photo-1537633552985-df8429e8048b | Event photography, crowd |
| photo-1511285560929-80b456fea0bc | Wedding ceremony |
| photo-1583939003579-730e3918a45a | Family portrait outdoor |
| photo-1529634597503-139d3726fed5 | Engagement shoot |
| photo-1532712938310-34cb3982ef74 | Corporate headshot |
| photo-1465495976277-4387d4b0b4c6 | Wedding reception details |
| photo-1606800052052-a08af7148866 | Portrait moody lighting |
