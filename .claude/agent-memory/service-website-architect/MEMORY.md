# Service Website Architect - Memory

## Section Template Patterns
- All templates must use `section-${sectionId}` prefix for CSS scoping (the `s` variable)
- Theme object uses `headingFont` (NOT `headFont`) and `bodyFont`
- The renderer wraps output in `<div id="${sectionId}">` so sections use `class="${s}"` internally
- Lead magnet templates: landscaping, cleaning, renovation, photography, auto-wrap
- All lead magnet forms must include SMS consent checkbox (required by system spec)

## Common Bugs Found & Fixed (2026-03-08)
- `hero-gradient.js` had unscoped CSS selectors (`.hero-gradient` instead of `.${s}`)
- `content-block.js` and `custom-row.js` used raw `sectionId` without `section-` prefix
- All 5 lead magnets referenced `theme.headFont` (wrong) instead of `theme.headingFont`
- `lead-magnet-auto-wrap.js` was missing `<section>` wrapper
- `cta-card.js` used `theme.textColor`/`theme.textMuted` inside always-dark card bg causing contrast issues
- `hero-page-banner.js` had hardcoded overlay/gradient colors not using theme tokens
- `nav-sticky-organic.js` had hardcoded scrolled-state backgrounds
- `services-carousel.js` arrows at `left:0`/`right:0` got clipped on edges
- `services-carousel.js` used `.carousel-center` without scope prefix (cross-section bleed)
- `gallery-filtered.js` overlay not visible on mobile (touch devices can't hover)
- Lead magnet inputs missing `font-family: inherit`, `width: 100%`, `box-sizing: border-box`

## Theme Tokens (from themes.js)
- `primaryColor`, `accentColor`, `bgColor`, `surfaceColor`
- `textColor`, `textMuted`
- `headingFont`, `bodyFont`, `fontImport`
- `borderRadius`, `buttonRadius`
- `borderAccent`, `borderAccentHover`
- 16 themes total (auto, landscaping, salon, restaurant, fitness, dental, hvac, cleaning x2, realEstate, photography x4, legal, renovation, organic, petGrooming)

## Color Contrast Rules
- Dark hero overlays: always use white text (#fff) regardless of theme
- CTA cards with gradient bg: always use white text, never theme.textColor
- Gradient CTA sections: white text on primaryColor gradient is safe
- Photography themes: `photography-warm` has dark text on light bg; `photography-dark` has light text on dark bg
- The `landscaping` primary (#1a3a1a) is very dark -- works as button bg with white text

## File Sizes (rough guide for edit matching)
- `contact-split.js`: ~490 lines (largest standard section)
- `services-carousel.js`: ~355 lines
- `footer-4col-dark.js`: ~366 lines
- Lead magnets: ~300 lines each (cleaning slider now ~917 lines after multi-step rewrite)

## Multi-Step Lead Magnet Pattern (established 2026-03-11)
- 3-step flow: Slider -> Results+Form -> Success
- Step transitions: hide/show with `.fade-in` CSS animation
- Step 2 uses two-column grid (stacks on mobile)
- Service checkboxes: hidden native checkbox + styled `.svc-check` span with SVG checkmark
- Stat bars: start at `width:0%`, animated to target via `setTimeout(fn, 100)` after step2 shows
- Health tiers: array of objects with `max` threshold, iterated with `for` loop
- `hexToRgba()` utility for dynamic border/bg alpha on info boxes and badges
- Slider value read from Step 1 `#range` element even in Step 2/3 (persists in DOM)
- Auto detailing template (`lead-magnet-slider-auto.js`) uses same dark theme but is NOT multi-step (single two-column layout with form always visible)
