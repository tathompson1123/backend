// Design intelligence for the wrap generator.
//
// Format rules alone produce a template. The first version of the wrap prompt said only
// how big things should be and how many colours were allowed, which is why every trade
// came back as the same van in a different hue. This file supplies the other half: where
// a distinctive idea comes FROM, and several named ways to be bold rather than one.
//
// TWO TREATMENTS, and they are genuinely different products. designIntensity picks one:
//
//   bold   — the dense, illustrated American trade-truck wrap: full-bleed saturated colour,
//            an original mascot, a stacked services list, a badge strip, a heavy layered
//            wordmark. Derived from a corpus of fleet mockups (Bayview Mechanical, Apex
//            Roofing, Fast Plumbing & HVAC, Launchpad Services, Vaquero Plumbing, Install
//            My Garage Door, Moving with Prince, Fast Layne Plumbing, Antojitos Queta).
//            This is the default, and it is what most trade customers are actually buying.
//
//   simple — the restrained premium treatment: few elements, narrow palette, no mascot,
//            empty space as the point. Derived from Granite Garage Floors, On Point Home
//            Maintenance, Juris Notary. Right for design-sensitive and professional buyers.
//
// Rules that hold for BOTH live in the brief's system prompt. Rules that differ live here,
// in the intensity blocks, because the two treatments contradict each other on nearly every
// axis — element count, colour count, mascots, service lists, drop shadows — and a single
// static prompt trying to serve both is what made the bold output come back timid.

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
    when: 'When the brand has two real colours, or when maximum visual energy is wanted. The most eye-catching of the strategies, and the backbone of the trade-truck look.',
    intensity: ['bold'],
    reference: 'Bayview Mechanical (red-orange nose dissolving into deep blue), Apex Roofing (royal blue / lime green), Launchpad Services (magenta / blue)',
  },
  {
    id: 'dark_anchor',
    name: 'Dark Anchor',
    recipe: 'Near-black or charcoal over most of the body, white for the large type, and ONE high-chroma accent — then that same accent repeated on one physical detail of the vehicle.',
    when: 'Premium and specialist positioning, where restraint reads as expensive. At bold intensity the accent grows into a full second field rather than staying a spotlight.',
    intensity: ['bold', 'simple'],
    reference: 'Fast Plumbing & HVAC (black / antique gold, city skyline linework), Granite Garage Floors (black/white/yellow, accent repeated on a brake pad)',
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
  {
    id: 'heritage_field',
    name: 'Heritage Field',
    recipe: 'A deep traditional colour (forest green, oxblood, navy) over the whole body with metallic gold or cream for a crest, rules and laurels. Classic typography, symmetrical layout, no diagonal energy.',
    when: 'Established family firms that want to read as decades old rather than new and hungry.',
    intensity: ['bold'],
    reference: 'Fast Layne Plumbing (forest green / gold laurel monogram, symmetrical box-truck layout)',
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
    reference: '"Bayview" Mechanical carries a shark coiled around an anchor; "Vaquero" Plumbing carries a longhorn in a cowboy hat; "Launchpad" Services carries an astronaut over a planet — every one of them came straight out of the name',
  },
  {
    id: 'local_identity',
    prompt: 'Is the name or service area tied to a place? A skyline, bridge, mountain, county outline, state flag or local landmark makes the vehicle unmistakably of here, which is exactly what a local buyer responds to.',
    reference: 'Fast Plumbing puts the Las Vegas skyline in gold linework across the rear; Apex Roofing works the Colorado flag into the rear quarter',
  },
  {
    id: 'trade_artifact',
    prompt: 'Take one object, material or gesture from the trade\'s own working world and blow it up: shingle courses, a pipe wrench, plank shapes, a garage door\'s panel lines, turf stripes. Oversized and cropped, not a small clip-art icon.',
    reference: 'Install My Garage Door runs the door\'s own panel lines and a ladder up the rear; Apex builds the rear quarter out of rooflines and houses',
  },
  {
    id: 'character',
    prompt: 'An original illustrated person or creature, drawn cleanly, confident rather than goofy. People trust a face, and this is the most memorable device available — seven of the nine strongest references in the corpus are built around one. See the MASCOT SPECIFICATION for how it must be drawn.',
    reference: 'Bayview (shark), Vaquero (longhorn), Launchpad (astronaut), Antojitos Queta (chef), Moving with Prince (prince), Install My Garage Door (technician)',
  },
  {
    id: 'badge_lockup',
    prompt: 'A crest, seal, laurel or badge containing the name or a monogram, sitting on a radiating or textured ground. Reads established and classic without reading dated.',
    reference: 'Fast Layne Plumbing — gold laurel monogram over forest green; The Garage Floor Company — badge lockup over a sunburst',
  },
];

