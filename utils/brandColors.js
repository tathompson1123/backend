// Pick a brand palette out of the customer's uploaded artwork.
//
// Cloudinary returns predominant colours on upload (`colors: true`), which avoids a
// native image dependency. But raw predominance is the wrong answer for a logo: a mark
// on a white background is mostly white, so "most coverage" hands back #FFFFFF every
// time. The selection below drops the backdrop and looks for the colours a person would
// call the brand colours.
//
// Returns null when the artwork genuinely has no chromatic colour (a pure black-on-white
// wordmark), so the caller can keep whatever the user already chose rather than
// overwriting it with grey.

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function toHex({ r, g, b }) {
  const p = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
}

/** Shortest distance around the hue wheel, so 350° and 10° read as 20° apart. */
function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Normalize Cloudinary's colour output into candidates.
 * Accepts the `colors` array ([[hex, pct], ...]) from one or more uploads and merges
 * coverage across them, so a colour appearing in several images ranks higher.
 */
function collectCandidates(colorArrays) {
  const byHex = new Map();
  for (const colors of colorArrays || []) {
    if (!Array.isArray(colors)) continue;
    for (const entry of colors) {
      const hex = Array.isArray(entry) ? entry[0] : entry?.hex;
      const pct = Array.isArray(entry) ? Number(entry[1]) : Number(entry?.percentage);
      const rgb = hexToRgb(hex);
      if (!rgb || !Number.isFinite(pct)) continue;
      const key = toHex(rgb);
      byHex.set(key, (byHex.get(key) || 0) + pct);
    }
  }

  return [...byHex.entries()].map(([hex, coverage]) => {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb);
    return { hex, coverage, ...hsl };
  });
}

/**
 * @param {Array<Array>} colorArrays one `colors` array per uploaded image
 * @returns {{primary: string, accent: string, palette: string[]} | null}
 */
function extractBrandColors(colorArrays) {
  const candidates = collectCandidates(colorArrays);
  if (candidates.length === 0) return null;

  // Backdrop and ink, not brand colour. Bounds are deliberately wide: logo sheets are
  // usually pure white or near-black, and an off-white card stock still isn't a brand
  // colour.
  const isBackdrop = c => c.l > 0.90 || c.l < 0.10;
  // Greys carry no hue to build a wrap around.
  const isGrey = c => c.s < 0.15;

  const chromatic = candidates
    .filter(c => !isBackdrop(c) && !isGrey(c))
    // Rank by coverage weighted toward saturation: a small, vivid mark beats a large
    // washed-out wash, which is how people actually read a logo.
    .sort((a, b) => (b.coverage * (0.5 + b.s)) - (a.coverage * (0.5 + a.s)));

  if (chromatic.length === 0) return null;

  const primary = chromatic[0];

  // A real second colour from the artwork always beats a derived one — it's the colour
  // the business actually uses. It only has to be distinguishable, not opposite: warm
  // palettes cluster (orange #FF6B1A and yellow #FFC53D sit 21 degrees apart, and
  // yellow is obviously the right accent), so requiring a wide hue gap wrongly
  // discarded the genuine brand colour and invented one instead. Any of hue,
  // lightness or saturation differing enough is sufficient.
  let accent = chromatic.find(c => c !== primary && (
    hueDistance(c.h, primary.h) > 15 ||
    Math.abs(c.l - primary.l) > 0.15 ||
    Math.abs(c.s - primary.s) > 0.20
  ));
  if (!accent) {
    // Nothing suitable in the artwork — derive one by lightening or darkening the
    // primary, so the pair still has contrast on the vehicle.
    const rgb = hexToRgb(primary.hex);
    const shift = primary.l > 0.5 ? -70 : 70;
    accent = { hex: toHex({ r: rgb.r + shift, g: rgb.g + shift, b: rgb.b + shift }), derived: true };
  }

  return {
    primary: primary.hex,
    accent: accent.hex,
    accentDerived: !!accent.derived,
    // The rest, for showing the user what was found.
    palette: chromatic.slice(0, 6).map(c => c.hex),
  };
}

module.exports = { extractBrandColors, hexToRgb, rgbToHsl, hueDistance, toHex };
