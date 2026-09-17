// Turn a business's details into two vehicle-wrap design directions.
//
// Claude does the judgment here — reading the trade off the artwork, choosing what to lead
// with, and writing the zone-by-zone instruction the image model paints from.
//
// WHAT LIVES WHERE. This system prompt holds only the rules that are true under BOTH
// treatments. Everything that differs between the dense trade-truck look and the restrained
// premium look — element count, colour count, mascots, service lists, drop shadows, whether
// contact details may repeat — lives in wrapDesignSystem's intensity blocks, which are
// injected per run. An earlier version had all of it here as one static set of rules, and
// because those rules were written for the restrained treatment they forbade almost
// everything that makes a trade-truck wrap work: the output came back sparse no matter what
// intensity was asked for.
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
design their branding from that. Produce TWO distinct wrap directions.

A WRAP HAS FOUR JOBS. Judge every decision against these, in order:
  1. Catch the attention of the ideal client.
  2. Make it instantly clear WHO they are and WHAT THEY DO.
  3. Leave a positive impression of the brand.
  4. Give ONE clear direction for where to go next.
A wrap that is merely attractive has done job 1 and failed the other three.

THE REFERENCE BLOCK AT THE END OF THE INPUT IS AUTHORITATIVE on how dense the design should
be: how many elements, how many colours, whether there is a mascot, whether there is a
services list, and what may be repeated. It is also AUTHORITATIVE on which panels are wrapped
at all — most runs are a full wrap, but some are a sides-only, sides-plus-rear, or spot-decal
partial wrap, and when that is the case the reference block overrides any view-by-view guidance
below that assumes every panel is wrapped: write side_prompt/front_prompt/rear_prompt to match
what the reference block says is actually wrapped on each view, including saying plainly that a
view is left in the vehicle's bare paint when that is what was asked for. Read the reference
block before you design anything, and follow it over any general instinct toward restraint.
This prompt sets the thinking; that block sets the treatment.

DESIGN MODE. The input carries designMode, and it changes how far you may go:

- designMode "evolve" — the business likes what it has and wants it respected. Keep their
  existing palette, their logo at real prominence, and the character of what they gave you.
  Improve hierarchy, legibility, spacing and colour balance; do not restructure the identity
  or introduce a new palette. The result should be recognisably theirs, done properly.
  In this mode EVERY colour must be traceable to the supplied artwork — a darker or lighter
  value of one of their colours is fine, a brand-new hue is not. If their palette has no
  bright colour to spotlight with, use a light/dark value contrast instead of inventing one.
  WHERE THIS CONFLICTS WITH THE COLOUR GUIDANCE ELSEWHERE, THIS SECTION WINS.

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

NEVER INVENT A FACTUAL CLAIM. "Licensed & insured", "24/7", "free estimates", "family owned",
"30 years experience", a star rating, a review count, a licence number, a guarantee — none of
these go on the vehicle unless they appear in the CONTENT INVENTORY you were given. You would
be printing a promise on someone's van that the business never made, and they would drive it
for five years. The same applies to services: name only the services you were actually given.
A TAGLINE is different — it is creative, not factual — and you may write one.

THE LOGO AND THE MASCOT ARE DIFFERENT THINGS. The logo is the customer's property: it is
reproduced faithfully, never redrawn, restyled, recoloured or relettered, and it is only ever
mentioned if artwork was actually supplied. A mascot is original artwork you commission for
this wrap; if the reference block permits one, drawing it does not conflict with logo
fidelity, and both appear on the vehicle. With no artwork supplied, say nothing about a logo
at all — telling the image model to "reproduce the supplied logo" when none exists invites it
to invent one.

MESSAGE — SELL THE OUTCOME, NOT THE COMMODITY:
- Lead with what the customer's life looks like afterwards, not the process. "Building your
  better outdoor lifestyle" beats "fence and deck stain". "Does your garage floor need a
  makeover?" beats a list of coating types. People do not want a deck; they want to live
  outdoors better.
- A tagline should be short and rhythmic ("Done once. Done right.").

THE CALL TO ACTION — one per view, unmistakable, and the second-largest thing on that view:
- For CONSIDERED purchases (remodelling, design-build, decks, landscaping, coatings, roof
  replacement) lead with the WEBSITE. These buyers want to size a company up before speaking
  to anyone, and a website does more of the selling than a phone call.
