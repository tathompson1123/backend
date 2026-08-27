// Design intelligence for the wrap generator.
//
// Format rules alone produce a template. The first version of the wrap prompt said only
// how big things should be and how many colours were allowed, which is why every trade
// came back as the same van in a different hue. This file supplies the other half: where
// a distinctive idea comes FROM, and several named ways to be bold rather than one.
//
// Derived from a corpus of wraps that work (Totally Hooked Plumbing, Duval Floor Care,
// A1 Garage Door Service, The Garage Floor Company, Granite Garage Floors, On Point Home
// Maintenance) plus a teardown critique of wraps that don't.

// ── Colour strategies ────────────────────────────────────────────────────────
//
// The earlier rule — "dark committed base plus one small hot accent" — described exactly
// one of these and forbade the rest. It would have rejected A1's saturated red, Totally
// Hooked's lime, and The Garage Floor Company's orange. The real variable is CHROMA
// COMMITMENT: a fully saturated field reads boldly, a mid-chroma one (the medium blue van
// that fell flat) commits to nothing.

const COLOR_STRATEGIES = [
  {
    id: 'saturated_field',
    name: 'Saturated Field',
    recipe: 'One fully saturated high-chroma colour over most of the body (red, orange, lime, electric blue), a neutral band (cream or white) carrying the secondary text, and black or near-black for outlines and anchoring.',
    when: 'Default for trades that want to be seen and remembered. Strongest for urgent and everyday home services.',
    intensity: ['bold', 'simple'],
    reference: 'A1 Garage Door Service (red), The Garage Floor Company (orange/navy)',
  },
  {
    id: 'complementary_split',
    name: 'Complementary Split',
    recipe: 'TWO large fields of complementary colour at full chroma, split by a named divider device, each field carrying its own text so nothing has to fight a busy background.',
    when: 'When the brand has two real colours, or when maximum visual energy is wanted. The most eye-catching of the strategies.',
    intensity: ['bold'],
    reference: 'Totally Hooked (lime/deep blue, halftone dot split), Duval Floor Care (red/cyan)',
  },
  {
    id: 'dark_anchor',
    name: 'Dark Anchor',
    recipe: 'Near-black or charcoal over most of the body, a little white for the large type, and ONE high-chroma accent used on a small area to spotlight the two or three things that matter — then that same accent repeated on one physical detail of the vehicle.',
    when: 'Premium and specialist positioning, where restraint reads as expensive.',
    intensity: ['bold', 'simple'],
    reference: 'Granite Garage Floors (black/white/yellow, accent repeated on a brake pad)',
  },
  {
    id: 'committed_two_tone',
    name: 'Committed Two-Tone',
    recipe: 'Two muted colours in a hard, clean split with a large value difference between them. No third colour at all.',
    when: 'Professional and considered services — notary, accountancy, consultancy, design-build — where a saturated wrap would undercut the credibility.',
    intensity: ['simple'],
    reference: 'On Point Home Maintenance (grey/beige), Juris Notary (grey/maroon)',
  },
  {
    id: 'material_field',
    name: 'Material Field',
    recipe: 'The whole wrap becomes the material the trade works in — wood grain, stone, turf, water — then exactly ONE overlay colour on top carrying all the type, and one call to action.',
    when: 'When the material itself is the selling point and instantly recognisable.',
    intensity: ['bold'],
    reference: 'A Sydney decking company wrapped entirely in timber with a single overlay colour',
  },
];

// ── Where a signature comes from ─────────────────────────────────────────────
//
// A menu of three devices (mascot / icon / split field) is itself a template. These are
// SOURCES to mine, not shapes to pick — the name and the locality turned out to be the
// two richest, and both were missing from the first version.

