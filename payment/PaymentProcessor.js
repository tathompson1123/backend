/**
 * Abstract base class for payment processors.
 * All processor implementations (Stripe, Square, PayPal) must implement these methods.
 */
class PaymentProcessor {
  constructor(connection) {
    this.connection = connection;
  }

  get processorName() {
    throw new Error('processorName getter not implemented');
  }

  /**
   * Create a payment intent / charge
   * @returns {{ processorPaymentId, clientSecret?, status }}
   */
  async createPaymentIntent(amount, currency, metadata) {
    throw new Error('createPaymentIntent not implemented');
  }

  /**
   * Create a hosted checkout session (redirect-based)
   * @returns {{ checkoutUrl, sessionId }}
   */
  async createCheckoutSession({ amount, currency, description, customerEmail, successUrl, cancelUrl, metadata }) {
    throw new Error('createCheckoutSession not implemented');
  }

  /**
   * Capture a previously authorized payment
   * @returns {{ status, processorPaymentId }}
   */
  async capturePayment(paymentIntentId) {
    throw new Error('capturePayment not implemented');
  }

  /**
   * Refund a payment (full or partial)
   * @returns {{ refundId, status, amount }}
   */
  async refundPayment(processorPaymentId, amount) {
    throw new Error('refundPayment not implemented');
  }

  /**
   * Get payment status from processor
   * @returns {{ status, amount, metadata }}
   */
  async getPaymentStatus(processorPaymentId) {
    throw new Error('getPaymentStatus not implemented');
  }

  /**
   * Verify webhook signature
   * @returns {object} parsed event/payload
   */
  async verifyWebhook(rawBody, signature) {
    throw new Error('verifyWebhook not implemented');
  }

  /**
   * Verify the connection is still valid
   * @returns {{ valid: boolean, error?: string }}
   */
  async verifyConnection() {
    throw new Error('verifyConnection not implemented');
  }
}

module.exports = PaymentProcessor;