- For URGENT trades (plumbing, HVAC, electrical, water damage, locksmith, towing) lead with
  the PHONE, large. When something is broken now, nobody browses.
- Set cta_type to "website" or "phone" and say which in the rationale. The leading CTA may
  appear on more than one view — a driver only ever sees one view at a time — but two
  competing calls to action within a single view is why a viewer does nothing.

MATCH THE AESTHETIC TO THE TRADE, and never chase "cool" for its own sake:
- A roofer should look clean and pristine. A rugged, cracked, broken-apart treatment is cool
  and wrong — it suggests damage, which is exactly what the customer is trying to avoid.
- For DESIGN-SENSITIVE trades (remodelling, design-build, landscaping, interiors) the wrap's
  own design quality is part of the pitch: those buyers are judging whether you have the taste
  to work on their home. Push refinement.
- For FUNCTIONAL trades (fencing, hauling, drain clearing) the buyer asks "will it work" —
  clarity and trustworthiness matter more than sophistication.

THE TWO DIRECTIONS must be a genuine choice, not a restyle: one built around an original
character, one without one.
- character_led: an original mascot (see MASCOT SPECIFICATION) is the hero of this design, at
  panel height, with everything else arranged around it. Under a treatment that bans mascots
  (SIMPLE intensity has no character source available to it — see the reference block), this
  direction leans on the boldest single geometric signature available instead: wordplay,
  local identity, or a trade artifact. Never invent a mascot where the treatment forbids one.
- wordmark_led: no mascot, ever, regardless of intensity. The business name itself, at maximum
  possible scale, IS the design — it spans the side. Any signature stays small or absent, and
  the field geometry supports the type rather than competing with it.

TEXT BUDGET DIFFERS BETWEEN THE TWO DIRECTIONS, and this is not optional polish — it is the
difference between legible and garbled at the resolution these renders actually have. A
detailed mascot competes with adjacent text for the same limited pixel budget on its view;
asking that same view to also hold a six-item services block is how a name comes back as
recognisable letters and the services block next to it comes back as noise. So:
- On character_led's side view, the mascot is the content. Name, trade descriptor and the
  leading CTA only — no services block, no credential strip, no tagline crowding the panel the
  mascot already occupies.
- wordmark_led carries the services block and the credential strip instead, on whichever view
  in its own plan has room for them (ordinarily the side, per the view plan below) — it has no
  mascot competing for space, so it is the direction with room for that content, not merely
  permission to include it.
- Both directions still carry the phone/website CTA at full size on every view regardless —
  this rule is only about the services list and credential strip, not the calls to action.

=== WRITING THE IMAGE PROMPTS ===

The render is normally a THREE-VIEW LAYOUT SHEET: one image containing the vehicle's side
profile, its front, and its rear, all of the same vehicle wrapped in the same design. THE
REFERENCE BLOCK MAY OVERRIDE THIS for a partial wrap or spot-graphics job — a sides-only or
spot job renders as a single side-profile image, and sides+rear as a two-view sheet with no
front view at all. When the reference block's coverage override applies, follow it: write
only the fields it says matter, and leave the others as a short placeholder — they will not
reach the image model. You still write four pieces, and they are assembled into the
instruction the image model paints from:

- design_spec: the design that is common to every view actually being rendered. Exact hex
  values with the role each one plays, the field geometry and the divider device, the type
  treatment, the mascot (if any) described precisely enough to be drawn the same way on every
  view, and the background scene or texture. This is what keeps every view recognisably one
  design.
- side_prompt, front_prompt, rear_prompt: what goes where on each view that is actually
  rendered, per the coverage override.

In all four: give EXACT hex colours, give the exact text strings verbatim in quotes, and say
which flat colour field each text element sits on. Always require the vehicle's shape, angle,
wheels and lighting to be preserved, and the text to be crisp and correctly spelled.

SIZE BY CONTAINMENT, NOT BY RATIO. An image model reliably honours "fills its own black
block edge to edge, spanning the full width of that block" and reliably ignores "two-thirds
the cap height of the wordmark" or "12% of panel height". So give each important element its
own colour field and say it fills that field. This matters most for the call to action: put
it in a block of its own and have it span the block, rather than specifying a percentage.

CONSISTENCY ACROSS THE THREE VIEWS is the thing most likely to go wrong. Repeat the exact hex
values and the exact wordmark treatment in each view prompt rather than writing "as on the
side" — the image model does not reliably carry a reference across a long instruction.

