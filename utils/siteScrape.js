// Read a business's public website: text, structured data, image candidates, screenshot.
//
// Built for the wrap tool's brand scan, but deliberately generic — routes/services.js has
// its own near-identical Puppeteer scraper (scrapeWithPuppeteer, ~line 262) that predates
// this and should eventually be folded in here. It is NOT rewired as part of this change:
// it is a working deployed path with its own tuning, and swapping its engine belongs in a
// change that can be tested against it rather than riding along with a new feature.
//
// TWO ENGINES, same shape out. Puppeteer first, because the trades this tool serves are
// overwhelmingly on Wix, Squarespace and GoDaddy builders whose markup is assembled in the
// browser — a plain GET returns a shell with no services in it. Chromium is slow to cold
// start on Railway and occasionally will not start at all, so a cheerio fallback runs when
// it fails rather than the scan failing.
//
// SSRF. This module fetches a URL a user typed, from inside our network. Without a guard
// that is a request forwarder: someone types http://169.254.169.254/latest/meta-data/ and
// we obligingly fetch Railway's instance credentials and hand the text to an LLM that
// summarises it back to them. Every hostname is resolved and checked against the private
// ranges before a byte is fetched, and in the Puppeteer path every request the page makes
// is checked too, because a public host can redirect to a private one.

const dns = require('dns').promises;
const net = require('net');
const cheerio = require('cheerio');

const NAV_TIMEOUT_MS = 30000;
// Bounds the homepage plus up to MAX_LINKED_PAGES more, combined. Generous on purpose —
// brandScan sends this straight through to Opus 5 with no further truncation, and 60000
// characters is under 15K tokens, trivial next to a 1M-token context window. A smaller cap
// here would repeat the exact bug that was fixed on the brandScan side: content from a
// later-fetched page silently never reaching the model.
const MAX_TEXT_CHARS = 60000;
const MAX_LINKED_PAGES = 4;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class ScrapeError extends Error {
  constructor(message, code = 'SCRAPE_FAILED') {
    super(message);
    this.name = 'ScrapeError';
    this.code = code;
  }
}

// ── SSRF guard ───────────────────────────────────────────────────────────────

/** Private, loopback, link-local and unique-local ranges, v4 and v6. */
function isPrivateAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // 169.254/16 is link-local, and it is where every cloud provider parks its
    // instance-metadata service. This is the one that actually matters.
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true;                          // multicast and reserved
    return false;
  }
  if (version === 6) {
    const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (addr === '::1' || addr === '::') return true;
    if (/^f[cd]/.test(addr)) return true;               // unique local fc00::/7
    if (/^fe[89ab]/.test(addr)) return true;            // link local fe80::/10
    // ::ffff:10.0.0.1 — a v4 address wearing a v6 hat.
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // not an IP we can reason about — refuse it
}

/**
 * Normalise a user-supplied URL and prove it points somewhere public.
 * Throws ScrapeError rather than returning a flag, so it cannot be forgotten at a call site.
 */
