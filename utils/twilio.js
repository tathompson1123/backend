const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Purchase a local phone number for a business
async function purchasePhoneNumber(areaCode, userId) {
  try {
    const availableNumbers = await client.availablePhoneNumbers('US')
      .local
      .list({ areaCode, limit: 1 });

    if (availableNumbers.length === 0) {
      throw new Error(`No available numbers in area code ${areaCode}`);
    }

    const purchasedNumber = await client.incomingPhoneNumbers.create({
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
    const result = await client.messages.create({
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
  client,
  purchasePhoneNumber,
  sendSMS
};