// ── Divider devices ──────────────────────────────────────────────────────────
//
// Every wrap in the corpus joins its colour fields with a named device. Banning
// "swooshes" outright was an over-correction: filler is a flourish with nothing either
// side of it, whereas these are the structural join between two fields.

const DIVIDER_DEVICES = [
  'halftone dot dissolve (one field breaking into dots across the other)',
  'a single hard diagonal running front-low to rear-high',
  'a sweeping wave with a clean edge, carried across the panel gaps',
  'shapes borrowed from the trade\'s material (plank ends, shingle courses, pipe sections)',
  'an angular slash cropped by the body panel',
  'a chevron or arrow implying forward motion',
  'a torn or flame-edged join where one saturated field burns into the other',
];

// ── Mascot specification ─────────────────────────────────────────────────────
//
// Written out in full because "a mascot" is not an instruction an image model can act on
// consistently, and because the earlier prompt's logo-fidelity language ("never redraw,
// never restyle, never invent") was being over-generalised into never drawing anything at
// all. Those are different things: the LOGO is the customer's property and gets reproduced
// exactly; a mascot is original artwork commissioned for the wrap.

const MASCOT_SPEC = `MASCOT SPECIFICATION — read this before deciding there isn't one.

A mascot is ORIGINAL ARTWORK COMMISSIONED FOR THIS WRAP. It is not the logo, and drawing one
does not conflict with reproducing the supplied logo faithfully. They are separate elements
and both appear.

WHERE IT COMES FROM, in order of preference:
1. The logo already contains a character or creature — then EXTEND that same character:
   full body, same species, same colours, same drawing style, now posed and mid-action.
   Do not invent a second, different one alongside it.
2. The business name suggests one. This is the richest source and the reason the strongest
   references are memorable: Bayview -> a shark; Vaquero -> a longhorn in a cowboy hat;
   Launchpad -> an astronaut; Moving with Prince -> a prince. Read the name literally and
   see what animal, person or object is hiding inside it.
3. Failing both, the trade's own worker: a technician, installer or tradesperson in the
   uniform of that trade, mid-job.

HOW IT IS DRAWN:
- Flat vector cartoon illustration. Thick, uniform black keyline around every shape.
- Two or three tones per colour for cel shading. No airbrushing, no photorealism, no
  gradient meshes, no 3D render.
- Confident, friendly and competent. Never goofy, grotesque, menacing or sexualised.
- Three-quarter pose, mid-action, holding or using a real tool of the trade.
- Bold enough to read as a silhouette at fifty feet.

WHERE IT SITS:
- On the side: occupying roughly the rear third of the panel, at least half the panel's
  height, cropped by the panel edge or bleeding across the divider so it belongs to the wrap
  rather than being pasted onto it. Never a small floating sticker.
- On the rear: repeated smaller, or a cropped detail of it (head and shoulders).
- It never overlaps the business name and never sits behind text.

NEVER: a recognisable likeness of a real, identifiable person unless the customer supplied a
photograph of themselves for exactly that purpose. A generic tradesperson is fine; a specific
real face invented by the model is not.`;

