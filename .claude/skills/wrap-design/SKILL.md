---
name: wrap-design
description: Design an eye-catching vehicle wrap from a company name, its industry, and optionally a logo. Runs a brief → render → critique → revise loop using image generation, scoring each render against what actually makes a wrap work in traffic. Use when asked to create, improve, or critique a vehicle wrap or fleet livery.
---

# Vehicle Wrap Design

You are the design lead at a shop whose wraps get noticed. A wrap is not a poster — it is
read in about three seconds, at 40mph, by someone who was not looking for it.

Work from `utils/wrapDesignSystem.js` in this repo: it holds the colour strategies, signature
sources, divider devices, trade worlds and anti-defaults, all derived from a corpus of wraps
that work. Read it before designing. This skill is the loop around it.

## The four jobs

Every decision answers to these, in order. A wrap that is merely attractive has done job 1
and failed the rest.

1. Catch the attention of the ideal client.
2. Make it instantly clear WHO they are and WHAT THEY DO.
3. Leave a positive impression of the brand.
4. Give ONE clear next step.

## Step 1 — Establish the brief

From the name, the industry, and any logo:

- **Trade.** Read it from the name or, if supplied, the logo. This word goes on the vehicle.
  A viewer who cannot tell what the business does has seen a failed wrap.
- **Look at the logo if there is one.** Its real colours (ignore the white background), its
  character, whether it reads traditional or modern. The logo is the seed of the brand — a
  generic mark caps how good any wrap can be, and if that is the case, say so plainly rather
  than quietly producing a generic wrap.
- **Outcome, not commodity.** What does the customer's life look like afterwards? "A roof you
  can forget about" beats "roof replacement". Never invent a claim — no "lowest prices",
  "24/7" or "licensed & insured" unless it was supplied.
- **CTA.** Urgent trades (plumbing, HVAC, electrical, locksmith) lead with the PHONE, large.
  Considered purchases (remodelling, decks, flooring, landscaping) lead with the WEBSITE —
  those buyers want to size a company up before speaking to anyone. One CTA, never both.
- **Intensity.** Bold by default. Simple means fewer elements and a narrower palette, never
  less commitment: no mascot, no ornament, two colours, one quiet geometric mark, lots of
  space — but still a saturated or near-black base and still the name enormous.

## Step 2 — Choose a strategy and find a signature

Pick a named colour strategy from `wrapDesignSystem.js` (saturated field, complementary
split, dark anchor, committed two-tone, material field) and vary it across directions.

Boldness is **chroma commitment, not darkness**. A saturated field reads boldly; a mid-chroma
body commits to nothing and is the most common reason a wrap looks flat.

Then find the signature — the one thing this vehicle is remembered by. Mine the sources in
order; the name and the locality are richest because no competitor shares them:

- wordplay inside the name ("Totally Hooked" → a fish in a backwards cap)
- local identity (Duval Floor Care → the Jacksonville skyline)
- an oversized, cropped artifact from the trade's working world
- a character, only if it earns its place
- a badge lockup

**Avoid the category colour.** Nearly every plumber is blue and every landscaper green. On a
road full of blue plumbing vans, the way to be noticed is not to be blue.

## Step 3 — Render

Generate the base vehicle first, then paint each direction onto that same photo, so the
directions are comparable rather than three different vans.

Base vehicle: three-quarter front hero angle, turned ~25° to camera, whole vehicle in frame,
cinematic light (rim light along the roofline, gradient backdrop, glossy floor reflection),
bodywork completely blank. Not a flat side profile on seamless grey — that is a parts
catalogue photo and nothing looks good on it.

When painting, always state: preserve the vehicle's shape, angle, wheels and lighting; vinyl
follows the body's curves and panel lines; every text string spelled exactly as given.

Display type on a saturated field needs a heavy outline or layered offset. **Outlined
lettering may cross a colour boundary and stay legible; unoutlined lettering may not.**

Use `mcp__nanobanana-mcp__gemini_generate_image` for the base and
`mcp__nanobanana-mcp__gemini_edit_image` for each direction, passing the logo via
`reference_images` so the real mark is reproduced rather than invented. Prefer the `flash`
model — `gemini-3-pro-image` has no free-tier quota and 429s on every request.

## Step 4 — Critique the render, then revise

**This is the step that separates a good wrap from a lucky one. Actually look at the image.**

Score each render 1–10 and name the weakest thing:

| Score | What it looks like |
|---|---|
| 8–10 | Eye-catching, trade obvious, one clear CTA, a signature you would remember |
| 6–7 | Clear and competent, but nothing memorable — reads as any company in the trade |
| 3–5 | Trade unclear, or several colours competing, or the CTA is mixed |
| 1–2 | Generic mark plus a bulleted service list. Say the brand needs work first |

Check specifically:

- Can you tell the trade **without reading the small print**?
- Is the name unmistakably the largest thing?
- Is there exactly **one** CTA, appearing **once**?
- Does any text cross a colour boundary unoutlined?
- Is the base saturated or near-black — or has it drifted mid-chroma?
- Is the signature specific to THIS business, or would it suit any competitor?
- Is it on the anti-default list in `wrapDesignSystem.js`?

Then revise the prompt for whatever scored worst and re-render. One revision pass usually
moves a 6 to an 8. Do not ship a first render just because it came back clean.

## Anti-defaults

Refuse these, including the ones this pipeline reaches for on its own:

- deep navy body + white condensed capitals + one orange accent + a generic mascot — the
  house default, and the fastest way to look machine-made
- the category colour
- a mid-chroma body with no anchor and no saturated field
- a plain rectangle of colour floating on an otherwise white body
- a thin pinstripe along the rocker
- bulleted service lists
- small inset photographs; a photo is a full-bleed field with one colour over it, or nothing
- the same CTA twice on one view
- gradients blending three or more hues
- bevels, drop shadows and glossy textures — they read dated, not established

## Deliver

For each direction: the label, the colour strategy, the named signature, the palette as hex,
the rationale, and the render. Say which one you would lead with and why.

If the logo is too generic to build on, say so — the money is better spent on the identity
first, and a wrap cannot rescue it.
