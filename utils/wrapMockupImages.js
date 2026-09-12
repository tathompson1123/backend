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

/**
 * One Gemini image generation, with retries on transient rate limits.
 * `parts` is the content array: text plus any inline images.
 * Returns the first image the model produced, as a Buffer.
 */
async function generateImage(parts) {
  let waitedMs = 0;

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
        throw new WrapImageError(`Gemini returned no image (${reason})`);
      }
      return Buffer.from(imagePart.inlineData.data, 'base64');
    }

    const detail = body?.error?.message || text.slice(0, 300);

    if (res.status !== 429) {
      throw new WrapImageError(`Gemini image request failed (${res.status}) on ${IMAGE_MODEL}: ${detail}`);
    }

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

    if (attempt === MAX_ATTEMPTS) {
      throw new WrapImageError(
        `Gemini rate limit on ${IMAGE_MODEL} did not clear after ${attempt} attempts ` +
        `(waited ${Math.round(waitedMs / 1000)}s). The free tier allows very few image requests per minute; ` +
        `enabling billing on the Google AI project is the durable fix.`,
        'RATE_LIMITED'
      );
    }

    // Google's own delay when offered, otherwise exponential backoff.
    const wait = Math.min(suggestedDelayMs(body) || (2000 * Math.pow(2, attempt - 1)), MAX_WAIT_PER_ATTEMPT_MS);
    waitedMs += wait;
    console.log(`[wrap-mockup] rate limited on ${IMAGE_MODEL}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await sleep(wait);
  }

  // Unreachable — the loop either returns or throws.
  throw new WrapImageError('Gemini image generation failed');
}

/**
 * The blank vehicle sheet the wrap gets painted onto.
 *
 * Three orthographic-style views of ONE vehicle on a single sheet: side profile across the
 * top, front and rear beneath it. Flat, even, shadowless lighting on a plain light
 * background, because the artwork is the deliverable and staging that competes with it is
 * staging that hides it.
 *
 * Generated once per run and reused for both variants — a fresh vehicle per variant
 * would give two different vans, which defeats comparing designs side by side.
 */
async function renderBaseVehicle({ year, make, model, trim }) {
  const vehicle = [year, make, model, trim].filter(Boolean).join(' ');
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
    + 'LIGHTING AND FINISH: flat, even, neutral studio lighting across every panel, as on a '
    + 'wrap shop\'s design proof. No dramatic rim lighting, no cast shadows, no glossy floor '
    + 'reflections, no background gradient, no depth-of-field blur. Every panel is evenly lit '
    + 'and in sharp focus edge to edge. Clean, crisp, technical.\n\n'
    + 'The bodywork is completely blank: pure white paint, no text, no graphics, no logos, no '
    + 'livery, no pinstripes, no badges anywhere on any view. Ready to be wrapped.\n\n'
    + 'No people, no other vehicles, no watermark, no caption text, no labels, no dimension '
    + 'lines, no title on the sheet.';

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
 * @param {'bold'|'simple'} intensity which treatment — decides the coverage rule
 */
async function paintWrap({ baseImage, imagePrompt, references = [], intensity = 'bold' }) {
  const parts = [];
  const refs = (references || []).filter(r => r?.buffer);
  const bold = intensity !== 'simple';

  // The attached artwork is described in order and by kind, so the model can tell a
  // logo from a job photo. Without this it treats every attachment as equally
  // paintable and will smear a photograph across the whole panel.
  let refNote = '';
  if (refs.length === 1) {
    refNote = '\n- One artwork image is attached after the vehicle sheet.'
      + ' If it is a logo, reproduce it faithfully: same shapes, same colours, same proportions.'
      + ' Never redraw, restyle, recolour or add text to a logo. It is a separate element from any'
      + ' mascot described above; both appear.'
      + ' If it is a photograph, it is either a full-bleed duotone field tinted to the brand colours filling one zone, with text on a solid panel over it, or it is left out entirely. Never a small inset.';
  } else if (refs.length > 1) {
    const listed = refs.map((r, i) => '(' + (i + 1) + ') ' + (r.label || 'artwork')).join(', ');
    refNote = '\n- ' + refs.length + ' artwork images are attached after the vehicle sheet, in this order: ' + listed + '.'
      + '\n- Any logo among them must be reproduced faithfully: same shapes, same colours, same proportions. Never redraw, restyle, recolour or add text to a logo. It is a separate element from any mascot described above; both appear.'
      + '\n- Use at most ONE photographic image, and only as a full-bleed duotone field tinted to the brand colours filling a single zone, with text on a solid panel over it. Never a small inset or thumbnail. If it cannot be used at full bleed, leave it out.'
      + '\n- Do not tile, collage or repeat the artwork across the vehicle.';
  }

  // Coverage is the difference between a wrap and a decal job, and it is the one rule that
  // genuinely differs by treatment: the dense look demands every panel, the restrained look
  // earns its effect from empty base colour.
  const coverage = bold
    ? '\n- The wrap covers 100% of the painted bodywork on EVERY view, edge to edge: hood, roof, '
      + 'doors, full side, rear, front and rear bumpers, mirror caps and the pillars between the '
      + 'windows. No bare white body panel is visible anywhere unless white is a deliberate field '
      + 'in the design. Graphics run across panel gaps and door seams uninterrupted, as real vinyl does.'
    : '\n- Every view carries the base colour across the full body, including hood and bumpers. '
      + 'Empty space is in the base colour, never in bare white paint.';

  const instruction = imagePrompt + '\n\nMANDATORY CONSTRAINTS:'
    + '\n- Keep the THREE-VIEW LAYOUT exactly as in the attached sheet: the side profile across the '
    + 'top, the front at bottom left, the rear at bottom right, each in the same position, at the '
    + 'same size and at the same angle. Do not merge them, do not re-stage the vehicle at a new '
    + 'angle, do not drop a view, do not add a view.'
    + '\n- Preserve the vehicle exactly as shown: same model, shape, proportions, wheels, windows, '
    + 'background and flat even lighting. Change only the graphics applied to the bodywork.'
    + '\n- All three views show the SAME design: identical colours, identical wordmark treatment, '
    + 'identical mascot. They are three sides of one vehicle, not three design options.'
    + coverage
    + "\n- The wrap must follow the body's curves and panel lines like real vinyl, not float as a flat overlay."
    + '\n- The grille\'s mesh or slatted insert, and any badge set into it, are NOT wrapped — leave that '
    + 'area in the vehicle\'s real finish exactly as photographed. A wrap cannot be applied to a '
    + 'perforated, three-dimensional opening; every real installer cuts around it. Likewise leave '
    + 'glass, wheels, tyres, chrome trim and door handles unwrapped.'
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