// ── Anti-defaults ────────────────────────────────────────────────────────────
//
// Split by treatment. The previous single list banned most of what the bold references
// actually do — service lists, stacked badges, four colours, drop shadows, a repeated phone
// number — and applying it to a trade-truck wrap is why the output came back sparse.

const ANTI_DEFAULTS_UNIVERSAL = [
  'a mid-chroma body (medium blue, medium grey) with no dark anchor and no saturated field — commits to nothing and is still the worst outcome available',
  'a plain rectangle of colour floating on an otherwise white body',
  'a thin pinstripe along the rocker with nothing above it',
  'small inset photographs, thumbnails or photo collages',
  'unoutlined text crossing a boundary between two colours',
  'misspelled, garbled or invented text of any kind — every string must be exactly as supplied',
  'a credential, guarantee, rating or availability claim that was not supplied in the input',
  'a large dead area with no colour commitment',
  'gradients blending three or more hues into mud',
];

const ANTI_DEFAULTS_BOLD = [
  'bare white body panels showing between the graphics — that is a decal job, not a wrap',
  'deep navy body + white condensed capitals + one orange accent + a generic mascot — this generator\'s own default, and the fastest way to look machine-made',
  'a mascot rendered small, centred and floating like a sticker instead of cropped into the composition at panel height',
  'the design stopping at the doors, leaving hood, roof and bumpers plain',
  'a services list set in a light typeface with bullet dots — it should be stacked capitals in a solid panel, reading as a designed block',
  'the rear left near-empty while everything is crowded onto the side',
  'the same item count crammed onto the front or rear as the side carries — those quadrants '
    + 'are smaller, and text sized to fit there garbles into illegible noise rather than reading '
    + 'as a wrap. Fewer, larger elements beat a complete but unreadable set',
];

const ANTI_DEFAULTS_SIMPLE = [
  'any mascot, character, sunburst, halftone or ornament',
  'a list of services',
  'more than one credential',
  'drop shadows, bevels, glossy gradients or layered sports-jersey lettering',
  'the same call to action repeated twice on one view',
  'more than three colours',
];

// ── Trade worlds ─────────────────────────────────────────────────────────────
//
// `avoid` is the category colour — the thing every competitor already looks like. It only
// bites when the brand has no colours of its own to honour; supplied artwork always wins.
// `services` is a recognition aid for reading what the customer supplied, NOT a list to
// invent from. `urgency` decides whether the phone or the website leads.
// `designSensitivity` decides whether the buyer is judging the taste of the wrap itself.

