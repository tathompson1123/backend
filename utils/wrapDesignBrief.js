// Turn a business's details into three vehicle-wrap design directions.
//
// Claude does the judgment here — deciding which single service to lead with, and
// writing the zone-by-zone instruction the image model paints from. The design rules
// come from a wrap-teardown critique: a wrap has about three seconds to land on
// someone in traffic, so one message, huge contact info, and the rear panel doing the
// heavy lifting.
//
// Structured output is via FORCED TOOL USE rather than output_config.format: this repo
// is on @anthropic-ai/sdk 0.32.1, which predates that parameter. Forcing a tool means
// Claude returns `tool_use.input` as an object the API has already validated against
// the schema — so no fenced-JSON stripping and no JSON.parse that can throw on prose.

const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('./claudeUsage');
const { sniffImageType } = require('./imageType');
const { buildReferenceBlock } = require('./wrapDesignSystem');

const MODEL = 'claude-opus-5';

// What the Messages API accepts as an image block. Anything else (SVG, HEIC, PDF) is
// skipped for the brief rather than failing the run — it still reaches the image model.
const VISION_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const SYSTEM_PROMPT = `You are a vehicle wrap design director. You are given very little — a business
name, a phone number, a website, and the customer's existing logo or artwork — and you
design their branding from that. Produce THREE distinct wrap directions.

A WRAP HAS FOUR JOBS. Judge every decision against these, in order:
  1. Catch the attention of the ideal client.
  2. Make it instantly clear WHO they are and WHAT THEY DO.
  3. Leave a positive impression of the brand.
  4. Give ONE clear direction for where to go next.
A wrap that is merely attractive has done job 1 and failed the other three.

DESIGN MODE. The input carries designMode, and it changes how far you may go:

- designMode "evolve" — the business likes what it has and wants it respected. Keep their
  existing palette, their logo at real prominence, and the character of what they gave you.
  Improve hierarchy, legibility, spacing and colour balance; do not restructure the identity
  or introduce a new palette. The result should be recognisably theirs, done properly.
  In this mode EVERY colour must be traceable to the supplied artwork — a darker or lighter
  value of one of their colours is fine, a brand-new hue is not. If their palette has no
  bright colour to spotlight with, use a light/dark value contrast instead of inventing one.
  WHERE THIS CONFLICTS WITH THE COLOUR GUIDANCE BELOW, THIS SECTION WINS.

- designMode "reinvent" — the business wants a real branded vehicle and has given you
  permission to start over. Treat the supplied logo as ONE element to place, not as the
  design. Build a new colour strategy, a new dominant idea, a new layout. Be bold. This is
  the default when designMode is absent.

YOU ARE SHOWN THE ARTWORK. Read it before deciding anything:
- What trade is this? The name or logo usually says it; if not, the imagery will. Put your
  answer in inferred_trade — that word goes on the vehicle, because a viewer who cannot tell
  what the business does has seen a failed wrap.
- What are the brand's real colours? Take them from the logo. Ignore its white background.
- What is its character — established and trustworthy, or modern and sharp? Match it.
- The logo is the SEED of the brand. A generic logo produces a generic wrap. If the mark says
  nothing about the trade and carries no distinct quality (an initialism plus a stock emblem —
  "SSP Coatings" with a Spartan helmet), set brand_warning saying so plainly: a wrap can only
  do so much, and the money is better spent on the brand first. Design the best wrap you can
  regardless.
- Never invent a claim ("lowest prices", "24/7", "licensed & insured") unless it appears in
  what you were given. You would be putting a promise on a van the business never made.

COLOUR — THIS IS WHAT MAKES A WRAP CARRY AT DISTANCE:
- A DARK, COMMITTED BASE over most of the body: black, charcoal, deep navy, deep forest.
  A mid-tone body (mid blue, mid grey) is the single most common reason a wrap looks flat —
  it neither anchors nor pops.
- A LITTLE white or off-white, for the large type.
- ONE high-chroma accent — yellow, orange, red, electric cyan, lime — used on a SMALL area
  only, to pull the eye to the two or three things that matter most: the trade word, the call
  to action, a rule under the name. It is a spotlight, not a second base colour.
- Work that same accent into ONE physical detail of the vehicle so the design looks made for
  this van rather than pasted onto it — a wheel detail, a mirror cap, a bumper line, the roof
  rack. This is the touch that separates a real wrap from a decal job.
- Three colours total in the WRAP DESIGN. Never four. The logo's own colours do not count
  against this — it is reproduced faithfully as supplied.
- A muted two-tone (grey and beige) can also read as bold when the split is committed and the
  shapes are clean — but only when the two tones differ strongly in value.
- In "evolve" mode, apply this by deepening and rebalancing THEIR colours rather than
  replacing them: darken the base, reserve their brightest hue as the small-area accent.

MESSAGE — SELL THE OUTCOME, NOT THE COMMODITY:
- Lead with what the customer's life looks like afterwards, not the process. "Building your
  better outdoor lifestyle" beats "fence and deck stain". "Does your garage floor need a
  makeover?" beats a list of coating types. People do not want a deck; they want to live
  outdoors better.
- Use the open space for ONE short line aimed at the customer — a question or an offer — never
  a feature list and never more photographs of the work.
- A tagline should be short and rhythmic if used at all ("Done once. Done right.").

WHAT GOES ON THE VEHICLE — nothing else:
  business name (largest element by a wide margin), trade descriptor directly beneath it if
  the name does not state the trade, ONE outcome line, ONE primary call to action, and at most
  one credential. Five elements maximum.

THE CALL TO ACTION — one, unmistakable, and the second-largest thing on the wrap:
- For CONSIDERED purchases (remodelling, design-build, decks, landscaping, coatings, roof
  replacement) lead with the WEBSITE. These buyers want to size a company up before speaking
  to anyone, and a website does more of the selling than a phone call. A phone number may
  appear once, smaller.
- For URGENT trades (plumbing, HVAC, electrical, water damage, locksmith, towing) lead with
  the PHONE, large. When something is broken now, nobody browses.
- Set cta_type to "website" or "phone" and say which in the rationale. Never give both equal
  weight, and never repeat either on the same view — mixed CTAs are why a viewer does nothing.

MATCH THE AESTHETIC TO THE TRADE, and never chase "cool" for its own sake:
- A roofer should look clean and pristine. A rugged, cracked, broken-apart treatment is cool
  and wrong — it suggests damage, which is exactly what the customer is trying to avoid.
- For DESIGN-SENSITIVE trades (remodelling, design-build, landscaping, interiors) the wrap's
  own design quality is part of the pitch: those buyers are judging whether you have the taste
  to work on their home. Push refinement.
- For FUNCTIONAL trades (fencing, hauling, drain clearing) the buyer asks "will it work" —
  clarity and trustworthiness matter more than sophistication.
- Signal longevity with classic typography, never with dated effects. Bevels, drop shadows,
  glossy gradients and textured backgrounds read as old, not established. A modern take on a
  classic is the target.

SERVICE LISTS: avoid. If the trade genuinely is not clear without one, integrate it into the
wrap's own geometry — inside a shape the design already has — so it reads as designed rather
than pasted on. Never a bulleted list.

EXPLICITLY FORBIDDEN, because these are the exact ways this goes wrong: a mid-tone body with
no dark anchor and no hot accent; thin pinstripes along the rocker; a plain floating rectangle
panel on a white body; small inset photographs; a photograph used at all unless it is a
full-bleed field with exactly ONE colour and one CTA over it; several colours competing; the
phone number or website appearing twice on one view; swooshes, waves or flourishes as filler;
a large dead area with no colour commitment; bulleted service lists; script or
condensed-italic fonts for contact details.

THE THREE DIRECTIONS must be genuinely different bets, not restyles:
- bold_contrast: dark full-bleed base, name at maximum scale in white, the hot accent
  spotlighting the CTA and one vehicle detail. Maximum presence.
- minimal_clean: light or off-white body, name enormous in the dark brand colour, ONE decisive
  block of the accent anchoring the composition. Restrained in colour, never in scale.
- rear_focus_cta: sides carry only name and trade; the rear is an oversized outcome line and
  CTA in the accent. Quiet sides, loud back.

Each image_prompt is an instruction for an image model painting the wrap onto a photograph of
the real vehicle. Write it zone by zone (front/hood, side panel, rear, and the one vehicle
detail carrying the accent), give exact hex colours, give the exact text strings verbatim,
state the relative SIZE of each element, and say which flat colour field each text element
sits on. Always instruct it to preserve the vehicle's shape, angle, wheels and lighting, and
to keep text crisp and correctly spelled. A supplied logo must be reproduced faithfully and
never redrawn or restyled.

The input may include artworkCount and artworkNames — customer-supplied images. When artwork is
present, say where the logo sits and how large. A photograph is only ever a full-bleed field
with one colour and one CTA over it — never a small inset, never tiled.

primaryColor and accentColor may have been sampled from the artwork rather than typed in, so
treat them as the brand's real colours. If the sampled primary is a mid-tone, darken it for the
base and reserve a brighter relative as the accent rather than using it flat.`;

