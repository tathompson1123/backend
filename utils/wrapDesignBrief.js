// Turn a business's details into three vehicle-wrap design directions.
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
design their branding from that. Produce THREE distinct wrap directions.

A WRAP HAS FOUR JOBS. Judge every decision against these, in order:
  1. Catch the attention of the ideal client.
  2. Make it instantly clear WHO they are and WHAT THEY DO.
  3. Leave a positive impression of the brand.
  4. Give ONE clear direction for where to go next.
A wrap that is merely attractive has done job 1 and failed the other three.

THE REFERENCE BLOCK AT THE END OF THE INPUT IS AUTHORITATIVE on how dense the design should
be: how many elements, how many colours, whether there is a mascot, whether there is a
services list, and what may be repeated. Read it before you design anything, and follow it
over any general instinct toward restraint. This prompt sets the thinking; that block sets
the treatment.

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

THE THREE DIRECTIONS must be genuinely different bets, not restyles. Each names what is the
HERO of that design — the thing the eye lands on first:
- signature_led: the signature device is the hero and everything else is arranged around it.
  Under the dense treatment that is the mascot, at panel height; under the restrained
  treatment it is a single large geometric mark.
- wordmark_led: the business name itself, at maximum possible scale, IS the design. It spans
  the side. The signature is small or absent and the field geometry supports the type.
- field_led: the colour geometry is the hero — an unexpected split, a material field, a
  locality scene — with the name placed into it rather than sitting on top of it.

=== WRITING THE IMAGE PROMPTS ===

The render is a THREE-VIEW LAYOUT SHEET: one image containing the vehicle's side profile, its
front, and its rear, all of the same vehicle wrapped in the same design. You write four
pieces, and they are assembled into the instruction the image model paints from:

- design_spec: the design that is common to all three views. Exact hex values with the role
  each one plays, the field geometry and the divider device, the type treatment, the mascot
  (if any) described precisely enough to be drawn the same way three times, and the
  background scene or texture. This is what keeps the three views recognisably one design.
- side_prompt, front_prompt, rear_prompt: what goes where on each view.

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
present, say where the logo sits and how large. A photograph is only ever a full-bleed field
with one colour and one CTA over it — never a small inset, never tiled.

primaryColor and accentColor may have been sampled from the artwork rather than typed in, so
treat them as the brand's real colours. If the sampled primary is a mid-tone, darken or
saturate it rather than using it flat — a mid-chroma body is the worst outcome available.`;

// The tool is the output contract. Claude is forced to call it, so the response is a
// validated object rather than text that has to be parsed.
//
// The per-variant content manifest (wordmark, services_shown, credentials_shown, phone/website
// display strings) exists because prose prompts silently drop content. Making Claude commit to
// each string as its own field means the assembled image prompt provably contains them, and
// means the salesperson can see exactly what will be printed before spending a render.
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
        description: 'Before finalising, test the three directions against the reference block. Would these be the same for ANY business in this trade? Does any land on the anti-defaults list? At the dense treatment, is any view under-filled or any panel left bare white? Name what you changed as a result.',
      },
      variants: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ['signature_led', 'wordmark_led', 'field_led'] },
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
              description: 'The mascot described precisely enough to be drawn identically three times: what it is, its pose, what it holds, its colours, its drawing style. Empty string if this direction has none.',
            },

            design_spec: {
              type: 'string',
              description: 'The design common to all three views: exact hexes and their roles, field geometry and divider device, type treatment, mascot, background scene. This is what keeps the three views one design.',
            },
            side_prompt: { type: 'string', description: 'What goes where on the side profile view.' },
            front_prompt: { type: 'string', description: 'What goes where on the front view, including hood, bumper and mirror caps.' },
            rear_prompt: { type: 'string', description: 'What goes where on the rear view — usually the densest panel.' },
          },
          required: [
            'id', 'label', 'color_strategy', 'signature', 'rationale',
            'palette', 'wordmark', 'trade_descriptor', 'services_shown', 'credentials_shown',
            'phone_display', 'website_display',
            'design_spec', 'side_prompt', 'front_prompt', 'rear_prompt',
          ],
        },
      },
    },
    required: ['creative_summary', 'inferred_trade', 'brand_read', 'cta_type', 'dominant_message', 'self_critique', 'variants'],
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
 * Fold the shared spec and the three view prompts into the single instruction paintWrap
 * paints from. Assembled here rather than asked for as one field because a model writing
 * one long prose prompt reliably shortchanges the rear view — separate required fields
 * make skipping it impossible.
 */
function assembleImagePrompt(v) {
  const section = (title, body) => (body ? `\n\n${title}\n${body}` : '');
  return [
    'Apply this wrap design to all three views of the vehicle in the layout sheet.',
    section('THE DESIGN (identical across all three views):', v.design_spec),
    section('SIDE PROFILE VIEW — the large view:', v.side_prompt),
    section('FRONT VIEW:', v.front_prompt),
    section('REAR VIEW:', v.rear_prompt),
  ].join('');
}

/**
 * @param {object} business name, service, tagline, phone, website, colours, vehicle,
 *   designMode, designIntensity, and `content` — the supplied wrap copy
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

  // Show Claude the actual logo. Describing it in words was the weak link: the trade,
  // the brand's character and which colours are really the brand's are all things you
  // can only judge by looking.
  const messageContent = [];
  for (const item of artwork) {
    if (!item?.buffer) continue;
    // The real type, not the declared one — the API rejects a mismatch, and an upload's
    // Content-Type comes from its file extension.
    const mediaType = sniffImageType(item.buffer);
    if (!mediaType || !VISION_TYPES.includes(mediaType)) continue;
    messageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: item.buffer.toString('base64') },
    });
    messageContent.push({ type: 'text', text: `(above: ${item.label || 'artwork'})` });
  }
  messageContent.push({ type: 'text', text: JSON.stringify(business, null, 1) });
  messageContent.push({
    type: 'text',
    text: buildReferenceBlock(
      [business.businessName, business.service].filter(Boolean).join(' '),
      business.designIntensity,
      business.content || {}
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
      return { ...clean, image_prompt: assembleImagePrompt(clean) };
    })
    .filter(v => v.design_spec || v.side_prompt);

  if (brief.variants.length === 0) {
    throw new Error('Wrap brief came back with no usable design directions');
  }
  return brief;
}

module.exports = { generateWrapBrief, assembleImagePrompt, MODEL };
