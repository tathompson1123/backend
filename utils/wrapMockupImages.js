// Paint a wrap onto a vehicle mockup using Gemini's image model.
//
// Two steps, because a wrap mockup needs a believable vehicle first:
//
//   1. renderBaseVehicle() generates a THREE-VIEW LAYOUT SHEET of the year/make/model —
//      side profile, front and rear of the same blank white vehicle on one clean sheet.
//   2. paintWrap() edits that sheet, applying one design direction across all three views —
//      and, when the customer supplied a logo, passes it as a further image so the model
//      reproduces the real mark instead of inventing one.
//
// WHY A LAYOUT SHEET, not a single hero angle. The wrap-shop mockups this tool is judged
// against are all three-view sheets, and for a reason: the rear is the panel a driver stares
// at for ninety seconds at a stop light, and it carries the densest content. A single
// three-quarter render never shows it, so half the design was being generated blind and
// never presented. Three separate renders per variant would cost 7 image calls a run
// instead of 3; one sheet keeps the cost identical to the old single-angle version.
//
// WHY FLAT MOCKUP STAGING, not a cinematic hero shot. An earlier version asked for a rim
// light along the roofline, shallow depth of field and a glossy floor reflection. It made
// handsome photographs in which the artwork — the entire deliverable — was soft, dimmed at
// the edges and half in shadow. Wrap presentation sheets are lit flat and evenly for the
// same reason a proof is: the design has to be read, not admired.
//
// Gemini is called over raw REST rather than through @google/genai. The dependency
// isn't in this project and the request shape here is small and stable, so adding a
// package (and a Railway rebuild) buys nothing.
//
// The base vehicle is GENERATED rather than looked up from a stock-photo API. For a
// mockup you present to win the job that's the right trade: no stock-photo licence
// question on an image you email to a prospect, no second vendor, one API key. The
// cost is exact-trim fidelity — the model renders a convincing Transit, but won't
// reliably distinguish a 2019 from a 2023.

const { sniffImageType } = require('./imageType');

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Image generation lives on the image-preview models; the plain text models reject it.
//
// Flash, not pro, and deliberately: gemini-3-pro-image has NO free-tier quota
// ("limit: 0"), so it 429s on every request until billing is enabled. Flash is also the
// model the proof-of-concept renders were made with, so it's the one actually known to
// hold text legibly and preserve the vehicle on an edit.
//
// Override with GEMINI_IMAGE_MODEL once billing is on, if pro is worth the cost.
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';

class WrapImageError extends Error {
  constructor(message, code = 'IMAGE_FAILED') {
    super(message);
    this.name = 'WrapImageError';
    this.code = code;
  }
}

function apiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new WrapImageError(
      'Image generation is not configured — GEMINI_API_KEY is missing on the server.',
      'NOT_CONFIGURED'
    );
  }
  return key;
}

/** Sleep helper for the retry loop below. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Google returns a RetryInfo detail with the delay it wants ("22.78s"). Honour it
// rather than guessing a backoff.
function suggestedDelayMs(body) {
  const details = body?.error?.details || [];
  for (const d of details) {
    const raw = d?.retryDelay;
    if (typeof raw === 'string') {
      const seconds = parseFloat(raw.replace(/s$/, ''));
      if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
    }
  }
  return null;
}

// A run is three image calls (one base sheet, two painted variants), so one per-minute
// trip would otherwise kill the whole thing. Retry inside the call instead of asking the
// user to start over.
//
// Bounded deliberately: these retries sit inside a single HTTP request, and three calls
// each backing off generously can push the response past a proxy's timeout, which loses
// the whole run rather than one image. Two waits of at most 20s per call keeps the worst
// case to a couple of minutes including generation time. If the free tier is being hit
// this hard, billing is the fix, not a longer wait.
const MAX_ATTEMPTS = 3;
const MAX_WAIT_PER_ATTEMPT_MS = 20000;

// 429 (rate limited) and 500/503 (Google's own infra overloaded or restarting) are all
// transient — the same request routed a few seconds later routinely succeeds. Anything else
// (400, 403, 404...) is a request Google has actually looked at and rejected, and retrying
// it wastes the attempt budget on a result that cannot change.
const RETRYABLE_STATUSES = [429, 500, 503];

/**
 * One Gemini image generation, with retries on transient rate limits and server errors.
 * `parts` is the content array: text plus any inline images.
 * Returns the first image the model produced, as a Buffer.
 */
