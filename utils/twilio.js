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
    const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: selectedNumber,
      friendlyName: `SORCE-User-${userId}`,
      smsUrl: `${baseUrl}/api/sms/webhook`,
      smsMethod: 'POST',
      voiceUrl: `${baseUrl}/api/voice/webhook`,
      voiceMethod: 'POST'
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

// Finds a number we already own that no account is using, and hands it over rather
// than buying another. Orphans happen — a failed signup can leave a number attached
// to nobody while still billing monthly — so this recovers them automatically.
//
// The shared trial number and our own SORCE sender are excluded by name; they're
// deliberately unassigned and must never be handed to a customer.
async function claimSpareNumber(userId) {
  const twilioClient = getClient();
  const { pool } = require('../config/database');

  const owned = await twilioClient.incomingPhoneNumbers.list({ limit: 200 });
  if (owned.length === 0) return null;

  const assigned = new Set(
    (await pool.query(
      `SELECT twilio_phone_number FROM users WHERE twilio_phone_number IS NOT NULL`
    )).rows.map(r => String(r.twilio_phone_number).replace(/\D/g, '').slice(-10))
  );

  const reserved = new Set(
    [process.env.TWILIO_SHARED_TRIAL_NUMBER, process.env.SORCE_SMS_FROM]
      .filter(Boolean)
      .map(n => String(n).replace(/\D/g, '').slice(-10))
  );

  const spare = owned.find(n => {
    const last10 = String(n.phoneNumber).replace(/\D/g, '').slice(-10);
    return !assigned.has(last10) && !reserved.has(last10);
  });
  if (!spare) return null;

  const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
  await twilioClient.incomingPhoneNumbers(spare.sid).update({
    friendlyName: `SORCE-User-${userId}`,
    smsUrl: `${baseUrl}/api/sms/webhook`,
    smsMethod: 'POST',
    voiceUrl: `${baseUrl}/api/voice/webhook`,
    voiceMethod: 'POST',
  });

  console.log(`♻️ Reusing unassigned number ${spare.phoneNumber} for user ${userId} instead of buying one`);
  return { phoneNumber: spare.phoneNumber, phoneSid: spare.sid, reused: true };
}

// Send SMS/MMS via Messaging Service
// Typographic punctuation sits outside GSM-7, and a single character outside it flips
// the whole message to UCS-2 — dropping the per-segment limit from 153 to 67 and
// roughly tripling the cost of a two-line text. Claude writes em-dashes and curly
// quotes by default, so the AI-composed replies were the worst offenders and no amount
// of prompt wording fixes that reliably. Normalising here catches every send.
//
// Emoji are deliberately left alone: they also force UCS-2, but where they appear
// (a raffle win, a friendly sign-off) they're a choice worth paying for.
const GSM_SUBSTITUTIONS = [
  [/[‘’‛′]/g, "'"],   // curly single quotes, prime
  [/[“”‟″]/g, '"'],   // curly double quotes
  [/[‐-―]/g, '-'],              // hyphens, en dash, em dash, horizontal bar
  [/…/g, '...'],                     // ellipsis
  [/[   ]/g, ' '],         // non-breaking spaces
  [/•/g, '*'],                       // bullet
  [/[‹›]/g, "'"],               // single angle quotes
  [/[«»]/g, '"'],               // double angle quotes
];

function normalizeSmsText(text) {
  if (typeof text !== 'string') return text;
  return GSM_SUBSTITUTIONS.reduce((out, [re, to]) => out.replace(re, to), text);
}

async function sendSMS(to, message, userId, mediaUrl) {
  message = normalizeSmsText(message);
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

    // Get final delivery status async via callback
    const baseUrl = process.env.PRODUCTION_BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
    msgParams.statusCallback = `${baseUrl}/api/sms/status`;

    const result = await twilioClient.messages.create(msgParams);

    console.log(
      `📤 Twilio create → sid=${result.sid} status=${result.status}` +
      (mediaUrl ? ` (MMS, ${Array.isArray(mediaUrl) ? mediaUrl.length : 1} media)` : '') +
      (result.errorCode ? ` errorCode=${result.errorCode} errorMessage="${result.errorMessage}"` : '')
    );

    return {
      success: true,
      messageSid: result.sid,
      status: result.status,
      errorCode: result.errorCode || null,
      errorMessage: result.errorMessage || null,
    };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

// Normalize a US phone number to E.164 (+1XXXXXXXXXX) for use in TwiML <Number>/Dial.
// Business phones are stored free-form (e.g. "(555) 123-4567"), so coerce before dialing.
// Returns null when the value can't be turned into a plausible number.
function toE164US(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.startsWith('+')) {
    const d = s.slice(1).replace(/\D/g, '');
    return d.length >= 10 && d.length <= 15 ? '+' + d : null;
  }
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
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
  claimSpareNumber,
  purchasePhoneNumber,
  sendSMS,
  setVoiceWebhook,
  releasePhoneNumber,
  toE164US,
  normalizeSmsText
};