const TRADE_WORLDS = {
  plumbing: {
    artifacts: 'pipe wrench, copper pipe, brass fittings, water droplets, pressure gauge',
    outcome: 'water working again, and no mess left behind',
    avoid: 'blue — the entire category is blue',
    services: 'water heaters, drain cleaning, re-pipes, leak detection, sewer line, fixture install, emergency service',
    urgency: 'emergency', designSensitivity: 'low',
  },
  hvac: {
    artifacts: 'fan blades, airflow lines, thermostat dial, snowflake and flame pairing',
    outcome: 'a house that is comfortable again, today',
    avoid: 'the red-and-blue hot/cold split every competitor uses',
    services: 'furnaces, boilers, mini splits, AC systems, maintenance, gas piping, air purification',
    urgency: 'emergency', designSensitivity: 'low',
  },
  electrical: {
    artifacts: 'bolt, conduit, switch plate, filament, wire gauge',
    outcome: 'power back on, safely and to code',
    avoid: 'yellow-and-black hazard striping',
    services: 'panel upgrades, rewiring, lighting, EV chargers, generators, troubleshooting',
    urgency: 'emergency', designSensitivity: 'low',
  },
  roofing: {
    artifacts: 'shingle courses, ridgeline, roof pitch, gutter line, skyline silhouette',
    outcome: 'a roof that stops worrying you when it rains',
    avoid: 'storm imagery and cracked or broken textures — they suggest damage, which is what the customer is trying to escape',
    services: 'roof replacement, repairs, gutters, siding, storm damage, inspections',
    urgency: 'considered', designSensitivity: 'medium',
  },
  garage_doors: {
    artifacts: 'door panel lines, spring coil, opener rail, the geometry of a rising door',
    outcome: 'a door that opens quietly, every morning',
    avoid: 'a plain photograph of a garage door',
    services: 'sales, installation, spring repair, opener service, tune-ups',
    urgency: 'emergency', designSensitivity: 'low',
  },
  flooring: {
    artifacts: 'plank patterns, tile grid, grout lines, carpet pile, wood grain',
    outcome: 'floors that make the whole room look new',
    avoid: 'a beige-on-beige palette taken from the flooring itself',
    services: 'hardwood, tile, epoxy coatings, carpet, refinishing, subfloor repair',
    urgency: 'considered', designSensitivity: 'high',
  },
  landscaping: {
    artifacts: 'mower stripes, leaf silhouettes, hedge geometry, stone edging',
    outcome: 'a yard the neighbours notice',
    avoid: 'green — the entire category is green',
    services: 'lawn care, hardscaping, irrigation, tree service, clean-ups, design',
    urgency: 'considered', designSensitivity: 'high',
  },
  auto_detailing: {
    artifacts: 'water beading on a clear coat, reflection highlights, buffer swirl, microfibre',
    outcome: 'a car that looks better than the day it was bought',
    avoid: 'black-on-black, and chrome gradient lettering',
    services: 'ceramic coating, paint correction, interior detail, PPF, window tint',
    urgency: 'considered', designSensitivity: 'high',
  },
  cleaning: {
    artifacts: 'bubbles, a squeegee edge, a gleam or sparkle mark, folded linen',
    outcome: 'walking into a home that feels reset',
    avoid: 'pale blue and a sparkle cluster',
    services: 'deep cleaning, recurring service, move-in/move-out, post-construction, windows',
    urgency: 'considered', designSensitivity: 'medium',
  },
  pest_control: {
    artifacts: 'a shield, a perimeter line, an oversized stylised insect silhouette',
    outcome: 'a house that is yours again',
    avoid: 'cartoon bugs in party hats — it trivialises the problem',
    services: 'termites, rodents, ants, mosquitoes, wildlife removal, quarterly plans',
    urgency: 'emergency', designSensitivity: 'low',
  },
  remodeling: {
    artifacts: 'a folding rule, blueprint lines, a mitre joint, tile and timber pairings',
    outcome: 'the room you actually wanted to live in',
    avoid: 'before-and-after photo pairs, and a hard-hat clip-art icon',
    services: 'kitchens, bathrooms, additions, basements, decks, whole-home',
    urgency: 'considered', designSensitivity: 'high',
  },
  moving: {
    artifacts: 'stacked boxes, a hand truck, a strapped furniture blanket, a doorway silhouette',
    outcome: 'everything arriving where it should, unbroken and on the day promised',
    avoid: 'a photograph of a truck printed on a truck',
    services: 'local moves, long distance, packing, loading, storage',
    urgency: 'considered', designSensitivity: 'low',
  },
  food_service: {
    artifacts: 'the dishes themselves at full saturation, festival bunting, a chef figure, steam',
    outcome: 'the thing they are already hungry for, right now',
    avoid: 'a muted or sophisticated palette — this is the one trade where louder genuinely sells more',
    services: 'the actual menu items, named',
    urgency: 'emergency', designSensitivity: 'low',
  },
  professional_services: {
    artifacts: 'a seal, a signature stroke, a document corner, a monogram',
    outcome: 'paperwork handled properly, without a trip into an office',
    avoid: 'anything saturated — it undercuts the credibility this buyer is looking for',
    services: 'the specific filings or engagements offered',
    urgency: 'considered', designSensitivity: 'high',
  },
};