The input may include artworkCount and artworkNames — customer-supplied images. When artwork is
present, say where the logo sits and how large — AND say what it sits on, because this is
where a wrap most often ends up looking like a sticker was slapped onto a finished design
rather than designed in from the start:
- First choice, and the common case: the logo sits DIRECTLY on one of the wrap's own colour
  fields, no background shape behind it at all. Most logos already carry their own outline or
  enough internal contrast to read on a solid field — say so, and say which field.
- Only if the logo's own colours would genuinely vanish against every field in the palette
  (e.g. dark text with no fill, on a dark base) does it get a background of its own — and that
  background must be a real, load-bearing part of the wrap's geometry: a corner of the same
  field split the divider already creates, or a panel bounded by the same angle as the main
  divider, sized close to the logo's own bounding shape. Never a rounded rectangle, never a
  card, never a shape that does not share an edge or an angle with something else already in
  the design — a shape invented solely to hold the logo is what makes it read as pasted on.
A photograph is only ever a full-bleed field with one colour and one CTA over it — never a
small inset, never tiled.

primaryColor and accentColor may have been sampled from the artwork rather than typed in, so
treat them as the brand's real colours. If the sampled primary is a mid-tone, darken or
saturate it rather than using it flat — a mid-chroma body is the worst outcome available.`;

// Shared between BRIEF_TOOL (two fresh variants) and REFINE_TOOL (one revised variant) — the
// per-variant shape is identical either way, only how many of them and what surrounds them
// differs. Kept in one place so the two tools can't silently drift apart on a field.
//
// The content manifest (wordmark, services_shown, credentials_shown, phone/website display
// strings) exists because prose prompts silently drop content. Making Claude commit to each
// string as its own field means the assembled image prompt provably contains them, and means
// the salesperson can see exactly what will be printed before spending a render.
const VARIANT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', enum: ['character_led', 'wordmark_led'] },
    label: { type: 'string', description: 'A short name for this direction the salesperson can say out loud.' },
    color_strategy: {
      type: 'string',
      enum: ['saturated_field', 'complementary_split', 'dark_anchor', 'committed_two_tone', 'material_field', 'heritage_field'],
      description: 'Which named colour strategy this direction uses. Use a different one per direction where the brand allows.',
    },
    signature: {
      type: 'string',
      description: 'The ONE thing this vehicle will be remembered by, and which source it came from (name wordplay, local identity, trade artifact, character, badge). Specific, not a category.',
    },
    rationale: { type: 'string', description: 'One sentence on what this direction is betting on.' },

    palette: {
      type: 'array',
      minItems: 2,
      description: 'Every colour in this design, with the job it does. Roles: field_primary, field_secondary, type, keyline, accent.',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          hex: { type: 'string', description: 'Six-digit hex, with the leading #.' },
        },
        required: ['role', 'hex'],
      },
    },
    wordmark: {
      type: 'string',
      description: 'The business name exactly as it will be set on the vehicle, including capitalisation and any line break shown as " / ".',
    },
    trade_descriptor: {
      type: 'string',
      description: 'The words that tell a stranger what this business does, exactly as they will appear.',
    },
    tagline: {
      type: 'string',
      description: 'The tagline as it will appear, or an empty string if this direction uses none. Creative, never a factual claim.',
    },
    services_shown: {
      type: 'array',
      items: { type: 'string' },
      description: 'The services printed on this design, verbatim from the supplied content inventory. Empty array if none were supplied or the treatment excludes them. Never invent one.',
    },
    credentials_shown: {
      type: 'array',
      items: { type: 'string' },
      description: 'The credential badges printed on this design, verbatim from the supplied content inventory. Empty array if none were supplied. Never invent one.',
    },
    phone_display: {
      type: 'string',
      description: 'The phone number formatted exactly as it will be printed, or an empty string if this design carries none.',
    },
    website_display: {
      type: 'string',
      description: 'The website exactly as it will be printed, or an empty string if this design carries none.',
    },
    mascot: {
      type: 'string',
      description: 'The mascot described precisely enough to be drawn identically on every view: what it is, its pose, what it holds, its colours, its drawing style. Empty string if this direction has none.',
    },

    design_spec: {
      type: 'string',
      description: 'The design common to every view actually rendered (see the reference block\'s coverage override): exact hexes and their roles, field geometry and divider device, type treatment, mascot, background scene. This is what keeps those views one design.',
    },
    side_prompt: { type: 'string', description: 'What goes where on the side profile view. Always used.' },
    front_prompt: { type: 'string', description: 'What goes where on the front view, including hood, bumper and mirror caps. Not used when the coverage override has no front view (sides-only, sides+rear, or spot graphics) — write a short placeholder in that case.' },
    rear_prompt: { type: 'string', description: 'What goes where on the rear view — usually the densest panel. Not used when the coverage override has no rear view (sides-only or spot graphics) — write a short placeholder in that case.' },
  },
  required: [
    'id', 'label', 'color_strategy', 'signature', 'rationale',
    'palette', 'wordmark', 'trade_descriptor', 'services_shown', 'credentials_shown',
    'phone_display', 'website_display',
    'design_spec', 'side_prompt', 'front_prompt', 'rear_prompt',
  ],
};

// The tool is the output contract. Claude is forced to call it, so the response is a
// validated object rather than text that has to be parsed.
const BRIEF_TOOL = {
  name: 'submit_wrap_brief',
  description: 'Return the two wrap design directions.',
  input_schema: {
    type: 'object',
    properties: {
      creative_summary: {
        type: 'string',
        description: 'Two or three sentences on the big idea, for the salesperson to read out.',
      },
      inferred_trade: {
        type: 'string',
        description: 'The trade this business is in, read from the name and artwork. One to four words, exactly as it would be said out loud: "Plumbing", "Garage Door Service", "Heating & Cooling". No parenthetical list of services, no dash-and-explanation, no HTML entities — write an ampersand as "&".',
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
        description: 'Before finalising, test the two directions against the reference block. Would these be the same for ANY business in this trade? Does any land on the anti-defaults list? At the dense treatment, is any view under-filled or any panel left bare white? Name what you changed as a result.',
      },
      variants: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: VARIANT_SCHEMA,
      },
    },
    required: ['creative_summary', 'inferred_trade', 'brand_read', 'cta_type', 'dominant_message', 'self_critique', 'variants'],
  },
};

// Same per-variant shape as BRIEF_TOOL, but returning exactly ONE revised variant rather than
// two fresh directions — see refineWrapVariant below.
const REFINE_TOOL = {
  name: 'submit_wrap_revision',
  description: 'Return the revised wrap variant.',
  input_schema: {
    type: 'object',
    properties: {
      change_summary: {
        type: 'string',
        description: 'One sentence on what actually changed and which fields it touched, for the salesperson to confirm before spending a render.',
      },
      variant: VARIANT_SCHEMA,
    },
    required: ['change_summary', 'variant'],
  },
};

// Claude occasionally HTML-escapes an ampersand inside a JSON string ("Heating &amp; Cooling").
// Harmless in most outputs; not here. These strings are instructions to an image model about
// text to print on a vehicle, and it prints what it is given — a five-year wrap reading
// "HEATING &AMP; COOLING". Decoded on the way out, so it cannot reach the paint step whichever
// field it lands in.
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

function decodeEntities(value) {
  if (typeof value === 'string') {
    return value.replace(/&(?:amp|quot|apos|#39|lt|gt|nbsp);/g, m => ENTITIES[m] || m);
  }
  if (Array.isArray(value)) return value.map(decodeEntities);
  return value;
}

/**
 * Fold the shared spec and the relevant view prompts into the single instruction paintWrap
 * paints from. Assembled here rather than asked for as one field because a model writing
 * one long prose prompt reliably shortchanges the rear view — separate required fields
 * make skipping it impossible.
 *
 * Which views are included depends on coverage: front_prompt/rear_prompt exist on every
 * variant regardless (the schema requires them), but a sides-only or spot job never rendered
 * a front or rear panel to paint, so including those sections here would hand the image model
 * instructions for a view it was never shown — dropped rather than assembled.
 *
 * @param {object} v the variant, with design_spec/side_prompt/front_prompt/rear_prompt
 * @param {'full'|'sides'|'sides_rear'|'spot'} coverage which views were actually rendered
 */
function assembleImagePrompt(v, coverage = 'full') {
  const section = (title, body) => (body ? `\n\n${title}\n${body}` : '');
  const hasFront = coverage === 'full';
  const hasRear = coverage === 'full' || coverage === 'sides_rear';
  const viewCount = hasFront && hasRear ? 'three views of the vehicle in the layout sheet'
    : hasRear ? 'two views of the vehicle in the layout sheet'
    : 'the vehicle in this image';

  return [
    `Apply this wrap design to ${viewCount}.`,
    section(`THE DESIGN (identical across ${hasFront || hasRear ? 'every view' : 'the vehicle'}):`, v.design_spec),
    section('SIDE PROFILE VIEW:', v.side_prompt),
    hasFront ? section('FRONT VIEW:', v.front_prompt) : '',
    hasRear ? section('REAR VIEW:', v.rear_prompt) : '',
  ].join('');
}

// Show Claude the actual logo/artwork rather than describing it in words — the trade, the
// brand's character and which colours are really the brand's are all things only visible by
// looking. Shared between generateWrapBrief and refineWrapVariant so both see artwork the
// same way.
function buildArtworkContent(artwork = []) {
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
  return content;
}

/**
 * @param {object} business name, service, tagline, phone, website, colours, vehicle,
 *   designMode, designIntensity, wrapCoverage, and `content` — the supplied wrap copy
 *   ({ services, badges, serviceArea, yearsInBusiness, socialHandle }).
 * @param {number} userId for cost attribution
 * @param {Array<{buffer: Buffer, mimeType: string, label: string}>} artwork
 * @returns {Promise<object>} the brief, each variant carrying an assembled image_prompt
 */
async function generateWrapBrief(business, userId, artwork = []) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messageContent = buildArtworkContent(artwork);
  messageContent.push({ type: 'text', text: JSON.stringify(business, null, 1) });
  messageContent.push({
    type: 'text',
    text: buildReferenceBlock(
      [business.businessName, business.service].filter(Boolean).join(' '),
      business.designIntensity,
      business.content || {},
      business.wrapCoverage
    ),
  });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 24000,
    system: SYSTEM_PROMPT,
    tools: [BRIEF_TOOL],
    // Forcing the tool is what makes the output structured rather than prose.
    tool_choice: { type: 'tool', name: 'submit_wrap_brief' },
    messages: [{ role: 'user', content: messageContent }],
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

  for (const key of ['inferred_trade', 'creative_summary', 'brand_read', 'brand_warning', 'dominant_message', 'self_critique']) {
    brief[key] = decodeEntities(brief[key]);
  }

  // Drop anything with no paintable instruction rather than sending an empty prompt to the
  // image model, which would return a blank white vehicle and burn a generation.
  const PRINTED = [
    'wordmark', 'trade_descriptor', 'tagline', 'services_shown', 'credentials_shown',
    'phone_display', 'website_display', 'mascot',
    'design_spec', 'side_prompt', 'front_prompt', 'rear_prompt',
  ];
  brief.variants = brief.variants
    .map(v => {
      const clean = { ...v };
      for (const key of PRINTED) clean[key] = decodeEntities(clean[key]);
      return { ...clean, image_prompt: assembleImagePrompt(clean, business.wrapCoverage) };
    })
    .filter(v => v.design_spec || v.side_prompt);

  if (brief.variants.length === 0) {
    throw new Error('Wrap brief came back with no usable design directions');
  }
  // Non-enumerable so it cannot leak into the JSONB the route stores or the JSON it
  // returns, but is still there for the test harness and for per-run spend reporting.
  Object.defineProperty(brief, 'usage', { value: response.usage, enumerable: false });
  return brief;
}

// This prompt holds only the rules a REVISION needs, not the full design-from-scratch
// judgment SYSTEM_PROMPT carries — a refine call is shown one existing, already-good variant
// and a specific complaint, not a blank page.
const REFINE_SYSTEM_PROMPT = `You are revising ONE existing vehicle wrap design based on
specific feedback from the salesperson or customer who has already seen the render. You are
not designing from scratch — you are shown the exact current variant, field by field, and a
description of what should change about it.

