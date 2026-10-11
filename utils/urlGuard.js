// SSRF guard for every route that fetches a URL a user typed.
//
// The seo-audit, service-scrape and Google-review-import routes used to fetch whatever they
// were given, from inside our network — so http://169.254.169.254/ (the cloud metadata
// service), localhost, or Railway's private network were all reachable, and the response
// was handed back through the AI. siteScrape.js already had a solid guard; this exposes it
// in the shapes the other routes need.
const { assertPublicUrl, ScrapeError } = require('./siteScrape');

/** Resolve + validate. Throws an Error with a user-safe message. */
async function safeUrl(raw) {
  try {
    return await assertPublicUrl(raw);
  } catch (err) {
    if (err instanceof ScrapeError) throw err;
    throw new ScrapeError('That address cannot be fetched.', 'BAD_URL');
  }
}

/**
 * fetch() that validates the URL and every redirect hop (a public host can redirect to a
 * private one), with a hard cap on hops and on body size.
 */
async function guardedFetch(rawUrl, options = {}, { maxRedirects = 4, maxBytes = 2_000_000 } = {}) {
  let url = (await safeUrl(rawUrl)).href;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(url, { ...options, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = (await safeUrl(new URL(res.headers.get('location'), url).href)).href;
      continue;
    }
    // Read at most maxBytes so a huge or endless response can't exhaust memory.
    const reader = res.body?.getReader?.();
    let text = '';
    if (reader) {
      const decoder = new TextDecoder();
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        text += decoder.decode(value, { stream: true });
        if (total >= maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } break; }
      }
    } else {
      text = (await res.text()).slice(0, maxBytes);
    }
    return { ok: res.ok, status: res.status, headers: res.headers, text, url };
  }
  throw new ScrapeError('Too many redirects.', 'BAD_URL');
}

/**
 * Make a Puppeteer page refuse any request — the first navigation, redirects, or
 * subresources — that resolves to a non-public address.
 */
async function guardPuppeteerPage(page) {
  const verdicts = new Map(); // hostname -> Promise<boolean>
  const isPublic = (u) => {
    let host;
    try { host = new URL(u).hostname; } catch { return Promise.resolve(false); }
    if (!verdicts.has(host)) {
      verdicts.set(host, assertPublicUrl(u).then(() => true, () => false));
    }
    return verdicts.get(host);
  };
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = req.url();
      if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return req.continue();
      if (!/^https?:/i.test(u)) return req.abort('blockedbyclient');
      if (await isPublic(u)) return req.continue();
      return req.abort('blockedbyclient');
    } catch {
      try { req.abort('failed'); } catch { /* already handled */ }
    }
  });
}

module.exports = { safeUrl, guardedFetch, guardPuppeteerPage, ScrapeError };
