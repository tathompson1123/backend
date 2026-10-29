// Recurring bookings: a plan row says "this customer, this service, every N", and this
// module keeps real rows in `bookings` filled in ahead of time so the calendar, the
// employee app and reminders all see them like any other booking.
//
// Scheduling rule worth knowing: monthly-style plans (monthly / every 2 months /
// quarterly / yearly) keep the SAME WEEKDAY and week-of-month as the first visit —
// "first Tuesday", "third Friday" — instead of the same date. A detailing route is built
// around days of the week, so a customer who is a Tuesday customer stays a Tuesday
// customer. A 5th weekday that doesn't exist that month falls back to the last one.
//
// Generation is idempotent: bookings.recurring_occurrence_date is the slot a visit was
// generated for (it does NOT move when a single visit is rescheduled), and a unique index
// on (plan, slot) stops the nightly top-up from creating a second copy.

const axios = require('axios');
const { pool } = require('../config/database');
const { normalizeServiceList, resolveBookingServices } = require('./bookingServices');
const { resolveFeeTotals } = require('./catalogFees');

// days = fixed day step, months = month step (same weekday + week-of-month), twice = two
// visits every month. 'bimonthly' is the business's own term for TWICE A MONTH, not
// "every other month" — that is why it is not a months:2 entry. 'cadence' is how often
// the plan is BILLED in Square (visits-per-month plans are all billed monthly).
const FREQUENCIES = {
  weekly:    { label: 'Weekly',                         days: 7,       cadence: 'MONTHLY',   visitsPerBill: null },
  biweekly:  { label: 'Bi-weekly (every 2 weeks)',      days: 14,      cadence: 'MONTHLY',   visitsPerBill: null },
  bimonthly: { label: 'Bi-monthly (twice a month)',     twice: true,   cadence: 'MONTHLY',   visitsPerBill: 2 },
  monthly:   { label: 'Monthly',                        months: 1,     cadence: 'MONTHLY',   visitsPerBill: 1 },
  quarterly: { label: 'Quarterly',                      months: 3,     cadence: 'QUARTERLY', visitsPerBill: 1 },
  yearly:    { label: 'Yearly',                         months: 12,    cadence: 'ANNUAL',    visitsPerBill: 1 },
};

// How far ahead real bookings are kept on the schedule.
const HORIZON_DAYS = 90;
// Safety cap on one generation pass (weekly over 90 days is ~13).
const MAX_OCCURRENCES_PER_RUN = 60;

// ── Date math on 'YYYY-MM-DD' strings, in UTC so server timezone can't shift a day ──
/**
 * 'YYYY-MM-DD' from whatever the database handed back. node-postgres returns DATE columns
 * as a Date at LOCAL midnight, so read it with local getters; strings pass straight through.
 * (toYmd(date) yields "Mon Nov 02" — never do that.)
 */
