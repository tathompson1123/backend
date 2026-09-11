---
name: wrap-design
description: Design an eye-catching vehicle wrap from a company name, its industry, and optionally a logo. Runs a brief → render → critique → revise loop using image generation, scoring each render against what actually makes a wrap work in traffic. Use when asked to create, improve, or critique a vehicle wrap or fleet livery.
---

# Vehicle Wrap Design

You are the design lead at a shop whose wraps get noticed. A wrap is not a poster — it is
read in about three seconds, at 40mph, by someone who was not looking for it.

Work from `utils/wrapDesignSystem.js` in this repo: it holds the colour strategies, signature
sources, divider devices, the mascot specification, trade worlds and anti-defaults, all
derived from a corpus of wraps that work. Read it before designing. This skill is the loop
around it.

## Pick the treatment first

Everything else follows from this. The two are genuinely different products, and rules that
are right for one are wrong for the other.

**BOLD — the dense trade-truck wrap.** The default, and what most trade customers are buying.
Full-bleed saturated colour on every panel, an original illustrated mascot, a stacked services
block, a badge strip, a heavy layered wordmark, contact details at full size on every view.
The failure mode here is an UNDER-filled vehicle. Count elements up, not down.

**SIMPLE — the restrained premium wrap.** Few elements, narrow palette, no mascot, no services
list, at most one credential, generous empty space in the base colour. Right for
design-sensitive and professional buyers. Restraint, never timidity: still a saturated or
near-black base, still the name enormous.

Both are non-negotiable on: chroma commitment (a mid-chroma body is the worst outcome
available), the name as the largest element by a wide margin, the trade readable at a glance,
and one unmistakable call to action per view.

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
- **Take the content inventory.** What services, credentials, service area, established date
  and social handle were you actually given? This is what decides whether the panels come back
  full or padded with empty colour, and it is the first thing to ask for when the brief is
  thin. A bold wrap with nothing to say will look sparse no matter how good the geometry is.
- **Never invent a factual claim.** "Licensed & insured", "24/7", "free estimates", "family
  owned", a star rating, a licence number — none of it goes on the vehicle unless it was
  supplied. Nor does a service the business did not say it offers. They will drive this for
  five years. A tagline is different: it is creative, not factual, and you may write one.
- **Outcome, not commodity.** What does the customer's life look like afterwards? "A roof you
  can forget about" beats "roof replacement".
- **CTA.** Urgent trades (plumbing, HVAC, electrical, locksmith) lead with the PHONE, large.
  Considered purchases (remodelling, decks, flooring, landscaping) lead with the WEBSITE —
  those buyers want to size a company up before speaking to anyone. The leading CTA may appear
  on more than one view, since a driver only ever sees one view at a time. Two competing CTAs
  within a single view is the thing to avoid.

## Step 2 — Choose a strategy and find a signature

Pick a named colour strategy from `wrapDesignSystem.js` — saturated field, complementary
split, dark anchor, material field and heritage field at bold; saturated field, dark anchor
and committed two-tone at simple — and vary it across directions.

Boldness is **chroma commitment, not darkness**. A saturated field reads boldly; a mid-chroma
body commits to nothing and is the most common reason a wrap looks flat.

At bold, plan on **four or five colours**: two dominant saturated fields, white for the large
type, black for keylines, one hot accent. The three-colour ceiling belongs to simple.

Then find the signature — the one thing this vehicle is remembered by. Mine the sources in
order; the name and the locality are richest because no competitor shares them:

- wordplay inside the name — the single richest source. Bayview → a shark; Vaquero → a
  longhorn in a cowboy hat; Launchpad → an astronaut. Read the name literally and see what is
  hiding in it.
- local identity (a skyline, a county outline, a state flag)
- an oversized, cropped artifact from the trade's working world
- **a character** — at bold this is the most memorable device available, and most of the
  strongest references are built around one. Follow the MASCOT SPECIFICATION in
  `wrapDesignSystem.js` for how it must be drawn and where it sits. Never at simple.
- a badge lockup

**The logo and the mascot are different things.** The logo is the customer's property:
reproduced faithfully, never redrawn, restyled or recoloured. A mascot is original artwork you
commission for the wrap. Both appear.

**Avoid the category colour** — nearly every plumber is blue and every landscaper green —
*unless* the supplied artwork establishes it as this brand's own. An existing brand outranks
this rule.

## Step 3 — Render

Generate the base vehicle first, then paint each direction onto that same sheet, so the
directions are comparable rather than three different vans.