CHANGE ONLY WHAT THE REQUESTED REVISION REQUIRES. Every field in the current variant that the
revision doesn't touch is copied through unchanged — same hex values, same wordmark treatment,
same mascot, same text, character for character. A revision that rewrites fields nobody asked
to change produces a different design, not a refined one, and the whole point of this step is
that the salesperson already liked most of what they have.

THE REVISION INSTRUCTION IS DIRECT HUMAN SIGN-OFF, not a general design brief. If it asks for
specific text that wasn't in the original design ("add 'Est. 2010'", "change the phone number
to..."), that is authorized — a person looked at the render and asked for it on purpose. This
is different from generating a NEW design, where inventing unsupplied claims is forbidden.
Still never invent something the instruction and the current variant didn't between them
already establish — if the instruction says "make it pop more" with no specifics, use your
judgment on the EXISTING palette and signature rather than introducing a new claim or a new
element that wasn't asked for.

IF THE CHANGE AFFECTS WHAT'S PAINTED (colour, sizing, layout, mascot, added or changed text),
update design_spec and every view prompt it appears in so the instruction the image model
receives fully reflects the change — never leave a view prompt with stale wording that
contradicts what design_spec now says. If the change is about something already described
precisely enough (e.g. "make the mascot bigger"), update the sizing language in the relevant
view prompt(s) directly.

