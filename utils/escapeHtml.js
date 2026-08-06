// One HTML escaper for outbound email.
//
// Email templates interpolate values that people we don't control typed: customer names
// off a booking form, SMS bodies, invoice line-item descriptions, model output. A stray
// `<` silently eats the rest of a line in an owner's inbox, and anything deliberate is
// someone else's markup rendering inside our email.
//
// This lives on its own because the escaping had been reimplemented per-file, in
// versions that disagreed about whether quotes counted. Escape at the interpolation
// point in `html:` only — never in `subject:` or `text:`, where an entity renders as
// the literal characters "&amp;" instead of "&".
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };
