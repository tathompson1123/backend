// Read a scraped website and turn it into the wrap tool's content inventory.
//
// This exists because the dense wrap treatment is mostly a CONTENT problem. A wrap needs
// seven services, a tagline, a credential strip and a service area to look full; a form
// that only asks for a business name and a phone number gives the design nothing to put on
// the panels, and it comes back padded with empty colour. Nearly every one of those facts
// is already written on the customer's own website.
//
// It also resolves the claims tension. wrapDesignBrief refuses to print "Licensed &
// Insured" or "24/7" unless it was supplied, because putting an unmade promise on someone's
// van for five years is not a design flourish. If the business says it on their own website,
// they made the claim — so a scan is a legitimate source for exactly the content the brief
// is otherwise forbidden to invent. The instruction below is correspondingly strict: verbatim
// or nothing.
//
// Structured output is FORCED TOOL USE, matching wrapDesignBrief — the repo is on
// @anthropic-ai/sdk 0.32.1, which predates output_config.

const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('./claudeUsage');
const { sniffImageType } = require('./imageType');

// Opus 5, consistent with the brief step. This task is extraction rather than design
// judgment, so claude-sonnet-5 would do it for roughly a third of the cost — worth
// switching if scan volume ever matters, but that is a call to make deliberately.
const MODEL = 'claude-opus-5';

const VISION_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Only the top few logo candidates are shown as actual images. Each one costs roughly as
// much as a page of text, the ranking in siteScrape is already decent, and the screenshot
// corroborates which mark is really in the header.
const LOGO_IMAGES_SHOWN = 3;
const MAX_PAGE_TEXT = 14000;

const SYSTEM_PROMPT = `You are preparing a vehicle-wrap brief by reading a service business's own
website. Your job is EXTRACTION, not invention. Everything you return must already be on the
site you were shown.

THE ONE RULE THAT MATTERS: a wrap is printed vinyl that the business drives for five years.
If you return a service they do not offer, or a credential they never claimed, it gets printed
on their van. So:
- Return a service ONLY if the site names it as something they do.
- Return a credential ONLY if the site states it, AND write it as a SHORT BADGE LABEL — two
  to five words, the way it would actually fit in a strip of badges on a vehicle — never a
  quoted marketing sentence. "No extra charges nights, weekends or holidays" becomes "No
  Overtime Charges". "Same-day and emergency service 365 days a year" becomes "24/7 Emergency
  Service". Where the underlying claim matches one of these common labels, use that exact
  wording so it lines up with the standard badge set: "Licensed & Insured", "24/7 Emergency
  Service", "Free Estimates", "Family Owned & Operated", "Financing Available", "Veteran
  Owned". Otherwise condense the claim into your own short label of the same length — still
  strictly no invention, only compression. A star rating or review count follows the same
  rule ("4.9★ Google Rating", not the full sentence it appeared in).
- Do not repeat the established date as a credential — that is years_in_business's job. If a
  page says "Trusted for over 90 years" and you have already captured "Since 1935" there, skip
  it here rather than adding a second, redundant badge.
- When in doubt, leave it out and say so in "missing". An empty field is correct and useful;
  a plausible guess is a liability.
- Use the business's own wording, trimmed to wrap length. "Ductless Mini-Split Installation
  & Service" may become "Mini Splits". Do not invent a service that merely sounds adjacent.

WHAT YOU ARE LOOKING AT:
- A screenshot of the homepage, for the visual brand and to confirm which mark is the logo.
- Up to three candidate images that scored highest as the logo, each numbered.
- Any JSON-LD structured data. For a local business this is the most reliable source there
  is — name, telephone, areaServed and foundingDate come from it clean. Prefer it over prose.
- The page text, including a few internal pages (services, about, contact).

PICKING THE LOGO. Set logo_index to the numbered candidate that is genuinely the company's
mark — the thing in the header that carries the name. Not a hero photo, not a stock badge, not
an icon, not a payment-method or certification logo belonging to someone else. If none of the
candidates is the real logo, set it to -1; a wrong logo is worse than none, because it gets
reproduced faithfully onto the vehicle.

PICKING PHOTOS. From the photo candidate list (metadata only — you are not shown these), pick
up to three that look like real photographs of their work, their crew or their vehicles. These
are used as a full-bleed tinted background field, never as a small inset, so favour large,
simple images. Skip stock imagery, headshots, icons and anything with text baked into it. An
empty list is fine.

TRADE. Name the trade in one to four words as it would be said out loud — "Plumbing", "Garage
Door Service", "Heating & Cooling". No parenthetical service lists, no HTML entities.

PHONE. Prefer a tel: link or the JSON-LD telephone over a number pattern-matched out of prose.
Return it formatted the way the site displays it.

TAGLINE. Only if the site actually has one. Do not write them one here — the wrap brief does
that later, where it belongs.`;