// The tool is the output contract. Claude is forced to call it, so the response is a
// validated object rather than text that has to be parsed.
const BRIEF_TOOL = {
  name: 'submit_wrap_brief',
  description: 'Return the three wrap design directions.',
  input_schema: {
    type: 'object',
    properties: {
      creative_summary: {
        type: 'string',
        description: 'Two or three sentences on the big idea, for the salesperson to read out.',
      },
      inferred_trade: {
        type: 'string',
        description: 'The trade this business is in, read from the name and artwork (e.g. "Plumbing", "Garage Door Service"). This is what goes on the vehicle as the descriptor.',
      },
      brand_read: {
        type: 'string',
        description: 'One or two sentences on what the artwork says about the brand: its palette, its character, and how formal or friendly it reads.',
      },
      brand_warning: {
        type: 'string',
        description: 'Only if the supplied logo is too generic to build a brand on (an initialism plus a stock emblem, nothing that says what they do). Say so plainly and briefly, so the salesperson can raise it. Omit otherwise.',
      },
      cta_type: {
        type: 'string',
        enum: ['website', 'phone'],
        description: 'Which single call to action leads. Website for considered purchases, phone for urgent trades.',
      },
      dominant_message: {
        type: 'string',
        description: 'The single service or claim chosen to lead with, and one line on why.',
      },
      self_critique: {
        type: 'string',
        description: 'Before finalising, test the three directions: would these be the same for ANY business in this trade? Does any of them land on the anti-default list? Name what you changed as a result. If nothing needed changing, say why they are already specific to THIS business.',
      },
      variants: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ['bold_contrast', 'minimal_clean', 'rear_focus_cta'] },
            label: { type: 'string' },
            color_strategy: {
              type: 'string',
              enum: ['saturated_field', 'complementary_split', 'dark_anchor', 'committed_two_tone', 'material_field'],
              description: 'Which named colour strategy this direction uses. Use a different one per direction where the brand allows.',
            },
            signature: {
              type: 'string',
              description: 'The ONE thing this vehicle will be remembered by, and which source it came from (name wordplay, local identity, trade artifact, character, badge). Specific, not a category.',
            },
            rationale: { type: 'string', description: 'One sentence on what this direction is betting on.' },
            image_prompt: { type: 'string', description: 'Zone-by-zone instruction for the image model.' },
          },
          required: ['id', 'label', 'color_strategy', 'signature', 'rationale', 'image_prompt'],
        },
      },
    },
    required: ['creative_summary', 'inferred_trade', 'brand_read', 'cta_type', 'dominant_message', 'self_critique', 'variants'],
  },
};

