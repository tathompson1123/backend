/**
 * Logs real Claude API token usage to the claude_usage table after every API call.
 * Used by all routes that call anthropic.messages.create() so the analytics
 * dashboard shows actual per-user costs instead of rough estimates.
 */

const { pool } = require('../config/database');

// Current Anthropic pricing — update if pricing changes (per million tokens).
// Verified 2026-09-11.
const PRICING = {
  'claude-fable-5':           { input: 10.00, output: 50.00 },
  'claude-mythos-5':          { input: 10.00, output: 50.00 },
  'claude-opus-5':            { input: 5.00,  output: 25.00 },
  'claude-opus-4-8':          { input: 5.00,  output: 25.00 },
  'claude-opus-4-7':          { input: 5.00,  output: 25.00 },
  'claude-opus-4-6':          { input: 5.00,  output: 25.00 },
  'claude-sonnet-5':          { input: 2.00,  output: 10.00 },
  'claude-sonnet-4-6':        { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':         { input: 1.00,  output: 5.00  },
  'claude-sonnet-4-20250514': { input: 3.00,  output: 15.00 }, // retired 2026-06-15; kept for historical cost calc
  'claude-sonnet-4-5':        { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001':{ input: 1.00,  output: 5.00  },
  'claude-haiku-4-20240307':  { input: 0.25,  output: 1.25  },
  'claude-opus-4-20250514':   { input: 15.00, output: 75.00 },
};

// An unknown model falls back to the most expensive current tier, NOT a mid one. This
// table's whole job is to answer "what are we spending", and a silent under-report is the
// one failure mode that matters — claude-opus-5 was missing here and being costed at
// Sonnet 4.6 rates, understating every wrap brief by about 40%.
const FALLBACK = { input: 10.00, output: 50.00 };

function calcCost(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) console.warn(`⚠️ No pricing entry for "${model}" — costing at top-tier rates.`);
  const rate = p || FALLBACK;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/**
 * @param {number}  userId   - the platform user whose action triggered this call
 * @param {string}  model    - model ID from the API call
 * @param {object}  usage    - { input_tokens, output_tokens } from the API response
 * @param {string}  endpoint - short label e.g. 'chat', 'website_gen', 'sms_response'
 */
async function logClaudeUsage(userId, model, usage, endpoint) {
  if (!userId || !usage) return;
  const inputTokens  = usage.input_tokens  || 0;
  const outputTokens = usage.output_tokens || 0;
  const cost = calcCost(model, inputTokens, outputTokens);
  try {
    await pool.query(
      `INSERT INTO claude_usage (user_id, model, input_tokens, output_tokens, cost_usd, endpoint, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [userId, model, inputTokens, outputTokens, cost, endpoint]
    );
  } catch (err) {
    // Non-fatal — never let logging break a user-facing request
    console.error('⚠️ Failed to log Claude usage:', err.message);
  }
}

module.exports = { logClaudeUsage, calcCost };