function toYmd(v) {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

function parseYmd(s) {
  const [y, m, d] = toYmd(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtYmd(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function addDays(ymd, n) {
  const dt = parseYmd(ymd);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmtYmd(dt);
}

/** The nth visit date (n = 0 is the anchor itself). */
function occurrenceDate(anchorYmd, frequency, n) {
  const f = FREQUENCIES[frequency];
  if (!f) throw new Error(`Unknown frequency: ${frequency}`);
  if (n === 0) return toYmd(anchorYmd);
  if (f.days) return addDays(anchorYmd, f.days * n);

  const anchor = parseYmd(anchorYmd);
  const weekday = anchor.getUTCDay();
  const ordinal = Math.ceil(anchor.getUTCDate() / 7); // 1..5

  if (f.twice) {
    // Exactly two visits every month, evenly spread, on the anchor's weekday: 1st+3rd
    // or 2nd+4th. Odd ordinals pair as (1,3), even as (2,4); a 5th Tuesday first visit
    // continues on 1st/3rd Tuesdays.
    const pair = ordinal % 2 === 1 ? [1, 3] : [2, 4];
    // Slots at-or-after the anchor, counted in order. Walk months until n slots are past.
    let seen = 0;
    for (let m = 0; m < 600; m++) {
      const totalMonths = anchor.getUTCMonth() + m;
      const year = anchor.getUTCFullYear() + Math.floor(totalMonths / 12);
      const month = totalMonths % 12;
      for (const k of pair) {
        const d = nthWeekday(year, month, weekday, k);
        // n=0 is the anchor itself (handled above), so count only slots after it.
        if (d <= toYmd(anchorYmd)) continue;
        seen++;
        if (seen === n) return d;
      }
    }
    throw new Error('occurrenceDate: ran past 600 months');
  }

  const totalMonths = anchor.getUTCMonth() + f.months * n;
  const year = anchor.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  return nthWeekday(year, month, weekday, ordinal);
}

/** The k-th (1..5) given weekday of a month; a 5th that doesn't exist → the last one. */
function nthWeekday(year, month, weekday, k) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  let day = 1 + offset + (k - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  while (day > daysInMonth) day -= 7;
  return fmtYmd(new Date(Date.UTC(year, month, day)));
}

/** Today's date in the given IANA timezone as 'YYYY-MM-DD' (server runs in UTC). */
function todayInTz(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York' }).format(new Date());
  } catch {
    return fmtYmd(new Date());
  }
}

// ── Geocoding (OpenStreetMap Nominatim) ──
// Free and keyless, matching what BusinessInformation already uses on the client. Usage
// policy: identify the app with a User-Agent and stay near 1 request/second — plans are
// created one at a time by a person, so that holds.
// Google Places text search — the same lookup Google Maps uses, so a loose address like
// "2721 leaning oak pl se olympia" resolves exactly as it does there. Used first when the key exists.
async function googlePlace(q, bias) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  try {
    const body = { textQuery: q, regionCode: 'US', maxResultCount: 1 };
    if (bias) body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 } };
    const r = await axios.post('https://places.googleapis.com/v1/places:searchText', body, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.location,places.formattedAddress' },
      timeout: 8000,
    });
    const loc = r.data?.places?.[0]?.location;
    return loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)
      ? { lat: loc.latitude, lng: loc.longitude } : null;
  } catch (e) {
    console.warn('[recurring] google geocode failed:', e.response?.data?.error?.message || e.message);
    return null;
  }
}

async function photon(q, bias, box) {
  try {
    const params = { q, limit: 5, lang: 'en' };
    if (bias) { params.lat = bias.lat; params.lon = bias.lng; }
    if (box) { const [w, n, e, so] = box.split(','); params.bbox = [w, so, e, n].join(','); }
    const r = await axios.get('https://photon.komoot.io/api/', {
      params, headers: { 'User-Agent': 'SORCE-CRM/1.0 (recurring-bookings map)' }, timeout: 8000,
    });
    const feats = (r.data?.features || []).filter(f => f.properties?.countrycode === 'US' || !f.properties?.countrycode);
    // Only accept something with a street: a house, or at least the street itself.
    const pick = feats.find(f => f.properties.housenumber && f.properties.street) || feats.find(f => f.properties.street);
    const c = pick?.geometry?.coordinates;
    return c && Number.isFinite(c[1]) && Number.isFinite(c[0]) ? { lat: c[1], lng: c[0] } : null;
  } catch (e) {
    console.warn('[recurring] photon failed:', e.message);
    return null;
  }
}

async function nominatim(q, bias, box) {
  const params = { q, format: 'json', limit: 1, countrycodes: 'us' };
  // Prefer results near the business's other customers (a soft preference, not a filter), so a
  // partial address like "2721 leaning oak pl se olympia" lands in the right state.
  if (bias) params.viewbox = [bias.lng - 0.6, bias.lat + 0.6, bias.lng + 0.6, bias.lat - 0.6].join(',');
  if (box) { params.viewbox = box; params.bounded = 1; } // hard limit to this area
  const r = await axios.get('https://nominatim.openstreetmap.org/search', {
    params,
    headers: { 'User-Agent': 'SORCE-CRM/1.0 (recurring-bookings map)' },
    timeout: 8000,
  });
  const hit = r.data && r.data[0];
  if (!hit) return null;
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function milesBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(h));
}

