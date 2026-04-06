const { Expo } = require('expo-server-sdk');
const { pool } = require('../config/database');

const expo = new Expo();

/**
 * Send push notification to the owner/admin employee of a business (by userId).
 * Finds the is_admin=true employee for that account and sends via their push token.
 */
async function sendPushToOwner(userId, title, body, data = {}) {
  try {
    const result = await pool.query(
      `SELECT ec.push_token, e.id AS employee_id
       FROM employees e
       JOIN employee_credentials ec ON ec.employee_id = e.id
       WHERE e.user_id = $1 AND e.is_admin = true AND ec.push_token IS NOT NULL
       LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) return { sent: false, reason: 'no_admin_push_token' };
    const { push_token: pushToken, employee_id } = result.rows[0];
    if (!Expo.isExpoPushToken(pushToken)) return { sent: false, reason: 'invalid_token' };
    const chunks = expo.chunkPushNotifications([{ to: pushToken, sound: 'default', title, body, data }]);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
    console.log(`✅ Push sent to owner (employee ${employee_id}) for user ${userId}`);
    return { sent: true };
  } catch (error) {
    console.error(`❌ Failed to send push to owner ${userId}:`, error.message);
    return { sent: false, reason: error.message };
  }
}

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

module.exports = { sendPushToEmployee, sendPushToOwner };
