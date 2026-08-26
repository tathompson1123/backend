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

Design rules, in priority order:
1. Three-second glance rule — the message must land instantly on a driver in traffic.
2. ONE dominant message. If several services are listed, pick the single strongest and lead with it; do not list everything.
3. Contact info large, bold, sans-serif, high contrast. Never script or condensed fonts.
4. The rear/tailgate is the highest-visibility zone in traffic — the strongest CTA and the phone number belong there.
5. High contrast beats busy imagery. Text never sits on a photo without a solid panel behind it.
6. At most 1-2 trust badges or credentials.
7. White space is doing work. Cluttered is worse than sparse.

The three directions must be genuinely different, not restyled versions of each other:
- bold_contrast: full-colour body, maximum visibility at distance.
- minimal_clean: light body, one accent block, logo-forward, restrained.
- rear_focus_cta: sides deliberately quiet, rear carries an oversized CTA.

Each image_prompt is an instruction for an image model that will paint the wrap onto a
photograph of the real vehicle. Write it zone by zone (hood / side panel / rear), give
exact colours as hex, give the exact text strings verbatim, and state the typography
weight and the contrast relationship. Always instruct it to preserve the vehicle's
shape, angle, wheels and lighting. If a logo is supplied it must be reproduced
faithfully and never redrawn or restyled.`;

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
