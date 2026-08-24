const StripeConnectProcessor = require('./StripeConnectProcessor');
const SquareProcessor = require('./SquareProcessor');
const PayPalProcessor = require('./PayPalProcessor');
const CloverProcessor = require('./CloverProcessor');

// QuickBooks is an accounting system, not a payment processor — it can hold a
// connection (for drafting invoices) but can never take a payment, so it must be
// kept out of every checkout path.
const NON_PAYMENT_PROCESSORS = ['quickbooks'];

function getProcessor(connection) {
  switch (connection.processor) {
    case 'stripe':
      return new StripeConnectProcessor(connection);
    case 'square':
      return new SquareProcessor(connection);
    case 'paypal':
      return new PayPalProcessor(connection);
    case 'clover':
      return new CloverProcessor(connection);
    case 'quickbooks':
      throw new Error('QuickBooks cannot process payments — it is used for invoicing only');
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
    // Without an explicit preference this picks the primary connection — which must
    // never land on QuickBooks, or the public pay page would 500 instead of offering
    // a checkout.
    params.push(NON_PAYMENT_PROCESSORS);
    query += ` AND NOT (processor = ANY($${params.length}))`;
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
  PayPalProcessor,
  CloverProcessor,
  NON_PAYMENT_PROCESSORS
};