const SIGNATURE_SOURCES = [
  {
    id: 'name_wordplay',
    prompt: 'Is there a pun, image or double meaning inside the business name? Build the signature out of it. This is the single richest source and the most defensible, because no competitor shares the name.',
    reference: '"Totally Hooked" Plumbing carries a cartoon fish in a backwards cap — the name made the mascot',
  },
  {
    id: 'local_identity',
    prompt: 'Is the name or service area tied to a place? A skyline, bridge, mountain, county outline or local landmark makes the vehicle unmistakably of here, which is exactly what a local buyer responds to.',
    reference: 'Duval Floor Care carries the Jacksonville skyline inside a map-pin shield',
  },
  {
    id: 'trade_artifact',
    prompt: 'Take one object, material or gesture from the trade\'s own working world and blow it up: shingle courses, a pipe wrench, plank shapes, a garage door\'s panel lines, turf stripes. Oversized and cropped, not a small clip-art icon.',
    reference: 'Duval renders the lower panel as overlapping floor planks — the pattern IS the product',
  },
  {
    id: 'character',
    prompt: 'A friendly illustrated person or creature, drawn cleanly, confident rather than goofy. People trust a face. Only if it earns its place — never a stock mascot bolted on.',
    reference: 'A1 Garage Door Service, Totally Hooked, Surf\'s Pup',
  },
  {
    id: 'badge_lockup',
    prompt: 'A crest, seal or badge containing the name, sitting on a radiating or textured ground. Reads established and classic without reading dated.',
    reference: 'The Garage Floor Company — badge lockup over a sunburst',
  },
];

// ── Divider devices ──────────────────────────────────────────────────────────
//
// Every wrap in the corpus joins its colour fields with a named device. Banning
// "swooshes" outright was an over-correction: filler is a flourish with nothing either
// side of it, whereas these are the structural join between two fields.

const DIVIDER_DEVICES = [
  'halftone dot dissolve (one field breaking into dots across the other)',
  'a single hard diagonal',
  'a sweeping wave with a clean edge',
  'shapes borrowed from the trade\'s material (plank ends, shingle courses, pipe sections)',
  'an angular slash cropped by the body panel',
  'a chevron or arrow implying forward motion',
];

// ── Anti-defaults ────────────────────────────────────────────────────────────
//
// Named because the generator's own habits belong on this list too. Without it the same
// van comes back for a plumber, a roofer and a landscaper, differing only in the noun.

const ANTI_DEFAULTS = [
  'deep navy body + white condensed capitals + one orange accent + a generic mascot — this generator\'s own default, and the fastest way to look machine-made',
  'the category colour: nearly every plumber is blue, every landscaper green, every HVAC red-and-blue. On a road full of blue plumbing vans, the way to be noticed is not to be blue',
  'a mid-chroma body (medium blue, medium grey) with no dark anchor and no saturated field — commits to nothing',
  'a plain rectangle of colour floating on an otherwise white body',
  'a thin pinstripe along the rocker',
  'a bulleted list of services',
  'small inset photographs',
  'text unoutlined across a colour boundary',
  'the same call to action repeated twice on one view',
  'gradients blending three or more hues',
];

// ── Trade worlds ─────────────────────────────────────────────────────────────
//
// `avoid` is the category colour — the thing every competitor already looks like.
// `urgency` decides whether the phone or the website leads. `designSensitivity` decides
// whether the buyer is judging the taste of the wrap itself.

