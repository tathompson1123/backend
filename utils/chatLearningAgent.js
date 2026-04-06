/**
 * Chat Learning Agent
 *
 * Runs on a schedule. Scans recent chat conversations for:
 *   1. Error messages that leaked through to customers
 *   2. Booking attempts that failed
 *   3. Customers who disengaged early or expressed frustration
 *
 * Sends findings to Claude, gets back concise behavioral instructions,
 * and appends them to the agent config as `learnedInstructions` (kept
 * separate from the user's own `customInstructions` so it can be reviewed).
 */

const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../config/database');
const { logClaudeUsage } = require('./claudeUsage');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Patterns that indicate a system error leaked into the chat
const ERROR_PATTERNS = [
  /invalid input syntax/i,
  /syntax error/i,
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /null value in column/i,
  /duplicate key value/i,
  /permission denied/i,
  /connection refused/i,
  /ECONNREFUSED/i,
];

function looksLikeError(content) {
  return ERROR_PATTERNS.some(p => p.test(content));
}

async function runChatLearningAgent() {
  if (!process.env.ANTHROPIC_API_KEY) return;

  console.log('🧠 Chat learning agent running...');

  try {
    // Find all users who had conversations in the past 24h
    const usersResult = await pool.query(`
      SELECT DISTINCT user_id
      FROM chat_conversations
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);

    for (const { user_id } of usersResult.rows) {
      try {
        await analyzeAndLearn(user_id);
      } catch (err) {
        console.error(`🧠 Learning agent error for user ${user_id}:`, err.message);
      }
    }

    console.log('🧠 Chat learning agent complete');
  } catch (err) {
    console.error('🧠 Chat learning agent fatal error:', err.message);
  }
}

async function analyzeAndLearn(userId) {
  // Pull recent conversations with full message history
  const convsResult = await pool.query(`
    SELECT
      cc.id AS conv_id,
      JSON_AGG(
        JSON_BUILD_OBJECT('role', cm.role, 'content', cm.content)
        ORDER BY cm.created_at ASC
      ) AS messages
    FROM chat_conversations cc
    JOIN chat_messages cm ON cm.conversation_id = cc.id
    WHERE cc.user_id = $1
      AND cc.created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY cc.id
    HAVING COUNT(cm.id) > 1
  `, [userId]);

  if (convsResult.rows.length === 0) return;

  const issues = [];

  for (const { conv_id, messages } of convsResult.rows) {
    const assistantMsgs = messages.filter(m => m.role === 'assistant');
    const userMsgs = messages.filter(m => m.role === 'user');

    // 1. Error messages visible to customers
    const errMsgs = assistantMsgs.filter(m =>
      m.content.startsWith("I'm sorry, but") && looksLikeError(m.content)
    );
    if (errMsgs.length > 0) {
      issues.push({
        convId: conv_id,
        type: 'system_error',
        detail: errMsgs.map(m => m.content).join('\n'),
      });
    }

    // 2. Booking attempt that failed (BOOKING_REQUEST present but no "Booking #" in any message)
    const allText = messages.map(m => m.content).join('\n');
    if (allText.includes('BOOKING_REQUEST') && !/booking #/i.test(allText)) {
      issues.push({ convId: conv_id, type: 'failed_booking', detail: null });
    }

    // 3. Customer frustration signals
    const frustrationPhrases = [
      /forget it/i, /never mind/i, /this is useless/i, /not helpful/i,
      /you don't understand/i, /that's wrong/i, /stop/i,
    ];
    const frustrated = userMsgs.some(m => frustrationPhrases.some(p => p.test(m.content)));
    if (frustrated) {
      // Include the last 4 messages for context
      const snippet = messages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
      issues.push({ convId: conv_id, type: 'frustration', detail: snippet });
    }
  }

  if (issues.length === 0) return;

  // Get current agent config
  const configResult = await pool.query(
    'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
    [userId, 'website_chat']
  );
  const currentConfig = configResult.rows[0]?.config || {};
  const existingLearned = currentConfig.learnedInstructions || '';

  // Build summary for Claude
  const systemErrors = issues.filter(i => i.type === 'system_error');
  const failedBookings = issues.filter(i => i.type === 'failed_booking');
  const frustrations = issues.filter(i => i.type === 'frustration');

  const lines = [];
  if (systemErrors.length > 0) {
    lines.push(`System errors shown to customers (${systemErrors.length} occurrences):\n${systemErrors.slice(0, 3).map(i => i.detail).join('\n---\n')}`);
  }
  if (failedBookings.length > 0) {
    lines.push(`${failedBookings.length} booking attempt(s) started but never completed.`);
  }
  if (frustrations.length > 0) {
    lines.push(`Customer frustration detected in ${frustrations.length} conversation(s):\n${frustrations.slice(0, 2).map(i => i.detail).join('\n---\n')}`);
  }

  const prompt = `You are improving a chat booking agent's behavior based on real conversation issues.

Already-learned instructions (do not repeat these):
${existingLearned || '(none yet)'}

Issues found in the last 24 hours:
${lines.join('\n\n')}

Write ONLY new behavioral instructions for the agent to avoid these issues going forward. Rules:
- Be concise: 1-3 sentences per issue type
- Only write instructions the agent can actually follow (no code fixes)
- If the issue is purely a backend/code bug (e.g. database errors) that can't be addressed through conversation behavior, skip it
- Do not repeat anything already in the learned instructions above
- If there is nothing actionable to add, respond with exactly: NO_CHANGE

Respond with either "NO_CHANGE" or the new instruction text only.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  logClaudeUsage(userId, 'claude-haiku-4-5-20251001', response.usage, 'chat_learning');
  const suggestion = response.content[0].text.trim();
  if (!suggestion || suggestion === 'NO_CHANGE') {
    console.log(`🧠 Learning: no prompt changes needed for user ${userId}`);
    return;
  }

  // Append new learning with a timestamp marker
  const timestamp = new Date().toISOString().slice(0, 10);
  const newLearned = existingLearned
    ? `${existingLearned}\n[${timestamp}] ${suggestion}`
    : `[${timestamp}] ${suggestion}`;

  const updatedConfig = { ...currentConfig, learnedInstructions: newLearned };

  if (configResult.rows.length > 0) {
    await pool.query(
      `UPDATE agent_configs SET config = $1, updated_at = NOW()
       WHERE user_id = $2 AND agent_type = $3`,
      [JSON.stringify(updatedConfig), userId, 'website_chat']
    );
  } else {
    await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config) VALUES ($1, $2, $3)`,
      [userId, 'website_chat', JSON.stringify(updatedConfig)]
    );
  }

  console.log(`🧠 Learning: updated instructions for user ${userId}: "${suggestion.slice(0, 80)}..."`);
}

module.exports = { runChatLearningAgent };
