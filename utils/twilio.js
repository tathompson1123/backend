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
// Searches by zip code first, then area code fallback, then any US number
async function purchasePhoneNumber({ zipCode, areaCode, userId }) {
  try {
    const twilioClient = getClient();

    let availableNumbers = [];

    // 1. Try by zip code (best match for business location)
    if (zipCode) {
      availableNumbers = await twilioClient.availablePhoneNumbers('US')
        .local
        .list({ inPostalCode: zipCode, smsEnabled: true, voiceEnabled: true, limit: 1 });
    }

    // 2. Fallback: try by area code
    if (availableNumbers.length === 0 && areaCode) {
      console.log(`⚠️  No numbers near zip ${zipCode}, trying area code ${areaCode}...`);
      availableNumbers = await twilioClient.availablePhoneNumbers('US')
        .local
        .list({ areaCode, smsEnabled: true, voiceEnabled: true, limit: 1 });
    }

    // 3. Fallback: any US local number
    if (availableNumbers.length === 0) {
      console.log(`⚠️  No local numbers found, trying any US number...`);
      availableNumbers = await twilioClient.availablePhoneNumbers('US')
        .local
        .list({ smsEnabled: true, voiceEnabled: true, limit: 1 });
    }

    // 4. Last resort: toll-free
    if (availableNumbers.length === 0) {
      console.log('⚠️  No local numbers available, trying toll-free...');
      availableNumbers = await twilioClient.availablePhoneNumbers('US')
        .tollFree
        .list({ smsEnabled: true, limit: 1 });
    }

    if (availableNumbers.length === 0) {
      throw new Error('No available phone numbers found. Please try again later.');
    }

    const selectedNumber = availableNumbers[0].phoneNumber;

    // 5. Purchase the number
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: selectedNumber,
      friendlyName: `SORCE-User-${userId}`
    });

    console.log(`✅ Purchased number: ${selectedNumber} (zip: ${zipCode})`);

    // 6. Add to Messaging Service
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

// Send SMS/MMS via Messaging Service
async function sendSMS(to, message, userId, mediaUrl) {
  try {
    const twilioClient = getClient();

    // Get user's phone number from database
    const { pool } = require('../config/database');
    const userResult = await pool.query(
      'SELECT twilio_phone_number, twilio_phone_sid FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows[0]?.twilio_phone_number) {
      throw new Error(`No phone number assigned to this user (userId: ${userId})`);
    }

    const userData = userResult.rows[0];
    const msgParams = {
      body: message,
      to: to,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
    };

    // Dedicated numbers send with explicit from; shared trial numbers let the Messaging Service pick
    if (userData.twilio_phone_sid) {
      msgParams.from = userData.twilio_phone_number;
    }

    if (mediaUrl) {
      msgParams.mediaUrl = Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl];
    }

    const result = await twilioClient.messages.create(msgParams);

    return {
      success: true,
      messageSid: result.sid
    };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

// Set voice webhook URL on a phone number (for missed call text-back)
async function setVoiceWebhook(phoneSid, voiceUrl) {
  try {
    const twilioClient = getClient();
    await twilioClient.incomingPhoneNumbers(phoneSid).update({
      voiceUrl: voiceUrl,
      voiceMethod: 'POST'
    });
    console.log(`✅ Voice webhook set on ${phoneSid}: ${voiceUrl}`);
    return { success: true };
  } catch (error) {
    console.error('Error setting voice webhook:', error);
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
  setVoiceWebhook,
  releasePhoneNumber
};
