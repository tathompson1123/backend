// Maps US state (+ zip prefix for split-timezone states) to IANA timezone
function getTimezoneForBusiness(state, zipCode) {
  const zip3 = zipCode ? zipCode.substring(0, 3) : '';
  const st = (state || '').toUpperCase().trim();

  // Handle split-timezone states by zip prefix first
  if (st === 'FL' && ['322', '324', '325', '326'].includes(zip3)) return 'America/Chicago';
  if (st === 'TX' && ['798', '799'].includes(zip3)) return 'America/Denver';
  if (st === 'KY' && ['420', '421', '422', '423', '424', '425', '426', '427'].includes(zip3)) return 'America/Chicago';
  if (st === 'TN' && ['377', '378', '379'].includes(zip3)) return 'America/New_York';
  if (st === 'ND' && ['586', '587', '588'].includes(zip3)) return 'America/Denver';
  if (st === 'SD' && ['573', '574', '575', '576', '577'].includes(zip3)) return 'America/Denver';
  if (st === 'NE' && ['690', '691', '692', '693'].includes(zip3)) return 'America/Denver';
  if (st === 'OR' && zip3 === '979') return 'America/Boise';
  if (st === 'ID' && ['832', '833'].includes(zip3)) return 'America/Los_Angeles';

  const stateTimezones = {
    // Eastern
    'CT': 'America/New_York', 'DE': 'America/New_York', 'DC': 'America/New_York',
    'FL': 'America/New_York', 'GA': 'America/New_York', 'IN': 'America/New_York',
    'KY': 'America/New_York', 'ME': 'America/New_York', 'MD': 'America/New_York',
    'MA': 'America/New_York', 'MI': 'America/New_York', 'NH': 'America/New_York',
    'NJ': 'America/New_York', 'NY': 'America/New_York', 'NC': 'America/New_York',
    'OH': 'America/New_York', 'PA': 'America/New_York', 'RI': 'America/New_York',
    'SC': 'America/New_York', 'VT': 'America/New_York', 'VA': 'America/New_York',
    'WV': 'America/New_York',
    // Central
    'AL': 'America/Chicago', 'AR': 'America/Chicago', 'IL': 'America/Chicago',
    'IA': 'America/Chicago', 'KS': 'America/Chicago', 'LA': 'America/Chicago',
    'MN': 'America/Chicago', 'MS': 'America/Chicago', 'MO': 'America/Chicago',
    'NE': 'America/Chicago', 'ND': 'America/Chicago', 'OK': 'America/Chicago',
    'SD': 'America/Chicago', 'TN': 'America/Chicago', 'TX': 'America/Chicago',
    'WI': 'America/Chicago',
    // Mountain
    'AZ': 'America/Phoenix', 'CO': 'America/Denver', 'ID': 'America/Boise',
    'MT': 'America/Denver', 'NM': 'America/Denver', 'UT': 'America/Denver',
    'WY': 'America/Denver',
    // Pacific
    'CA': 'America/Los_Angeles', 'NV': 'America/Los_Angeles',
    'OR': 'America/Los_Angeles', 'WA': 'America/Los_Angeles',
    // Non-contiguous & territories
    'AK': 'America/Anchorage', 'HI': 'Pacific/Honolulu',
    'PR': 'America/Puerto_Rico', 'VI': 'America/Virgin',
    'GU': 'Pacific/Guam', 'AS': 'Pacific/Pago_Pago',
  };

  return stateTimezones[st] || 'America/New_York';
}

// Get current date/time info in the business's timezone
function getBusinessDateTime(state, zipCode) {
  const tz = getTimezoneForBusiness(state, zipCode);
  const now = new Date();

  const fullDate = now.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const isoDate = now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD

  const currentTime = now.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', hour12: true
  });

  return { fullDate, isoDate, currentTime, timezone: tz };
}

module.exports = { getTimezoneForBusiness, getBusinessDateTime };
