const PaymentProcessor = require('./PaymentProcessor');

class PayPalProcessor extends PaymentProcessor {
  constructor(connection) {
    super(connection);
    this.clientId = connection.paypal_client_id;
    this.clientSecret = connection.paypal_client_secret;
    this.baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  get processorName() {
    return 'paypal';
  }

  async _getAccessToken() {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || 'PayPal auth failed');
    return data.access_token;
  }

  async _apiRequest(method, path, body = null) {
    const accessToken = await this._getAccessToken();
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${this.baseUrl}${path}`, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || JSON.stringify(data));
    return data;
  }

  async createPaymentIntent(amount, currency = 'USD', metadata = {}) {
    // PayPal uses Orders API — create order, then capture after approval
    const order = await this._apiRequest('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency.toUpperCase(),
          value: amount.toFixed(2)
        },
        description: metadata.description || 'Invoice Payment',
        reference_id: metadata.invoiceId?.toString()
      }]
    });

    return {
      processorPaymentId: order.id,
      status: order.status.toLowerCase(),
      approvalUrl: order.links?.find(l => l.rel === 'approve')?.href
    };
  }

  async createCheckoutSession({ amount, currency = 'USD', description, customerEmail, successUrl, cancelUrl, metadata = {} }) {
    const order = await this._apiRequest('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency.toUpperCase(),
          value: amount.toFixed(2)
        },
        description: description || 'Invoice Payment',
        reference_id: metadata.invoiceId?.toString()
      }],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: successUrl,
            cancel_url: cancelUrl,
            user_action: 'PAY_NOW',
            brand_name: 'SORCE'
          }
        }
      }
    });

    const approveLink = order.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve');

    return {
      checkoutUrl: approveLink?.href || `https://www.paypal.com/checkoutnow?token=${order.id}`,
      sessionId: order.id
    };
  }

  async capturePayment(orderId) {
    const capture = await this._apiRequest('POST', `/v2/checkout/orders/${orderId}/capture`);
    const captureUnit = capture.purchase_units?.[0]?.payments?.captures?.[0];

    return {
      status: capture.status.toLowerCase(),
      processorPaymentId: captureUnit?.id || orderId
    };
  }

  async refundPayment(captureId, amount = null) {
    const refundBody = {};
    if (amount) {
      refundBody.amount = {
        currency_code: 'USD',
        value: amount.toFixed(2)
      };
    }

    const refund = await this._apiRequest('POST', `/v2/payments/captures/${captureId}/refund`, refundBody);
    return {
      refundId: refund.id,
      status: refund.status.toLowerCase(),
      amount: parseFloat(refund.amount?.value || amount || 0)
    };
  }

  async getPaymentStatus(orderId) {
    const order = await this._apiRequest('GET', `/v2/checkout/orders/${orderId}`);
    const captureUnit = order.purchase_units?.[0]?.payments?.captures?.[0];

    return {
      status: (captureUnit?.status || order.status).toLowerCase(),
      amount: parseFloat(order.purchase_units?.[0]?.amount?.value || 0),
      metadata: { payerEmail: order.payer?.email_address }
    };
  }

  async verifyWebhook(rawBody, signature) {
    // PayPal webhook verification requires calling their API
    const accessToken = await this._getAccessToken();
    const headers = typeof signature === 'object' ? signature : {};

    const verifyResponse = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: process.env.PAYPAL_WEBHOOK_ID,
        webhook_event: JSON.parse(rawBody.toString())
      })
    });

    const result = await verifyResponse.json();
    if (result.verification_status !== 'SUCCESS') {
      throw new Error('Invalid PayPal webhook signature');
    }

    return JSON.parse(rawBody.toString());
  }

  async verifyConnection() {
    try {
      await this._getAccessToken();
      return { valid: true, accountName: 'PayPal Connected' };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  static getOAuthUrl(userId) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    if (!clientId) throw new Error('PAYPAL_CLIENT_ID not configured');
    const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payment-connections/paypal/callback`;
    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://www.paypal.com'
      : 'https://www.sandbox.paypal.com';
    const scope = encodeURIComponent('openid profile email');
    return `${baseUrl}/signin/authorize?client_id=${clientId}&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${userId}`;
  }

  static async handleOAuthCallback(code) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('PayPal credentials not configured');

    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
    const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payment-connections/paypal/callback`;

    // Exchange authorization code for tokens
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(`${baseUrl}/v1/identity/openidconnect/tokenservice`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'PayPal token exchange failed');

    const accessToken = tokenData.access_token;

    // Get merchant profile info
    const profileRes = await fetch(`${baseUrl}/v1/identity/openidconnect/userinfo?schema=openid`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json();

    return {
      paypalEmail: profile.email || profile.emails?.[0]?.value || '',
      paypalPayerId: profile.payer_id || profile.sub || '',
      name: profile.name || '',
    };
  }
}

module.exports = PayPalProcessor;
