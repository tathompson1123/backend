// SendBlue API Integration
// Docs: https://sendblue.co/docs

const SENDBLUE_API_KEY = process.env.SENDBLUE_API_KEY;
const SENDBLUE_API_SECRET = process.env.SENDBLUE_API_SECRET;
const SENDBLUE_BASE_URL = 'https://api.sendblue.co/api';

// Export functions early to avoid circular dependency warnings
module.exports = {
  sendSMS,
  sendMMS,
  getMessageStatus,
  getConversations,
  verifyWebhookSignature
};

if (!SENDBLUE_API_KEY || !SENDBLUE_API_SECRET) {
  console.warn('⚠️ SendBlue credentials not configured');
}

/**
 * Send SMS via SendBlue
 * @param {string} to - Phone number (E.164 format: +1234567890)
 * @param {string} message - Message content
 * @returns {Promise<Object>} SendBlue response
 */
async function sendSMS(to, message) {
  if (!SENDBLUE_API_KEY || !SENDBLUE_API_SECRET) {
    throw new Error('SendBlue not configured');
  }

  const response = await fetch(`${SENDBLUE_BASE_URL}/send-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': SENDBLUE_API_KEY,
      'sb-api-secret-key': SENDBLUE_API_SECRET
    },
    body: JSON.stringify({
      number: to,
      content: message
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`SendBlue API error: ${error.message || response.statusText}`);
  }

  return await response.json();
}

/**
 * Send MMS (with media) via SendBlue
 * @param {string} to - Phone number
 * @param {string} message - Message content
 * @param {string} mediaUrl - URL to image/video
 */
async function sendMMS(to, message, mediaUrl) {
  if (!SENDBLUE_API_KEY || !SENDBLUE_API_SECRET) {
    throw new Error('SendBlue not configured');
  }

  const response = await fetch(`${SENDBLUE_BASE_URL}/send-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': SENDBLUE_API_KEY,
      'sb-api-secret-key': SENDBLUE_API_SECRET
    },
    body: JSON.stringify({
      number: to,
      content: message,
      media_url: mediaUrl
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`SendBlue API error: ${error.message || response.statusText}`);
  }

  return await response.json();
}

/**
 * Get message status
 * @param {string} messageId - SendBlue message ID
 */
async function getMessageStatus(messageId) {
  const response = await fetch(`${SENDBLUE_BASE_URL}/message-status/${messageId}`, {
    headers: {
      'sb-api-key-id': SENDBLUE_API_KEY,
      'sb-api-secret-key': SENDBLUE_API_SECRET
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get message status');
  }

  return await response.json();
}

/**
 * Get all conversations
 */
async function getConversations() {
  const response = await fetch(`${SENDBLUE_BASE_URL}/conversations`, {
    headers: {
      'sb-api-key-id': SENDBLUE_API_KEY,
      'sb-api-secret-key': SENDBLUE_API_SECRET
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get conversations');
  }

  return await response.json();
}

/**
 * Verify webhook signature (for security)
 * @param {string} signature - X-Sendblue-Signature header
 * @param {string} body - Raw request body
 */
function verifyWebhookSignature(signature, body) {
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', SENDBLUE_API_SECRET);
  hmac.update(body);
  const expected = hmac.digest('hex');
  return signature === expected;
}
