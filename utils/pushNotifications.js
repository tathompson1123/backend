const { Expo } = require('expo-server-sdk');
const { pool } = require('../config/database');

const expo = new Expo();

/**
 * Send push notification to an employee's registered device
 */
async function sendPushToEmployee(employeeId, title, body, data = {}) {
  try {
    const result = await pool.query(
      'SELECT push_token FROM employee_credentials WHERE employee_id = $1 AND push_token IS NOT NULL',
      [employeeId]
    );

    if (result.rows.length === 0 || !result.rows[0].push_token) {
      return { sent: false, reason: 'no_push_token' };
    }

    const pushToken = result.rows[0].push_token;

    if (!Expo.isExpoPushToken(pushToken)) {
      console.warn(`⚠️ Invalid Expo push token for employee ${employeeId}`);
      return { sent: false, reason: 'invalid_token' };
    }

    const messages = [{
      to: pushToken,
      sound: 'default',
      title,
      body,
      data
    }];

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log(`✅ Push sent to employee ${employeeId}:`, ticketChunk);
    }

    return { sent: true };
  } catch (error) {
    console.error(`❌ Failed to send push to employee ${employeeId}:`, error.message);
    return { sent: false, reason: error.message };
  }
}

module.exports = { sendPushToEmployee };
