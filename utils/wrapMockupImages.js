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
const IMAGE_MODEL = 'gemini-3-pro-image-preview';

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

/**
 * One Gemini call. `parts` is the content array: text plus any inline images.
 * Returns the first image the model produced, as a Buffer.
 */
async function generateImage(parts) {
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

  if (!res.ok) {
    const detail = body?.error?.message || text.slice(0, 300);
    throw new WrapImageError(`Gemini image request failed (${res.status}): ${detail}`);
  }

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
async function paintWrap({ baseImage, imagePrompt, logo }) {
  const parts = [];

  const instruction = `${imagePrompt}

MANDATORY CONSTRAINTS:
- Preserve the vehicle exactly as photographed: same model, shape, angle, position in frame, wheels, windows, background and lighting. Change only the graphics applied to the bodywork.
- The wrap must follow the body's curves and panel lines like real vinyl, not float as a flat overlay.
- Every text string must be spelled exactly as given and be crisply legible.${logo ? `
- A logo image is attached. Reproduce it faithfully — same shapes, same colours, same proportions. Do not redraw, restyle, recolour or add text to it.` : ''}`;

  parts.push({ text: instruction });
  parts.push({ inlineData: { mimeType: 'image/png', data: baseImage.toString('base64') } });
  if (logo) {
    parts.push({ inlineData: { mimeType: logo.mimeType || 'image/png', data: logo.buffer.toString('base64') } });
  }

  return generateImage(parts);
}

module.exports = { renderBaseVehicle, paintWrap, WrapImageError, IMAGE_MODEL };
