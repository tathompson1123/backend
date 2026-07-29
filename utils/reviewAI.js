// AI helpers for the Google Review SMS flow.
//
// Every function is defensive: a Claude error or odd output falls back to a
// deterministic result so the live SMS flow never breaks. Uses the same
// @anthropic-ai/sdk + usage-logging pattern as the rest of the app.

const Anthropic = require('@anthropic-ai/sdk');
const { logClaudeUsage } = require('./claudeUsage');

const MODEL = 'claude-sonnet-4-6';

let _client = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

async function ask(userId, endpoint, system, user, maxTokens = 160) {
  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  try { logClaudeUsage(userId, MODEL, resp.usage, endpoint); } catch {}
  return (resp.content?.[0]?.text || '').trim();
}

// ── Shorten a service name to how a customer would say it ────────────────────
// "Paint Enhancement Inspection" -> "paint enhancement"
// "3 Hour Express Interior Detail" -> "interior detail"
function fallbackShorten(name) {
  const out = String(name).toLowerCase()
    .replace(/\b\d+\s*(hour|hr|min|minute)s?\b/g, '')
    .replace(/\b(express|deluxe|premium|basic|standard|package|service|inspection|appointment|session)\b/g, '')
    .replace(/[^a-z0-9\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || String(name).toLowerCase().trim() || 'service';
}

async function shortenServiceName(serviceName, userId) {
  const name = String(serviceName || '').trim();
  if (!name) return 'service';
  try {
    const out = await ask(
      userId, 'review_shorten',
      'You shorten a service name to how a customer would casually refer to it when asked "how did the ___ go?". Reply with ONLY the short phrase, lowercase, no punctuation, 1-3 words.',
      `Examples:\n"Paint Enhancement Inspection" -> paint enhancement\n"3 Hour Express Interior Detail" -> interior detail\n"Ceramic Coating Package" -> ceramic coating\n"Full Exterior Wash & Wax" -> wash and wax\n\nService: "${name}"`,
      24
    );
    const cleaned = out.replace(/["'`]/g, '').replace(/[.]+$/, '').toLowerCase().trim();
    return cleaned || fallbackShorten(name);
  } catch {
    return fallbackShorten(name);
  }
}

// ── Classify a reply as positive / negative / neutral ────────────────────────
function keywordSentiment(body) {
  const t = String(body).toLowerCase();
  if (/\b(bad|terrible|awful|disappoint\w*|not happy|unhappy|worst|horrible|issue|problem|complain\w*|refund|poor|upset|angry|mad|not good|wasn'?t good|didn'?t|scratch\w*|damage\w*|never again|rude)\b/.test(t)) return 'negative';
  if (/\b(great|good|awesome|amazing|love\w*|perfect|excellent|fantastic|happy|satisfied|thank\w*|nice|wonderful|best|incredible|10\/10|beautiful|clean)\b/.test(t)) return 'positive';
  return 'neutral';
}

async function classifyReplySentiment(text, userId) {
  const body = String(text || '').trim();
  if (!body) return 'neutral';
  try {
    const out = await ask(
      userId, 'review_sentiment',
      'Classify a customer\'s reply to the question "How did the service go?" as exactly one word: positive, negative, or neutral. positive = satisfied/happy. negative = unhappy/complaint/problem. neutral = unclear, a question, or unrelated. Reply with ONLY one word.',
      `Reply: "${body}"`,
      8
    );
    const w = out.toLowerCase().replace(/[^a-z]/g, '');
    if (w.startsWith('pos')) return 'positive';
    if (w.startsWith('neg')) return 'negative';
    if (w.startsWith('neu')) return 'neutral';
    return keywordSentiment(body);
  } catch {
    return keywordSentiment(body);
  }
}

// ── Compose the positive-reply SMS (weaves the incentive in naturally) ───────
function fallbackPositive({ fn, incentive, incentiveEnabled, reviewLink }) {
  const inc = incentiveEnabled && incentive
    ? `Leave us a quick Google review and ${incentive}. `
    : `If you have a sec, we'd love a quick Google review. `;
  return `So glad to hear it, ${fn}! ${inc}${reviewLink || ''}`.trim();
}

async function composePositiveReply({ firstName, businessName, incentive, incentiveEnabled, reviewLink }, userId) {
  const fn = (firstName && String(firstName).trim()) || 'there';
  try {
    const incLine = incentiveEnabled && incentive
      ? `Offer this incentive, but ONLY as a reward conditional on leaving the review: "${incentive}". Phrase it like "if you leave us a Google review, <incentive>".`
      : 'Do not offer any incentive; just warmly ask for the review.';
    const out = await ask(
      userId, 'review_positive',
      `You write a single short, friendly SMS (max ~2 sentences, at most one emoji) from ${businessName || 'the business'} thanking a happy customer and asking them to leave a Google review. ${incLine} End with the review link exactly as given, on the same line is fine. Do not invent facts. Reply with ONLY the message text.`,
      `Customer first name: ${fn}\nReview link: ${reviewLink || ''}`,
      160
    );
    let msg = out.replace(/^["']|["']$/g, '').trim();
    if (reviewLink && !msg.includes(reviewLink)) msg = `${msg} ${reviewLink}`.trim();
    return msg || fallbackPositive({ fn, incentive, incentiveEnabled, reviewLink });
  } catch {
    return fallbackPositive({ fn, incentive, incentiveEnabled, reviewLink });
  }
}

// ── Rate an owner's incentive 1-10 for how well it earns reviews ─────────────
async function rateIncentive(incentiveText, userId) {
  const inc = String(incentiveText || '').trim();
  if (!inc) {
    return { score: null, tip: 'Add a specific, valuable incentive (e.g. a dollar amount off or a free add-on) to motivate reviews.' };
  }
  try {
    const out = await ask(
      userId, 'review_rate_incentive',
      'You rate how effective an incentive is at motivating a customer to leave a Google review, on a 1-10 scale (10 = very compelling). Give one short, concrete tip to improve it. Respond with ONLY minified JSON: {"score": <1-10 integer>, "tip": "<one sentence>"}.',
      `Incentive: "${inc}"`,
      120
    );
    const m = out.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      let score = parseInt(parsed.score, 10);
      score = Number.isFinite(score) ? Math.max(1, Math.min(10, score)) : null;
      return { score, tip: String(parsed.tip || '').trim() };
    }
  } catch {}
  return { score: null, tip: '' };
}

module.exports = {
  shortenServiceName,
  classifyReplySentiment,
  composePositiveReply,
  rateIncentive,
};
