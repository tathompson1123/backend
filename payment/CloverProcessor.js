const PaymentProcessor = require('./PaymentProcessor');

class CloverProcessor extends PaymentProcessor {
  constructor(connection) {
    super(connection);
    this.accessToken = connection.clover_access_token;
    this.merchantId = connection.clover_merchant_id;
    this.isSandbox = process.env.CLOVER_ENVIRONMENT === 'sandbox';
    this.apiBase = this.isSandbox
      ? 'https://sandbox.dev.clover.com'
      : 'https://api.clover.com';
    this.sclBase = this.isSandbox
      ? 'https://scl-sandbox.dev.clover.com'
      : 'https://scl.clover.com';
  }

  get processorName() {
    return 'clover';
  }

  async _fetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Clover API error (${res.status}): ${body}`);
    }
    return res.json();
  }

  async createPaymentIntent(amount, currency = 'usd', metadata = {}) {
    // Clover card-not-present payments require a tokenized card source.
    // Use createCheckoutSession for hosted payment flows instead.
    throw new Error('Use createCheckoutSession for Clover payments');
  }

  async createCheckoutSession({ amount, currency = 'USD', description, customerEmail, successUrl, cancelUrl, metadata = {} }) {
    const body = {
      customer: { email: customerEmail },
      shoppingCart: {
        lineItems: [{
          name: description || 'Invoice Payment',
          unitQty: 1,
          price: Math.round(amount * 100),
        }],
      },
      redirectUrls: {
        success: successUrl,
        failure: cancelUrl,
      },
    };

    const data = await this._fetch(`${this.sclBase}/invoicing/v1/checkouts`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      checkoutUrl: data.href,
      sessionId: data.checkoutSessionId,
    };
  }

  async capturePayment(paymentId) {
    // Clover payments are captured immediately
    const data = await this._fetch(`${this.apiBase}/v3/merchants/${this.merchantId}/payments/${paymentId}`);
    return {
      status: data.result?.toLowerCase() || 'success',
      processorPaymentId: data.id,
    };
  }

  async refundPayment(processorPaymentId, amount = null) {
    const body = { payment: { id: processorPaymentId } };
    if (amount) body.amount = Math.round(amount * 100);

    const data = await this._fetch(`${this.apiBase}/v3/merchants/${this.merchantId}/refunds`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      refundId: data.id,
      status: 'succeeded',
      amount: (data.amount || 0) / 100,
    };
  }

  async getPaymentStatus(processorPaymentId) {
    const data = await this._fetch(`${this.apiBase}/v3/merchants/${this.merchantId}/payments/${processorPaymentId}`);
    return {
      status: data.result?.toLowerCase() || 'unknown',
      amount: (data.amount || 0) / 100,
      metadata: {},
    };
  }

  async verifyWebhook(rawBody, signature) {
    // Clover webhooks don't use signature verification — just parse the body
    return JSON.parse(rawBody.toString());
  }

  async verifyConnection() {
    try {
      const data = await this._fetch(`${this.apiBase}/v3/merchants/${this.merchantId}`);
      return {
        valid: !!data.id,
        accountName: data.name,
        error: null,
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Generate the Clover OAuth authorization URL
   */
  static getOAuthUrl(userId) {
    const appId = process.env.CLOVER_APP_ID;
    if (!appId) throw new Error('CLOVER_APP_ID is not configured. Add it to your Railway environment variables.');
    const isSandbox = process.env.CLOVER_ENVIRONMENT === 'sandbox';
    const baseUrl = isSandbox ? 'https://sandbox.dev.clover.com' : 'https://www.clover.com';
    const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payment-connections/clover/callback`;
    return `${baseUrl}/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${userId}`;
  }

  /**
   * Exchange OAuth code for access token.
   * Note: merchant_id comes from the callback query params, not the token response.
   */
  static async handleOAuthCallback(code) {
    const appId = process.env.CLOVER_APP_ID;
    const appSecret = process.env.CLOVER_APP_SECRET;
    const isSandbox = process.env.CLOVER_ENVIRONMENT === 'sandbox';
    const apiBase = isSandbox ? 'https://sandbox.dev.clover.com' : 'https://api.clover.com';

    const res = await fetch(`${apiBase}/oauth/token?client_id=${appId}&client_secret=${appSecret}&code=${code}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Clover token exchange failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    return { accessToken: data.access_token };
  }
}

module.exports = CloverProcessor;
