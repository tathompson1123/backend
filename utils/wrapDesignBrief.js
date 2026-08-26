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

const MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `You are a vehicle wrap design director. Given a business's details, produce THREE distinct wrap directions.

WHAT MAKES A WRAP WORK: brutal hierarchy and a disciplined palette. Not decoration. A
stranger at 40mph must know WHO this is and WHAT THEY DO before the vehicle has passed.
Restraint applies to how MANY things are on the panel; boldness applies to how BIG and how
COMMITTED the few things are. A timid design and a cluttered one fail the same way.

NON-NEGOTIABLES, every direction:

1. IDENTITY AT A GLANCE. The business name is by far the largest element on the vehicle —
   several times the size of anything else, filling roughly the upper two thirds of the side
   panel. If the name does not itself state the trade, a trade descriptor ("DOOR SERVICE",
   "PLUMBING", "ROOFING") sits DIRECTLY beneath it, smaller but still large and readable at
   distance. A viewer who cannot tell what the business does has seen a failed wrap.

2. TWO BRAND COLOURS PLUS ONE NEUTRAL. Exactly that — name the hex values and use nothing
   else. No third accent, no gradient blends, no rainbow. A tight palette is what reads as
   professional rather than homemade.

3. TYPE NEVER CROSSES A COLOUR BOUNDARY. Every text element sits wholly inside one flat
   field of colour. Lettering that runs from a dark field onto a light one loses half its
   legibility at distance, which is the whole game.

4. AT MOST FIVE TEXT ELEMENTS on the side: name, trade descriptor, website, phone (ONCE —
   never repeated on the same view), and at most one credential. Nothing else. Empty space
   in the brand colour is deliberate and should be described as such.

5. ONE IMPACT DEVICE, chosen per direction and never combined: either a friendly
   illustrated character/mascot (a technician holding a tool of the trade, clean vector
   style), or ONE oversized trade icon, or a bold split-colour field. It sits away from the
   lettering and never overlaps it.

6. THE REAR is the highest-visibility zone in stop-and-go traffic. The phone number and the
   strongest call to action belong there, large.

7. FULL-BLEED COMMITMENT. Colour runs off the panel edges and wraps the vehicle. A small
   rectangle of colour floating on an otherwise white van, or a thin pinstripe along the
   rocker, reads as a cheap decal job — never do either.

EXPLICITLY FORBIDDEN, because these are the exact ways this goes wrong: thin pinstripes
along the bottom; a plain floating rectangle panel on a white body; small inset
photographs; the phone number appearing more than once on one view; swooshes, waves or
flourishes added as filler; a large dead area with nothing in it and no colour commitment;
walls of services; script or condensed-italic fonts for contact details.

THE THREE DIRECTIONS must be genuinely different bets, not restyles:
- bold_contrast: the whole body is a full-bleed field of the primary brand colour, name at
  maximum possible scale in the neutral, plus the impact device. Maximum presence.
- minimal_clean: neutral/light body, name enormous in the primary colour, ONE decisive
  colour block or band anchoring the composition. Restrained in colour, never in scale.
- rear_focus_cta: the sides carry only the name and trade descriptor; the rear panel is an
  oversized CTA and phone block in the primary colour. Quiet sides, loud back.

Each image_prompt is an instruction for an image model painting the wrap onto a photograph
of the real vehicle. Write it zone by zone (front/hood, side panel, rear), give exact hex
colours, give the exact text strings verbatim, state the relative SIZE of each element, say
which flat colour field each text element sits on, and name the one impact device. Always
instruct it to preserve the vehicle's shape, angle, wheels and lighting, and to keep text
crisp and correctly spelled. If artwork is supplied, a logo must be reproduced faithfully
and never redrawn or restyled.

The input may include artworkCount and artworkNames — customer-supplied images (a logo,
sometimes real job photos). When artwork is present, say where the logo sits and how large.
A photograph is only ever used as a full-bleed duotone field tinted to the brand colours,
filling one zone, with text on a solid panel over it — never as a small inset, never tiled.

primaryColor and accentColor may have been sampled from that artwork rather than typed in,
so treat them as the brand's real colours and build the palette around them.`;

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
      dominant_message: {
        type: 'string',
        description: 'The single service or claim chosen to lead with, and one line on why.',
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
            rationale: { type: 'string', description: 'One sentence on what this direction is betting on.' },
            image_prompt: { type: 'string', description: 'Zone-by-zone instruction for the image model.' },
          },
          required: ['id', 'label', 'rationale', 'image_prompt'],
        },
      },
    },
    required: ['creative_summary', 'dominant_message', 'variants'],
  },
};

/**
 * @param {object} business name, service, tagline, phone, website, colours, vehicle
 * @param {number} userId for cost attribution
 * @returns {Promise<{creative_summary: string, dominant_message: string, variants: object[]}>}
 */
async function generateWrapBrief(business, userId) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [BRIEF_TOOL],
    // Forcing the tool is what makes the output structured rather than prose.
    tool_choice: { type: 'tool', name: 'submit_wrap_brief' },
    messages: [{
      role: 'user',
      content: JSON.stringify(business, null, 1),
    }],
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