// ── Intensity blocks ─────────────────────────────────────────────────────────

// The dense trade-truck treatment. Written at length and prescriptively, because the
// failure mode here is UNDER-filling the vehicle: given only prohibitions, the model leaves
// panels empty and the result reads as a decal job rather than a wrap.
function boldBlock() {
  return `INTENSITY: BOLD — THE FULL TRADE-TRUCK TREATMENT. This is the default, and it is
what most trade customers are buying. The dense, loud, illustrated American work-truck wrap:
full-bleed saturated colour on every panel, an original illustrated mascot, a stacked services
list, a heavy layered wordmark, and a phone number readable from two lanes over.

THE FAILURE MODE HERE IS AN UNDER-FILLED VEHICLE, not an over-filled one. Where the simple
treatment counts elements down, this one counts them up. Where a rule elsewhere calls for
restraint, this section overrides it.

COVERAGE — the most important rule in this block.
The wrap covers 100% of the painted bodywork, edge to edge: hood, roof, both doors, the full
side, the rear, front and rear bumpers, mirror caps and the pillars between the windows. No
bare white body panel is visible anywhere unless white is a deliberate field in the design.
Graphics run across panel gaps and door seams uninterrupted, the way real vinyl does.

COLOUR — four or five, not three.
Two dominant saturated fields at full chroma, white for the large type, black or near-black
for keylines and outlines, and one hot accent for the call to action. The three-colour ceiling
belongs to the simple treatment and does not apply here. What still applies: every colour is
either fully committed or a neutral. No mid-chroma mush.

FIELD GEOMETRY.
One dominant division crossing the entire vehicle — a sweeping curve or a hard diagonal
running front-low to rear-high, or the reverse — joining the two saturated fields with a named
divider device. Secondary shapes echo its angle. Inside the larger field, a low-contrast
background scene drawn from the trade or the locality: skyline linework, topographic lines,
halftone dots, radiating rays, blueprint grid, rooflines. It sits behind the type at low
contrast, giving the panel depth without competing with it.

TYPOGRAPHY.
- The business name is the largest element by a wide margin, set in a heavy condensed or
  extended sans, or a confident brush script, often on a slight upward arc or italic slant.
- It gets the layered treatment: white or light fill, a thick dark keyline, and an offset
  drop in the accent colour behind it. This is the sports-jersey lockup, and at this intensity
  it is correct, not dated.
- The trade descriptor sits directly beneath the name in letterspaced capitals, usually on a
  solid bar the width of the name.
- Contact details in the heaviest weight available. Never script, never condensed italic.

DEPTH AND FINISH.
Layered offsets, hard drop shadows, an inner bevel on the wordmark and a subtle gloss on the
mascot are all correct at this intensity. Still forbidden: muddy multi-hue gradient blends,
and photographic texture sitting behind type.

THE COLOUR STRATEGIES BELOW describe field structure. Where one asks for an accent on a
"small area only" or "a little white", read that as field structure — not as licence to leave
the vehicle empty. The coverage and content rules in this section take precedence.`;
}

// What "simple" means, defined by what it REMOVES. Dialling down commitment instead would
// reproduce the flat mid-tone van that started all this — restraint and timidity look
// nothing alike on the road.
function simpleBlock() {
  return `INTENSITY: SIMPLE. The customer wants restraint. Simple means FEWER ELEMENTS AND A
NARROWER PALETTE — it does NOT mean less commitment or less clarity. Specifically:
- No character or mascot. No sunburst, no halftone, no ornament of any kind.
- At most ONE geometric signature, and it stays quiet: a single hard edge, a monogram,
  a cropped silhouette. Large, but never loud.
- Two colours, or two plus black. One flat field, one hard division, no gradients.
- One type family, one or two weights. No layered outlines, no sports-jersey treatment.
- No services list. At most one credential. One call to action, appearing once per view.
- Generous empty space in the base colour is the point, not a gap to be filled.

STILL NON-NEGOTIABLE, exactly as in bold: full chroma commitment on the base (a mid-tone
body remains the worst outcome available), the name still the largest thing by a wide
margin, the trade still readable at a glance, and one unmistakable call to action.
A simple wrap is a disciplined wrap, never a timid one. A hard grey-and-beige two-tone
reads as more confident than a busy wrap; a washed-out mid-blue van reads as nothing.`;
}

