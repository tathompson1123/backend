// Abuse checks for the public website chat agent.
//
// The chat endpoint is anonymous and every message spends Claude tokens, so besides the
// rate limits (config/middleware.js) each message is scored here. A message that looks
// like abuse earns the conversation strikes; at BLOCK_AT strikes the conversation stops
// getting AI replies and just points the visitor at the business's own contact details.
// Nothing here looks at who the visitor is — only at what they send and how fast.

const MAX_USER_MESSAGES_PER_CONVERSATION = 30;
const BLOCK_AT = 3;               // strikes before a conversation is cut off
const LONG_MESSAGE_CHARS = 1500;  // the hard cap is 2000; sitting near it repeatedly is a tell
const BURST_MESSAGES = 8;         // this many visitor messages inside BURST_WINDOW_S is a script
const BURST_WINDOW_S = 60;

// Attempts to override the agent's instructions or pull its prompt out. A real customer
// asking about a detail has no reason to write any of these.
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|your)\b.{0,30}\b(instructions?|prompts?|rules?|guidelines?)\b/i,
  /\b(reveal|show|print|repeat|display|leak|output|tell me)\b.{0,40}\b(system|hidden|initial|original)\b.{0,15}\b(prompt|instructions?|message)\b/i,
  /\b(jailbreak|DAN mode|developer mode|do anything now)\b/i,
  /\byou are (now|no longer)\b.{0,40}\b(an? )?(ai|assistant|chatbot|model|unrestricted|unfiltered)\b/i,
  /\bpretend (to be|you are|you're)\b.{0,40}\b(unrestricted|unfiltered|different ai|no rules)\b/i,
  /<\s*\/?\s*(system|instructions?)\s*>/i,
];

const normalise = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param {string} message          the visitor's new message
 * @param {string[]} recentMessages their previous messages in this conversation, newest first
 * @param {number} recentCount      how many messages they sent in the last BURST_WINDOW_S
 * @returns {{ strikes: number, reasons: string[] }}
 */
function assessMessage(message, recentMessages = [], recentCount = 0) {
  const reasons = [];
  let strikes = 0;

  if (INJECTION_PATTERNS.some((re) => re.test(message))) {
    reasons.push('prompt_injection');
    strikes += 2; // deliberate, so it counts double
  }
  if (message.length >= LONG_MESSAGE_CHARS) {
    reasons.push('very_long_message');
    strikes += 1;
  }
  const n = normalise(message);
  if (n.length >= 4 && recentMessages.slice(0, 3).some((m) => normalise(m) === n)) {
    reasons.push('repeated_message');
    strikes += 1;
  }
  if (recentCount >= BURST_MESSAGES) {
    reasons.push('burst');
    strikes += 1;
  }
  return { strikes, reasons };
}

module.exports = {
  assessMessage,
  MAX_USER_MESSAGES_PER_CONVERSATION,
  BLOCK_AT,
  BURST_MESSAGES,
  BURST_WINDOW_S,
};
