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
      basic: { amount: 2995, name: 'Basic Plan' },      // $29.95
      pro: { amount: 9995, name: 'Pro Plan' },           // $99.95
      scale: { amount: 17595, name: 'Scale Plan' },      // $175.95
      // Legacy plans kept for existing subscribers
      expert: { amount: 9995, name: 'Expert Plan' }
    };

    // Trial days: basic = 14-day PRO trial, pro = 7-day, scale = 7-day
    const trialDays = { basic: 14, pro: 7, scale: 7 };

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
      subscription_data: {
        trial_period_days: trialDays[plan] || 0,
      },
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
    // Basic plan gets PRO features during 14-day trial
    const effectivePlan = plan === 'basic' ? 'pro' : plan;
    const trialEnds = plan === 'basic' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
                    : (plan === 'pro' || plan === 'scale') ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                    : null;
    try {
      await pool.query(
        `UPDATE users SET plan = $1, stripe_customer_id = $2, stripe_subscription_id = $3,
         base_plan = $5, trial_ends_at = $6 WHERE id = $4`,
        [effectivePlan, session.customer, session.subscription, userId, plan, trialEnds]
      );
      console.log(`✅ User ${userId} subscribed to ${plan} plan (effective: ${effectivePlan}, trial ends: ${trialEnds || 'none'})`);
    } catch (error) {
      console.error('Error updating user plan:', error.message);
    }

    // Auto-provision phone number for pro/scale plans
    if (plan === 'pro' || plan === 'scale') {
      try {
        const userRow = await pool.query(
          `SELECT u.twilio_phone_number, u.telnyx_phone_number, bi.city, bi.state
           FROM users u
           LEFT JOIN business_information bi ON bi.user_id = u.id
           WHERE u.id = $1`,
          [userId]
        );
        const userData = userRow.rows[0];

        // ── Telnyx provisioning (preferred when configured) ──────────────
        if (process.env.TELNYX_API_KEY && process.env.TELNYX_MESSAGING_PROFILE_ID) {
          if (!userData?.telnyx_phone_number) {
            const { purchasePhoneNumberTelnyx, getAreaCode } = require('../utils/telnyx');
            const areaCode = getAreaCode(userData?.state, userData?.city);
            const result = await purchasePhoneNumberTelnyx(areaCode);
            await pool.query(
              'UPDATE users SET telnyx_phone_number = $1, telnyx_order_id = $2 WHERE id = $3',
              [result.phoneNumber, result.orderId, userId]
            );
            console.log(`✅ Auto-provisioned Telnyx number ${result.phoneNumber} for user ${userId} (${plan} plan, area ${areaCode})`);
          }
        } else if (!userData?.twilio_phone_number) {
          // ── Twilio fallback ───────────────────────────────────────────
          const { purchasePhoneNumber } = require('../utils/twilio');
          const { getAreaCode } = require('../utils/telnyx');
          const twAreaCode = getAreaCode(userData?.state, userData?.city);
          const result = await purchasePhoneNumber(twAreaCode, userId);
          await pool.query(
            'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = $2 WHERE id = $3',
            [result.phoneNumber, result.phoneSid, userId]
          );
          console.log(`✅ Auto-provisioned Twilio number ${result.phoneNumber} for user ${userId} (${plan} plan)`);
        }
      } catch (provisionError) {
        // Non-fatal — user can provision manually
        console.error(`⚠️ Could not auto-provision phone for user ${userId}:`, provisionError.message);
      }
    }
  }

  // Handle subscription canceled (at period end)
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    try {
      await pool.query(
        `UPDATE users SET plan = NULL, stripe_subscription_id = NULL, base_plan = NULL,
         trial_ends_at = NULL, subscription_canceling = false
         WHERE stripe_subscription_id = $1`,
        [subscription.id]
      );
      console.log(`❌ Subscription ${subscription.id} canceled and user plan cleared`);
    } catch (error) {
      console.error('Error clearing canceled subscription:', error.message);
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
      basic: { amount: 2995, name: 'Basic Plan' },
      pro: { amount: 9995, name: 'Pro Plan' },
      scale: { amount: 17595, name: 'Scale Plan' },
      expert: { amount: 9995, name: 'Expert Plan' }
    };

    const trialDays = { basic: 14, pro: 7, scale: 7 };

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
      subscription_data: {
        trial_period_days: trialDays[plan] || 0,
      },
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

// Cancel subscription
router.post('/cancel-subscription', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      'SELECT stripe_subscription_id, plan FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];

    if (!user?.stripe_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    // Cancel at period end so they keep access until billing cycle ends
    await stripe.subscriptions.update(user.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Mark the user as canceling
    await pool.query(
      'UPDATE users SET subscription_canceling = true WHERE id = $1',
      [userId]
    );

    console.log(`⚠️ User ${userId} scheduled subscription cancellation (plan: ${user.plan})`);
    res.json({ success: true, message: 'Subscription will be canceled at end of billing period' });
  } catch (error) {
    console.error('Cancel subscription error:', error.message);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

module.exports = router;