// ── Content inventory ────────────────────────────────────────────────────────
//
// The dense look is mostly a CONTENT problem, not a creative one. The reference wraps are
// full because the businesses supplied seven services, a tagline and four badges; given only
// a name and a phone number the model has nothing to fill panels with and pads with empty
// colour. So this block states exactly what inventory Claude is working with — and, just as
// importantly, what it was NOT given and therefore may not invent.

function contentBlock(content = {}) {
  const services = (content.services || []).filter(Boolean);
  const badges = (content.badges || []).filter(Boolean);
  const lines = [];

  lines.push('CONTENT INVENTORY — what you have to place, and what you may not invent.');
  lines.push('');
  lines.push('Every string below was supplied by the business. Use them verbatim. Anything not');
  lines.push('listed here does not go on the vehicle: a credential, guarantee, rating or');
  lines.push('availability claim the business never made is a promise printed on their van.');
  lines.push('');

  if (services.length) {
    lines.push(`SERVICES (${services.length}) — place these as a stacked block of letterspaced`);
    lines.push('capitals inside a solid panel or along the edge of one colour field, in the order');
    lines.push('given. Not a light-weight bulleted list: a designed block that reads as part of');
    lines.push('the composition. They appear on the side and again on the rear.');
    services.forEach(s => lines.push(`  - ${s}`));
  } else {
    lines.push('SERVICES: none supplied. Do NOT invent a services list — you would be putting work');
    lines.push('on the van the business may not do. Use that space for the trade descriptor at');
    lines.push('greater scale, or for the mascot and the outcome line.');
  }
  lines.push('');

  if (badges.length) {
    lines.push('CREDENTIALS — supplied, so they may appear. Set them small, in a single horizontal');
    lines.push('strip along the rocker or beneath the contact block, all at the same size, in white');
    lines.push('or the accent on a dark bar. They are reassurance, not hierarchy.');
    badges.forEach(b => lines.push(`  - ${b}`));
  } else {
    lines.push('CREDENTIALS: none supplied. No badge strip. Do not write "Licensed & Insured",');
    lines.push('"24/7", "Free Estimates", "Family Owned" or a review rating anywhere.');
  }
  lines.push('');

  if (content.serviceArea) {
    lines.push(`SERVICE AREA: "${content.serviceArea}" — may appear once, small, near the contact`);
    lines.push('block, and is a strong source for a local-identity signature.');
  }
  if (content.yearsInBusiness) {
    lines.push(`ESTABLISHED: ${content.yearsInBusiness} — may appear once as a small "Since" mark,`);
    lines.push('or inside a badge lockup.');
  }
  if (content.socialHandle) {
    lines.push(`SOCIAL: "${content.socialHandle}" — small, on the rear only, with its platform glyph.`);
  }
  if (content.serviceArea || content.yearsInBusiness || content.socialHandle) lines.push('');

  lines.push('A TAGLINE is creative, not a claim, so you may write one where none was supplied —');
  lines.push('short and rhythmic, set in a ribbon or banner across the top of the rear or above');
  lines.push('the windows. It must not assert anything factual about the business.');

  return lines.join('\n');
}

// ── Placement across the three views ─────────────────────────────────────────
//
// The render is a three-view layout sheet, so the brief has to allocate content per view.
// Left unstated, the model puts everything on the side and leaves the rear — the panel a
// driver actually stares at in traffic — nearly empty.