const TRADE_WORLDS = {
  plumbing: {
    artifacts: 'pipe wrench, copper pipe, brass fittings, water droplets, pressure gauge',
    outcome: 'water working again, and no mess left behind',
    avoid: 'blue — the entire category is blue',
    urgency: 'emergency', designSensitivity: 'low',
  },
  hvac: {
    artifacts: 'fan blades, airflow lines, thermostat dial, snowflake and flame pairing',
    outcome: 'a house that is comfortable again, today',
    avoid: 'the red-and-blue hot/cold split every competitor uses',
    urgency: 'emergency', designSensitivity: 'low',
  },
  electrical: {
    artifacts: 'bolt, conduit, switch plate, filament, wire gauge',
    outcome: 'power back on, safely and to code',
    avoid: 'yellow-and-black hazard striping',
    urgency: 'emergency', designSensitivity: 'low',
  },
  roofing: {
    artifacts: 'shingle courses, ridgeline, roof pitch, gutter line, skyline silhouette',
    outcome: 'a roof that stops worrying you when it rains',
    avoid: 'storm imagery and cracked or broken textures — they suggest damage, which is what the customer is trying to escape',
    urgency: 'considered', designSensitivity: 'medium',
  },
  garage_doors: {
    artifacts: 'door panel lines, spring coil, opener rail, the geometry of a rising door',
    outcome: 'a door that opens quietly, every morning',
    avoid: 'a plain photograph of a garage door',
    urgency: 'emergency', designSensitivity: 'low',
  },
  flooring: {
    artifacts: 'plank patterns, tile grid, grout lines, carpet pile, wood grain',
    outcome: 'floors that make the whole room look new',
    avoid: 'a beige-on-beige palette taken from the flooring itself',
    urgency: 'considered', designSensitivity: 'high',
  },
  landscaping: {
    artifacts: 'mower stripes, leaf silhouettes, hedge geometry, stone edging',
    outcome: 'a yard the neighbours notice',
    avoid: 'green — the entire category is green',
    urgency: 'considered', designSensitivity: 'high',
  },
  auto_detailing: {
    artifacts: 'water beading on a clear coat, reflection highlights, buffer swirl, microfibre',
    outcome: 'a car that looks better than the day it was bought',
    avoid: 'black-on-black, and chrome gradient lettering',
    urgency: 'considered', designSensitivity: 'high',
  },
  cleaning: {
    artifacts: 'bubbles, a squeegee edge, a gleam or sparkle mark, folded linen',
    outcome: 'walking into a home that feels reset',
    avoid: 'pale blue and a sparkle cluster',
    urgency: 'considered', designSensitivity: 'medium',
  },
  pest_control: {
    artifacts: 'a shield, a perimeter line, an oversized stylised insect silhouette',
    outcome: 'a house that is yours again',
    avoid: 'cartoon bugs in party hats — it trivialises the problem',
    urgency: 'emergency', designSensitivity: 'low',
  },
  remodeling: {
    artifacts: 'a folding rule, blueprint lines, a mitre joint, tile and timber pairings',
    outcome: 'the room you actually wanted to live in',
    avoid: 'before-and-after photo pairs, and a hard-hat clip-art icon',
    urgency: 'considered', designSensitivity: 'high',
  },
  professional_services: {
    artifacts: 'a seal, a signature stroke, a document corner, a monogram',
    outcome: 'paperwork handled properly, without a trip into an office',
    avoid: 'anything saturated — it undercuts the credibility this buyer is looking for',
    urgency: 'considered', designSensitivity: 'high',
  },
};

// What "simple" means, defined by what it REMOVES. Dialling down commitment instead would
// reproduce the flat mid-tone van that started all this — restraint and timidity look
// nothing alike on the road.
function intensityBlock(level) {
  if (level === 'simple') {
    return [
      'INTENSITY: SIMPLE. The customer wants restraint. Simple means FEWER ELEMENTS AND A',
      'NARROWER PALETTE — it does NOT mean less commitment or less clarity. Specifically:',
      '- No character or mascot. No sunburst, no halftone, no ornament of any kind.',
      '- At most ONE geometric signature, and it stays quiet: a single hard edge, a monogram,',
      '  a cropped silhouette. Large, but never loud.',
      '- Two colours, or two plus black. One flat field, one hard division, no gradients.',
      '- One type family, one or two weights. No layered outlines, no sports-jersey treatment.',
      '- Generous empty space in the base colour is the point, not a gap to be filled.',
      '',
      'STILL NON-NEGOTIABLE, exactly as in bold: full chroma commitment on the base (a mid-tone',
      'body remains the worst outcome available), the name still the largest thing by a wide',
      'margin, the trade still readable at a glance, and one unmistakable call to action.',
      'A simple wrap is a disciplined wrap, never a timid one. A hard grey-and-beige two-tone',
      'reads as more confident than a busy wrap; a washed-out mid-blue van reads as nothing.',
      '',
    ].join('\n');
  }
  return [
    'INTENSITY: BOLD. Maximum presence — saturated colour, an oversized signature, and a',
    'divider device with real energy. This is the default.',
    '',
  ].join('\n');
}

