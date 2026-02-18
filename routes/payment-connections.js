const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { getConnectionsForUser, getProcessor, StripeConnectProcessor, SquareProcessor } = require('../payment/ProcessorFactory');
const PayPalProcessor = require('../payment/PayPalProcessor');
const { syncSquarePayments, syncSquareInvoices } = require('../utils/squareSync');

// GET /api/payment-connections - List all connections
router.get('/', authenticateToken, async (req, res) => {
  try {
    const connections = await getConnectionsForUser(req.user.userId, pool);
    res.json({ connections });
  } catch (error) {
    console.error('Error fetching payment connections:', error.message);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// GET /api/payment-connections/:processor/oauth-url - Get OAuth redirect URL
router.get('/:processor/oauth-url', authenticateToken, async (req, res) => {
  try {
    const { processor } = req.params;
    const userId = req.user.userId;
    let url;

    switch (processor) {
      case 'stripe':
        url = StripeConnectProcessor.getOAuthUrl(userId);
        break;
      case 'square':
        url = SquareProcessor.getOAuthUrl(userId);
        break;
      case 'paypal':
        url = PayPalProcessor.getOAuthUrl(userId);
        break;
      default:
        return res.status(400).json({ error: 'Unknown processor' });
    }

    res.json({ oauthUrl: url });
  } catch (error) {
    console.error('Error generating OAuth URL:', error.message);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

// GET /api/payment-connections/stripe/callback - Stripe OAuth callback
router.get('/stripe/callback', async (req, res) => {
  try {
    const { code, state: userId, error: oauthError } = req.query;

    if (oauthError) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&error=${oauthError}`);
    }

    const result = await StripeConnectProcessor.handleOAuthCallback(code);

    await pool.query(
      `INSERT INTO payment_connections (user_id, processor, stripe_account_id, stripe_access_token, is_active, is_primary)
       VALUES ($1, 'stripe', $2, $3, true, true)
       ON CONFLICT (user_id, processor)
       DO UPDATE SET stripe_account_id = $2, stripe_access_token = $3, is_active = true, updated_at = NOW()`,
      [userId, result.stripeAccountId, result.accessToken]
    );

    res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&connected=stripe`);
  } catch (error) {
    console.error('Stripe OAuth callback error:', error.message);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&error=stripe_failed`);
  }
});

// GET /api/payment-connections/square/callback - Square OAuth callback
router.get('/square/callback', async (req, res) => {
  try {
    const { code, state: userId, error: oauthError } = req.query;

    if (oauthError) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&error=${oauthError}`);
    }

    const result = await SquareProcessor.handleOAuthCallback(code);

    // Get first location
    const { Client, Environment } = require('square/legacy');
    const client = new Client({
      bearerAuthCredentials: { accessToken: result.accessToken },
      environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? Environment.Sandbox : Environment.Production,
    });
    const { result: locResult } = await client.locationsApi.listLocations();
    const locationId = locResult.locations?.[0]?.id;

    await pool.query(
      `INSERT INTO payment_connections (user_id, processor, square_merchant_id, square_access_token, square_refresh_token, square_location_id, is_active, is_primary)
       VALUES ($1, 'square', $2, $3, $4, $5, true, false)
       ON CONFLICT (user_id, processor)
       DO UPDATE SET square_merchant_id = $2, square_access_token = $3, square_refresh_token = $4, square_location_id = $5, is_active = true, updated_at = NOW()`,
      [userId, result.merchantId, result.accessToken, result.refreshToken, locationId]
    );

    // Auto-sync payments and invoices in background after connecting
    setImmediate(async () => {
      try {
        const pCount = await syncSquarePayments(userId, result.accessToken, pool);
        const iCount = await syncSquareInvoices(userId, result.accessToken, locationId, pool);
        console.log(`✅ Auto-synced ${pCount} Square payments and ${iCount} invoices for user ${userId}`);
      } catch (err) {
        console.error('Square auto-sync error:', err.message);
      }
    });

    res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&connected=square`);
  } catch (error) {
    console.error('Square OAuth callback error:', error.message);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&error=square_failed`);
  }
});

// GET /api/payment-connections/paypal/callback - PayPal OAuth callback
router.get('/paypal/callback', async (req, res) => {
  try {
    const { code, state: userId, error: oauthError } = req.query;

    if (oauthError) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&error=${oauthError}`);
    }

    const result = await PayPalProcessor.handleOAuthCallback(code);

    await pool.query(
      `INSERT INTO payment_connections (user_id, processor, paypal_client_id, paypal_client_secret, is_active, is_primary)
       VALUES ($1, 'paypal', $2, $3, true, false)
       ON CONFLICT (user_id, processor)
       DO UPDATE SET paypal_client_id = $2, paypal_client_secret = $3, is_active = true, updated_at = NOW()`,
      [userId, result.paypalEmail || result.paypalPayerId, result.paypalPayerId || result.paypalEmail]
    );

    res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&connected=paypal`);
  } catch (error) {
    console.error('PayPal OAuth callback error:', error.message);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?tab=payment-settings&error=paypal_failed`);
  }
});

// POST /api/payment-connections/:processor/connect - Manual connection (PayPal)
router.post('/:processor/connect', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { processor } = req.params;
    const { clientId, clientSecret } = req.body;

    if (processor !== 'paypal') {
      return res.status(400).json({ error: 'Use OAuth for Stripe and Square' });
    }

    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'Client ID and Client Secret are required' });
    }

    // Verify credentials work
    const PayPalProcessor = require('../payment/PayPalProcessor');
    const testProcessor = new PayPalProcessor({
      paypal_client_id: clientId,
      paypal_client_secret: clientSecret
    });

    const verification = await testProcessor.verifyConnection();
    if (!verification.valid) {
      return res.status(400).json({ error: `Invalid credentials: ${verification.error}` });
    }

    await pool.query(
      `INSERT INTO payment_connections (user_id, processor, paypal_client_id, paypal_client_secret, is_active, is_primary)
       VALUES ($1, 'paypal', $2, $3, true, false)
       ON CONFLICT (user_id, processor)
       DO UPDATE SET paypal_client_id = $2, paypal_client_secret = $3, is_active = true, updated_at = NOW()`,
      [userId, clientId, clientSecret]
    );

    res.json({ success: true, message: 'PayPal connected successfully' });
  } catch (error) {
    console.error('Error connecting PayPal:', error.message);
    res.status(500).json({ error: 'Failed to connect PayPal' });
  }
});

// PUT /api/payment-connections/:id/primary - Set as primary processor
router.put('/:id/primary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Clear existing primary
    await pool.query('UPDATE payment_connections SET is_primary = false WHERE user_id = $1', [userId]);

    // Set new primary
    const result = await pool.query(
      'UPDATE payment_connections SET is_primary = true, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Connection not found' });
    res.json({ success: true, connection: result.rows[0] });
  } catch (error) {
    console.error('Error setting primary processor:', error.message);
    res.status(500).json({ error: 'Failed to update' });
  }
});

// DELETE /api/payment-connections/:id - Disconnect processor
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM payment_connections WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Connection not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting processor:', error.message);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// POST /api/payment-connections/:id/verify - Verify connection
router.post('/:id/verify', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const connResult = await pool.query(
      'SELECT * FROM payment_connections WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (connResult.rows.length === 0) return res.status(404).json({ error: 'Connection not found' });

    const processor = getProcessor(connResult.rows[0]);
    const verification = await processor.verifyConnection();

    await pool.query('UPDATE payment_connections SET last_verified_at = NOW() WHERE id = $1', [id]);

    res.json(verification);
  } catch (error) {
    console.error('Error verifying connection:', error.message);
    res.status(500).json({ error: 'Failed to verify' });
  }
});

module.exports = router;
