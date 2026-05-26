# Thompson's Auto Detailing — Code Reference for Wix Port

Standalone HTML/CSS/JS rebuild of thompsonsautodetailing.com. **Not a SORCE feature** — this is a personal-business code reference you can port to Wix Dev Mode (Velo) by hand.

## How to preview locally

Just open any HTML file directly in a browser, or:

```bash
cd templates/thompsons-auto-detailing
python -m http.server 8000
# then visit http://localhost:8000
```

## Brand tokens (keep these consistent in Wix)

| Token | Value | Use |
|---|---|---|
| `--navy` | `#0f1e3d` | Primary background, headers |
| `--navy-deep` | `#070d1f` | Footer, deepest backgrounds |
| `--gold` | `#d4a544` | Accent, CTAs, highlights |
| `--gold-bright` | `#f0c265` | Shine sweeps, hover states |
| `--off-white` | `#f5f3ee` | Body text on dark, cards |
| `--ink` | `#1a1a1a` | Body text on light |

Fonts: **Playfair Display** (display headlines) + **Inter** (body). Both Google Fonts — already linked in each file's `<head>`.

## Files

| File | Page | Signature animation |
|---|---|---|
| `index.html` | Home | Ken Burns hero + gold shine sweep across headline + word-by-word reveal + scroll parallax + animated polish-stroke divider |
| `liquid-ppf.html` | NANOPRO Liquid PPF (NEW) | Hydrophobic water-bead drift loop + gold curtain line draw + acrylic-reinforced positioning vs. traditional PPF |
| `ceramic-coating.html` | Ceramic Coating | Diagonal gloss-sweep light bar across hero + curtain line draw + ceramic vs. wax/sealant comparison |
| `window-tint.html` | Window Tint | Hero image darkens 1.2 → 0.35 brightness over 2.5s (mimics tinting) + faint horizontal scan stripes fading in + WA state legal note |
| `mobile-detailing.html` | Mobile Detailing | Slow Ken Burns background + horizontal motion streaks racing across hero + in-shop vs. mobile cards |
| `gift-cards.html` | Gift Cards | 3D card-flip intro from back to front, then gentle floating idle, with shimmer light passing across the card every ~5s |
| `contact.html` | Book / Contact | Minimal curtain-line intro + 4-method contact grid + form (Wix Form replacement) + stylized map placeholder (Wix Maps replacement) |

## Porting to Wix Dev Mode (Velo) — three patterns

You have three options for any given animation/section. Pick per-section based on how much of the design you want to preserve.

### Pattern 1 — HTML iframe component (highest fidelity, fewest tradeoffs)

**Use for:** the home hero, the liquid PPF water-bead loop, anything with custom CSS keyframes or layered animation.

1. In Wix Editor: `Add (+)` → `Embed Code` → `Embed HTML` → `Custom Code`
2. Paste the *entire* `<style>` + `<body>` content of the section between `<html><body>...</body></html>` tags
3. Set the iframe to full-width, fixed height (or use Wix's responsive height settings)
4. The animation runs inside the iframe sandbox — no Velo code needed

**Tradeoff:** SEO crawlers don't index iframe content as well, and the iframe is its own document (no shared fonts unless you re-link them inside).

### Pattern 2 — Native Wix elements + Velo `wix-animations`

**Use for:** scroll-triggered fades, simple section reveals, button hovers.

```javascript
// Velo page code (e.g. masterPage.js or Home.js)
import wixAnimations from 'wix-animations';

$w.onReady(() => {
  // Fade-up on a Wix element with ID 'serviceCard1'
  const timeline = wixAnimations.timeline({ repeat: 0 });
  timeline
    .add($w('#serviceCard1'), { y: 30, opacity: 0, duration: 0 })
    .add($w('#serviceCard1'), { y: 0, opacity: 1, duration: 800 })
    .play();
});
```

For scroll-triggered: use `$w('#section').onViewportEnter(() => { ... })`.

**Tradeoff:** Wix's animation API is less expressive than the CSS keyframes used here. Complex sequences require building your own timeline.

### Pattern 3 — Velo `customElement` (Web Components)

**Use for:** reusable widgets across pages (e.g., the gold-stroke divider, the animated hero headline).

Register a custom element in Wix Editor → Settings → Custom Code, then drop it on any page. Best when you want pixel-perfect parity with this codebase but on multiple pages.

## Wix-specific gotchas

- **Sticky nav with `backdrop-filter: blur()`** — works in iframe (Pattern 1) but Wix's native header section may not honor it. Fallback: solid `rgba(15, 30, 61, 0.95)`.
- **Custom fonts** — upload Playfair Display + Inter in Wix Site Design → Fonts → Upload, OR use Wix's built-in Google Fonts integration (search "Playfair Display").
- **Mobile menu** — Wix has its own mobile nav. Don't duplicate. Hide the desktop nav-links container on mobile; let Wix's hamburger take over.
- **Form submissions** — replace any `<form>` in `contact.html` with a Wix Form element (collects to Wix CRM). Don't try to keep the HTML form.
- **The animated hero headline gold-shine** — only ports cleanly via Pattern 1 (iframe). Worth doing for the home page.

## What I changed vs. the live site

- Added **NANOPRO Liquid PPF** as a flagship service (positioned next to ceramic coating, priced *above* ceramic to reflect the upgrade)
- Reorganized homepage to lead with PPF + ceramic as the two premium offerings
- Added a "Why NANOPRO over traditional PPF" comparison block on the PPF page
- Added scroll-triggered fades site-wide
- Replaced flat hero with animated cinematic hero on home
- Kept all your contact info, hours, service area, socials verbatim

## What still needs your input before going live

- **Real photos.** I'm using Unsplash placeholders. Swap to your own work shots (especially for the gallery and hero).
- **NANOPRO pricing.** I put `$1,899+` as a placeholder positioned ~20% above ceramic. Update before publish.
- **NANOPRO warranty length.** I wrote "7-year" — confirm with your supplier's spec sheet.
- **Logo file.** I'm using a text logo with gold underline. Drop your circular badge logo in when you port to Wix.
