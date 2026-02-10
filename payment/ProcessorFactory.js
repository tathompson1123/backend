const StripeConnectProcessor = require('./StripeConnectProcessor');
const SquareProcessor = require('./SquareProcessor');
const PayPalProcessor = require('./PayPalProcessor');

function getProcessor(connection) {
  switch (connection.processor) {
    case 'stripe':
      return new StripeConnectProcessor(connection);
    case 'square':
      return new SquareProcessor(connection);
    case 'paypal':
      return new PayPalProcessor(connection);
    default:
      throw new Error(`Unknown payment processor: ${connection.processor}`);
  }
}

/**
 * Get the active payment processor for a user.
 * Prefers `preferredProcessor` if specified, otherwise uses the primary connection.
 */
async function getProcessorForUser(userId, pool, preferredProcessor = null) {
  let query = 'SELECT * FROM payment_connections WHERE user_id = $1 AND is_active = true';
  const params = [userId];

  if (preferredProcessor) {
    query += ' AND processor = $2';
    params.push(preferredProcessor);
  } else {
    query += ' ORDER BY is_primary DESC, created_at ASC';
  }

  query += ' LIMIT 1';

  const result = await pool.query(query, params);
  if (result.rows.length === 0) return null;

  return getProcessor(result.rows[0]);
}

/**
 * Get all active connections for a user
 */
async function getConnectionsForUser(userId, pool) {
  const result = await pool.query(
    'SELECT id, processor, is_active, is_primary, connected_at, last_verified_at FROM payment_connections WHERE user_id = $1 ORDER BY is_primary DESC',
    [userId]
  );
  return result.rows;
}

module.exports = {
  getProcessor,
  getProcessorForUser,
  getConnectionsForUser,
  StripeConnectProcessor,
  SquareProcessor,
  PayPalProcessor
};
