// The one place a recurring plan gets created. Both the dashboard booking form
// (routes/recurring.js) and the public online-booking sign-up (routes/public.js) call this,
// so the rules — validation, Square readiness, schedule generation, the card-link email —
// cannot drift between the two doors.

const { pool } = require('../config/database');
const { validateCustomerContact } = require('./customerContact');
const { normalizeServiceList, resolveBookingServices } = require('./bookingServices');
const { getTimezoneForBusiness } = require('./zipToTimezone');
const {
  FREQUENCIES, todayInTz, geocodeAddress, findOrCreateCustomer, generateForPlan, pickEmployee,
} = require('./recurringBookings');
const planBilling = require('./planBilling');
const { TRANSACTIONAL_EMAIL, ownerAlertReplyTo } = require('./emailFrom');
const { escapeHtml: esc } = require('./escapeHtml');
const { plainEmail } = require('./emailLayout');
const { sendPushToOwner } = require('./pushNotifications');
const { sendBookingEmails } = require('./bookingEmail');

const fmtLong = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtTime = (hm) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

/**
 * Same confirmations a normal booking sends — the customer's confirmation and the owner's
 * new-booking email (utils/bookingEmail) plus the owner push — for the plan's FIRST visit,
 * with the next few dates in the notes so the customer sees what is coming. Later visits
 * need nothing here: they are ordinary bookings, so the reminder crons (email + SMS) and
 * review requests pick them up on their own.
 * Never throws: a notification failure must not undo a created plan.
 */
async function notifyNewPlan({ userId, planId, contact, address, servicePlan, freq, startTime, bookingsCreated, usesSavedCard, cardLinkSent, cardLinkError, source }) {
  try {
    const visits = (await pool.query(
      `SELECT b.booking_number, to_char(b.booking_date, 'YYYY-MM-DD') AS d, b.start_time, b.end_time,
              (SELECT string_agg(bi.service_name, ' + ' ORDER BY bi.is_addon NULLS FIRST, bi.id)
                 FROM booking_items bi WHERE bi.booking_id = b.id) AS services
       FROM bookings b WHERE b.recurring_plan_id = $1 AND b.status <> 'cancelled'
       ORDER BY b.booking_date LIMIT 4`, [planId])).rows;
    const first = visits[0];
    const label = FREQUENCIES[freq]?.label || freq;

    if (first) {
      const planLine = servicePlan
        ? `Recurring plan: ${servicePlan.name} (${label}) — $${Number(servicePlan.price).toFixed(2)} per ${servicePlan.billing_period || 'month'}, one charge covers all visits.`
        : `Recurring: ${label}.`;
      const next = visits.slice(1).map(v => fmtLong(v.d)).join('; ');
      await sendBookingEmails({
        userId,
        bookingNumber: first.booking_number,
        customerName: contact.name,
        customerEmail: contact.email,
        customerPhone: contact.phone,
        serviceName: first.services || (servicePlan ? servicePlan.name : 'Service'),
        bookingDate: first.d,
        startTime: String(first.start_time).slice(0, 5),
        endTime: first.end_time ? String(first.end_time).slice(0, 5) : null,
        subtotal: 0,
        total: 0,
        location: address || undefined,
        notes: [planLine, next ? `Next visits: ${next}` : null, source === 'online' ? 'Booked online.' : null].filter(Boolean).join(' '),
      });
    }

    // Billing needs the owner's attention only when the card link did not go out.
    if (cardLinkError && process.env.SENDGRID_API_KEY) {
      const owner = (await pool.query('SELECT email FROM users WHERE id = $1', [userId])).rows[0];
      if (owner?.email) {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        await sgMail.send({
          to: owner.email,
          from: { name: 'SORCE Notifications', email: TRANSACTIONAL_EMAIL },
          replyTo: ownerAlertReplyTo(contact.email, contact.name),
          subject: `Action needed: card link not sent to ${contact.name}`,
          html: plainEmail({
            paragraphs: [
              `<strong>${esc(contact.name)}</strong>'s recurring plan was created and ${bookingsCreated} visit(s) are on your schedule, but the card link could not be sent: ${esc(cardLinkError)}`,
              'Open the Recurring tab and use "Resend card link" once that is fixed. Nothing is being charged until they save a card.',
            ],
          }),
        });
      }
    }

    await sendPushToOwner(userId, 'New Recurring Customer',
      `${contact.name} — ${servicePlan ? servicePlan.name : label}${first ? `, first visit ${first.d} at ${fmtTime(String(first.start_time).slice(0, 5))}` : ''}`,
      { type: 'new_recurring_plan' }
    );
  } catch (e) {
    console.error('[recurring] new-plan notifications failed:', e.message);
  }
}

class PlanError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHm = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

async function businessToday(userId) {
  const r = await pool.query('SELECT state, zip_code FROM business_information WHERE user_id = $1', [userId]);
  return todayInTz(getTimezoneForBusiness(r.rows[0]?.state, r.rows[0]?.zip_code));
}

/**
 * @param {number} userId business owner
 * @param {object} input {servicePlanId?, frequency?, mainServices?, additionalServices?,
 *   startDate, endDate?, startTime, customerInfo, notes?, employeeId?, groupId?}
 *   With servicePlanId, the catalog plan decides frequency, services and price.
 * @returns {Promise<{planId, bookingsCreated, located, cardLinkSent, cardLinkError, billed}>}
 */