const SCAN_TOOL = {
  name: 'submit_brand_scan',
  description: 'Return what the website says about this business.',
  input_schema: {
    type: 'object',
    properties: {
      business_name: { type: 'string', description: 'The trading name, as the site presents it.' },
      trade: { type: 'string', description: 'One to four words. "Plumbing", "Heating & Cooling".' },
      tagline: { type: 'string', description: 'Their existing tagline, verbatim. Empty string if they have none — do not write one.' },
      phone: { type: 'string', description: 'Formatted as the site displays it. Empty string if not found.' },
      website: { type: 'string', description: 'The bare domain, e.g. "bayviewmech.com".' },
      service_area: { type: 'string', description: 'City, county or region served. Empty string if not stated.' },
      years_in_business: { type: 'string', description: 'As a short mark: "Since 2009", "30+ Years". Empty string unless the site states it.' },
      social_handle: { type: 'string', description: 'One handle with its @, from a social link on the page. Empty string if none.' },
      services: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 7, each trimmed to wrap length, in the order the site presents them. Only services the site names. Empty array if the site does not list any.',
      },
      credentials: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 6, each a SHORT BADGE LABEL (2-5 words) as it would print on a vehicle badge strip — never a full sentence copied from the page. Factually equivalent to a claim the site actually makes; compressed, not invented. Prefer the standard wording ("Licensed & Insured", "24/7 Emergency Service", "Free Estimates", "Family Owned & Operated", "Financing Available", "Veteran Owned") when the claim matches one. Do not duplicate years_in_business here. Empty array if the site makes no such claims — a common and correct answer.',
      },
      logo_index: { type: 'integer', description: 'The numbered candidate that is the real logo, or -1 if none of them is.' },
      photo_indexes: { type: 'array', items: { type: 'integer' }, description: 'Up to 3 indexes from the photo candidate list. Empty array is fine.' },
      brand_colors: {
        type: 'object',
        description: 'The brand\'s colours as used on the site, read from the screenshot. Useful when the logo is monochrome and colour cannot be sampled from it.',
        properties: {
          primary: { type: 'string', description: 'Six-digit hex with leading #.' },
          accent: { type: 'string', description: 'Six-digit hex with leading #.' },
        },
      },
      brand_read: { type: 'string', description: 'One or two sentences on the brand\'s character from the site: formal or friendly, established or new, and how its colours are used.' },
      missing: {
        type: 'array',
        items: { type: 'string' },
        description: 'What you could NOT find and deliberately left blank, so the salesperson knows to ask. e.g. "no services listed anywhere on the site", "no phone number found".',
      },
    },
    required: ['business_name', 'trade', 'services', 'credentials', 'logo_index', 'photo_indexes', 'missing'],
  },
};

