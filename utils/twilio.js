const twilio = require('twilio');

// Don't initialize client at module load - do it lazily
let client = null;

function getClient() {
  if (!client) {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your environment variables.');
    }
    
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return client;
}

// Purchase a local phone number for a business
async function purchasePhoneNumber(areaCode, userId) {
  try {
    const twilioClient = getClient();
    
    const availableNumbers = await twilioClient.availablePhoneNumbers('US')
      .local
      .list({ areaCode, limit: 1 });

    if (availableNumbers.length === 0) {
      throw new Error(`No available numbers in area code ${areaCode}`);
    }

    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: availableNumbers[0].phoneNumber,
      smsUrl: `${process.env.BACKEND_URL}/api/sms/webhook`,
      smsMethod: 'POST'
    });

    return {
      phoneNumber: purchasedNumber.phoneNumber,
      phoneSid: purchasedNumber.sid
    };
  } catch (error) {
    console.error('Error purchasing phone number:', error);
    throw error;
  }
}

// Send SMS
async function sendSMS(to, from, message) {
  try {
    const twilioClient = getClient();
    
    const result = await twilioClient.messages.create({
      body: message,
      to: to,
      from: from
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

module.exports = {
  getClient,
  purchasePhoneNumber,
  sendSMS
};
