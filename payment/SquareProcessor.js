const PaymentProcessor = require('./PaymentProcessor');

class SquareProcessor extends PaymentProcessor {
  constructor(connection) {
    super(connection);
    const { Client, Environment } = require('square/legacy');
    this.client = new Client({
      bearerAuthCredentials: { accessToken: connection.square_access_token },
      environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? Environment.Sandbox : Environment.Production,
    });
    this.locationId = connection.square_location_id;
  }

  get processorName() {
    return 'square';
  }

  async createPaymentIntent(amount, currency = 'USD', metadata = {}) {
    const { v4: uuidv4 } = require('uuid');
    const { result } = await this.client.paymentsApi.createPayment({
      sourceId: metadata.sourceId || 'EXTERNAL', // nonce from Web Payments SDK
      idempotencyKey: uuidv4(),
      amountMoney: {
        amount: BigInt(Math.round(amount * 100)),
        currency: currency.toUpperCase()
      },
      locationId: this.locationId,
      note: metadata.description || 'Invoice Payment',
      referenceId: metadata.invoiceId?.toString()
    });

    return {
      processorPaymentId: result.payment.id,
      status: result.payment.status.toLowerCase(),
      receiptUrl: result.payment.receiptUrl
    };
  }

  async createCheckoutSession({ amount, currency = 'USD', description, customerEmail, successUrl, cancelUrl, metadata = {} }) {
    const { v4: uuidv4 } = require('uuid');
    const { result } = await this.client.checkoutApi.createPaymentLink({
      idempotencyKey: uuidv4(),
      order: {
        locationId: this.locationId,
        lineItems: [{
          name: description || 'Invoice Payment',
          quantity: '1',
          basePriceMoney: {
            amount: BigInt(Math.round(amount * 100)),
            currency: currency.toUpperCase()
          }
        }]
      },
      checkoutOptions: {
        redirectUrl: successUrl,
        allowTipping: false
      },
      prePopulatedData: {
        buyerEmail: customerEmail
      }
    });

    return {
      checkoutUrl: result.paymentLink.url,
      sessionId: result.paymentLink.id
    };
  }

  async capturePayment(paymentId) {
    const { result } = await this.client.paymentsApi.completePayment(paymentId, {});
    return {
      status: result.payment.status.toLowerCase(),
      processorPaymentId: result.payment.id
    };
  }

  async refundPayment(processorPaymentId, amount = null) {
    const { v4: uuidv4 } = require('uuid');
    const refundData = {
      idempotencyKey: uuidv4(),
      paymentId: processorPaymentId,
    };

    if (amount) {
      refundData.amountMoney = {
        amount: BigInt(Math.round(amount * 100)),
        currency: 'USD'
      };
    }

    const { result } = await this.client.refundsApi.refundPayment(refundData);
    return {
      refundId: result.refund.id,
      status: result.refund.status.toLowerCase(),
      amount: Number(result.refund.amountMoney.amount) / 100
    };
  }

  async getPaymentStatus(processorPaymentId) {
    const { result } = await this.client.paymentsApi.getPayment(processorPaymentId);
    return {
      status: result.payment.status.toLowerCase(),
      amount: Number(result.payment.amountMoney.amount) / 100,
      metadata: { receiptUrl: result.payment.receiptUrl }
    };
  }

  async verifyWebhook(rawBody, signature) {
    const { WebhooksHelper } = require('square/legacy');
    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    const notificationUrl = `${process.env.BACKEND_URL}/api/webhooks/square`;

    const isValid = WebhooksHelper.isValidWebhookEventSignature(
      rawBody.toString(),
      signature,
      signatureKey,
      notificationUrl
    );

    if (!isValid) throw new Error('Invalid Square webhook signature');
    return JSON.parse(rawBody.toString());
  }

  async verifyConnection() {
    try {
      const { result } = await this.client.locationsApi.retrieveLocation(this.locationId);
      return {
        valid: result.location.status === 'ACTIVE',
        accountName: result.location.name,
        error: result.location.status !== 'ACTIVE' ? 'Location not active' : null
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  static getOAuthUrl(userId) {
    const clientId = process.env.SQUARE_APPLICATION_ID;
    const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payment-connections/square/callback`;
    const baseUrl = process.env.SQUARE_ENVIRONMENT === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';
    return `${baseUrl}/oauth2/authorize?client_id=${clientId}&scope=PAYMENTS_WRITE+PAYMENTS_READ+ORDERS_WRITE+ORDERS_READ&session=false&state=${userId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  static async handleOAuthCallback(code) {
    const { Client, Environment } = require('square/legacy');
    const client = new Client({
      environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? Environment.Sandbox : Environment.Production,
    });

    const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payment-connections/square/callback`;
    const { result } = await client.oAuthApi.obtainToken({
      clientId: process.env.SQUARE_APPLICATION_ID,
      clientSecret: process.env.SQUARE_APPLICATION_SECRET,
      code,
      grantType: 'authorization_code',
      redirectUri,
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      merchantId: result.merchantId,
      expiresAt: result.expiresAt
    };
  }
}

module.exports = SquareProcessor;