// Same reason as wrapDesignBrief: an HTML-escaped ampersand that reaches the image model
// gets printed onto a vehicle as "&AMP;".
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
function decodeEntities(value) {
  if (typeof value === 'string') {
    return value.replace(/&(?:amp|quot|apos|#39|lt|gt|nbsp);/g, m => ENTITIES[m] || m);
  }
  if (Array.isArray(value)) return value.map(decodeEntities);
  return value;
}

/** A vision block, or null when the bytes are not something the Messages API accepts. */
function imageBlock(buffer) {
  const mediaType = sniffImageType(buffer);
  if (!mediaType || !VISION_TYPES.includes(mediaType)) return null;
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
  };
}

/**
 * @param {object} site the scrapeSite() result
 * @param {Array<{index: number, buffer: Buffer, meta: object}>} logoImages downloaded logo candidates
 * @param {number} userId for cost attribution
 * @returns {Promise<object>} the scan, decoded
 */
async function scanBrand(site, logoImages, userId) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = [];

  content.push({
    type: 'text',
    text: `Website: ${site.finalUrl}\nPage title: ${site.title || '(none)'}\n`
      + `Meta description: ${site.description || '(none)'}`,
  });

  // The screenshot goes first: it frames everything that follows, and it is what lets the
  // model tell a real logo from a stock badge sitting next to it.
  if (site.screenshot) {
    const block = imageBlock(site.screenshot);
    if (block) {
      content.push(block);
      content.push({ type: 'text', text: '(above: screenshot of the homepage)' });
    }
  } else {
    content.push({
      type: 'text',
      text: '(No screenshot — this page could only be read as raw HTML, so judge the brand from the text and the candidate images alone.)',
    });
  }

  for (const item of logoImages.slice(0, LOGO_IMAGES_SHOWN)) {
    const block = imageBlock(item.buffer);
    if (!block) continue;
    content.push(block);
    const m = item.meta || {};
    content.push({
      type: 'text',
      text: `(above: LOGO CANDIDATE ${item.index} — alt "${m.alt || ''}", `
        + `rendered ${m.w || '?'}x${m.h || '?'}, natural ${m.natW || '?'}x${m.natH || '?'}, `
        + `${m.inHeader ? 'in the header' : 'not in the header'}, src ${m.src})`,
    });
  }

  if (site.jsonLd?.length) {
    // Trimmed hard: SEO plugins emit enormous @graph blocks, and everything the wrap needs
    // sits in the first couple of entities.
    const trimmed = JSON.stringify(site.jsonLd).slice(0, 6000);
    content.push({ type: 'text', text: `STRUCTURED DATA (JSON-LD) — the most reliable source here:\n${trimmed}` });
  }

  if (site.tel?.length) {
    content.push({ type: 'text', text: `tel: links found on the page: ${site.tel.join(', ')}` });
  }
  if (site.social?.length) {
    content.push({ type: 'text', text: `Social links found: ${site.social.join(', ')}` });
  }

  const photoList = (site.photos || []).map((p, i) =>
    `[${i}] alt "${p.alt || ''}" — ${p.natW || '?'}x${p.natH || '?'} — ${p.src}`
  ).join('\n');
  content.push({
    type: 'text',
    text: photoList
      ? `PHOTO CANDIDATES (metadata only — pick by index):\n${photoList}`
      : 'PHOTO CANDIDATES: none found.',
  });

  content.push({
    type: 'text',
    text: `PAGE TEXT (homepage plus linked pages):\n\n${(site.text || '').slice(0, MAX_PAGE_TEXT)}`,
  });

  const response = await anthropic.messages.create({
    model: MODEL,
    // The output is a short content inventory, so this ceiling is generous already and
    // keeps a runaway response from becoming a runaway bill.
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [SCAN_TOOL],
    tool_choice: { type: 'tool', name: 'submit_brand_scan' },
    messages: [{ role: 'user', content }],
  });

  logClaudeUsage(userId, MODEL, response.usage, 'wrap_brand_scan');

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse?.input) {
    throw new Error(`Claude did not return a brand scan (stop_reason: ${response.stop_reason})`);
  }

  const scan = toolUse.input;
  for (const key of ['business_name', 'trade', 'tagline', 'phone', 'website', 'service_area',
    'years_in_business', 'social_handle', 'services', 'credentials', 'brand_read', 'missing']) {
    scan[key] = decodeEntities(scan[key]);
  }
  Object.defineProperty(scan, 'usage', { value: response.usage, enumerable: false });
  return scan;
}

module.exports = { scanBrand, MODEL };
