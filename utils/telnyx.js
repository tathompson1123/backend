// ============================================
// Telnyx SMS utility (parallel test — Twilio untouched)
// Requires env vars:
//   TELNYX_API_KEY               — V2 API key from Telnyx portal
//   TELNYX_MESSAGING_PROFILE_ID  — Messaging Profile ID (must have webhook URL set)
// Each business gets their own provisioned number — no shared number needed.
// ============================================

const TELNYX_BASE = 'https://api.telnyx.com/v2';

function telnyxHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
  };
}

// One representative area code per US state — used when we only know the state
const STATE_AREA_CODE = {
  AL: '205', AK: '907', AZ: '602', AR: '501', CA: '213', CO: '303',
  CT: '203', DE: '302', FL: '305', GA: '404', HI: '808', ID: '208',
  IL: '312', IN: '317', IA: '515', KS: '316', KY: '502', LA: '504',
  ME: '207', MD: '301', MA: '617', MI: '313', MN: '612', MS: '601',
  MO: '314', MT: '406', NE: '402', NV: '702', NH: '603', NJ: '201',
  NM: '505', NY: '212', NC: '704', ND: '701', OH: '216', OK: '405',
  OR: '503', PA: '215', RI: '401', SC: '803', SD: '605', TN: '615',
  TX: '214', UT: '801', VT: '802', VA: '703', WA: '206', WV: '304',
  WI: '414', WY: '307', DC: '202',
};

/**
 * Get area code for a user based on their state (and optionally city).
 * Falls back to 888 (toll-free available on Telnyx) if unknown.
 */
function getAreaCode(state, city) {
  if (!state) return '888';
  const code = STATE_AREA_CODE[(state || '').toUpperCase().trim()];
  return code || '888';
}

/**
 * Search Telnyx for an available local SMS-capable number with the given area code.
 * Returns the phone_number string or null.
 */
async function searchAvailableNumber(areaCode) {
  const url = `${TELNYX_BASE}/available_phone_numbers?filter[national_destination_code]=${areaCode}&filter[features][]=sms&page[size]=5`;
  const res = await fetch(url, { headers: telnyxHeaders() });
  const data = await res.json();

  if (!res.ok) throw new Error(`Telnyx search error: ${JSON.stringify(data.errors || data)}`);

  const numbers = data.data || [];
  if (numbers.length > 0) return numbers[0].phone_number;

  return null; // none available in that area code
}

/**
 * Purchase a phone number and assign it to the configured Messaging Profile.
 * The Messaging Profile must already have the inbound webhook URL set in Telnyx portal.
 */
async function purchasePhoneNumberTelnyx(areaCode, fallbackAreaCode = '888') {
  if (!process.env.TELNYX_API_KEY) throw new Error('TELNYX_API_KEY not set');
  if (!process.env.TELNYX_MESSAGING_PROFILE_ID) throw new Error('TELNYX_MESSAGING_PROFILE_ID not set');

  // Try requested area code first, then fallback
  let phoneNumber = await searchAvailableNumber(areaCode);
  if (!phoneNumber && areaCode !== fallbackAreaCode) {
    console.log(`⚠️ No number in area ${areaCode}, trying ${fallbackAreaCode}`);
    phoneNumber = await searchAvailableNumber(fallbackAreaCode);
  }
  if (!phoneNumber) throw new Error(`No available numbers in area codes ${areaCode} or ${fallbackAreaCode}`);

  // Place the order — Telnyx assigns it to the messaging profile automatically
  const orderRes = await fetch(`${TELNYX_BASE}/number_orders`, {
    method: 'POST',
    headers: telnyxHeaders(),
    body: JSON.stringify({
      phone_numbers: [{ phone_number: phoneNumber }],
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
    }),
  });

  const orderData = await orderRes.json();
  if (!orderRes.ok) throw new Error(`Telnyx order error: ${JSON.stringify(orderData.errors || orderData)}`);

  const orderId = orderData.data?.id;
  console.log(`✅ Telnyx ordered ${phoneNumber} (order ${orderId})`);

  return {
    phoneNumber,
    orderId,
  };
}

/**
 * Send an SMS via Telnyx from a specific from number.
 * Pass fromNumber explicitly so each user sends from their own provisioned number.
 */
async function sendSMSTelnyx(to, message, fromNumber) {
  if (!process.env.TELNYX_API_KEY) throw new Error('TELNYX_API_KEY not configured');
  if (!fromNumber) throw new Error('fromNumber is required — each business sends from their own provisioned number');

  const response = await fetch(`${TELNYX_BASE}/messages`, {
    method: 'POST',
    headers: telnyxHeaders(),
    body: JSON.stringify({ from: fromNumber, to, text: message }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Telnyx send error: ${JSON.stringify(data.errors || data)}`);

  return {
    success: true,
    messageId: data.data?.id,
  };
}

/**
 * Release (delete) a Telnyx phone number by its E.164 number string.
 */
async function releasePhoneNumberTelnyx(phoneNumber) {
  // First look up the phone number record ID
  const searchRes = await fetch(
    `${TELNYX_BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}`,
    { headers: telnyxHeaders() }
  );
  const searchData = await searchRes.json();
  const recordId = searchData.data?.[0]?.id;
  if (!recordId) throw new Error(`Telnyx: phone number ${phoneNumber} not found`);

  const delRes = await fetch(`${TELNYX_BASE}/phone_numbers/${recordId}`, {
    method: 'DELETE',
    headers: telnyxHeaders(),
  });

  if (!delRes.ok) {
    const d = await delRes.json();
    throw new Error(`Telnyx delete error: ${JSON.stringify(d.errors || d)}`);
  }

  console.log(`✅ Telnyx released ${phoneNumber}`);
  return { success: true };
}

module.exports = { sendSMSTelnyx, purchasePhoneNumberTelnyx, getAreaCode, releasePhoneNumberTelnyx };
