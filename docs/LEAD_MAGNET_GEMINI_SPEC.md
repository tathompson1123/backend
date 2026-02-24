# Lead Magnet Template — Gemini Generation Spec

Use this prompt with Gemini to generate a new lead magnet section template.
The output is a JavaScript module file that gets dropped into
`sections/lead-magnets/` and registered in `sections/registry.js`.

---

## How to register after Gemini outputs the file

1. Save Gemini's output as `sections/lead-magnets/{id}.js`
2. Add one line to `sections/registry.js` inside the static sections object:
   ```js
   'your-lead-magnet-id': require('./lead-magnets/your-lead-magnet-id'),
   ```
3. Restart the backend (or use the dynamic registration endpoint if available)
4. Reference it in a website schema section like any other template:
   ```json
   { "id": "lm1", "template": "your-lead-magnet-id", "content": { "headline": "...", "ctaText": "..." } }
   ```

---

## Full Gemini Prompt

Copy and paste this entire prompt into Gemini, then fill in the `[PLACEHOLDERS]`:

---

```
You are generating a JavaScript module for a website section that acts as an
interactive lead magnet tool. It is a multi-step wizard that captures user
preferences, then collects their contact info and submits it to a lead API.

OUTPUT: A single JavaScript file in the format below. No explanation text,
no markdown fences — just the raw JS file content.

═══════════════════════════════════════
LEAD MAGNET TO BUILD:
Industry:      [e.g. auto wraps / bathroom remodels / roofing / HVAC / etc.]
Tool Name:     [e.g. "Design Your Vehicle Wrap" / "Estimate Your Remodel"]
Steps 1–4:     [describe the 4 choice questions to ask, each with 4 options]
Result:        [what personalized result to show — price range, design summary, etc.]
═══════════════════════════════════════

RULES YOU MUST FOLLOW:

1. MODULE FORMAT — output exactly this shape:
   module.exports = {
     id: 'lead-magnet-[industry-slug]',
     name: '[Tool Name]',
     category: 'lead-magnet',
     description: '...',
     suitability: { [industry]: 1.0 },
     contentSchema: {
       headline:    { type: 'text', label: 'Headline',    default: '...' },
       subheadline: { type: 'text', label: 'Subheadline', default: '...' },
       ctaText:     { type: 'text', label: 'CTA Button',  default: '...' },
     },
     render(content, theme, sectionId = 'lm-[slug]') {
       const s = `section-${sectionId}`;
       // ... theme variables + HTML/CSS/JS return
     }
   };

2. SECTION ID PREFIX — every CSS class and JS function name MUST start with `${s}-`
   to avoid collisions with other sections on the page.
   Example: `.${s}-btn`, `.${s}-choice`, `window[s + 'Next']`

3. THEME VARIABLES — extract these at the top of render():
   const primary  = theme.primaryColor  || '#[sensible default for industry]';
   const accent   = theme.accentColor   || '#[lighter shade]';
   const text     = theme.textColor     || '#1f2937';
   const bg       = theme.bgColor       || '#ffffff';
   const headFont = theme.headFont      || 'Inter';

4. HTML STRUCTURE — use data-step attributes:
   - data-step="0"       → intro/splash screen
   - data-step="1"–"4"  → choice steps (one question each, 4 tile options)
   - data-step="5"       → contact form (name, email, phone optional)
   - data-step="result"  → success screen with personalized result
   - data-step="error"   → error fallback with retry button
   Each step div has class "${s}-step" and is hidden by default.
   Only the active one gets class "active" (display:block).

5. CHOICE STEPS — each step must have:
   - A question in a <p class="${s}-q"> tag
   - A grid of 4 tiles: <div class="${s}-choice" onclick="${s}Pick(this,'key','value')">
   After the user picks, auto-advance to the next step after 350ms.

6. CONTACT STEP — a <form> with:
   - Name input (required)
   - Email input (required)
   - Phone input (optional)
   - Submit button
   - Fine print: "No spam. We'll only contact you about your [tool name]."
   onsubmit calls ${s}Submit(event)

7. RESULT SCREEN — show a personalized message based on their answers.
   Build a lookup map (ESTIMATE_MAP or RESULT_MAP) at the top of the IIFE
   keyed by the step-1 answer → step-2 answer → result string.
   Display it in a styled box with their specific answers echoed back.

8. API SUBMISSION — in ${s}Submit():
   var userId = window.__SORCE_USER_ID__;   // injected by SORCE page renderer
   if (!userId) { ${s}GoTo('error'); return; }

   fetch('/api/leads/public/' + userId, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       name: name,
       email: email,
       phone: phone,
       service: _state.answers.step1Key || '[industry]',
       message: [build a human-readable summary of all 4 answers],
       sms_consent: true
     })
   })
   .then(function() { ${s}GoTo('result'); })
   .catch(function() { ${s}GoTo('error'); });

9. JAVASCRIPT — IIFE pattern, NO external dependencies, NO arrow functions
   (for max browser compatibility). All global functions exposed on `window`
   with the `${s}` prefix so they don't conflict:
     window[s + 'GoTo'] = function(step) { ... }
     window[s + 'Next'] = function() { ... }
     window[s + 'Pick'] = function(el, key, value) { ... }
     window[s + 'Submit'] = function(e) { ... }

   OR use the exact inline onclick string approach shown in the landscaping
   example (see sections/lead-magnets/lead-magnet-landscaping.js).

10. PROGRESS BAR — a thin bar at the top of the card:
    <div class="${s}-progress-bar"><div class="${s}-progress-fill" id="${s}-fill"></div></div>
    Update width % = (currentStep / 5 * 100) on each transition.

11. CSS — scoped entirely within the section. Include:
    - White card with border-radius:20px, box-shadow, max-width:560px centered
    - Choice tiles with hover (border color = primary) and selected state
    - Smooth fade-in animation on step change
    - Result box styled in primary color tint
    - Mobile-responsive at 480px

12. NO PLACEHOLDER COMMENTS — write complete, working code. Every function
    body must be fully implemented.

EXAMPLE REFERENCE: See sections/lead-magnets/lead-magnet-landscaping.js
for a complete working example to base your structure on.
```

---

## Example Ideas to Generate

| Industry | Tool Name | Step 1 | Step 2 | Step 3 | Step 4 | Result |
|---|---|---|---|---|---|---|
| Auto Wrap | Vehicle Wrap Designer | Vehicle type | Wrap style (full/partial/accent) | Color/finish (gloss/matte/chrome/color shift) | Timeline | Cost estimate + description |
| Bathroom Remodel | Bathroom Estimator | Bathroom size | Scope (cosmetic/mid/full gut) | Fixtures (standard/premium/luxury) | Timeline | Cost range |
| Roofing | Roof Replacement Estimator | Home size | Roof type (asphalt/metal/tile) | Story count | Timeline | Cost range |
| HVAC | System Sizing Tool | Home sq ft | System type (AC/heat pump/full system) | Efficiency tier | Urgency | System recommendation + cost |
| Auto Detailing | Detail Package Picker | Vehicle type | Condition | Service level | Frequency | Package recommendation + price |
| Photography | Package Builder | Event type | Guest count | Hours needed | Add-ons | Package recommendation + price |

---

## After Gemini Outputs the File

1. Review the JS for syntax errors (paste into a linter)
2. Check that `window.__SORCE_USER_ID__` is used in the submit function
3. Check that all `onclick` handlers use the `${s}` scoped names
4. Drop the file in `sections/lead-magnets/{id}.js`
5. Add to `sections/registry.js`
6. Add the section to a website schema in the AI prompt (`sections/generateSchemaPrompt.js`) under appropriate business types