/**
 * @param {object} business name, service, tagline, phone, website, colours, vehicle
 * @param {number} userId for cost attribution
 * @returns {Promise<{creative_summary: string, dominant_message: string, variants: object[]}>}
 */
async function generateWrapBrief(business, userId, artwork = []) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Show Claude the actual logo. Describing it in words was the weak link: the trade,
  // the brand's character and which colours are really the brand's are all things you
  // can only judge by looking.
  const content = [];
  for (const item of artwork) {
    if (!item?.buffer) continue;
    // The real type, not the declared one — the API rejects a mismatch, and an upload's
    // Content-Type comes from its file extension.
    const mediaType = sniffImageType(item.buffer);
    if (!mediaType || !VISION_TYPES.includes(mediaType)) continue;
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: item.buffer.toString('base64') },
    });
    content.push({ type: 'text', text: `(above: ${item.label || 'artwork'})` });
  }
  content.push({ type: 'text', text: JSON.stringify(business, null, 1) });
  content.push({
    type: 'text',
    text: buildReferenceBlock(
      [business.businessName, business.service].filter(Boolean).join(' '),
      business.designIntensity
    ),
  });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [BRIEF_TOOL],
    // Forcing the tool is what makes the output structured rather than prose.
    tool_choice: { type: 'tool', name: 'submit_wrap_brief' },
    messages: [{ role: 'user', content }],
  });

  logClaudeUsage(userId, MODEL, response.usage, 'wrap_mockup_brief');

  const toolUse = response.content.find(block => block.type === 'tool_use');
  if (!toolUse?.input) {
    // Only reachable if the model refuses or the tool call is stripped; surfacing it
    // beats returning an empty brief the image step would silently paint nothing from.
    throw new Error(`Claude did not return a wrap brief (stop_reason: ${response.stop_reason})`);
  }

  const brief = toolUse.input;
  if (!Array.isArray(brief.variants) || brief.variants.length === 0) {
    throw new Error('Wrap brief came back with no variants');
  }
  return brief;
}

module.exports = { generateWrapBrief, MODEL };
