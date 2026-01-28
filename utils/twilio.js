const twilio = require('twilio');

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured');
    }
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return client;
}

// Purchase number and add to Messaging Service
async function purchasePhoneNumber(areaCode, userId) {
  try {
    const twilioClient = getClient();

    // 1. Search for available number
    const availableNumbers = await twilioClient.availablePhoneNumbers('US')
      .local
      .list({ 
        areaCode, 
        smsEnabled: true,
        limit: 1 
      });

    if (availableNumbers.length === 0) {
      throw new Error(`No available numbers in area code ${areaCode}`);
    }

    const selectedNumber = availableNumbers[0].phoneNumber;

    // 2. Purchase the number
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: selectedNumber,
      friendlyName: `SORCE-User-${userId}`
    });

    console.log(`✅ Purchased number: ${selectedNumber}`);

    // 3. Add to Messaging Service (this sets the webhook automatically)
    await twilioClient.messaging.v1
      .services(process.env.TWILIO_MESSAGING_SERVICE_SID)
      .phoneNumbers
      .create({ phoneNumberSid: purchasedNumber.sid });

    console.log(`✅ Added ${selectedNumber} to Messaging Service`);

    return {
      phoneNumber: purchasedNumber.phoneNumber,
      phoneSid: purchasedNumber.sid
    };
  } catch (error) {
    console.error('Error purchasing phone number:', error);
    throw error;
  }
}

// Send SMS via Messaging Service (automatic number selection)
async function sendSMS(to, message, userId) {
  try {
    const twilioClient = getClient();

    // Get user's phone number from database
    const { pool } = require('../config/database');
    const userResult = await pool.query(
      'SELECT twilio_phone_number FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows[0]?.twilio_phone_number) {
      throw new Error('No phone number assigned to this user');
    }

    const from = userResult.rows[0].twilio_phone_number;

    // Send via Messaging Service
    const result = await twilioClient.messages.create({
      body: message,
      to: to,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      from: from // Explicitly use their number
    });

    return {
      success: true,
      messageSid: result.sid
    };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

// Release phone number (for when user cancels)
async function releasePhoneNumber(phoneSid) {
  try {
    const twilioClient = getClient();
    
    // Remove from messaging service first
    await twilioClient.messaging.v1
      .services(process.env.TWILIO_MESSAGING_SERVICE_SID)
      .phoneNumbers(phoneSid)
      .remove();

    // Then release the number
    await twilioClient.incomingPhoneNumbers(phoneSid).remove();
    
    console.log(`✅ Released phone number: ${phoneSid}`);
    return { success: true };
  } catch (error) {
    console.error('Error releasing phone number:', error);
    throw error;
  }
}

module.exports = {
  getClient,
  purchasePhoneNumber,
  sendSMS,
  releasePhoneNumber
};