async function assertPublicUrl(raw) {
  const text = String(raw || '').trim();
  // A scheme other than http/https ("ftp://", "file://", "javascript:") must be rejected
  // outright, not silently rewritten. Blindly prepending "https://" to anything lacking an
  // http(s) prefix — the original approach — turns "ftp://example.com" into the URL
  // "https://ftp//example.com": still blocked (it fails DNS), but for the wrong reason and
  // with a confusing error, and the general shape of "mangle first, validate second" is
  // exactly how a scheme check gets bypassed by accident later. Reject any other scheme by
  // name; only bare "bayviewmech.com" — no scheme at all — gets https assumed.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) {
    throw new ScrapeError('Only http and https addresses can be scanned.', 'BAD_URL');
  }
  let url;
  try {
    // "bayviewmech.com" is what a salesperson types; assume https rather than rejecting it.
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    throw new ScrapeError('That does not look like a web address.', 'BAD_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScrapeError('Only http and https addresses can be scanned.', 'BAD_URL');
  }
  const host = url.hostname;
  if (/^localhost$/i.test(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new ScrapeError('That address is not publicly reachable.', 'BLOCKED_HOST');
  }

  // A literal IP needs no lookup; a hostname needs every address it resolves to checked,
  // because a DNS record can point at 127.0.0.1 just as easily as anywhere else.
  const literals = net.isIP(host) ? [host] : [];
  let addresses = literals;
  if (addresses.length === 0) {
    try {
      const records = await dns.lookup(host, { all: true });
      addresses = records.map(r => r.address);
    } catch {
      throw new ScrapeError(`Could not find a site at ${host}.`, 'DNS_FAILED');
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new ScrapeError('That address is not publicly reachable.', 'BLOCKED_HOST');
  }
  return url;
}

/** Cheap synchronous re-check for redirect targets and subresources. */
function hostLooksPrivate(hostname) {
  if (!hostname) return true;
  if (/^localhost$/i.test(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.internal')) return true;
  if (net.isIP(hostname)) return isPrivateAddress(hostname);
  return false;
}

/**
 * Clean and dedupe the remainder of a set of tel: hrefs. Some call-tracking widgets double
 * up the scheme in their own markup (a real href of "tel:%20tel:555-1234" is not rare),
 * which otherwise reaches Claude as several noisy near-duplicates of the same number
 * instead of one clean value. Applied in Node after extraction rather than inside the
 * Puppeteer page.evaluate() callback, which runs in an isolated browser context with no
 * closure access to a helper defined out here.
 */
function cleanTelList(rawList) {
  const cleaned = (rawList || [])
    .map(raw => String(raw || '').replace(/^(?:%20|\s)*tel:/i, '').trim())
    .filter(Boolean);
  return Array.from(new Set(cleaned)).slice(0, 5);
}

// ── Shared helpers ───────────────────────────────────────────────────────────

// Nav labels a service business puts its content behind. Ordered by how often the wrap
// content inventory — services, credentials, service area — actually lives there.
const PAGE_KEYWORDS = [
  'service', 'about', 'contact', 'what-we-do', 'our-work', 'pricing', 'areas',
  'residential', 'commercial', 'gallery', 'review',
];

function scoreLogoCandidate(img) {
  let score = 0;
  const haystack = `${img.src} ${img.alt} ${img.cls}`.toLowerCase();
  if (img.inHeader) score += 4;
  if (/logo|brand|wordmark/.test(haystack)) score += 4;
  if (img.top != null && img.top < 250) score += 2;
  if (/\.svg(\?|$)/.test(img.src)) score += 1;
  if (/\.png(\?|$)/.test(img.src)) score += 1;
  // A logo is DISPLAYED small and roughly bannerish. Judge by RENDERED size first — what the
  // page actually shows — not the source file's native resolution: a logo uploaded as a
  // 2000px PNG and scaled down by CSS to 150px is still a logo, and a natural-resolution-only
  // check was missing exactly that common case. Natural width is the fallback for cheerio,
  // where no rendered size is ever available.
  if (img.w && img.w >= 40 && img.w <= 320) score += 3;
  else if (img.natW && img.natW >= 60 && img.natW <= 900) score += 2;
  if (img.w && img.w > 700) score -= 4;
  if (img.inFooter) score -= 2;
  if (/hero|banner|slide|background|cover/.test(haystack)) score -= 3;
  if (img.source === 'meta') score += 1;
  return score;
}

function scorePhotoCandidate(img) {
  let score = 0;
  const haystack = `${img.src} ${img.alt} ${img.cls}`.toLowerCase();
  if (img.natW && img.natW >= 800) score += 3;
  else if (img.natW && img.natW >= 500) score += 1;
  if (img.w && img.w >= 300) score += 2;
  if (/gallery|project|work|job|team|truck|van|fleet|crew/.test(haystack)) score += 3;
  if (/hero|banner/.test(haystack)) score += 1;
  if (img.inHeader) score -= 2;
  if (img.inFooter) score -= 3;
  if (/logo|icon|badge|avatar|sprite/.test(haystack)) score -= 5;
  if (img.natW && img.natW < 300) score -= 4;
  return score;
}

/**
 * Rank the raw image list into logo candidates and job-photo candidates.
 * Kept out of the browser context so it can be unit-tested and so both engines share it.
 */
function rankImages(images) {
  const seen = new Set();
  const unique = [];
  for (const img of images) {
    if (!img?.src) continue;
    // Data URIs can't be re-fetched by URL and tracking pixels aren't worth a slot.
    if (img.src.startsWith('data:')) continue;
    if (seen.has(img.src)) continue;
    seen.add(img.src);
    unique.push(img);
  }
  const logos = unique
    .map(img => ({ ...img, score: scoreLogoCandidate(img) }))
    .filter(img => img.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const logoSrcs = new Set(logos.map(l => l.src));
  const photos = unique
    .filter(img => !logoSrcs.has(img.src))
    .map(img => ({ ...img, score: scorePhotoCandidate(img) }))
    .filter(img => img.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return { logos, photos };
}

/** Every <script type="application/ld+json"> block that parses. */
function parseJsonLd(html) {
  const blocks = [];
  const $ = cheerio.load(html);
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      // A @graph wrapper is how most SEO plugins emit several entities at once.
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed['@graph']) blocks.push(...[].concat(parsed['@graph']));
      else blocks.push(parsed);
    } catch {
      // A malformed block is common and not worth failing a scan over.
    }
  });
  return blocks;
}

// ── Puppeteer engine ─────────────────────────────────────────────────────────

async function scrapeWithBrowser(url) {
  const puppeteer = require('puppeteer-core');
  const chromium = require('@sparticuz/chromium');

  const browser = await puppeteer.launch({
    args: chromium.args,
    // Kept modest on purpose: the screenshot goes to a vision model, which downscales
    // anything larger anyway, and a smaller viewport is a smaller Chromium footprint.
    defaultViewport: { width: 1280, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: 'new',
    ignoreHTTPSErrors: true,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36 SORCE-BrandScan/1.0 (+https://sorce.app)'
    );

    // The redirect half of the SSRF guard. assertPublicUrl vetted the address the user
    // typed; this vets everywhere the page then tries to go.
    await page.setRequestInterception(true);
    page.on('request', req => {
      try {
        if (hostLooksPrivate(new URL(req.url()).hostname)) return req.abort();
      } catch { return req.abort(); }
      req.continue();
    });

    await page.goto(url.href, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
    await sleep(2000);

    // Lazy-loaded galleries are where the job photos live, and they only exist after a scroll.
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 400));
      }
      window.scrollTo(0, 0);
    });
    await sleep(800);

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 72 });

    const harvested = await page.evaluate(() => {
      const abs = (src) => { try { return new URL(src, location.href).href; } catch { return null; } };
      const images = [];

      for (const img of document.querySelectorAll('img')) {
        const src = abs(img.currentSrc || img.src);
        if (!src) continue;
        const rect = img.getBoundingClientRect();
        images.push({
          src,
          alt: img.alt || '',
          cls: String(img.className || ''),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          natW: img.naturalWidth || null,
          natH: img.naturalHeight || null,
          top: Math.round(rect.top + window.scrollY),
          inHeader: !!img.closest('header, nav, [role="banner"], .header, #header'),
          inFooter: !!img.closest('footer, [role="contentinfo"], .footer, #footer'),
          source: 'img',
        });
      }

      // CSS background images, but only on the containers likely to hold a logo or a hero.
      // Walking every element on a builder-generated page is thousands of getComputedStyle
      // calls for almost no additional signal.
      const containers = document.querySelectorAll(
        'header, nav, [role="banner"], section, .hero, .banner, [class*="hero"], [class*="logo"]'
      );
      let scanned = 0;
      for (const el of containers) {
        if (scanned++ > 60) break;
        const bg = getComputedStyle(el).backgroundImage;
        const match = bg && bg.match(/url\(["']?(.+?)["']?\)/);
        if (!match) continue;
        const src = abs(match[1]);
        if (!src) continue;
        const rect = el.getBoundingClientRect();
        images.push({
          src, alt: '', cls: String(el.className || ''),
          w: Math.round(rect.width), h: Math.round(rect.height),
          natW: null, natH: null,
          top: Math.round(rect.top + window.scrollY),
          inHeader: !!el.closest('header, nav, [role="banner"]'),
          inFooter: !!el.closest('footer, [role="contentinfo"]'),
          source: 'css',
        });
      }

      const meta = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) || '';
      for (const [sel, attr] of [
        ['meta[property="og:image"]', 'content'],
        ['link[rel="apple-touch-icon"]', 'href'],
        ['link[rel="icon"]', 'href'],
      ]) {
        const raw = meta(sel, attr);
        const src = raw && abs(raw);
        if (src) {
          images.push({
            src, alt: 'site metadata image', cls: '', w: 0, h: 0,
            natW: null, natH: null, top: 0, inHeader: false, inFooter: false, source: 'meta',
          });
        }
      }

      // tel: and mailto: are far more reliable than pattern-matching a phone out of prose,
      // and sameAs/social links give the handle the wrap can carry.
      const hrefs = Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
      const tel = hrefs.filter(h => h.startsWith('tel:')).map(h => h.slice(4));
      const social = hrefs.filter(h =>
        /(facebook|instagram|linkedin|youtube|tiktok|x\.com|twitter)\.com/i.test(h));

      return {
        title: document.title || '',
        description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
        siteName: meta('meta[property="og:site_name"]'),
        text: document.body.innerText || '',
        images,
        tel: Array.from(new Set(tel)).slice(0, 5),
        social: Array.from(new Set(social)).slice(0, 8),
      };
    });

    const html = await page.content();

    // Follow a few internal pages. Services and credentials are usually one click in.
    const links = await page.evaluate((keywords) => {
      const base = new URL(location.href);
      const seen = new Set([base.pathname]);
      const found = [];
      for (const a of document.querySelectorAll('nav a[href], header a[href], a[href]')) {
        if (found.length >= 8) break;
        let u;
        try { u = new URL(a.href, base.origin); } catch { continue; }
        if (u.origin !== base.origin) continue;
        if (seen.has(u.pathname) || u.pathname === '/' ) continue;
        if (/\.(jpg|jpeg|png|gif|svg|pdf|css|js|ico|webp|mp4|mp3)$/i.test(u.pathname)) continue;
        const hay = (u.pathname + ' ' + (a.textContent || '')).toLowerCase();
        if (!keywords.some(k => hay.includes(k))) continue;
        seen.add(u.pathname);
        found.push(u.href);
      }
      return found;
    }, PAGE_KEYWORDS);

    let text = harvested.text;
    for (const link of links.slice(0, MAX_LINKED_PAGES)) {
      if (text.length > MAX_TEXT_CHARS) break;
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1200);
        const extra = await page.evaluate(() => document.body.innerText || '');
        text += `\n\n--- ${link} ---\n\n${extra}`;
      } catch {
        // A page that will not load is not a reason to lose the pages that did.
      }
    }

    return {
      engine: 'browser',
      finalUrl: url.href,
      title: harvested.title,
      description: harvested.description,
      siteName: harvested.siteName,
      text: text.slice(0, MAX_TEXT_CHARS),
      jsonLd: parseJsonLd(html),
      tel: cleanTelList(harvested.tel),
      social: harvested.social,
      ...rankImages(harvested.images),
      screenshot,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Cheerio fallback ─────────────────────────────────────────────────────────

async function scrapeWithFetch(url) {
  const res = await fetch(url.href, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SORCE-BrandScan/1.0 (+https://sorce.app)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new ScrapeError(`The site returned ${res.status} when we tried to read it.`, 'HTTP_ERROR');
  }
  // fetch follows redirects itself, so the destination has to be re-checked.
  const finalUrl = new URL(res.url || url.href);
  if (hostLooksPrivate(finalUrl.hostname)) {
    throw new ScrapeError('That address redirects somewhere not publicly reachable.', 'BLOCKED_HOST');
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const abs = (src) => { try { return new URL(src, finalUrl.href).href; } catch { return null; } };

  const images = [];
  $('img').each((_, el) => {
    const src = abs($(el).attr('src') || $(el).attr('data-src') || '');
    if (!src) return;
    const inHeader = $(el).closest('header, nav, .header, #header').length > 0;
    images.push({
      src,
      alt: $(el).attr('alt') || '',
      cls: $(el).attr('class') || '',
      // No layout without a browser, so the width attribute is the only size hint there is.
      w: parseInt($(el).attr('width'), 10) || 0,
      h: parseInt($(el).attr('height'), 10) || 0,
      natW: parseInt($(el).attr('width'), 10) || null,
      natH: null,
      top: null,
      inHeader,
      inFooter: $(el).closest('footer, .footer, #footer').length > 0,
      source: 'img',
    });
  });
  for (const [sel, attr] of [
    ['meta[property="og:image"]', 'content'],
    ['link[rel="apple-touch-icon"]', 'href'],
    ['link[rel="icon"]', 'href'],
  ]) {
    const src = abs($(sel).first().attr(attr) || '');
    if (src) {
      images.push({
        src, alt: 'site metadata image', cls: '', w: 0, h: 0,
        natW: null, natH: null, top: 0, inHeader: false, inFooter: false, source: 'meta',
      });
    }
  }

  const hrefs = $('a[href]').map((_, el) => $(el).attr('href')).get();
  $('script, style, noscript, svg').remove();
  let text = $('body').text().replace(/\s+/g, ' ').trim();

  // Follow the same handful of internal pages the browser engine would, so a Chromium
  // failure doesn't ALSO mean losing the services/contact page's content on top of losing
  // JS-rendered images — a plain GET works just as well as Puppeteer for a static page,
  // and this was previously skipped outright, silently limiting the fallback to whatever
  // fit on the homepage alone.
  const links = [];
  const seenPaths = new Set([finalUrl.pathname]);
  $('nav a[href], header a[href], a[href]').each((_, el) => {
    if (links.length >= MAX_LINKED_PAGES) return false;
    let u;
    try { u = new URL($(el).attr('href') || '', finalUrl.origin); } catch { return; }
    if (u.origin !== finalUrl.origin) return;
    if (seenPaths.has(u.pathname) || u.pathname === '/') return;
    if (/\.(jpg|jpeg|png|gif|svg|pdf|css|js|ico|webp|mp4|mp3)$/i.test(u.pathname)) return;
    const hay = (u.pathname + ' ' + ($(el).text() || '')).toLowerCase();
    if (!PAGE_KEYWORDS.some(k => hay.includes(k))) return;
    seenPaths.add(u.pathname);
    links.push(u.href);
  });

  for (const link of links) {
    if (text.length > MAX_TEXT_CHARS) break;
    try {
      const linkRes = await fetch(link, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SORCE-BrandScan/1.0 (+https://sorce.app)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!linkRes.ok) continue;
      // Re-checked for the same reason as the homepage itself — a redirect can land
      // somewhere this scan should never fetch.
      if (hostLooksPrivate(new URL(linkRes.url || link).hostname)) continue;
      const linkHtml = await linkRes.text();
      const $link = cheerio.load(linkHtml);
      $link('script, style, noscript, svg').remove();
      const linkText = $link('body').text().replace(/\s+/g, ' ').trim();
      text += `\n\n--- ${link} ---\n\n${linkText}`;
    } catch {
      // A page that won't load isn't a reason to lose the ones that did.
    }
  }

  return {
    engine: 'fetch',
    finalUrl: finalUrl.href,
    title: $('title').first().text() || '',
    description: $('meta[name="description"]').attr('content')
      || $('meta[property="og:description"]').attr('content') || '',
    siteName: $('meta[property="og:site_name"]').attr('content') || '',
    text: text.slice(0, MAX_TEXT_CHARS),
    jsonLd: parseJsonLd(html),
    tel: cleanTelList(hrefs.filter(h => h?.startsWith('tel:')).map(h => h.slice(4))),
    social: Array.from(new Set(hrefs.filter(h =>
      /(facebook|instagram|linkedin|youtube|tiktok|x\.com|twitter)\.com/i.test(h || '')))).slice(0, 8),
    ...rankImages(images),
    screenshot: null,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Read a public website. Puppeteer first, cheerio when Chromium will not cooperate.
 * @param {string} rawUrl whatever the user typed
 * @returns {Promise<object>} { engine, finalUrl, title, text, jsonLd, logos, photos, screenshot, ... }
 */
async function scrapeSite(rawUrl) {
  const url = await assertPublicUrl(rawUrl);

  // One retry before giving up on the browser engine. A Chromium cold start or a single
  // slow navigation on Railway is a transient blip, not a reason to fall back to cheerio
  // for the whole scan — and cheerio genuinely cannot see a JS-rendered logo, gallery or
  // lazy-loaded image, which is most of what these builder-platform sites are made of.
  // Falling back on the first hiccup was very likely why logos and photos were going
  // missing intermittently rather than consistently.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await scrapeWithBrowser(url);
    } catch (err) {
      if (err instanceof ScrapeError) throw err;
      if (attempt === 2) {
        console.warn(`[brand-scan] browser engine failed twice (${err.message}); falling back to fetch`);
        break;
      }
      console.warn(`[brand-scan] browser engine failed (${err.message}); retrying once`);
    }
  }
  return await scrapeWithFetch(url);
}

/**
 * Download one of the images the scan found.
 * Re-validated rather than trusted: the URL came off a page we do not control.
 */
async function fetchImage(src, maxBytes = 5 * 1024 * 1024) {
  const url = await assertPublicUrl(src);
  const res = await fetch(url.href, {
    redirect: 'follow',
    headers: { 'User-Agent': 'SORCE-BrandScan/1.0 (+https://sorce.app)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new ScrapeError(`Image fetch failed (${res.status})`, 'IMAGE_FAILED');
  if (hostLooksPrivate(new URL(res.url || url.href).hostname)) {
    throw new ScrapeError('Image redirects somewhere not publicly reachable.', 'BLOCKED_HOST');
  }
  const declared = Number(res.headers.get('content-length'));
  if (declared && declared > maxBytes) {
    throw new ScrapeError('Image is too large to use.', 'IMAGE_TOO_LARGE');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) throw new ScrapeError('Image is too large to use.', 'IMAGE_TOO_LARGE');
  return { buffer, contentType: res.headers.get('content-type') || '' };
}

module.exports = {
  scrapeSite,
  fetchImage,
  assertPublicUrl,
  isPrivateAddress,
  rankImages,
  parseJsonLd,
  ScrapeError,
};
