// One-off: buys the shared SORCE demo number, points its SMS webhook at the app, and
// adds it to the Messaging Service (so carriers treat it as registered traffic).
//
//   node scripts/buy-demo-number.js            # area code 360 (default)
//   node scripts/buy-demo-number.js 206        # pick another area code
//
// Idempotent: if a number named "SORCE-Demo" already exists it is reused, not re-bought.
// Prints the number to put in DEMO_SMS_NUMBER on Railway.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const twilio = require('twilio');

const FRIENDLY_NAME = 'SORCE-Demo';
const areaCode = parseInt(process.argv[2] || '360', 10);
const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';

(async () => {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const serviceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!serviceSid) throw new Error('TWILIO_MESSAGING_SERVICE_SID is not set');

  let number = (await client.incomingPhoneNumbers.list({ friendlyName: FRIENDLY_NAME, limit: 1 }))[0];
  if (number) {
    console.log(`Reusing existing demo number ${number.phoneNumber}`);
  } else {
    const available = await client.availablePhoneNumbers('US').local.list({ areaCode, smsEnabled: true, limit: 1 });
    if (!available.length) throw new Error(`No SMS-capable local numbers available in area code ${areaCode}`);
    number = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      friendlyName: FRIENDLY_NAME,
      smsUrl: `${baseUrl}/api/sms/webhook`,
      smsMethod: 'POST',
    });
    console.log(`Purchased ${number.phoneNumber}`);
  }

  // Make sure the webhook is right even on a reused number.
  await client.incomingPhoneNumbers(number.sid).update({ smsUrl: `${baseUrl}/api/sms/webhook`, smsMethod: 'POST' });

  const inService = await client.messaging.v1.services(serviceSid).phoneNumbers.list({ limit: 200 });
  if (inService.some(p => p.sid === number.sid)) {
    console.log('Already in the Messaging Service');
  } else {
    await client.messaging.v1.services(serviceSid).phoneNumbers.create({ phoneNumberSid: number.sid });
    console.log('Added to the Messaging Service');
  }

  console.log(`\nDEMO_SMS_NUMBER=${number.phoneNumber}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