/** Nearest trade entry for a free-text trade string, or null. */
function matchTrade(trade) {
  const text = String(trade || '').toLowerCase();
  const aliases = {
    plumbing: ['plumb', 'drain', 'sewer', 'rooter', 'water heater'],
    hvac: ['hvac', 'heating', 'cooling', 'air condition', 'furnace'],
    electrical: ['electric', 'sparky'],
    roofing: ['roof', 'gutter', 'siding'],
    garage_doors: ['garage door', 'overhead door'],
    flooring: ['floor', 'tile', 'carpet', 'epoxy', 'coating'],
    landscaping: ['landscap', 'lawn', 'yard', 'tree', 'irrigation', 'hardscape'],
    auto_detailing: ['detail', 'ceramic coating', 'car wash', 'ppf', 'tint'],
    cleaning: ['clean', 'maid', 'janitor', 'pressure wash', 'window wash'],
    pest_control: ['pest', 'exterminat', 'termite', 'rodent'],
    remodeling: ['remodel', 'renovat', 'construction', 'contractor', 'handyman', 'deck', 'fence', 'carpentry'],
    professional_services: ['notary', 'account', 'bookkeep', 'legal', 'insurance', 'consult', 'real estate'],
  };
  for (const [key, needles] of Object.entries(aliases)) {
    if (needles.some(n => text.includes(n))) return { id: key, ...TRADE_WORLDS[key] };
  }
  return null;
}

/**
 * The reference section injected into the design brief prompt.
 * Trade-specific guidance is included only when the trade is recognised; a generic
 * fallback beats inventing artifacts for a trade that isn't in the table.
 */
function buildReferenceBlock(trade, intensity = 'bold') {
  const world = matchTrade(trade);
  const level = intensity === 'simple' ? 'simple' : 'bold';

  const strategies = COLOR_STRATEGIES.filter(s => s.intensity.includes(level)).map(s =>
    `- ${s.name} (${s.id}): ${s.recipe}\n  Use when: ${s.when}\n  Seen in: ${s.reference}`
  ).join('\n');

  const signatures = SIGNATURE_SOURCES.map(s =>
    `- ${s.id}: ${s.prompt}\n  Seen in: ${s.reference}`
  ).join('\n');

  const tradeBlock = world
    ? `THIS TRADE (${world.id}):
- Its working world, to mine for the signature: ${world.artifacts}
- What the customer actually wants: ${world.outcome}
- AVOID, because every competitor already looks like this: ${world.avoid}
- Buying urgency: ${world.urgency} — ${world.urgency === 'emergency' ? 'lead with the PHONE, large' : 'lead with the WEBSITE'}
- Design sensitivity: ${world.designSensitivity}${world.designSensitivity === 'high' ? ' — this buyer is judging whether you have the taste to work on their property, so the wrap\'s own craft is part of the pitch' : ''}`
    : `THIS TRADE is not in the reference table. Work out its own artifacts, the outcome its
customers actually want, and the colour the category has already worn out — then avoid that
colour deliberately.`;

  return `
=== WRAP DESIGN REFERENCE ===

${tradeBlock}

${intensityBlock(level)}
CHOOSE A COLOUR STRATEGY — a different one for each of the three directions where possible.
Boldness comes from CHROMA COMMITMENT, not from darkness. A fully saturated field reads
boldly; a mid-chroma body commits to nothing and is the most common reason a wrap looks
flat. Name the strategy you chose in each variant's rationale.

${strategies}

FIND A SIGNATURE — the one thing this vehicle will be remembered by. Mine these sources in
order; the name and the locality are the richest because no competitor shares them.

${signatures}

JOIN THE COLOUR FIELDS with a named divider device rather than letting them simply abut:
${DIVIDER_DEVICES.map(d => `- ${d}`).join('\n')}

DISPLAY TYPE ON A SATURATED FIELD needs a heavy outline — a contrasting keyline, or a
layered offset in a third colour. Outlined lettering may cross a colour boundary and stay
legible; unoutlined lettering may not. This is how the sports-jersey treatment on the
strongest references survives being read at 40mph.

NEVER PRODUCE ANY OF THESE:
${ANTI_DEFAULTS.map(d => `- ${d}`).join('\n')}
`;
}

module.exports = {
  COLOR_STRATEGIES,
  SIGNATURE_SOURCES,
  DIVIDER_DEVICES,
  ANTI_DEFAULTS,
  TRADE_WORLDS,
  matchTrade,
  buildReferenceBlock,
};
