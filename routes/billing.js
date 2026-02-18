const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { authenticateToken } = require('../config/middleware');
const { pool } = require('../config/database');

// Create Checkout Session
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.userId;
    
    console.log('🔍 Environment check:', {
      FRONTEND_URL: process.env.FRONTEND_URL,
      NODE_ENV: process.env.NODE_ENV
    });
    
    // Get user email
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = userResult.rows[0]?.email;

    // Define prices
    const prices = {
      pro: { amount: 9550, name: 'Pro Plan' },          // $95.50
      scale: { amount: 17550, name: 'Scale Plan' },     // $175.50
      // Legacy plans kept for existing subscribers
      basic: { amount: 2995, name: 'Basic Plan' },
      expert: { amount: 9995, name: 'Expert Plan' }
    };

    const selectedPrice = prices[plan];
    if (!selectedPrice) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer_email: userEmail,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: selectedPrice.name,
              description: `Monthly subscription to SORCE ${plan} plan`,
            },
            unit_amount: selectedPrice.amount,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?view=billing`,
      metadata: {
        userId: userId.toString(),
        plan: plan,
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe Webhook - Handle successful payments
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata.userId;
    const plan = session.metadata.plan;

    // Update user's plan in database
    try {
      await pool.query(
        'UPDATE users SET plan = $1, stripe_customer_id = $2, stripe_subscription_id = $3 WHERE id = $4',
        [plan, session.customer, session.subscription, userId]
      );
      console.log(`✅ User ${userId} upgraded to ${plan} plan`);
    } catch (error) {
      console.error('Error updating user plan:', error.message);
    }
  }

  res.json({ received: true });
});

// Create Embedded Checkout Session (for PublishWizard — stays in modal)
router.post('/create-embedded-checkout', authenticateToken, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.userId;

    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = userResult.rows[0]?.email;

    const prices = {
      pro: { amount: 9550, name: 'Pro Plan' },
      scale: { amount: 17550, name: 'Scale Plan' },
      basic: { amount: 2995, name: 'Basic Plan' },
      expert: { amount: 9995, name: 'Expert Plan' }
    };

    const selectedPrice = prices[plan];
    if (!selectedPrice) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const session = await stripe.checkout.sessions.create({
      customer_email: userEmail,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: selectedPrice.name,
            description: `Monthly subscription to SORCE ${plan} plan`,
          },
          unit_amount: selectedPrice.amount,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      mode: 'subscription',
      ui_mode: 'embedded',
      redirect_on_completion: 'if_required',
      return_url: `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?tab=website&flow=publish&plan=${plan}`,
      metadata: {
        userId: userId.toString(),
        plan: plan,
      },
    });

    res.json({ clientSecret: session.client_secret });
  } catch (error) {
    console.error('Embedded checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create embedded checkout session' });
  }
});

// Check Checkout Session status (for 3DS redirect return)
router.get('/checkout-session-status', authenticateToken, async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) {
      return res.status(400).json({ error: 'session_id required' });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.json({
      status: session.status,
      payment_status: session.payment_status,
      plan: session.metadata?.plan,
    });
  } catch (error) {
    console.error('Session status error:', error.message);
    res.status(500).json({ error: 'Failed to check session status' });
  }
});

// Get current subscription status
router.get('/subscription', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      'SELECT plan, stripe_subscription_id FROM users WHERE id = $1',
      [userId]
    );
    
    const user = result.rows[0];
    
    if (user.stripe_subscription_id) {
      const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
      res.json({
        plan: user.plan,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
      });
    } else {
      res.json({ plan: user.plan, status: 'none' });
    }
  } catch (error) {
    console.error('Error fetching subscription:', error.message);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

module.exports = router;
