const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { authenticateToken } = require('../config/middleware');
const { pool } = require('../config/database');

// Plan hierarchy for upgrade/downgrade detection
const PLAN_ORDER = { basic: 1, pro: 2, scale: 3 };

// Create a Stripe Price object for a given plan (needed for subscription updates)
async function getStripePrice(plan) {
  const amounts = { basic: 2995, pro: 9995, scale: 17595 };
  const names = { basic: 'Basic Plan', pro: 'Pro Plan', scale: 'Scale Plan' };
  if (!amounts[plan]) throw new Error('Invalid plan');
  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: amounts[plan],
    recurring: { interval: 'month' },
    product_data: { name: names[plan] },
  });
  return price.id;
}

// Create Checkout Session (also handles upgrade/downgrade for existing subscribers)
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.userId;

    const prices = {
      basic: { amount: 2995, name: 'Basic Plan' },
      pro: { amount: 9995, name: 'Pro Plan' },
      scale: { amount: 17595, name: 'Scale Plan' },
      expert: { amount: 9995, name: 'Expert Plan' }
    };

    const selectedPrice = prices[plan];
    if (!selectedPrice) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Get user with billing info
    const userResult = await pool.query(
      'SELECT email, plan, base_plan, stripe_customer_id, stripe_subscription_id FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    // ─── Existing subscriber: upgrade / downgrade in-place ───
    if (user.stripe_subscription_id) {
      try {
        const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);

        if (subscription.status === 'active' || subscription.status === 'trialing') {
          const currentLevel = PLAN_ORDER[user.base_plan] || PLAN_ORDER[user.plan] || 0;
          const targetLevel = PLAN_ORDER[plan] || 0;

          if (targetLevel === currentLevel) {
            return res.status(400).json({ error: 'Already on this plan' });
          }

          const newPriceId = await getStripePrice(plan);
          const itemId = subscription.items.data[0].id;
          const isUpgrade = targetLevel > currentLevel;

          await stripe.subscriptions.update(user.stripe_subscription_id, {
            items: [{ id: itemId, price: newPriceId }],
            proration_behavior: isUpgrade ? 'create_prorations' : 'none',
          });

          // Update DB — plan changes immediately, no new trial
          await pool.query(
            'UPDATE users SET plan = $1, base_plan = $1, trial_ends_at = NULL WHERE id = $2',
            [plan, userId]
          );

          console.log(`${isUpgrade ? '⬆️' : '⬇️'} User ${userId} ${isUpgrade ? 'upgraded' : 'downgraded'} to ${plan}`);
          return res.json({ [isUpgrade ? 'upgraded' : 'downgraded']: true, plan });
        }
      } catch (stripeErr) {
        // Subscription invalid/canceled — fall through to new checkout
        console.warn('Existing subscription unusable, creating new checkout:', stripeErr.message);
      }
    }

    // ─── New subscriber (or returning after cancellation): checkout session ───
    // Trial enforcement: one free trial ever (check stripe_customer_id existence)
    const hadSubscription = !!user.stripe_customer_id;
    const trialDays = hadSubscription ? 0 : { basic: 14, pro: 7, scale: 7 }[plan] || 0;

    const sessionParams = {
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
      success_url: `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?view=billing`,
      metadata: { userId: userId.toString(), plan },
    };

    // Reuse existing Stripe customer to avoid duplicates
    if (user.stripe_customer_id) {
      sessionParams.customer = user.stripe_customer_id;
    } else {
      sessionParams.customer_email = user.email;
    }

    if (trialDays > 0) {
      sessionParams.subscription_data = { trial_period_days: trialDays };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
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

    // Auto-provision phone number
    // Pro/Scale: dedicated purchased number based on business zip code
    // Basic (trial): shared default number from Messaging Service
    try {
      const userRow = await pool.query(
        `SELECT u.twilio_phone_number, bi.zip_code
         FROM users u
         LEFT JOIN business_information bi ON bi.user_id = u.id
         WHERE u.id = $1`,
        [userId]
      );
      const userData = userRow.rows[0];

      if ((plan === 'pro' || plan === 'scale') && !userData?.twilio_phone_number) {
        const { purchasePhoneNumber } = require('../utils/twilio');
        const result = await purchasePhoneNumber({
          zipCode: userData?.zip_code,
          userId
        });
        await pool.query(
          'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = $2 WHERE id = $3',
          [result.phoneNumber, result.phoneSid, userId]
        );
        console.log(`✅ Auto-provisioned Twilio number ${result.phoneNumber} for user ${userId} (${plan} plan, zip ${userData?.zip_code})`);
      } else if (plan === 'basic' && !userData?.twilio_phone_number) {
        // Basic trial: assign the shared default number (no purchase needed)
        const sharedNumber = process.env.TWILIO_SHARED_TRIAL_NUMBER;
        if (sharedNumber) {
          await pool.query(
            'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = NULL WHERE id = $2',
            [sharedNumber, userId]
          );
          console.log(`✅ Assigned shared trial number ${sharedNumber} to user ${userId} (basic trial)`);
        }
      }
    } catch (provisionError) {
      console.error(`⚠️ Could not auto-provision phone for user ${userId}:`, provisionError.message);
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

  // Handle subscription updated (plan change sync — safety net)
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    try {
      const priceAmount = subscription.items?.data?.[0]?.price?.unit_amount;
      const amountToPlan = { 2995: 'basic', 9995: 'pro', 17595: 'scale' };
      const newPlan = amountToPlan[priceAmount];
      if (newPlan) {
        if (subscription.status === 'trialing') {
          // During trial, only update base_plan to preserve effective plan
          // (e.g., basic subscribers get pro features during trial)
          await pool.query(
            'UPDATE users SET base_plan = $1 WHERE stripe_subscription_id = $2',
            [newPlan, subscription.id]
          );
        } else {
          await pool.query(
            'UPDATE users SET plan = $1, base_plan = $1 WHERE stripe_subscription_id = $2',
            [newPlan, subscription.id]
          );
        }
        console.log(`🔄 Subscription ${subscription.id} synced to ${newPlan} via webhook (status: ${subscription.status})`);
      }
    } catch (error) {
      console.error('Error syncing subscription update:', error.message);
    }
  }

  res.json({ received: true });
});

// Create Embedded Checkout Session (for PublishWizard — stays in modal)
router.post('/create-embedded-checkout', authenticateToken, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.userId;

    const userResult = await pool.query(
      'SELECT email, stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    const prices = {
      basic: { amount: 2995, name: 'Basic Plan' },
      pro: { amount: 9995, name: 'Pro Plan' },
      scale: { amount: 17595, name: 'Scale Plan' },
      expert: { amount: 9995, name: 'Expert Plan' }
    };

    const selectedPrice = prices[plan];
    if (!selectedPrice) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Trial enforcement: one free trial ever
    const hadSubscription = !!user.stripe_customer_id;
    const trialDays = hadSubscription ? 0 : { basic: 14, pro: 7, scale: 7 }[plan] || 0;

    const sessionParams = {
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
      metadata: { userId: userId.toString(), plan },
    };

    if (user.stripe_customer_id) {
      sessionParams.customer = user.stripe_customer_id;
    } else {
      sessionParams.customer_email = user.email;
    }

    if (trialDays > 0) {
      sessionParams.subscription_data = { trial_period_days: trialDays };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
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
