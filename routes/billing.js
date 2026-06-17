const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { authenticateToken } = require('../config/middleware');
const { pool } = require('../config/database');
const { isUnlimitedAccount } = require('../utils/unlimitedAccounts');

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
        const { getTimezoneFromPhone } = require('../utils/zipToTimezone');
        const detectedTz = getTimezoneFromPhone(result.phoneNumber);
        await pool.query(
          'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = $2, timezone = $3 WHERE id = $4',
          [result.phoneNumber, result.phoneSid, detectedTz, userId]
        );
        console.log(`✅ Auto-provisioned Twilio number ${result.phoneNumber} for user ${userId} (${plan} plan, zip ${userData?.zip_code}, tz ${detectedTz})`);
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

// GET - Usage stats for the current billing month
router.get('/usage', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [smsRow, chatRow, userRow, claudeRow] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM sms_messages WHERE user_id = $1 AND direction = 'outgoing' AND created_at >= $2`,
        [userId, monthStart]
      ),
      pool.query(
        `SELECT COUNT(*) FROM chat_messages cm
         JOIN chat_conversations cc ON cc.id = cm.conversation_id
         WHERE cc.user_id = $1 AND cm.role = 'assistant' AND cm.created_at >= $2`,
        [userId, monthStart]
      ),
      pool.query(
        'SELECT plan, base_plan, trial_ends_at, stripe_subscription_id, email, ai_chat_unlimited FROM users WHERE id = $1',
        [userId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM claude_usage WHERE user_id = $1 AND created_at >= $2`,
        [userId, monthStart]
      ),
    ]);

    const plan = userRow.rows[0]?.plan;
    const basePlan = userRow.rows[0]?.base_plan || plan;
    const unlimited = isUnlimitedAccount(userRow.rows[0]?.email);
    // Chat comp can also be granted per-account via the ai_chat_unlimited DB flag
    // (mirrors the enforcement in routes/chat.js so the dashboard matches reality).
    const chatUnlimited = unlimited || userRow.rows[0]?.ai_chat_unlimited === true;
    const SMS_LIMITS = { free: 0, basic: 100, pro: 100, scale: 500, expert: 200 };
    const CHAT_LIMITS = { free: 0, basic: 200, pro: 500, scale: 99999, expert: 500 };
    // Monthly AI chat API cost limits by plan (in USD)
    const CHAT_COST_LIMITS = { free: 0, basic: 0, pro: 6.00, scale: null, expert: 6.00 };

    res.json({
      plan,
      basePlan,
      unlimited,
      smsUsed: parseInt(smsRow.rows[0].count, 10),
      smsLimit: unlimited ? null : (SMS_LIMITS[plan] || 0),
      chatUsed: parseInt(chatRow.rows[0].count, 10),
      chatLimit: chatUnlimited ? null : (CHAT_LIMITS[plan] || 0),
      claudeCostMonth: parseFloat(claudeRow.rows[0].total) || 0,
      chatCostLimit: chatUnlimited ? null : (CHAT_COST_LIMITS[plan] ?? null),
      monthStart: monthStart.toISOString(),
    });
  } catch (error) {
    console.error('Usage fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// POST - Contact sales / unsubscribe request
router.post('/contact-sales', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, phone, reason, flaws, feedback } = req.body;
    if (!name || !phone || !reason) {
      return res.status(400).json({ error: 'Name, phone, and reason are required' });
    }

    const userRow = await pool.query('SELECT email, plan, business_name FROM users WHERE id = $1', [userId]);
    const u = userRow.rows[0];

    // Store in DB for records
    await pool.query(
      `INSERT INTO contact_sales_requests (user_id, name, phone, reason, flaws, feedback, plan, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT DO NOTHING`,
      [userId, name, phone, reason, flaws || null, feedback || null, u?.plan || null]
    ).catch(() => {}); // table may not exist yet — non-blocking

    // Email the SORCE team + confirmation to user
    const sgMail = require('@sendgrid/mail');
    if (process.env.SENDGRID_API_KEY) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const emails = [
        // Internal notification
        {
          to: 'help@sorceintegrations.com',
          from: { name: 'SORCE Billing', email: 'noreply@sorceintegrations.com' },
          subject: `Cancellation Request — ${u?.business_name || u?.email || 'User ' + userId} (${u?.plan || 'unknown'} plan)`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <h2 style="color:#dc2626;">Cancellation Request</h2>
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;width:35%;">User ID</td><td style="padding:8px;border-bottom:1px solid #eee;">${userId}</td></tr>
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Business</td><td style="padding:8px;border-bottom:1px solid #eee;">${u?.business_name || '—'}</td></tr>
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Email</td><td style="padding:8px;border-bottom:1px solid #eee;">${u?.email || '—'}</td></tr>
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Plan</td><td style="padding:8px;border-bottom:1px solid #eee;">${u?.plan || '—'}</td></tr>
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Contact Name</td><td style="padding:8px;border-bottom:1px solid #eee;">${name}</td></tr>
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Phone</td><td style="padding:8px;border-bottom:1px solid #eee;">${phone}</td></tr>
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Reason</td><td style="padding:8px;border-bottom:1px solid #eee;">${reason}</td></tr>
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;vertical-align:top;">Dashboard Flaws</td><td style="padding:8px;border-bottom:1px solid #eee;white-space:pre-wrap;">${flaws || '—'}</td></tr>
                <tr><td style="padding:8px;background:#f9fafb;font-weight:600;vertical-align:top;">Feedback</td><td style="padding:8px;white-space:pre-wrap;">${feedback || '—'}</td></tr>
              </table>
            </div>`,
        },
      ];
      // Confirmation to the user (if we have their email)
      if (u?.email) {
        emails.push({
          to: u.email,
          from: { name: 'SORCE', email: 'noreply@sorceintegrations.com' },
          subject: 'We received your cancellation request',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <h2 style="color:#1f2937;">Request Received</h2>
              <p style="color:#4b5563;font-size:15px;">Hi ${name},</p>
              <p style="color:#4b5563;font-size:15px;">We've received your cancellation request for your SORCE ${u.plan || ''} plan. A team member will reply within 24 hours to process your request.</p>
              <p style="color:#4b5563;font-size:15px;">If you have any questions in the meantime, you can reply to this email or reach us at <a href="mailto:help@sorceintegrations.com">help@sorceintegrations.com</a>.</p>
              <p style="color:#9ca3af;font-size:13px;margin-top:32px;">— The SORCE Team</p>
            </div>`,
        });
      }
      sgMail.send(emails).catch(e => console.error('Contact-sales email error:', e.message));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Contact sales error:', error.message);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// POST - Enterprise inquiry (public — no auth required, works from pricing page too)
router.post('/enterprise-inquiry', async (req, res) => {
  try {
    const { name, email, phone, company, reason, details } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    // Store in DB (reuse contact_sales_requests with a type column if available, else ignore)
    await pool.query(
      `INSERT INTO contact_sales_requests (user_id, name, phone, reason, flaws, feedback, plan, created_at)
       VALUES (NULL, $1, $2, $3, $4, $5, 'enterprise', NOW())`,
      [name, phone, reason || 'Enterprise inquiry', company ? `Company: ${company}` : null, details || null]
    ).catch(() => {}); // table may not exist yet — non-blocking

    // Email the SORCE team
    const sgMail = require('@sendgrid/mail');
    if (process.env.SENDGRID_API_KEY) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      sgMail.send({
        to: 'support@sorceintegrations.com',
        from: { name: 'SORCE Sales', email: 'noreply@sorceintegrations.com' },
        subject: `Enterprise Inquiry — ${company || name}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#7c3aed;">Enterprise Plan Inquiry</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px;background:#f9fafb;font-weight:600;width:35%;">Name</td><td style="padding:8px;border-bottom:1px solid #eee;">${name}</td></tr>
              <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Company</td><td style="padding:8px;border-bottom:1px solid #eee;">${company || '—'}</td></tr>
              <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Email</td><td style="padding:8px;border-bottom:1px solid #eee;">${email}</td></tr>
              <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Phone</td><td style="padding:8px;border-bottom:1px solid #eee;">${phone}</td></tr>
              <tr><td style="padding:8px;background:#f9fafb;font-weight:600;">Reason / Use Case</td><td style="padding:8px;border-bottom:1px solid #eee;">${reason || '—'}</td></tr>
              <tr><td style="padding:8px;background:#f9fafb;font-weight:600;vertical-align:top;">Details</td><td style="padding:8px;white-space:pre-wrap;">${details || '—'}</td></tr>
            </table>
          </div>`,
      }).catch(e => console.error('Enterprise inquiry email error:', e.message));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Enterprise inquiry error:', error.message);
    res.status(500).json({ error: 'Failed to submit inquiry' });
  }
});

module.exports = router;
