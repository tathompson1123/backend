// The email shape that actually reaches inboxes.
//
// Not a style preference — a measured result. A discovery confirmation built as a 600px
// card (gradient header band, nested tables, a remote logo, 6.6KB of markup around 975
// characters of text) was filed as Junk at a cold Outlook mailbox by both SendGrid and
// Postmark, with SPF, DKIM, DMARC and compauth passing on both. A four-sentence plain
// email from the same address, same domain, same two providers, reached the inbox of that
// same mailbox. Rebuilt in this shape, the confirmation reached the inbox too.
//
// What that rules out is as useful as what it shows: sender reputation, IP reputation,
// both ESPs and authentication were all exonerated in a single comparison. The markup was
// the whole problem. So the rules here are deliberate:
//
//   - No images. A remote image on first contact is tracking-pixel shaped and was the
//     single largest thing to remove.
//   - No colour bands, no gradients. A solid band of colour with centered white text is
//     the marketing-template signature.
//   - No layout tables. Detail rows are plain labelled lines, which read the same in every
//     client and cost nothing.
//   - Links inline, not buttons. A button needs a table or a padded block to survive
//     Outlook; an inline link needs neither, and appears once rather than twice.
//   - Aim for markup within ~2-3x the text length. The failing template was 6.8:1; this
//     shape lands around 2:1.
//
// Campaign and marketing mail is exempt on purpose. It is allowed to look designed, it
// carries List-Unsubscribe, and recipients opted into it. This is for mail that must
// arrive: receipts, confirmations, alerts, payment links.

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";
const P = 'margin:0 0 16px;';
const MUTED = 'margin:0;color:#6b7280;font-size:13px;';
const LINK = 'color:#1d4ed8;';

/**
 * Build a plain transactional email.
 *
 * Every string is emitted as-is, so callers escape untrusted values before passing them
 * (see utils/escapeHtml). Kept that way on purpose: these bodies interpolate business
 * names and customer notes, and escaping at the interpolation point is visible where the
 * data enters rather than hidden in here.
 *
 * @param {object} opts
 * @param {string} [opts.greeting]      - "Hi Jordan," — omitted if absent
 * @param {string[]} [opts.paragraphs]  - body paragraphs, HTML allowed
 * @param {Array<{label:string,value:string}>} [opts.details] - labelled lines
 * @param {{label:string,url:string}} [opts.action] - single inline link
 * @param {string[]} [opts.after]       - paragraphs after the action
 * @param {string} [opts.signature]     - small closing line
 */
function plainEmail(opts = {}) {
  const parts = [];

  if (opts.greeting) parts.push(`<p style="${P}">${opts.greeting}</p>`);
  for (const p of opts.paragraphs || []) if (p) parts.push(`<p style="${P}">${p}</p>`);

  // Labelled lines rather than a table, joined with <br> inside one paragraph rather than
  // a paragraph each. htmlToText turns every </p> into a blank line, so separate
  // paragraphs made the text/plain version of a five-row detail block twice as tall as it
  // needed to be and read as a list of unrelated sentences.
  if (opts.details?.length) {
    const rows = opts.details
      .filter(d => d && d.value)
      .map(d => `<strong>${d.label}:</strong> ${d.value}`)
      .join('<br>');
    if (rows) parts.push(`<p style="${P}">${rows}</p>`);
  }

  if (opts.action?.url && opts.action?.label) {
    parts.push(`<p style="${P}"><a href="${opts.action.url}" style="${LINK}">${opts.action.label}</a></p>`);
  }

  for (const p of opts.after || []) if (p) parts.push(`<p style="${P}">${p}</p>`);
  if (opts.signature) parts.push(`<p style="${MUTED}">${opts.signature}</p>`);

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;">
  <div style="font-family:${FONT};max-width:560px;margin:0 auto;padding:24px;color:#1f2937;font-size:15px;line-height:1.55;">
    ${parts.join('\n    ')}
  </div>
</body></html>`;
}

module.exports = { plainEmail };
