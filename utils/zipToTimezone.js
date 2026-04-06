// Maps US phone area code to IANA timezone
const AREA_CODE_TIMEZONE = {
  // ── Eastern (America/New_York) ──────────────────────────
  // Connecticut
  203:'America/New_York',475:'America/New_York',860:'America/New_York',959:'America/New_York',
  // Delaware
  302:'America/New_York',
  // DC
  202:'America/New_York',
  // Florida (most; 850 panhandle = Central)
  239:'America/New_York',305:'America/New_York',321:'America/New_York',352:'America/New_York',
  386:'America/New_York',407:'America/New_York',561:'America/New_York',689:'America/New_York',
  727:'America/New_York',754:'America/New_York',772:'America/New_York',786:'America/New_York',
  813:'America/New_York',863:'America/New_York',904:'America/New_York',941:'America/New_York',
  954:'America/New_York',
  // Georgia
  229:'America/New_York',404:'America/New_York',470:'America/New_York',478:'America/New_York',
  678:'America/New_York',706:'America/New_York',762:'America/New_York',912:'America/New_York',
  // Indiana
  219:'America/New_York',260:'America/New_York',317:'America/New_York',463:'America/New_York',
  574:'America/New_York',765:'America/New_York',812:'America/New_York',930:'America/New_York',
  // Kentucky (mostly Eastern; west KY ~270/364 is Central but close enough)
  502:'America/New_York',606:'America/New_York',859:'America/New_York',
  270:'America/Chicago',364:'America/Chicago',
  // Maine
  207:'America/New_York',
  // Maryland
  240:'America/New_York',301:'America/New_York',410:'America/New_York',
  443:'America/New_York',667:'America/New_York',
  // Massachusetts
  339:'America/New_York',351:'America/New_York',413:'America/New_York',508:'America/New_York',
  617:'America/New_York',774:'America/New_York',781:'America/New_York',
  857:'America/New_York',978:'America/New_York',
  // Michigan
  231:'America/New_York',248:'America/New_York',269:'America/New_York',313:'America/New_York',
  517:'America/New_York',586:'America/New_York',616:'America/New_York',734:'America/New_York',
  810:'America/New_York',906:'America/New_York',989:'America/New_York',
  // New Hampshire
  603:'America/New_York',
  // New Jersey
  201:'America/New_York',551:'America/New_York',609:'America/New_York',640:'America/New_York',
  732:'America/New_York',848:'America/New_York',856:'America/New_York',862:'America/New_York',
  908:'America/New_York',973:'America/New_York',
  // New York
  212:'America/New_York',315:'America/New_York',347:'America/New_York',516:'America/New_York',
  518:'America/New_York',585:'America/New_York',607:'America/New_York',631:'America/New_York',
  646:'America/New_York',680:'America/New_York',716:'America/New_York',718:'America/New_York',
  845:'America/New_York',914:'America/New_York',917:'America/New_York',929:'America/New_York',
  934:'America/New_York',
  // North Carolina
  252:'America/New_York',336:'America/New_York',704:'America/New_York',743:'America/New_York',
  828:'America/New_York',910:'America/New_York',919:'America/New_York',
  980:'America/New_York',984:'America/New_York',
  // Ohio
  216:'America/New_York',220:'America/New_York',234:'America/New_York',330:'America/New_York',
  380:'America/New_York',419:'America/New_York',440:'America/New_York',513:'America/New_York',
  567:'America/New_York',614:'America/New_York',740:'America/New_York',937:'America/New_York',
  // Pennsylvania
  215:'America/New_York',267:'America/New_York',272:'America/New_York',412:'America/New_York',
  484:'America/New_York',570:'America/New_York',610:'America/New_York',717:'America/New_York',
  724:'America/New_York',814:'America/New_York',835:'America/New_York',878:'America/New_York',
  // Rhode Island
  401:'America/New_York',
  // South Carolina
  803:'America/New_York',843:'America/New_York',854:'America/New_York',864:'America/New_York',
  // Tennessee east
  423:'America/New_York',865:'America/New_York',
  // Virginia
  276:'America/New_York',434:'America/New_York',540:'America/New_York',571:'America/New_York',
  703:'America/New_York',757:'America/New_York',804:'America/New_York',
  // Vermont
  802:'America/New_York',
  // West Virginia
  304:'America/New_York',681:'America/New_York',

  // ── Central (America/Chicago) ───────────────────────────
  // Alabama
  205:'America/Chicago',251:'America/Chicago',256:'America/Chicago',938:'America/Chicago',
  // Arkansas
  479:'America/Chicago',501:'America/Chicago',870:'America/Chicago',
  // Florida panhandle
  850:'America/Chicago',
  // Illinois
  217:'America/Chicago',224:'America/Chicago',309:'America/Chicago',312:'America/Chicago',
  331:'America/Chicago',447:'America/Chicago',618:'America/Chicago',630:'America/Chicago',
  708:'America/Chicago',773:'America/Chicago',779:'America/Chicago',815:'America/Chicago',
  847:'America/Chicago',872:'America/Chicago',
  // Iowa
  319:'America/Chicago',515:'America/Chicago',563:'America/Chicago',641:'America/Chicago',712:'America/Chicago',
  // Kansas
  316:'America/Chicago',620:'America/Chicago',785:'America/Chicago',913:'America/Chicago',
  // Louisiana
  225:'America/Chicago',318:'America/Chicago',337:'America/Chicago',504:'America/Chicago',985:'America/Chicago',
  // Minnesota
  218:'America/Chicago',320:'America/Chicago',507:'America/Chicago',612:'America/Chicago',
  651:'America/Chicago',763:'America/Chicago',952:'America/Chicago',
  // Mississippi
  228:'America/Chicago',601:'America/Chicago',662:'America/Chicago',769:'America/Chicago',
  // Missouri
  314:'America/Chicago',417:'America/Chicago',573:'America/Chicago',636:'America/Chicago',
  660:'America/Chicago',816:'America/Chicago',975:'America/Chicago',
  // Nebraska
  308:'America/Chicago',402:'America/Chicago',531:'America/Chicago',
  // North Dakota
  701:'America/Chicago',
  // Oklahoma
  405:'America/Chicago',539:'America/Chicago',580:'America/Chicago',918:'America/Chicago',
  // South Dakota
  605:'America/Chicago',
  // Tennessee west/central
  615:'America/Chicago',629:'America/Chicago',731:'America/Chicago',901:'America/Chicago',
  // Texas (most)
  210:'America/Chicago',214:'America/Chicago',254:'America/Chicago',281:'America/Chicago',
  325:'America/Chicago',346:'America/Chicago',361:'America/Chicago',409:'America/Chicago',
  430:'America/Chicago',432:'America/Chicago',469:'America/Chicago',512:'America/Chicago',
  682:'America/Chicago',713:'America/Chicago',726:'America/Chicago',737:'America/Chicago',
  806:'America/Chicago',817:'America/Chicago',832:'America/Chicago',903:'America/Chicago',
  936:'America/Chicago',940:'America/Chicago',945:'America/Chicago',956:'America/Chicago',
  972:'America/Chicago',979:'America/Chicago',
  // Texas El Paso (Mountain)
  915:'America/Denver',
  // Wisconsin
  262:'America/Chicago',414:'America/Chicago',534:'America/Chicago',
  608:'America/Chicago',715:'America/Chicago',920:'America/Chicago',

  // ── Mountain (America/Denver) ───────────────────────────
  // Colorado
  303:'America/Denver',719:'America/Denver',720:'America/Denver',970:'America/Denver',
  // Idaho
  208:'America/Boise',986:'America/Boise',
  // Montana
  406:'America/Denver',
  // New Mexico
  505:'America/Denver',575:'America/Denver',
  // Utah
  385:'America/Denver',435:'America/Denver',801:'America/Denver',
  // Wyoming
  307:'America/Denver',
  // Arizona (no DST — Phoenix zone)
  480:'America/Phoenix',520:'America/Phoenix',602:'America/Phoenix',
  623:'America/Phoenix',928:'America/Phoenix',

  // ── Pacific (America/Los_Angeles) ───────────────────────
  // California
  209:'America/Los_Angeles',213:'America/Los_Angeles',279:'America/Los_Angeles',
  310:'America/Los_Angeles',323:'America/Los_Angeles',408:'America/Los_Angeles',
  415:'America/Los_Angeles',424:'America/Los_Angeles',442:'America/Los_Angeles',
  510:'America/Los_Angeles',530:'America/Los_Angeles',559:'America/Los_Angeles',
  562:'America/Los_Angeles',619:'America/Los_Angeles',626:'America/Los_Angeles',
  628:'America/Los_Angeles',650:'America/Los_Angeles',657:'America/Los_Angeles',
  661:'America/Los_Angeles',669:'America/Los_Angeles',707:'America/Los_Angeles',
  714:'America/Los_Angeles',747:'America/Los_Angeles',760:'America/Los_Angeles',
  764:'America/Los_Angeles',805:'America/Los_Angeles',818:'America/Los_Angeles',
  820:'America/Los_Angeles',831:'America/Los_Angeles',858:'America/Los_Angeles',
  909:'America/Los_Angeles',916:'America/Los_Angeles',925:'America/Los_Angeles',
  949:'America/Los_Angeles',951:'America/Los_Angeles',
  // Nevada
  702:'America/Los_Angeles',725:'America/Los_Angeles',775:'America/Los_Angeles',
  // Oregon
  458:'America/Los_Angeles',503:'America/Los_Angeles',541:'America/Los_Angeles',971:'America/Los_Angeles',
  // Washington state
  206:'America/Los_Angeles',253:'America/Los_Angeles',360:'America/Los_Angeles',
  425:'America/Los_Angeles',509:'America/Los_Angeles',564:'America/Los_Angeles',

  // ── Alaska / Hawaii / Territories ───────────────────────
  907:'America/Anchorage',
  808:'Pacific/Honolulu',
  787:'America/Puerto_Rico',939:'America/Puerto_Rico',
};

/**
 * Get IANA timezone from a US phone number by area code.
 * Falls back to 'America/New_York' if unknown.
 */
function getTimezoneFromPhone(phone) {
  if (!phone) return 'America/New_York';
  const digits = phone.replace(/\D/g, '');
  // Strip country code +1
  const local = digits.startsWith('1') && digits.length > 10 ? digits.slice(1) : digits;
  const areaCode = parseInt(local.substring(0, 3), 10);
  return AREA_CODE_TIMEZONE[areaCode] || 'America/New_York';
}

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

module.exports = { getTimezoneForBusiness, getBusinessDateTime, getTimezoneFromPhone };
