/**
 * Logs real Claude API token usage to the claude_usage table after every API call.
 * Used by all routes that call anthropic.messages.create() so the analytics
 * dashboard shows actual per-user costs instead of rough estimates.
 */

const { pool } = require('../config/database');

// Current Anthropic pricing — update if pricing changes (per million tokens)
const PRICING = {
  'claude-sonnet-4-6':        { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-20250514': { input: 3.00,  output: 15.00 }, // retired 2026-06-15; kept for historical cost calc
  'claude-sonnet-4-5':        { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001':{ input: 0.80,  output: 4.00  },
  'claude-haiku-4-20240307':  { input: 0.25,  output: 1.25  },
  'claude-opus-4-20250514':   { input: 15.00, output: 75.00 },
};

function calcCost(model, inputTokens, outputTokens) {
  const p = PRICING[model] || PRICING['claude-sonnet-4-6'];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
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
