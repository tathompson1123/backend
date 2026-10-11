// Small helpers for putting visitor-supplied text into email headers and names.

// Header values (subject, display name) must never contain line breaks, or the visitor gets
// to inject their own headers.
function singleLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

// A display name that is safe inside From: "Name <addr>".
function displayName(value) {
  return singleLine(value).replace(/["<>]/g, '');
}

function firstWord(value, max = 40) {
  return singleLine(value).split(/\s+/)[0].slice(0, max);
}

module.exports = { singleLine, displayName, firstWord };
