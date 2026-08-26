// Paint a wrap onto a vehicle photo using Gemini's image model.
//
// Two steps, because a wrap mockup needs a believable vehicle first:
//
//   1. renderBaseVehicle() generates a clean side-profile photo of the year/make/model.
//   2. paintWrap() edits that photo, applying one design direction — and, when the
//      customer supplied a logo, passes it as a second image so the model reproduces
//      the real mark instead of inventing one.
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

// A run is four image calls, so one per-minute trip would otherwise kill the whole
// thing. Retry inside the call instead of asking the user to start over.
//
// Bounded deliberately: these retries sit inside a single HTTP request, and four calls
// each backing off generously can push the response past a proxy's timeout, which loses
// the whole run rather than one image. Two waits of at most 20s per call keeps the worst
// case around three minutes including generation time. If the free tier is being hit
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
        generationConfig: { responseModalities: ['IMAGE'] },
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
 * A clean side-profile photo of the vehicle, to be wrapped.
 * Plain background and even light on purpose — a busy scene makes the wrap harder to
 * read and harder for the edit step to keep consistent.
 */
async function renderBaseVehicle({ year, make, model, trim }) {
  const vehicle = [year, make, model, trim].filter(Boolean).join(' ');
  const prompt = `Photorealistic commercial vehicle photograph of a plain white ${vehicle}, ` +
    `exact side profile view, side-on to the camera, whole vehicle in frame. ` +
    `Even neutral daylight, clean light grey seamless studio background, vehicle parked on smooth grey floor. ` +
    `No text, no graphics, no logos, no livery anywhere on the vehicle — completely blank white paintwork ready to be wrapped. ` +
    `Sharp focus, no motion blur, no people, no other vehicles.`;

  return generateImage([{ text: prompt }]);
}

/**
 * Apply one design direction to the base photo.
 *
 * The preservation clause is load-bearing: without it the model tends to re-stage the
 * vehicle, and three variants that each show a different van are useless for comparing
 * designs side by side.
 */
async function paintWrap({ baseImage, imagePrompt, references = [] }) {
  const parts = [];
  const refs = (references || []).filter(r => r?.buffer);

  // The attached artwork is described in order and by kind, so the model can tell a
  // logo from a job photo. Without this it treats every attachment as equally
  // paintable and will smear a photograph across the whole panel.
  let refNote = '';
  if (refs.length === 1) {
    refNote = '\n- One artwork image is attached after the vehicle photo.'
      + ' If it is a logo, reproduce it faithfully: same shapes, same colours, same proportions.'
      + ' Never redraw, restyle, recolour or add text to a logo.'
      + ' If it is a photograph, use it only small and behind a solid contrast panel, never as the background for text.';
  } else if (refs.length > 1) {
    const listed = refs.map((r, i) => '(' + (i + 1) + ') ' + (r.label || 'artwork')).join(', ');
    refNote = '\n- ' + refs.length + ' artwork images are attached after the vehicle photo, in this order: ' + listed + '.'
      + '\n- Any logo among them must be reproduced faithfully: same shapes, same colours, same proportions. Never redraw, restyle, recolour or add text to a logo.'
      + '\n- Use at most ONE photographic image, kept small, and only behind or beside a solid contrast panel. Text never sits directly on a photo.'
      + '\n- Do not tile, collage or repeat the artwork across the vehicle.';
  }

  const instruction = imagePrompt + '\n\nMANDATORY CONSTRAINTS:'
    + '\n- Preserve the vehicle exactly as photographed: same model, shape, angle, position in frame, wheels, windows, background and lighting. Change only the graphics applied to the bodywork.'
    + "\n- The wrap must follow the body's curves and panel lines like real vinyl, not float as a flat overlay."
    + '\n- Every text string must be spelled exactly as given and be crisply legible.'
    + refNote;

  parts.push({ text: instruction });
  // Vehicle photo first — it is the image being edited, not a reference.
  parts.push({ inlineData: { mimeType: 'image/png', data: baseImage.toString('base64') } });
  for (const ref of refs) {
    parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.buffer.toString('base64') } });
  }

  return generateImage(parts);
}

module.exports = { renderBaseVehicle, paintWrap, WrapImageError, IMAGE_MODEL };