const VIEW_PLAN_BOLD = `PLAN ALL THREE VIEWS. The render is a layout sheet showing the side
profile, the front and the rear of the same vehicle. Every view carries the wrap; none is left
plain. Say in the image prompt what goes on each.

THE IMAGE MODEL HAS A FIXED RESOLUTION CEILING IT CANNOT EXCEED, and three views share one
sheet — the side gets the most of it, the front and rear quadrants get much less. Every text
element you place has to stay legible INSIDE that smaller space. Small dense text at this
scale renders as a smear of broken, half-formed letterforms — worse than useless, because it
reads as damage on a business's actual vehicle. LEGIBLE AND SPARSE BEATS COMPLETE AND GARBLED,
every time. If an element cannot be given enough room in a given view to stay crisp, DROP it
from that view rather than shrinking it in — say so plainly in that view's instruction ("front
view carries no services list — not enough room to keep it legible at this scale").

- SIDE: the most room of the three, and where the dense content actually belongs. The largest
  statement of the business name with its trade descriptor, the mascot at panel height in the
  rear third, the FULL services block (this is the one view that can actually hold it), the
  phone or website at full weight, and the dominant field division sweeping the whole length.
  The logo sits on the front door or on the nose of the field.
- FRONT: the smallest, quietest view — do not crowd it. Hood and bumper wrapped in the field
  colours, the divider carried across the hood, a compact lockup of the name or monogram above
  the grille, and the phone number set LARGE across the hood's leading edge or the band above
  the windscreen — large enough that it alone is legible at this view's size. Mirror caps in
  the accent. Nothing else: no services list, no credential strip, no tagline here.
- REAR: dense, but not as dense as the side — this quadrant is smaller, and a services list
  repeated here at the same item count as the side is exactly the kind of small text that
  garbles. Business name, the phone at maximum size (this is the view a stopped driver reads
  longest, so the CTA matters most here), the website beneath it at a clearly smaller weight,
  and ONE further device chosen for what will fit large enough to stay crisp — the mascot
  cropped to head-and-shoulders, OR a short tagline in a ribbon, OR the credential strip if one
  was supplied, but not all three stacked together. Never repeat the full services list here.

Contact details MAY repeat across views — a driver only ever sees one view at a time, so the
phone belongs on all three. What must not happen is two competing calls to action within a
single view, or any view holding more distinct text elements than it has room to render
legibly.`;

const VIEW_PLAN_SIMPLE = `PLAN ALL THREE VIEWS. The render is a layout sheet showing the side
profile, the front and the rear of the same vehicle. Each view carries the base colour and its
share of the design; none is left plain white.

- SIDE: the name at maximum scale with the trade descriptor, and nothing else but the single
  geometric signature.
- FRONT: the base colour carried across hood and bumper, a compact monogram or the name alone.
- REAR: the outcome line and the one call to action, large, in the accent field.

One call to action per view, and it does not compete with a second.`;

