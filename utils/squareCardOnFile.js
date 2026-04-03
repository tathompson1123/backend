const { Client, Environment } = require('square');
const { pool } = require('../config/database');

/**
 * Get Square credentials for a business user.
 * Returns { client, locationId } or throws if not connected.
 */
async function getSquareClient(userId) {
  const result = await pool.query(
    `SELECT square_access_token, square_location_id
     FROM payment_connections
     WHERE user_id = $1 AND processor = 'square' AND is_active = true
     LIMIT 1`,
    [userId]
  );
  if (result.rows.length === 0 || !result.rows[0].square_access_token) {
    throw new Error('No active Square connection for this business');
  }
  const { square_access_token, square_location_id } = result.rows[0];
  const client = new Client({
    accessToken: square_access_token,
    environment: process.env.SQUARE_ENVIRONMENT === 'production'
      ? Environment.Production
      : Environment.Sandbox,
  });
  return { client, locationId: square_location_id };
}

/**
 * Find or create a Square Customer for the given contact info.
 * Returns the Square customer ID.
 */
async function findOrCreateSquareCustomer(client, { name, email, phone }) {
  // Try to find by email first
  if (email) {
    const searchResp = await client.customersApi.searchCustomers({
      query: { filter: { emailAddress: { exact: email } } }
    });
    const existing = searchResp.result?.customers?.[0];
    if (existing) return existing.id;
  }

  // Create new customer
  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const createResp = await client.customersApi.createCustomer({
    givenName: firstName,
    familyName: lastName,
    emailAddress: email || undefined,
    phoneNumber: phone || undefined,
    idempotencyKey: `cof-${email || phone}-${Date.now()}`,
  });

  return createResp.result.customer.id;
}

/**
 * Save a card on file for a Square customer using the tokenized sourceId
 * from the Web Payments SDK.
 * Returns { cardId, cardBrand, lastFour }
 */
async function saveCardOnFile(client, { sourceId, squareCustomerId, locationId }) {
  const resp = await client.cardsApi.createCard({
    idempotencyKey: `card-${squareCustomerId}-${Date.now()}`,
    sourceId,
    card: {
      customerId: squareCustomerId,
    },
  });

  const card = resp.result.card;
  return {
    cardId: card.id,
    cardBrand: card.cardBrand,
    lastFour: card.last4,
  };
}

module.exports = { getSquareClient, findOrCreateSquareCustomer, saveCardOnFile };
