// backend/utils/twilio-setup.js
const twilio = require('twilio');

async function createMessagingService() {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const service = await client.messaging.v1.services.create({
    friendlyName: 'SORCE Lead Qualification Service',
    inboundRequestUrl: `${process.env.BACKEND_URL}/api/sms/webhook`,
    inboundMethod: 'POST',
    useInboundWebhookOnNumber: false // Use service-level webhook
  });

  console.log('Messaging Service SID:', service.sid);
  // Save this to your .env: TWILIO_MESSAGING_SERVICE_SID
  return service.sid;
}
