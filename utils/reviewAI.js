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

/**
 * @param history optional prior turns [{ direction, message }] so a short reply
 *   like "yes" or "still no" is read against what was actually said before.
 */
async function classifyReplySentiment(text, userId, history = []) {
  const body = String(text || '').trim();
  if (!body) return { sentiment: 'neutral', reason: null, issue: null };

  // A stated rating settles the verdict — but the read still runs, because someone
  // can say "5 stars" and in the same breath mention the broken pressure washer,
  // and that is exactly the thing the business needs to hear about.
  const stated = explicitRating(body);

  const thread = (history || [])
    .slice(-6)
    .map(m => `${m.direction === 'incoming' ? 'Customer' : 'Business'}: ${m.message}`)
    .join('\n');

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
      (thread ? `Conversation so far:\n${thread}\n\n` : '') + `Latest reply: "${body}"`,
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
      // A rating they typed themselves outranks the model's reading of the prose,
      // but the issue it spotted is kept either way.
      const final = stated || result;
      if (stated && stated !== result) {
        console.log(`🧠 Rating "${stated}" overrides model verdict "${result}"`);
      }
      console.log(`🧠 Review sentiment: ${final}${reason ? ` — ${reason}` : ''}${issue ? ` | issue: ${issue}` : ''} | reply: "${body.slice(0, 120)}"`);
      return { sentiment: final, reason: reason || null, issue };
    }
    return { sentiment: stated || keywordSentiment(body), reason: null, issue: null };
  } catch (err) {
    console.warn('Review sentiment call failed, falling back to keywords:', err.message);
    return { sentiment: stated || keywordSentiment(body), reason: null, issue: null };
  }
}

// ── Compose the positive-reply SMS (weaves the incentive in naturally) ───────
// "Lukewarm" covers neutral verdicts and the mild-positive replies people actually
// send ("it went ok", "fine thanks") — gushing at those reads as canned, because it
// plainly isn't a response to what they said.
function fallbackPositive({ fn, incentive, incentiveEnabled, reviewLink, lukewarm }) {
  const inc = incentiveEnabled && incentive
    ? `Leave us a quick Google review and ${incentive}. `
    : `If you have a sec, we'd love a quick Google review. `;
  const opener = lukewarm ? `Thanks for letting us know, ${fn}!` : `So glad to hear it, ${fn}!`;
  return `${opener} ${inc}${reviewLink || ''}`.trim();
}

