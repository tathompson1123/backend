// Identify an image from its bytes rather than its filename.
//
// A browser sets an upload's Content-Type from the file extension, so multer's
// `file.mimetype` is a claim, not a fact. Anthropic's Messages API validates the actual
// bytes and rejects a mismatch outright:
//
//   "The image was specified using the image/png media type, but the image appears to be
//    a image/jpeg image"
//
// A customer sending a JPEG saved as .png — routine, and exactly how logos get passed
// around — would otherwise fail the whole run.

const SIGNATURES = [
  { type: 'image/png', test: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: 'image/jpeg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', test: b => b.length > 6 && b.toString('latin1', 0, 3) === 'GIF' },
  // WEBP is a RIFF container: "RIFF" then 4 size bytes then "WEBP".
  { type: 'image/webp', test: b => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];

/**
 * The real media type, or null when it isn't one of the formats we can pass on.
 * @param {Buffer} buffer
 * @returns {string|null}
 */
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  for (const sig of SIGNATURES) {
    if (sig.test(buffer)) return sig.type;
  }
  return null;
}

module.exports = { sniffImageType };
