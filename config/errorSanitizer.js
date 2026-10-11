// Stops internal error text from leaving the server.
//
// ~100 handlers answer a failure with `res.status(500).json({ error: err.message })`. When
// the failure is a database or network error, that message is a column name, a connection
// string fragment or a stack frame — a free schema map for anyone probing the API. Rewriting
// each handler is error-prone, so 5xx JSON bodies are screened here instead: messages that
// look internal are replaced with a generic one (and logged), `stack` is always removed, and
// ordinary human-readable messages ("Failed to send via Stripe") pass through unchanged.
const INTERNAL_PATTERNS = [
  /relation ".*" does not exist/i, /column ".*"/i, /violates .* constraint/i, /duplicate key/i,
  /syntax error/i, /invalid input syntax/i, /null value in column/i, /permission denied for/i,
  /\bECONN\w*|\bENOTFOUND\b|\bETIMEDOUT\b|\bEAI_AGAIN\b|socket hang up|getaddrinfo/i,
  /connection (terminated|timeout|refused)/i, /timeout exceeded when trying to connect/i,
  /cannot read propert|is not a function|is not defined|undefined|\bat \w+.*\(.*:\d+:\d+\)/i,
  /\bpostgres(ql)?\b|\bpg_|\bDATABASE_URL\b|\bjsonwebtoken\b|\bSECRET\b|\bAuthorization\b.*Bearer/i,
  /node_modules|[A-Za-z]:\\|\/app\/|\/usr\//,
];

function looksInternal(text) {
  return typeof text === 'string' && INTERNAL_PATTERNS.some(re => re.test(text));
}

function errorSanitizer(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (res.statusCode >= 500 && body && typeof body === 'object' && !Array.isArray(body)) {
        const cleaned = { ...body };
        delete cleaned.stack;
        for (const key of ['error', 'message', 'details']) {
          if (looksInternal(cleaned[key])) {
            console.error(`🛡️ Hid internal error text from ${req.method} ${req.originalUrl}: ${cleaned[key]}`);
            cleaned[key] = key === 'error' ? 'Something went wrong. Please try again.' : undefined;
          }
        }
        return originalJson(cleaned);
      }
    } catch { /* fall through to the untouched body */ }
    return originalJson(body);
  };
  next();
}

module.exports = { errorSanitizer, looksInternal };