// customerReply/history are what make this a reply rather than a form letter. Without
// them the model wrote the same "thrilled you're happy with the results!" to someone
// who had said "it went ok, thanks for getting me in so soon" — overclaiming their
// mood and ignoring the one specific thing they'd actually chosen to mention.
async function composePositiveReply(
  { firstName, businessName, incentive, incentiveEnabled, reviewLink,
    customerReply, sentiment, history },
  userId
) {
  const fn = (firstName && String(firstName).trim()) || 'there';
  const reply = String(customerReply || '').trim();
  const lukewarm = sentiment === 'neutral';
  try {
    const incLine = incentiveEnabled && incentive
      ? `Offer this incentive, but ONLY as a reward conditional on leaving the review: "${incentive}". Phrase it like "if you leave us a Google review, <incentive>".`
      : 'Do not offer any incentive; just warmly ask for the review.';

    const thread = (history || [])
      .slice(-6)
      .map(m => `${m.direction === 'incoming' ? 'Customer' : 'Business'}: ${m.message}`)
      .join('\n');

    const system = reply
      ? `You write a single short SMS from ${businessName || 'the business'} replying to a customer who has just answered "how did the service go?".\n\n` +
        'Do two things, in this order:\n' +
        '1. Respond to what they ACTUALLY said. Pick up the specific thing they mentioned and answer it like a person would. If they thanked you for something, acknowledge that thing.\n' +
        `2. Then ask them to leave a Google review. ${incLine}\n\n` +
        'Match their energy, never inflate it. If they said it went "ok" or "fine", do NOT tell them they are thrilled or delighted or that you are so glad they loved it — something like "glad we could get you in quickly" is the right register. Save real enthusiasm for customers who were actually enthusiastic.\n\n' +
        'Do not quote their words back at them verbatim, and do not invent details they did not mention. Keep it to about 2 sentences before the link, at most one emoji. End with the review link exactly as given. Reply with ONLY the message text.'
      : `You write a single short, friendly SMS (max ~2 sentences, at most one emoji) from ${businessName || 'the business'} thanking a happy customer and asking them to leave a Google review. ${incLine} End with the review link exactly as given, on the same line is fine. Do not invent facts. Reply with ONLY the message text.`;

    const user = [
      `Customer first name: ${fn}`,
      reply ? `What they just said: "${reply}"` : null,
      thread ? `Conversation so far:\n${thread}` : null,
      lukewarm ? 'Read: they were satisfied but understated. Keep the warmth measured.' : null,
      `Review link: ${reviewLink || ''}`,
    ].filter(Boolean).join('\n');

    const out = await ask(userId, 'review_positive', system, user, 200);
    let msg = out.replace(/^["']|["']$/g, '').trim();
    if (reviewLink && !msg.includes(reviewLink)) msg = `${msg} ${reviewLink}`.trim();
    return msg || fallbackPositive({ fn, incentive, incentiveEnabled, reviewLink, lukewarm });
  } catch {
    return fallbackPositive({ fn, incentive, incentiveEnabled, reviewLink, lukewarm });
  }
}

// ── Follow-up nudges for a customer who was asked but hasn't left a review ───
// attempt 1 = a day after the ask, attempt 2 = a week after. Kept deliberately
// short and low-pressure: this person already said they were happy, so the job is
// to make it easy, not to sell. Never implies they promised anything.
function fallbackFollowUp({ fn, businessName, incentive, incentiveEnabled, reviewLink, attempt }) {
  const inc = incentiveEnabled && incentive ? ` and ${incentive}` : '';
  const body = attempt === 1
    ? `Hi ${fn}, just floating this back up — if you have a minute for a quick Google review${inc}, here's the link:`
    : `Hi ${fn}, last nudge from ${businessName || 'us'} on this one — a quick Google review${inc} would really help us out:`;
  return `${body} ${reviewLink || ''}`.trim();
}

async function composeReviewFollowUp(
  { firstName, businessName, incentive, incentiveEnabled, reviewLink, attempt = 1, history },
  userId
) {
  const fn = (firstName && String(firstName).trim()) || 'there';
  try {
    const incLine = incentiveEnabled && incentive
      ? `You may mention the incentive, but ONLY as conditional on leaving the review: "${incentive}".`
      : 'Do not offer any incentive.';

    const thread = (history || [])
      .slice(-6)
      .map(m => `${m.direction === 'incoming' ? 'Customer' : 'Business'}: ${m.message}`)
      .join('\n');

    const out = await ask(
      userId, 'review_followup',
      `You write a single short follow-up SMS from ${businessName || 'the business'} to a customer who said their service went well and was sent a Google review link, but hasn't used it yet.\n\n` +
      `${attempt === 1
        ? 'This is a gentle first reminder, about a day after the ask.'
        : 'This is the SECOND and final text reminder, about a week after the ask. Make it clear this is the last time you will bring it up, warmly and without guilt-tripping.'}\n\n` +
      `${incLine}\n\n` +
      'Rules: assume they are busy, not avoiding you — never imply they promised or forgot, never guilt them, never repeat a previous follow-up almost word for word. One short sentence plus the link, no more. At most one emoji. End with the review link exactly as given. Reply with ONLY the message text.',
      [
        `Customer first name: ${fn}`,
        thread ? `Conversation so far:\n${thread}` : null,
        `Review link: ${reviewLink || ''}`,
      ].filter(Boolean).join('\n'),
      160
    );
    let msg = out.replace(/^["']|["']$/g, '').trim();
    if (reviewLink && !msg.includes(reviewLink)) msg = `${msg} ${reviewLink}`.trim();
    return msg || fallbackFollowUp({ fn, businessName, incentive, incentiveEnabled, reviewLink, attempt });
  } catch {
    return fallbackFollowUp({ fn, businessName, incentive, incentiveEnabled, reviewLink, attempt });
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
  composeReviewFollowUp,
  rateIncentive,
};
