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

// An explicit rating is the customer telling us the answer outright, so it beats
// any reading of the prose. Someone can describe a hiccup and still say 5 stars —
// that happened, and they got escalated to a manager for it.
function explicitRating(body) {
  const t = String(body).toLowerCase();
  const m = t.match(/\b([1-5])\s*(?:\/\s*5\b|\s*stars?\b|\s*star\b)/) || t.match(/\b([1-5])\s*out of\s*5\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 4) return 'positive';
  if (n <= 2) return 'negative';
  return 'neutral';
}

function keywordSentiment(body) {
  const t = String(body).toLowerCase();

  const rating = explicitRating(t);
  if (rating) return rating;

  // Words that describe an incident ("problem", "issue", "didn't") say nothing
  // about how the customer feels, so they can't sit in the negative list. Keep it
  // to phrases that express dissatisfaction.
  if (/\b(bad|terrible|awful|disappoint\w*|not happy|unhappy|worst|horrible|complain\w*|refund|poor|upset|angry|mad|not good|wasn'?t good|never again|rude|unacceptable|waste of money)\b/.test(t)) return 'negative';
  if (/\b(great|good|awesome|amazing|love\w*|perfect|excellent|fantastic|happy|satisfied|thank\w*|nice|wonderful|best|incredible|10\/10|beautiful|clean)\b/.test(t)) return 'positive';
  return 'neutral';
}

async function classifyReplySentiment(text, userId) {
  const body = String(text || '').trim();
  if (!body) return { sentiment: 'neutral', reason: null, issue: null };

  // If they stated a rating, that's the answer — don't let the model reinterpret it.
  const stated = explicitRating(body);
  if (stated) return { sentiment: stated, reason: 'Customer stated a rating outright', issue: null };

  try {
    // Given room to weigh the reply rather than forced into a single token, so a
    // resolved hiccup mentioned alongside praise is read the way a person would
    // read it. The rationale is logged, which is how misreads get caught.
    const out = await ask(
      userId, 'review_sentiment',
      'A customer was asked "How did the service go?". Decide whether they are SATISFIED.\n\n' +
      'Weigh the whole reply the way a business owner would:\n' +
      '- What did they actually say about the outcome and the people?\n' +
      '- If something went wrong, was it explained, resolved, or shrugged off? A problem they ' +
      '  are relaxed about is not dissatisfaction. A small thing they are clearly annoyed by is.\n' +
      '- Do they state a rating? That is them answering directly — take it at face value.\n' +
      '- Would this person recommend the business right now, or do they want something fixed?\n\n' +
      'Judge how they FEEL overall, not whether an incident is mentioned. Most people mention ' +
      'the one thing that stood out even when they are perfectly happy.\n\n' +
      'positive = satisfied overall, worth asking for a review\n' +
      'negative = genuinely dissatisfied, or wants something put right\n' +
      'neutral = unclear, a question, or unrelated\n\n' +
      'Examples:\n' +
      '"Good, could not wash the car because the pressure washer broke. Charlie came by to explain. 5 stars" -> positive (they rated it 5 and were fine with the explanation)\n' +
      '"Fine but the guy was 20 min late" -> positive (minor, stated without annoyance)\n' +
      '"They missed a spot and nobody got back to me" -> negative (unresolved, wants action)\n' +
      '"Terrible, want a refund" -> negative\n\n' +
      'Separately, note anything the business would want to know about operationally — ' +
      'broken equipment, a missed step, a late arrival, a staff issue. Note it even when ' +
      'the customer is perfectly happy, because they often are and the business still ' +
      'needs to hear it. Write "none" if there is nothing.\n\n' +
      'Answer in exactly this format, nothing else:\n' +
      'REASON: <one short sentence>\n' +
      'ISSUE: <what needs looking at, or none>\n' +
      'VERDICT: positive|negative|neutral',
      `Reply: "${body}"`,
      120
    );

    const verdict = (out.match(/VERDICT:\s*(\w+)/i)?.[1] || out).toLowerCase();
    const reason = out.match(/REASON:\s*(.+)/i)?.[1]?.trim();
    const rawIssue = out.match(/ISSUE:\s*(.+)/i)?.[1]?.trim();
    const issue = rawIssue && !/^none\b/i.test(rawIssue) ? rawIssue : null;

    let result = null;
    if (verdict.startsWith('pos')) result = 'positive';
    else if (verdict.startsWith('neg')) result = 'negative';
    else if (verdict.startsWith('neu')) result = 'neutral';

    if (result) {
      console.log(`🧠 Review sentiment: ${result}${reason ? ` — ${reason}` : ''}${issue ? ` | issue: ${issue}` : ''} | reply: "${body.slice(0, 120)}"`);
      return { sentiment: result, reason: reason || null, issue };
    }
    return { sentiment: keywordSentiment(body), reason: null, issue: null };
  } catch (err) {
    console.warn('Review sentiment call failed, falling back to keywords:', err.message);
    return { sentiment: keywordSentiment(body), reason: null, issue: null };
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