async function generateImage(parts) {
  let waitedMs = 0;
  let lastStatus = null;
  let lastDetail = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${GEMINI_ENDPOINT}/${IMAGE_MODEL}:generateContent?key=${apiKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        // imageSize is requested but not guaranteed: gemini-3.1-flash-image-preview is
        // documented to ignore it and return ~1K regardless (only gemini-3-pro-image-preview
        // honours up to 4K, and pro has zero free-tier quota — see IMAGE_MODEL above). Sent
        // anyway because an unsupported field is silently ignored, not rejected, so there is
        // no downside, and Google may start honouring it on this model without a code change
        // here. Do NOT rely on this actually raising resolution — the prompt-side legibility
        // rules in wrapDesignSystem.js are the real mitigation for small, dense text.
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { imageSize: '2K' },
        },
      }),
    });

    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = null; }

    if (res.ok) {
      const candidate = body?.candidates?.[0];
      // A safety block returns 200 with no image and a finishReason, so an empty parts
      // array is a real outcome to report rather than a crash.
      const imagePart = (candidate?.content?.parts || []).find(p => p.inlineData?.data);
      if (!imagePart) {
        const reason = candidate?.finishReason || body?.promptFeedback?.blockReason || 'no image returned';
        // NO_IMAGE means the request was accepted but the model just didn't produce an image
        // on this attempt — Google's own guidance treats this as distinct from an actual
        // content-policy block (IMAGE_SAFETY, SAFETY, or any real promptFeedback.blockReason)
        // and recommends simply retrying. A genuine safety block is a decision that will not
        // change on a retry, so only this ambiguous "produced nothing" outcome gets another
        // attempt — retrying an actual policy rejection would just burn the attempt budget.
        const retryableEmptyResult = (reason === 'NO_IMAGE' || reason === 'OTHER') && !body?.promptFeedback?.blockReason;
        if (retryableEmptyResult && attempt < MAX_ATTEMPTS) {
          console.log(`[wrap-mockup] ${IMAGE_MODEL} returned no image (${reason}), retrying (attempt ${attempt}/${MAX_ATTEMPTS})`);
          await sleep(1500);
          continue;
        }
        throw new WrapImageError(`Gemini returned no image (${reason})`);
      }
      return Buffer.from(imagePart.inlineData.data, 'base64');
    }

    const detail = body?.error?.message || text.slice(0, 300);

    if (!RETRYABLE_STATUSES.includes(res.status)) {
      throw new WrapImageError(`Gemini image request failed (${res.status}) on ${IMAGE_MODEL}: ${detail}`);
    }
    lastStatus = res.status;
    lastDetail = detail;

    // The quota messages below are specific to 429 responses — a 500/503 body doesn't carry
    // this shape, so these checks only ever fire on the status they're written for.
    if (res.status === 429) {
      // "limit: 0" means the model has no allowance on this billing tier at all. Google
      // still attaches a retry delay, which can never help — don't burn attempts on it.
      if (/limit:\s*0\b/.test(detail)) {
        throw new WrapImageError(
          `${IMAGE_MODEL} has no quota on this Google AI billing tier, so every request is refused ` +
          `(the "retry in Ns" in Google's message is misleading — the limit is 0, not exhausted). ` +
          `Either enable billing on the Google AI project, or set GEMINI_IMAGE_MODEL to a model your tier allows.`,
          'QUOTA_UNAVAILABLE'
        );
      }

      // A daily cap won't clear within a request either.
      if (/per\s*_?day/i.test(detail)) {
        throw new WrapImageError(
          `Daily Gemini image quota is used up on ${IMAGE_MODEL}. It resets on Google's schedule — ` +
          `enable billing on the Google AI project to lift it.`,
          'QUOTA_DAILY'
        );
      }
    }

    if (attempt === MAX_ATTEMPTS) {
      const cause = res.status === 429
        ? `Gemini rate limit on ${IMAGE_MODEL} did not clear after ${attempt} attempts ` +
          `(waited ${Math.round(waitedMs / 1000)}s). The free tier allows very few image requests per minute; ` +
          `enabling billing on the Google AI project is the durable fix.`
        : `Gemini's own infrastructure (${res.status}) did not recover after ${attempt} attempts ` +
          `(waited ${Math.round(waitedMs / 1000)}s): ${detail}. This is an outage on Google's side, not ` +
          `a quota or request problem — retrying again in a minute usually clears it.`;
      throw new WrapImageError(cause, res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE');
    }

    // Google's own delay when offered, otherwise exponential backoff.
    const wait = Math.min(suggestedDelayMs(body) || (2000 * Math.pow(2, attempt - 1)), MAX_WAIT_PER_ATTEMPT_MS);
    waitedMs += wait;
    const reason = res.status === 429 ? 'rate limited' : `got a ${res.status} from Gemini`;
    console.log(`[wrap-mockup] ${reason} on ${IMAGE_MODEL}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await sleep(wait);
  }

  // Unreachable — the loop either returns or throws.
  throw new WrapImageError(
    lastStatus ? `Gemini image generation failed (${lastStatus}): ${lastDetail}` : 'Gemini image generation failed'
  );
}

// Shared across every layout below — the bodywork is always blank and always shot flat, only
// the view count and arrangement change.
const BLANK_BODYWORK = 'The bodywork is completely blank: pure white paint, no text, no '
  + 'graphics, no logos, no livery, no pinstripes, no badges anywhere on any view. Ready to be '
  + 'wrapped.\n\nNo people, no other vehicles, no watermark, no caption text, no labels, no '
  + 'dimension lines, no title on the sheet.';
const FLAT_LIGHTING = 'LIGHTING AND FINISH: flat, even, neutral studio lighting across every '
  + 'panel, as on a wrap shop\'s design proof. No dramatic rim lighting, no cast shadows, no '
  + 'glossy floor reflections, no background gradient, no depth-of-field blur. Every panel is '
  + 'evenly lit and in sharp focus edge to edge. Clean, crisp, technical.';

/**
 * The blank vehicle sheet the wrap gets painted onto.
 *
 * The view count matches what the coverage actually needs to show, not a fixed three-view
 * sheet: a sides-only or spot-graphics job has nothing to say about the front or rear, so
 * rendering (and later preserving) blank panels for them is wasted resolution budget on the
 * one thing that IS the deliverable — the side. Full coverage keeps the original three-view
 * layout sheet; sides+rear drops to two views; sides-only and spot drop to one.
 *
 * Flat, even, shadowless lighting on a plain light background either way, because the
 * artwork is the deliverable and staging that competes with it is staging that hides it.
 *
 * Generated once per run and reused for both variants — a fresh vehicle per variant
 * would give two different vans, which defeats comparing designs side by side.
 *
 * @param {'full'|'sides'|'sides_rear'|'spot'} coverage which views to render
 */
async function renderBaseVehicle({ year, make, model, trim, coverage = 'full' }) {
  const vehicle = [year, make, model, trim].filter(Boolean).join(' ');

  if (coverage === 'sides' || coverage === 'spot') {
    const prompt = 'A professional vehicle-wrap design mockup template — a single SIDE PROFILE '
      + 'view of a plain white ' + vehicle + ', shot square-on at 90 degrees against a plain very '
      + 'light grey studio background. The entire vehicle in frame from front bumper to rear '
      + 'bumper, wheels straight, no perspective distortion, filling most of the frame. No other '
      + 'view of the vehicle anywhere in the image — this is a single shot, not a sheet.\n\n'
      + FLAT_LIGHTING + '\n\n' + BLANK_BODYWORK;
    return generateImage([{ text: prompt }]);
  }

  if (coverage === 'sides_rear') {
    const prompt = 'A professional vehicle-wrap design mockup template sheet for a plain white '
      + vehicle + ', laid out as a print-ready presentation sheet.\n\n'
      + 'LAYOUT — TWO views of the SAME vehicle on one sheet, against a plain very light grey '
      + 'studio background:\n'
      + '- Across the top: the full SIDE PROFILE, shot square-on at 90 degrees, the entire '
      + 'vehicle in frame from front bumper to rear bumper, wheels straight, no perspective '
      + 'distortion. This is the largest view.\n'
      + '- Below it: the REAR view, square-on, showing the full rear doors or tailgate and rear '
      + 'bumper.\n'
      + '- Clear even spacing between the two views. Each view complete and uncropped. NO FRONT '
      + 'VIEW anywhere on this sheet.\n\n'
      + FLAT_LIGHTING + '\n\n' + BLANK_BODYWORK;
    return generateImage([{ text: prompt }]);
  }

  // full — the original three-view layout sheet.
  const prompt = 'A professional vehicle-wrap design mockup template sheet for a plain white '
    + vehicle + ', laid out as a print-ready presentation sheet.\n\n'
    + 'LAYOUT — three views of the SAME vehicle on one sheet, against a plain very light grey '
    + 'studio background:\n'
    + '- Across the top half: the full SIDE PROFILE, shot square-on at 90 degrees, the entire '
    + 'vehicle in frame from front bumper to rear bumper, wheels straight, no perspective '
    + 'distortion. This is the largest view.\n'
    + '- Bottom left: the FRONT view, square-on, showing the full grille, bumper, hood face '
    + 'and both mirrors.\n'
    + '- Bottom right: the REAR view, square-on, showing the full rear doors or tailgate and '
    + 'rear bumper.\n'
    + '- Clear even spacing between the views. Each view complete and uncropped.\n\n'
    + FLAT_LIGHTING + '\n\n' + BLANK_BODYWORK;

  return generateImage([{ text: prompt }]);
}

/**
 * Apply one design direction to the base sheet.
 *
 * The preservation clause is load-bearing twice over here: without it the model re-stages
 * the vehicle (two variants that each show a different van are useless for comparison),
 * and it also collapses the three-view layout back into a single hero shot.
 *
 * @param {Buffer} baseImage the three-view sheet from renderBaseVehicle
 * @param {string} imagePrompt the assembled per-view instruction from the brief
 * @param {Array<{buffer: Buffer, mimeType: string, label: string}>} references customer artwork
 * @param {'bold'|'simple'} intensity which treatment — decides how dense the wrapped area is
 * @param {'full'|'sides'|'sides_rear'|'spot'} coverage how much of the vehicle is wrapped at all —
 *   orthogonal to intensity: intensity is how busy the wrapped area is, coverage is which panels
 *   are wrapped in the first place
 */
async function paintWrap({ baseImage, imagePrompt, references = [], intensity = 'bold', coverage: coveragePreset = 'full' }) {
  const parts = [];
  const refs = (references || []).filter(r => r?.buffer);
  const bold = intensity !== 'simple';

  // The single most common way a logo reads as pasted-on rather than designed-in: giving it
  // a background shape that exists for no reason other than to hold the logo — almost always
  // a plain white or light rounded rectangle, because that is the easiest way to guarantee
  // contrast. A shape with no other job in the composition reads as a sticker no matter how
  // faithfully the logo itself is reproduced. Repeated regardless of artwork count because it
  // is the fix for the failure mode actually seen, not a nice-to-have.
  const logoIntegration = '\n- Do NOT put the logo in a rounded rectangle, a card, a badge, or any other shape '
    + "invented solely to hold it — that shape has no other job in the design and reads as a sticker "
    + "applied after the fact. Prefer placing the logo directly on one of the wrap's own colour fields "
    + 'with no background shape at all. Only give it a background if its own colours would genuinely '
    + "vanish against every field in the palette, and even then that background must be a real part of "
    + "the wrap's structure already described above — a corner the divider naturally creates, a panel "
    + 'sharing the divider\'s own angle — sized close to the logo itself, never a card floating with '
    + 'generous padding around it.';

  // The attached artwork is described in order and by kind, so the model can tell a
  // logo from a job photo. Without this it treats every attachment as equally
  // paintable and will smear a photograph across the whole panel.
  let refNote = '';
  if (refs.length === 1) {
    refNote = '\n- One artwork image is attached after the vehicle sheet.'
      + ' If it is a logo, reproduce it faithfully: same shapes, same colours, same proportions.'
      + ' Never redraw, restyle, recolour or add text to a logo. It is a separate element from any'
      + ' mascot described above; both appear.'
      + logoIntegration
      + ' If it is a photograph, it is either a full-bleed duotone field tinted to the brand colours filling one zone, with text on a solid panel over it, or it is left out entirely. Never a small inset.';
  } else if (refs.length > 1) {
    const listed = refs.map((r, i) => '(' + (i + 1) + ') ' + (r.label || 'artwork')).join(', ');
    refNote = '\n- ' + refs.length + ' artwork images are attached after the vehicle sheet, in this order: ' + listed + '.'
      + '\n- Any logo among them must be reproduced faithfully: same shapes, same colours, same proportions. Never redraw, restyle, recolour or add text to a logo. It is a separate element from any mascot described above; both appear.'
      + logoIntegration
      + '\n- Use at most ONE photographic image, and only as a full-bleed duotone field tinted to the brand colours filling a single zone, with text on a solid panel over it. Never a small inset or thumbnail. If it cannot be used at full bleed, leave it out.'
      + '\n- Do not tile, collage or repeat the artwork across the vehicle.';
  }

  // Coverage is the difference between a wrap and a decal job. At FULL coverage it is also
  // the one rule that genuinely differs by treatment: the dense look demands every panel, the
  // restrained look earns its effect from empty base colour. Partial coverage overrides both —
  // and the base sheet itself only contains the views that coverage actually needs (see
  // renderBaseVehicle), so a partial job has no front/rear panel to describe as bare at all.
  const REAR_FULLY_WRAPPED = '\n- The rear is fully wrapped, edge to edge: both rear doors or the '
    + 'tailgate/hatch, and the rear bumper. No bare white body panel visible there.';

  const coverageByPreset = {
    full: bold
      ? '\n- The wrap covers 100% of the painted bodywork on EVERY view, edge to edge: hood, roof, '
        + 'doors, full side, rear, front and rear bumpers, mirror caps and the pillars between the '
        + 'windows. No bare white body panel is visible anywhere unless white is a deliberate field '
        + 'in the design. Graphics run across panel gaps and door seams uninterrupted, as real vinyl does.'
      : '\n- Every view carries the base colour across the full body, including hood and bumpers. '
        + 'Empty space is in the base colour, never in bare white paint.',

    sides: '\n- This is a SIDES-ONLY partial wrap, not a full wrap. The wrap covers the doors, the '
      + 'full side panel and the pillars between the windows, edge to edge, the way a real '
      + 'sides-only wrap job is cut. This image shows only that one side view — there is no front '
      + 'or rear panel to consider.',

    sides_rear: '\n- This is a SIDES + REAR partial wrap, not a full wrap. On the side view: the wrap '
      + 'covers the doors, the full side panel and the pillars between the windows, edge to edge, the '
      + 'way a real partial wrap is cut.'
      + REAR_FULLY_WRAPPED
      + ' There is no front view on this sheet at all.',

    spot: '\n- This is SPOT GRAPHICS — a decal package, not a wrap. The only graphics anywhere on the '
      + 'vehicle are the logo and the business wordmark, applied at a moderate size on the front doors '
      + 'in this side view — NOT edge to edge, NOT spanning the panel, sized the way a real vinyl decal '
      + 'application is: generous bare paint visible all around it. Every other part of this one panel — '
      + 'the rest of the doors, the rear quarter, the roofline — stays in the vehicle\'s own bare factory '
      + 'paint exactly as shown in the blank base image: no colour fields, no additional graphics, no '
      + 'text. This image shows only this one side view — there is no front or rear panel.',
  };

  const coverage = coverageByPreset[coveragePreset] || coverageByPreset.full;

  // The layout-preservation clause has to match what renderBaseVehicle actually produced for
  // this coverage — a single side shot, a two-view sheet, or the original three-view sheet.
  const viewCount = coveragePreset === 'full' ? 3 : (coveragePreset === 'sides_rear' ? 2 : 1);
  const layoutClause = viewCount === 3
    ? '\n- Keep the THREE-VIEW LAYOUT exactly as in the attached sheet: the side profile across the '
      + 'top, the front at bottom left, the rear at bottom right, each in the same position, at the '
      + 'same size and at the same angle. Do not merge them, do not re-stage the vehicle at a new '
      + 'angle, do not drop a view, do not add a view.'
    : viewCount === 2
    ? '\n- Keep the TWO-VIEW LAYOUT exactly as in the attached sheet: the side profile view and the '
      + 'rear view, each in the same position, at the same size and at the same angle. Do not merge '
      + 'them, do not re-stage the vehicle at a new angle, do not add a front view, do not drop '
      + 'either view.'
    : '\n- This is a SINGLE SIDE-PROFILE IMAGE. Keep the vehicle\'s position, angle and framing '
      + 'exactly as shown. Do not add a front or rear view and do not create a multi-panel layout.';

  const consistencyClause = viewCount > 1
    ? `\n- All ${viewCount === 3 ? 'three' : 'two'} views show the SAME design: identical colours, `
      + 'identical wordmark treatment, identical mascot. They are '
      + `${viewCount === 3 ? 'three sides' : 'two sides'} of one vehicle, not design options.`
    : '';

  // The grille carve-out only matters when a front view actually exists to carve it out of.
  const grilleClause = viewCount === 3
    ? '\n- The grille\'s mesh or slatted insert, and any badge set into it, are NOT wrapped — leave that '
      + 'area in the vehicle\'s real finish exactly as photographed. A wrap cannot be applied to a '
      + 'perforated, three-dimensional opening; every real installer cuts around it. Likewise leave '
      + 'glass, wheels, tyres, chrome trim and door handles unwrapped.'
    : '\n- Leave glass, wheels, tyres, chrome trim and door handles unwrapped.';

  const instruction = imagePrompt + '\n\nMANDATORY CONSTRAINTS:'
    + layoutClause
    + '\n- Preserve the vehicle exactly as shown: same model, shape, proportions, wheels, windows, '
    + 'background and flat even lighting. Change only the graphics applied to the bodywork.'
    + consistencyClause
    + coverage
    + "\n- The wrap must follow the body's curves and panel lines like real vinyl, not float as a flat overlay."
    + grilleClause
    + '\n- Every text string must be spelled exactly as given and be crisply legible. Text sits wholly '
    + 'within ONE flat field of colour, or carries a heavy contrasting keyline if it crosses a boundary.'
    + '\n- The business name is the largest element on the vehicle by a wide margin, and whatever the '
    + 'business does must be readable at a glance on every view.'
    + '\n- Do not add any text that was not specified above — no invented services, credentials, '
    + 'slogans, ratings or licence numbers.'
    + '\n- No watermark, no caption, no title, no dimension lines and no labels on the sheet itself.'
    + refNote;

  parts.push({ text: instruction });
  // Vehicle sheet first — it is the image being edited, not a reference.
  parts.push({ inlineData: { mimeType: 'image/png', data: baseImage.toString('base64') } });
  for (const ref of refs) {
    // Sniffed for the same reason as the brief step: the declared type can be wrong.
    parts.push({
      inlineData: {
        mimeType: sniffImageType(ref.buffer) || ref.mimeType || 'image/png',
        data: ref.buffer.toString('base64'),
      },
    });
  }

  return generateImage(parts);
}

module.exports = { renderBaseVehicle, paintWrap, WrapImageError, IMAGE_MODEL };