// Where this business's customers are (average of their geocoded plans), else null.
async function nearbyBias(userId) {
  if (!userId) return null;
  const r = await pool.query(
    'SELECT AVG(lat)::float AS lat, AVG(lng)::float AS lng FROM recurring_plans WHERE user_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL',
    [userId]
  );
  const { lat, lng } = r.rows[0] || {};
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// Works with partial addresses (no state/zip): tries the address as typed, then without unit
// text, then street + city without the house number, then the city alone — each biased toward
// the business's other customers, and with the business's state added when the address has none.
async function geocodeAddress(address, userId) {
  const full = String(address || '').trim();
  if (!full) return null;
  try {
    let bias = null;
    let state = '';
    if (userId) {
      bias = await nearbyBias(userId).catch(() => null);
      const b = await pool.query('SELECT state FROM business_information WHERE user_id = $1', [userId]).catch(() => null);
      state = String(b?.rows?.[0]?.state || '').trim();
    }
    // The geocoder reads a bare "Washington" as Washington, D.C. (the White House). For a business in
    // Washington state — or an address that says Washington/WA — drop the state/zip words and confine
    // the search to a Washington-state box instead.
    const STATE_TAIL = /[,\s]+(WA|Washington)\b(?!\s*,?\s*D\.?\s*C\b)[\s,]*(\d{5}(-\d{4})?)?\s*$/i;
    const waMode = /^(wa|washington)$/i.test(state) || (!state && STATE_TAIL.test(full));
    const base = waMode ? full.replace(STATE_TAIL, '').trim() : full;
    const stripped = base.replace(/\s*(,\s*)?(#|apt\.?|unit|suite|ste\.?)\s*[\w-]+/i, '').trim();
    const noNumber = stripped.replace(/^\s*\d+[\w-]*\s+/, '').trim();
    const tail = stripped.split(/[\s,]+/).filter(Boolean).slice(-1)[0];
    const WA_BOX = '-124.9,49.1,-116.8,45.4'; // west,north,east,south
    const fixedForGoogle = waMode ? base + ' WA' : base;
    const farFromBias = (hit) => bias && milesBetween(bias, hit) > 150; // wrong-place match (e.g. D.C.)

    // 0) Google (exact, handles partial addresses); free lookups below are the backup.
    const g = await googlePlace(fixedForGoogle, bias);
    if (g && !farFromBias(g)) return g;

    // 1) Photon: fuzzy, understands "pl" vs "road", and returns the house number when it knows it.
    for (const q of [...new Set(waMode ? [base + ' WA', stripped + ' WA', base] : [base, stripped])]) {
      const hit = await photon(q, bias, waMode ? WA_BOX : null);
      if (hit && !farFromBias(hit)) return hit;
    }

    // 2) Nominatim: the address as typed, then street + city without the house number.
    const queries = [];
    for (const q of [base, stripped, noNumber]) if (q && !queries.includes(q)) queries.push(q);
    for (const q of queries) {
      await new Promise(r => setTimeout(r, 1100)); // Nominatim: max 1 request/second
      const hit = await nominatim(q, bias, waMode ? WA_BOX : null);
      if (hit && !farFromBias(hit)) return hit;
    }

    // 3) Last resort: the city alone (approximate), never a landmark.
    if (tail && tail.length > 2) {
      await new Promise(r => setTimeout(r, 1100));
      const hit = await nominatim(tail, bias, waMode ? WA_BOX : null);
      if (hit && !farFromBias(hit)) return hit;
    }
  } catch (e) {
    console.warn('[recurring] geocode failed:', e.message);
  }
  return null;
}

// ── Customer ──
async function findOrCreateCustomer(userId, { name, email, phone }) {
  const existing = await pool.query(
    `SELECT id FROM customers
     WHERE user_id = $1 AND ((email IS NOT NULL AND email <> '' AND email = $2)
                          OR (phone IS NOT NULL AND phone <> '' AND phone = $3))
     ORDER BY id LIMIT 1`,
    [userId, email || null, phone || null]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const created = await pool.query(
    'INSERT INTO customers (user_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, name, email || null, phone || null]
  );
  return created.rows[0].id;
}

// ── Generation ──
async function pickEmployee(userId, serviceId, date, startTime, endTime) {
  const r = await pool.query(
    `SELECT e.id
     FROM employees e
     LEFT JOIN service_employees se ON e.id = se.employee_id
     WHERE e.user_id = $1
       AND e.active = true
       AND (se.service_id = $2 OR NOT EXISTS (SELECT 1 FROM service_employees WHERE employee_id = e.id))
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.employee_id = e.id
           AND b.booking_date = $3
           AND b.status NOT IN ('cancelled', 'no_show')
           AND ((b.start_time <= $4 AND b.end_time > $4)
             OR (b.start_time < $5 AND b.end_time >= $5)
             OR (b.start_time >= $4 AND b.end_time <= $5))
       )
     LIMIT 1`,
    [userId, serviceId, date, startTime, endTime]
  );
  return r.rows[0]?.id || null;
}

/**
 * Create the booking for one slot of a plan. Returns the booking id, or null when the
 * slot already has one (unique index) or the services no longer resolve.
 */
async function createOccurrence(plan, date, ctx) {
  const mains = normalizeServiceList(plan.services?.mains);
  const addons = normalizeServiceList(plan.services?.addons);
  if (!mains.length) return null;

  const resolved = await resolveBookingServices({ userId: plan.user_id, mains, addons });
  const resolvedMains = resolved.filter(s => !s.is_addon);
  if (!resolvedMains.length) return null;

  // A visit that belongs to a billed plan (plan.service_plan_id) is for SCHEDULING ONLY:
  // the customer pays the plan's flat subscription charge in Square, so the visit itself
  // carries $0 — otherwise every visit would also look like money owed (and could be
  // invoiced on top of the subscription). A schedule-only plan with no billing keeps
  // normal pricing.
  const billedByPlan = !!plan.service_plan_id;
  if (billedByPlan) resolved.forEach(s => { s.price = 0; });
  const serviceSubtotal = resolved.reduce((sum, s) => sum + s.price, 0);
  const totals = billedByPlan
    ? { subtotal: 0, taxAmount: 0, total: 0, feeTotal: 0, feeLines: [] }
    : await resolveFeeTotals({ userId: plan.user_id, serviceSubtotal, taxRate: ctx.taxRate });

  const hours = resolved.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
  const [sh, sm] = String(plan.start_time).split(':').map(Number);
  const endMinutes = sh * 60 + sm + Math.round(hours * 60);
  const endTime = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  const startTime = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;

  // A pinned employee is honoured as-is (same as a manual booking). Otherwise pick whoever
  // is free; if nobody is, leave it unassigned for the owner rather than skipping the visit.
  const employeeId = plan.employee_id
    || (plan.group_id ? null : await pickEmployee(plan.user_id, resolvedMains[0].id, date, startTime, endTime));

  const numRes = await pool.query('SELECT generate_booking_number() AS number');

  const ins = await pool.query(
    `INSERT INTO bookings (
       user_id, customer_id, booking_number, booking_date, start_time, end_time,
       subtotal, tax_rate, tax_amount, total_amount, fee_total, fees,
       customer_name, customer_email, customer_phone, customer_notes, status,
       employee_id, group_id, source, customer_address,
       recurring_plan_id, recurring_occurrence_date, payment_status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'confirmed',$17,$18,'recurring',$19,$20,$4,$21)
     ON CONFLICT (recurring_plan_id, recurring_occurrence_date) WHERE recurring_plan_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      plan.user_id, plan.customer_id, numRes.rows[0].number, date, startTime, endTime,
      totals.subtotal, billedByPlan ? 0 : ctx.taxRate, totals.taxAmount, totals.total,
      totals.feeTotal, totals.feeLines.length ? JSON.stringify(totals.feeLines) : null,
      plan.customer_name, plan.customer_email, plan.customer_phone, plan.notes || null,
      employeeId, plan.group_id || null, plan.customer_address || null,
      plan.id, billedByPlan ? 'plan' : 'unpaid',
    ]
  );
  if (!ins.rows.length) return null;
  const bookingId = ins.rows[0].id;

  for (const svc of resolved) {
    await pool.query(
      `INSERT INTO booking_items (
         booking_id, service_id, service_name, service_duration,
         service_price, quantity, subtotal, is_addon, description
       ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)`,
      [bookingId, svc.id, svc.name, svc.duration_hours, svc.price, svc.price, svc.is_addon, svc.description]
    );
  }
  return bookingId;
}

/**
 * Make sure a plan has real bookings for everything inside the horizon, and always at
 * least its next visit (so a yearly plan shows up on the calendar immediately).
 * @returns {Promise<number>} how many bookings were created
 */
async function generateForPlan(planId, { todayOverride } = {}) {
  const planRes = await pool.query('SELECT * FROM recurring_plans WHERE id = $1', [planId]);
  const plan = planRes.rows[0];
  if (!plan || plan.status !== 'active') return 0;

  const tzRes = await pool.query('SELECT state, zip_code FROM business_information WHERE user_id = $1', [plan.user_id]);
  const { getTimezoneForBusiness } = require('./zipToTimezone');
  const tz = getTimezoneForBusiness(tzRes.rows[0]?.state, tzRes.rows[0]?.zip_code);
  const today = todayOverride || todayInTz(tz);
  const horizon = addDays(today, HORIZON_DAYS);

  const taxRes = await pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [plan.user_id]);
  const ctx = { taxRate: parseFloat(taxRes.rows[0]?.default_tax_rate || 0) };

  const anchor = toYmd(plan.start_date);
  const endDate = plan.end_date ? toYmd(plan.end_date) : null;
  const skipped = new Set((plan.skipped_dates || []).map(d => toYmd(d)));

  let created = 0;
  let futureSeen = 0;
  for (let n = 0; n < 400 && created < MAX_OCCURRENCES_PER_RUN; n++) {
    const date = occurrenceDate(anchor, plan.frequency, n);
    if (endDate && date > endDate) break;
    if (date < today) continue;               // never backfill the past
    if (date > horizon && futureSeen >= 1) break;
    futureSeen++;
    if (skipped.has(date)) continue;
    try {
      if (await createOccurrence(plan, date, ctx)) created++;
    } catch (e) {
      console.error(`[recurring] plan ${plan.id} ${date}:`, e.message);
    }
  }
  return created;
}

/** Nightly top-up across every active plan. */
async function topUpAllPlans() {
  const r = await pool.query("SELECT id FROM recurring_plans WHERE status = 'active'");
  let total = 0;
  for (const { id } of r.rows) {
    try { total += await generateForPlan(id); } catch (e) { console.error(`[recurring] plan ${id}:`, e.message); }
  }
  if (total) console.log(`✅ Recurring top-up: ${total} booking(s) created across ${r.rows.length} plan(s)`);
  return total;
}

/**
 * Remove a plan's upcoming visits that nobody has touched (still just 'confirmed', no
 * invoice). Anything already invoiced / started / completed is left alone — cancelled
 * rather than deleted when it has an invoice attached.
 */
async function clearUpcoming(planId, userId, fromYmd) {
  const upcoming = await pool.query(
    `SELECT id, invoice_id FROM bookings
     WHERE recurring_plan_id = $1 AND user_id = $2 AND booking_date >= $3 AND status = 'confirmed'`,
    [planId, userId, fromYmd]
  );
  for (const b of upcoming.rows) {
    if (b.invoice_id) {
      await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [b.id]);
    } else {
      await pool.query('DELETE FROM booking_items WHERE booking_id = $1', [b.id]);
      await pool.query('UPDATE sms_messages SET booking_id = NULL WHERE booking_id = $1', [b.id]);
      await pool.query('DELETE FROM bookings WHERE id = $1', [b.id]);
    }
  }
  return upcoming.rows.length;
}

module.exports = {
  FREQUENCIES, HORIZON_DAYS, toYmd,
  occurrenceDate, todayInTz, addDays,
  geocodeAddress, findOrCreateCustomer,
  generateForPlan, topUpAllPlans, clearUpcoming, pickEmployee,
};