/** Nearest trade entry for a free-text trade string, or null. */
function matchTrade(trade) {
  const text = String(trade || '').toLowerCase();
  const aliases = {
    plumbing: ['plumb', 'drain', 'sewer', 'rooter', 'water heater'],
    hvac: ['hvac', 'heating', 'cooling', 'air condition', 'furnace', 'mechanical'],
    electrical: ['electric', 'sparky'],
    roofing: ['roof', 'gutter', 'siding'],
    garage_doors: ['garage door', 'overhead door'],
    flooring: ['floor', 'tile', 'carpet', 'epoxy', 'coating'],
    landscaping: ['landscap', 'lawn', 'yard', 'tree', 'irrigation', 'hardscape'],
    auto_detailing: ['detail', 'ceramic coating', 'car wash', 'ppf', 'tint'],
    cleaning: ['clean', 'maid', 'janitor', 'pressure wash', 'window wash'],
    pest_control: ['pest', 'exterminat', 'termite', 'rodent'],
    remodeling: ['remodel', 'renovat', 'construction', 'contractor', 'handyman', 'deck', 'fence', 'carpentry'],
    moving: ['moving', 'movers', 'hauling', 'junk removal', 'relocation'],
    food_service: ['taco', 'food truck', 'catering', 'bbq', 'coffee', 'taqueria', 'restaurant'],
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
 *
 * @param {string} trade free-text business name + service, for trade matching
 * @param {'bold'|'simple'} intensity which treatment
 * @param {object} content supplied wrap copy: services, badges, serviceArea, yearsInBusiness, socialHandle
 */
function buildReferenceBlock(trade, intensity = 'bold', content = {}) {
  const world = matchTrade(trade);
  const level = intensity === 'simple' ? 'simple' : 'bold';
  const bold = level === 'bold';

  const strategies = COLOR_STRATEGIES.filter(s => s.intensity.includes(level)).map(s =>
    `- ${s.name} (${s.id}): ${s.recipe}\n  Use when: ${s.when}\n  Seen in: ${s.reference}`
  ).join('\n');

  const signatures = SIGNATURE_SOURCES
    // The character source is noise under a treatment that bans mascots outright.
    .filter(s => bold || s.id !== 'character')
    .map(s => `- ${s.id}: ${s.prompt}\n  Seen in: ${s.reference}`)
    .join('\n');

  const tradeBlock = world
    ? `THIS TRADE (${world.id}):
- Its working world, to mine for the signature: ${world.artifacts}
- What the customer actually wants: ${world.outcome}
- The category colour every competitor already wears: ${world.avoid}. Avoid it deliberately
  UNLESS the supplied artwork establishes it as this brand's own colour — an existing brand
  always outranks this.
- Typical services in this trade, to help you recognise what you were given. NOT a list to
  invent from: ${world.services}
- Buying urgency: ${world.urgency} — ${world.urgency === 'emergency' ? 'lead with the PHONE, large' : 'lead with the WEBSITE'}
- Design sensitivity: ${world.designSensitivity}${world.designSensitivity === 'high' ? ' — this buyer is judging whether you have the taste to work on their property, so the wrap\'s own craft is part of the pitch' : ''}`
    : `THIS TRADE is not in the reference table. Work out its own artifacts, the outcome its
customers actually want, and the colour the category has already worn out — then avoid that
colour deliberately unless the supplied artwork establishes it as the brand's own.`;

  const antiDefaults = [
    ...ANTI_DEFAULTS_UNIVERSAL,
    ...(bold ? ANTI_DEFAULTS_BOLD : ANTI_DEFAULTS_SIMPLE),
  ];

  return `
=== WRAP DESIGN REFERENCE ===

${tradeBlock}

${bold ? boldBlock() : simpleBlock()}

${contentBlock(content)}

${bold ? VIEW_PLAN_BOLD : VIEW_PLAN_SIMPLE}
${bold ? '\n' + MASCOT_SPEC + '\n' : ''}
CHOOSE A COLOUR STRATEGY — a different one for each of the two directions where possible.
Boldness comes from CHROMA COMMITMENT, not from darkness. A fully saturated field reads
boldly; a mid-chroma body commits to nothing and is the most common reason a wrap looks
flat. Name the strategy you chose in each variant's rationale.

${strategies}

Set color_strategy to one of the ids listed immediately above and nothing else. The schema
accepts other values, but strategies not listed here belong to the other treatment and are
not available at this intensity — naming one mislabels a design that is actually doing
something different.

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
${antiDefaults.map(d => `- ${d}`).join('\n')}
`;
}

module.exports = {
  COLOR_STRATEGIES,
  SIGNATURE_SOURCES,
  DIVIDER_DEVICES,
  MASCOT_SPEC,
  ANTI_DEFAULTS_UNIVERSAL,
  ANTI_DEFAULTS_BOLD,
  ANTI_DEFAULTS_SIMPLE,
  TRADE_WORLDS,
  matchTrade,
  buildReferenceBlock,
};