THE REFERENCE BLOCK AT THE END OF THE INPUT still applies: it says which views exist for this
coverage (a partial or spot-graphics job may only have a side view — never add a front or rear
treatment that will never be rendered), and it still carries the anti-defaults and mascot
rules that governed the original design. A revision does not get to reintroduce something the
treatment forbids.

WRITING THE VIEW PROMPTS follows the same rules as the original design: exact hex colours,
exact text strings in quotes, say which flat colour field each text element sits on, and size
by containment ("fills its own colour field edge to edge") rather than by percentage.

Return the COMPLETE variant with every field present — this is not a diff, it is the full
variant paintWrap will paint from next.`;

/**
 * Revise ONE existing variant based on specific feedback, rather than generating fresh
 * directions. The caller (routes/tools.js's POST /wrap-mockup/:id/refine) re-paints from the
 * SAME base image and references the original run used — this function only produces the
 * updated creative fields and the image_prompt to paint them from.
 *
 * @param {object} business the same shape generateWrapBrief takes, reconstructed from the
 *   original request's stored request_context
 * @param {object} currentVariant the variant as it stands now (including design_spec/
 *   side_prompt/front_prompt/rear_prompt from the last render or refinement)
 * @param {string} instruction free-text description of the requested change
 * @param {number} userId for cost attribution
 * @param {Array<{buffer: Buffer, mimeType: string, label: string}>} artwork the original
 *   reference artwork, re-fetched by the route from where it was originally uploaded
 * @returns {Promise<object>} the revised variant, carrying a freshly assembled image_prompt
 *   and a change_summary
 */
async function refineWrapVariant(business, currentVariant, instruction, userId, artwork = []) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  if (!instruction?.trim()) {
    throw new Error('A revision instruction is required');
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messageContent = buildArtworkContent(artwork);
  messageContent.push({
    type: 'text',
    text: JSON.stringify({ business, current_variant: currentVariant, requested_change: instruction }, null, 1),
  });
  messageContent.push({
    type: 'text',
    text: buildReferenceBlock(
      [business.businessName, business.service].filter(Boolean).join(' '),
      business.designIntensity,
      business.content || {},
      business.wrapCoverage
    ),
  });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 24000,
    system: REFINE_SYSTEM_PROMPT,
    tools: [REFINE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_wrap_revision' },
    messages: [{ role: 'user', content: messageContent }],
  });

  logClaudeUsage(userId, MODEL, response.usage, 'wrap_mockup_refine');

  const toolUse = response.content.find(block => block.type === 'tool_use');
  if (!toolUse?.input?.variant) {
    throw new Error(`Claude did not return a wrap revision (stop_reason: ${response.stop_reason})`);
  }

  const revised = toolUse.input.variant;
  const PRINTED = [
    'wordmark', 'trade_descriptor', 'tagline', 'services_shown', 'credentials_shown',
    'phone_display', 'website_display', 'mascot',
    'design_spec', 'side_prompt', 'front_prompt', 'rear_prompt',
  ];
  for (const key of PRINTED) revised[key] = decodeEntities(revised[key]);

  if (!revised.design_spec && !revised.side_prompt) {
    throw new Error('Wrap revision came back with no usable design');
  }

  revised.image_prompt = assembleImagePrompt(revised, business.wrapCoverage);
  revised.change_summary = decodeEntities(toolUse.input.change_summary);
  Object.defineProperty(revised, 'usage', { value: response.usage, enumerable: false });
  return revised;
}

module.exports = { generateWrapBrief, refineWrapVariant, assembleImagePrompt, MODEL };