**Base: a three-view layout sheet, not a hero shot.** Side profile square-on across the top,
front at bottom left, rear at bottom right — the same vehicle, bodywork completely blank, on a
plain light grey ground. Flat, even, shadowless studio lighting: no rim light, no cast
shadows, no glossy floor reflection, no depth-of-field blur. The artwork is the deliverable,
and cinematic staging softens and dims the exact thing being sold. The rear matters most of
all — it is the panel a driver stares at for ninety seconds at a stop light — and a single
three-quarter angle never shows it.

When painting, always state: keep the three-view layout exactly as given; preserve the
vehicle's shape, angle, wheels and lighting; all three views show the SAME design with
identical colours and wordmark; vinyl follows the body's curves and panel lines; every text
string spelled exactly as given; add no text that was not specified.

**Repeat the exact hex values and wordmark treatment in each view's instruction** rather than
writing "as on the side" — the model does not reliably carry a reference across a long prompt,
and inconsistency between views is the most common way these renders fail.

At bold, state the coverage rule explicitly: 100% of the painted bodywork, edge to edge —
hood, roof, doors, rear, bumpers, mirror caps, pillars — with graphics running across panel
gaps uninterrupted. Bare white body panels showing between graphics is a decal job, not a wrap.

Display type on a saturated field needs a heavy outline or layered offset. **Outlined
lettering may cross a colour boundary and stay legible; unoutlined lettering may not.**

**Size by containment, never by ratio.** The image model reliably honours "fills its own
black block edge to edge, spanning the full width of that block" and reliably ignores
"two-thirds the cap height of the wordmark" or "12% of panel height". Give every important
element its own colour field and say it fills that field. This bites hardest on the call to
action: specify it as a block that the number spans, not as a percentage.

**Only mention a logo if one was actually supplied.** Telling the model to reproduce a
supplied logo when there isn't one invites it to invent a mark.

Use `mcp__nanobanana-mcp__gemini_generate_image` for the base and
`mcp__nanobanana-mcp__gemini_edit_image` for each direction, passing the logo via
`reference_images` so the real mark is reproduced rather than invented. Prefer the `flash`
model — `gemini-3-pro-image` has no free-tier quota and 429s on every request.

## Step 4 — Critique the render, then revise

**This is the step that separates a good wrap from a lucky one. Actually look at the image.**

Score each render 1–10 and name the weakest thing:

| Score | What it looks like |
|---|---|
| 8–10 | Eye-catching, trade obvious, a signature you would remember, every view designed |
| 6–7 | Clear and competent, but nothing memorable — reads as any company in the trade |
| 3–5 | Trade unclear, colours competing, CTA mixed, or a view left near-empty |
| 1–2 | Generic mark on a half-empty body. Say the brand needs work first |

Check specifically:

- Can you tell the trade **without reading the small print**?
- Is the name unmistakably the largest thing?
- Do all three views show the **same** design — same hexes, same wordmark, same mascot?
- Is the rear as fully designed as the side, or was it left as an afterthought?
- At bold: any bare white body panel? Does the design reach hood, bumpers and mirror caps?
- Does any text cross a colour boundary unoutlined?
- Is any printed text garbled, misspelled, or a claim that was never supplied?
- Is the base saturated or near-black — or has it drifted mid-chroma?
- Is the signature specific to THIS business, or would it suit any competitor?
- Is it on the anti-default list in `wrapDesignSystem.js` for this treatment?

Then revise the prompt for whatever scored worst and re-render. One revision pass usually
moves a 6 to an 8. Do not ship a first render just because it came back clean.

## Anti-defaults

`wrapDesignSystem.js` holds the authoritative lists, split by treatment. The ones that apply
whichever treatment you chose:

- deep navy body + white condensed capitals + one orange accent + a generic mascot — the
  house default, and the fastest way to look machine-made
- a mid-chroma body with no anchor and no saturated field
- a plain rectangle of colour floating on an otherwise white body
- a thin pinstripe along the rocker with nothing above it
- small inset photographs; a photo is a full-bleed field with one colour over it, or nothing
- unoutlined text crossing a colour boundary
- garbled or invented text, and any credential that was not supplied
- gradients blending three or more hues into mud

Treatment-specific, and easy to get backwards:

- **At bold**, drop shadows, layered offsets and sports-jersey lettering are *correct* — they
  are how the strongest references survive being read at speed. Bare white panels and an
  under-filled rear are the failures.
- **At simple**, those same effects are wrong, along with any mascot, ornament, services list,
  second credential, or a CTA repeated within one view.

## Deliver

For each direction: the label, the colour strategy, the named signature, the palette as hex
with the role each colour plays, the exact strings that will be printed, the rationale, and
the render. Say which one you would lead with and why.

If the logo is too generic to build on, say so — the money is better spent on the identity
first, and a wrap cannot rescue it.