async function createRecurringPlan(userId, input) {
  const {
    frequency, startDate, endDate, startTime, customerInfo, notes,
    employeeId, groupId, mainServices, additionalServices, servicePlanId, source,
  } = input;

  let servicePlan = null;
  if (servicePlanId) {
    const spRes = await pool.query('SELECT * FROM service_plans WHERE id = $1 AND user_id = $2 AND active = true', [servicePlanId, userId]);
    servicePlan = spRes.rows[0];
    if (!servicePlan) throw new PlanError(404, 'That plan is no longer available');
  }
  const freq = servicePlan ? servicePlan.frequency : frequency;

  if (!FREQUENCIES[freq]) throw new PlanError(400, 'Choose how often this repeats');
  if (!isYmd(startDate) || !isHm(startTime) || !customerInfo) throw new PlanError(400, 'Missing required fields');
  if (endDate && (!isYmd(endDate) || endDate < startDate)) throw new PlanError(400, 'End date must be after the first visit');
  if (startDate < await businessToday(userId)) throw new PlanError(400, 'First visit cannot be in the past');

  const mains = normalizeServiceList(servicePlan ? servicePlan.services?.mains : mainServices);
  const addons = normalizeServiceList(servicePlan ? servicePlan.services?.addons : additionalServices);
  if (!mains.length) throw new PlanError(400, 'Pick at least one service');

  const contact = validateCustomerContact(customerInfo);
  if (!contact.ok) throw new PlanError(400, contact.error);

  // Fail BEFORE anything is created if Square can't take subscriptions (not connected, or
  // connected without the subscription permission): the owner can fix that on the spot, and
  // a customer never receives a card link that cannot work.
  if (servicePlan) {
    try {
      await planBilling.ensureSquareVariation(userId, servicePlan);
    } catch (e) {
      throw new PlanError(e.code === 'SQUARE_RECONNECT' ? 409 : 400, e.message, e.code);
    }
  }

  const resolved = await resolveBookingServices({ userId, mains, addons });
  if (!resolved.some(s => !s.is_addon)) throw new PlanError(404, 'Service not found');

  const address = (typeof customerInfo.address === 'string' && customerInfo.address.trim()) || null;
  const customerId = await findOrCreateCustomer(userId, contact);
  const geo = address ? await geocodeAddress(address, userId) : null;

  const ins = await pool.query(
    `INSERT INTO recurring_plans (
       user_id, customer_id, customer_name, customer_email, customer_phone, customer_address,
       lat, lng, frequency, start_date, end_date, start_time, employee_id, group_id, services, notes,
       service_plan_id, price_cents, billing_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      userId, customerId, contact.name, contact.email, contact.phone, address,
      geo?.lat ?? null, geo?.lng ?? null, freq, startDate, endDate || null, startTime,
      employeeId || null, groupId || null, JSON.stringify({ mains, addons }), notes || null,
      servicePlan ? servicePlan.id : null,
      servicePlan ? planBilling.cents(servicePlan.price) : null,
      servicePlan ? 'awaiting_card' : 'none',
    ]
  );
  const planId = ins.rows[0].id;
  const bookingsCreated = await generateForPlan(planId);

  let cardLinkSent = false;
  let cardLinkError = null;
  let usesSavedCard = false;
  if (servicePlan) {
    try { usesSavedCard = (await planBilling.sendPlanCardLink(planId)).usesSavedCard; cardLinkSent = true; }
    catch (e) { cardLinkError = e.message; console.error('[recurring] card link failed:', e.message); }
  }
  notifyNewPlan({
    userId, planId, contact, address, servicePlan: servicePlan ? { ...servicePlan, billing_period: FREQUENCIES[freq].cadence === 'ANNUAL' ? 'year' : FREQUENCIES[freq].cadence === 'QUARTERLY' ? 'quarter' : 'month' } : null,
    freq, startTime, bookingsCreated, usesSavedCard, cardLinkSent, cardLinkError, source,
  });
  return { planId, bookingsCreated, located: !!geo, cardLinkSent, cardLinkError, usesSavedCard, billed: !!servicePlan };
}

/**
 * Public sign-ups pick their own first visit, so (unlike the owner on the dashboard) it
 * must be a time the business is open and someone is free. Later visits are not checked
 * here: they are placed by the schedule and left unassigned if nobody is free that day.
 */
async function assertFirstVisitAvailable(userId, servicePlan, date, startTime) {
  if (!isYmd(date) || !isHm(startTime)) throw new PlanError(400, 'Choose a date and time for the first visit');
  const resolved = await resolveBookingServices({
    userId,
    mains: normalizeServiceList(servicePlan.services?.mains),
    addons: normalizeServiceList(servicePlan.services?.addons),
  });
  const hours = resolved.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
  const [sh, sm] = startTime.split(':').map(Number);
  const endMin = sh * 60 + sm + Math.round(hours * 60);
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

  const dow = new Date(`${date}T12:00:00`).getDay();
  const bh = await pool.query('SELECT is_open, open_time, close_time FROM business_hours WHERE user_id = $1 AND day_of_week = $2', [userId, dow]);
  const h = bh.rows[0];
  if (!h || !h.is_open) throw new PlanError(409, 'We are closed that day — please pick another date.');
  const hhmm = (t) => String(t).slice(0, 5);
  if (startTime < hhmm(h.open_time) || endTime > hhmm(h.close_time)) {
    throw new PlanError(409, 'That time is outside our hours — please pick another time.');
  }
  const free = await pickEmployee(userId, resolved.find(s => !s.is_addon)?.id, date, startTime, endTime);
  if (!free) throw new PlanError(409, 'That time was just taken — please pick another.');
}

module.exports = { createRecurringPlan, PlanError, businessToday, assertFirstVisitAvailable };
