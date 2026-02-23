const PaymentProcessor = require('./PaymentProcessor');

class StripeConnectProcessor extends PaymentProcessor {
  constructor(connection) {
    super(connection);
    this.stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    this.connectedAccountId = connection.stripe_account_id;
  }

  get processorName() {
    return 'stripe';
  }

  async createPaymentIntent(amount, currency = 'usd', metadata = {}) {
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses cents
      currency,
      metadata,
      application_fee_amount: Math.round(amount * 100 * 0.029), // 2.9% platform fee
    }, {
      stripeAccount: this.connectedAccountId,
    });

    return {
      processorPaymentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status
    };
  }

  async createCheckoutSession({ amount, currency = 'usd', description, customerEmail, successUrl, cancelUrl, metadata = {} }) {
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency,
          product_data: { name: description || 'Invoice Payment' },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customerEmail,
      metadata,
      payment_intent_data: {
        application_fee_amount: Math.round(amount * 100 * 0.029),
        metadata
      }
    }, {
      stripeAccount: this.connectedAccountId,
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id
    };
  }

  async capturePayment(paymentIntentId) {
    const paymentIntent = await this.stripe.paymentIntents.capture(paymentIntentId, {}, {
      stripeAccount: this.connectedAccountId,
    });

    return {
      status: paymentIntent.status,
      processorPaymentId: paymentIntent.id
    };
  }

  async refundPayment(processorPaymentId, amount = null) {
    const refundData = { payment_intent: processorPaymentId };
    if (amount) {
      refundData.amount = Math.round(amount * 100);
    }

    const refund = await this.stripe.refunds.create(refundData, {
      stripeAccount: this.connectedAccountId,
    });

    return {
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount / 100
    };
  }

  async getPaymentStatus(processorPaymentId) {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(processorPaymentId, {}, {
      stripeAccount: this.connectedAccountId,
    });

    return {
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100,
      metadata: paymentIntent.metadata
    };
  }

  async verifyWebhook(rawBody, signature) {
    const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async verifyConnection() {
    try {
      const account = await this.stripe.accounts.retrieve(this.connectedAccountId);
      return {
        valid: account.charges_enabled && account.payouts_enabled,
        accountName: account.business_profile?.name || account.email,
        error: !account.charges_enabled ? 'Charges not enabled on this account' : null
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Generate the OAuth URL for Stripe Connect Standard
   */
  static getOAuthUrl(userId) {
    const clientId = process.env.STRIPE_CLIENT_ID;
    if (!clientId) throw new Error('STRIPE_CLIENT_ID is not configured on the server. Add it to your Railway environment variables.');
    const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payment-connections/stripe/callback`;
    return `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&redirect_uri=${encodeURIComponent(redirectUri)}&state=${userId}`;
  }

  /**
   * Handle OAuth callback and get the connected account ID
   */
  static async handleOAuthCallback(code) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const response = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    return {
      stripeAccountId: response.stripe_user_id,
      accessToken: response.access_token,
      refreshToken: response.refresh_token
    };
  }
}

module.exports = StripeConnectProcessor;
