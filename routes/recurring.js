const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { validateCustomerContact } = require('../utils/customerContact');
const { normalizeServiceList, resolveBookingServices } = require('../utils/bookingServices');
const {
  FREQUENCIES, occurrenceDate, todayInTz, geocodeAddress, findOrCreateCustomer, toYmd,
  generateForPlan, clearUpcoming,
} = require('../utils/recurringBookings');
const planBilling = require('../utils/planBilling');
const { createRecurringPlan, PlanError } = require('../utils/createRecurringPlan');
const { getTimezoneForBusiness } = require('../utils/zipToTimezone');

async function businessToday(userId) {
  try {
    const r = await pool.query('SELECT state, zip_code FROM business_information WHERE user_id = $1', [userId]);
    return todayInTz(getTimezoneForBusiness(r.rows[0]?.state, r.rows[0]?.zip_code));
  } catch {
    return todayInTz('America/New_York');
  }
}

const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHm = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

// GET - every plan with its schedule, for the Recurring tab and its map.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const today = await businessToday(userId);

    const plans = await pool.query(
      `SELECT p.*,
         COALESCE((
           SELECT json_agg(json_build_object('id', b.id, 'date', to_char(b.booking_date, 'YYYY-MM-DD'),
                                             'start_time', b.start_time, 'status', b.status,
                                             'total', b.total_amount) ORDER BY b.booking_date)
           FROM (SELECT * FROM bookings
                 WHERE recurring_plan_id = p.id AND booking_date >= $2 AND status NOT IN ('cancelled','no_show')
                 ORDER BY booking_date LIMIT 4) b
         ), '[]'::json) AS upcoming,
         (SELECT COUNT(*)::int FROM bookings WHERE recurring_plan_id = p.id AND status = 'completed') AS completed_count,
         e.name AS employee_name,
         sp.name AS plan_name, sp.price AS plan_catalog_price
       FROM recurring_plans p
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN service_plans sp ON sp.id = p.service_plan_id
       WHERE p.user_id = $1 AND p.status <> 'cancelled'
       ORDER BY p.created_at DESC`,
      [userId, today]
    );

    await planBilling.syncBillingStatuses(userId, plans.rows);

    // Price + service names come from the services JSON so a paused plan (no upcoming
    // bookings) still shows what it is.
    const out = [];
    for (const p of plans.rows) {
      let serviceNames = [];
      let perVisit = null;
      try {
        const resolved = await resolveBookingServices({
          userId,
          mains: normalizeServiceList(p.services?.mains),
          addons: normalizeServiceList(p.services?.addons),
        });
        serviceNames = resolved.map(s => s.name);
        perVisit = resolved.reduce((sum, s) => sum + s.price, 0);
      } catch { /* a deleted service shouldn't break the whole list */ }
      const startDow = new Date(`${toYmd(p.start_date)}T00:00:00Z`).getUTCDay();
      out.push({
        id: p.id,
        customer_id: p.customer_id,
        customer_name: p.customer_name,
        customer_email: p.customer_email,
        customer_phone: p.customer_phone,
        customer_address: p.customer_address,
        lat: p.lat !== null ? Number(p.lat) : null,
        lng: p.lng !== null ? Number(p.lng) : null,
        frequency: p.frequency,
        frequency_label: FREQUENCIES[p.frequency]?.label || p.frequency,
        weekday: startDow,
        start_time: p.start_time,
        start_date: toYmd(p.start_date),
        end_date: p.end_date ? toYmd(p.end_date) : null,
        status: p.status,
        notes: p.notes,
        employee_id: p.employee_id,
        employee_name: p.employee_name,
        group_id: p.group_id,
        service_names: serviceNames,
        per_visit: perVisit,
        // Billed plans: one flat charge per period, pinned at sign-up. per_visit is then
        // only what the visit would cost on its own — not what the customer pays.
        billed: !!p.service_plan_id,
        service_plan_id: p.service_plan_id,
        plan_name: p.plan_name,
        plan_price: p.service_plan_id
          ? (p.price_cents ? p.price_cents / 100 : Number(p.plan_catalog_price))
          : null,
        billing_period: FREQUENCIES[p.frequency]?.cadence === 'ANNUAL' ? 'year'
          : FREQUENCIES[p.frequency]?.cadence === 'QUARTERLY' ? 'quarter' : 'month',
        billing_status: p.billing_status,
        billing_error: p.billing_error,
        has_card: !!p.square_card_id,
        upcoming: p.upcoming,
        next_date: p.upcoming[0]?.date || null,
        completed_count: p.completed_count,
      });
    }
    res.json({ plans: out });
  } catch (error) {
    console.error('Error fetching recurring plans:', error.message);
    res.status(500).json({ error: 'Failed to fetch recurring plans' });
  }
});

// POST - create a plan and put its visits on the schedule immediately. With servicePlanId
// the customer is also put on that catalog plan: a Square subscription starts once they
// save a card (link emailed here).
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const result = await createRecurringPlan(req.user.userId, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof PlanError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('Error creating recurring plan:', error.message);
    res.status(500).json({ error: 'Failed to create recurring booking' });
  }
});

// PUT - change a plan. Upcoming untouched visits are rebuilt from the new settings.
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const planRes = await pool.query('SELECT * FROM recurring_plans WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    const plan = planRes.rows[0];
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const b = req.body;
    if (plan.service_plan_id && (b.frequency && b.frequency !== plan.frequency || b.mainServices)) {
      return res.status(400).json({ error: 'This customer is on a billed plan. To change their plan, stop it and set them up on the new one.' });
    }
    if (b.frequency !== undefined && !FREQUENCIES[b.frequency]) return res.status(400).json({ error: 'Invalid frequency' });
    if (b.startTime !== undefined && !isHm(b.startTime)) return res.status(400).json({ error: 'Invalid start time' });
    if (b.endDate && !isYmd(b.endDate)) return res.status(400).json({ error: 'Invalid end date' });
    if (b.startDate !== undefined && !isYmd(b.startDate)) return res.status(400).json({ error: 'Invalid start date' });

    const today = await businessToday(userId);

    // Re-anchor on the next real visit when the cadence changes, so "monthly" -> "every
    // 2 months" counts from the upcoming visit and not from a first visit long ago.
    let startDate = toYmd(plan.start_date);
    if (b.startDate) {
      if (b.startDate < today) return res.status(400).json({ error: 'Next visit cannot be in the past' });
      startDate = b.startDate;
    } else if (b.frequency && b.frequency !== plan.frequency) {
      const next = await pool.query(
        `SELECT to_char(MIN(booking_date), 'YYYY-MM-DD') AS d FROM bookings
         WHERE recurring_plan_id = $1 AND booking_date >= $2 AND status = 'confirmed'`,
        [plan.id, today]
      );
      startDate = next.rows[0].d || (startDate >= today ? startDate : today);
    }

    let { customer_address: address, lat, lng } = plan;
    if (b.address !== undefined && ((b.address || '').trim() !== (plan.customer_address || '') || b.regeocode)) {
      address = (b.address || '').trim() || null;
      const geo = address ? await geocodeAddress(address, userId) : null;
      lat = geo?.lat ?? null;
      lng = geo?.lng ?? null;
    }

    // Contact / address edits don't touch the schedule: update the plan and its upcoming visits
    // in place so deleted-visit skips and other customised visits survive.
    const scheduleKeys = ['frequency', 'startDate', 'startTime', 'endDate', 'employeeId', 'groupId', 'mainServices', 'additionalServices', 'notes'];
    if (!scheduleKeys.some(k => b[k] !== undefined)) {
      const name = b.name !== undefined ? String(b.name).trim().slice(0, 200) : plan.customer_name;
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const email = b.email !== undefined ? (String(b.email).trim().slice(0, 200) || null) : plan.customer_email;
      const phone = b.phone !== undefined ? (String(b.phone).trim().slice(0, 40) || null) : plan.customer_phone;
      await pool.query(
        `UPDATE recurring_plans SET customer_name = $1, customer_email = $2, customer_phone = $3,
           customer_address = $4, lat = $5, lng = $6, updated_at = NOW() WHERE id = $7`,
        [name, email, phone, address, lat, lng, plan.id]
      );
      await pool.query(
        `UPDATE bookings SET customer_name = $1, customer_email = $2, customer_phone = $3, customer_address = $4
         WHERE recurring_plan_id = $5 AND user_id = $6 AND status = 'confirmed' AND booking_date >= $7`,
        [name, email, phone, address, plan.id, userId, today]
      );
      return res.json({ success: true, bookingsCreated: 0, located: !address || (lat != null && lng != null) });
    }

    let services = plan.services;
    if (b.mainServices) {
      const mains = normalizeServiceList(b.mainServices);
      if (!mains.length) return res.status(400).json({ error: 'Pick at least one service' });
      services = { mains, addons: normalizeServiceList(b.additionalServices) };
    }

    // Clear BEFORE rewriting the anchor so the rebuilt schedule can't collide with it.
    await clearUpcoming(plan.id, userId, today);

    await pool.query(
      `UPDATE recurring_plans SET
         frequency = $1, start_date = $2, end_date = $3, start_time = $4, employee_id = $5, group_id = $6,
         notes = $7, customer_address = $8, lat = $9, lng = $10, services = $11, updated_at = NOW()
       WHERE id = $12`,
      [
        b.frequency || plan.frequency, startDate,
        b.endDate !== undefined ? (b.endDate || null) : plan.end_date,
        b.startTime || plan.start_time,
        b.employeeId !== undefined ? (b.employeeId || null) : plan.employee_id,
        b.groupId !== undefined ? (b.groupId || null) : plan.group_id,
        b.notes !== undefined ? b.notes : plan.notes,
        address, lat, lng, JSON.stringify(services), plan.id,
      ]
    );
    // The skip list belongs to the old schedule; a rebuilt one starts clean.
    await pool.query('UPDATE recurring_plans SET skipped_dates = ARRAY[]::date[] WHERE id = $1', [plan.id]);

    const created = await generateForPlan(plan.id);
    res.json({ success: true, bookingsCreated: created });
  } catch (error) {
    console.error('Error updating recurring plan:', error.message);
    res.status(500).json({ error: 'Failed to update recurring booking' });
  }
});

// PATCH - pause / resume / cancel.
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status } = req.body;
    if (!['active', 'paused', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const planRes = await pool.query('SELECT * FROM recurring_plans WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    const plan = planRes.rows[0];
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const today = await businessToday(userId);
    let removed = 0;
    let created = 0;

    // Billing moves first. If Square refuses, nothing else changes — stopping the schedule
    // while the card keeps getting charged (or the reverse) is the worst outcome here.
    if (plan.service_plan_id && plan.square_subscription_id) {
      const action = status === 'paused' ? 'pause' : status === 'cancelled' ? 'cancel' : 'resume';
      try {
        await planBilling.changeSubscription(userId, plan.square_subscription_id, action);
      } catch (e) {
        return res.status(502).json({ error: `Square: ${e.message}` });
      }
      await pool.query('UPDATE recurring_plans SET billing_status = $1 WHERE id = $2',
        [status === 'paused' ? 'paused' : status === 'cancelled' ? 'canceled' : 'active', plan.id]);
    } else if (plan.service_plan_id && status === 'cancelled') {
      await pool.query("UPDATE recurring_plans SET billing_status = 'canceled' WHERE id = $1", [plan.id]);
    }

    if (status === 'active') {
      // Resume from the next real visit in the pattern, not from visits missed while paused.
      await pool.query("UPDATE recurring_plans SET status = 'active', skipped_dates = ARRAY[]::date[], updated_at = NOW() WHERE id = $1", [plan.id]);
      created = await generateForPlan(plan.id);
    } else {
      removed = await clearUpcoming(plan.id, userId, today);
      await pool.query('UPDATE recurring_plans SET status = $1, updated_at = NOW() WHERE id = $2', [status, plan.id]);
    }
    res.json({ success: true, removed, created });
  } catch (error) {
    console.error('Error changing recurring plan status:', error.message);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// POST - (re)send the card link for a billed plan
router.post('/:id/send-card-link', authenticateToken, async (req, res) => {
  try {
    const own = await pool.query('SELECT id, service_plan_id, square_subscription_id FROM recurring_plans WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (!own.rows[0]?.service_plan_id) return res.status(404).json({ error: 'Billed plan not found' });
    if (own.rows[0].square_subscription_id) return res.status(400).json({ error: 'Billing is already running for this plan' });
    await planBilling.sendPlanCardLink(own.rows[0].id);
    res.json({ success: true });
  } catch (e) {
    console.error('Error sending plan card link:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// POST - retry starting the subscription from the card already saved (after a failure)
router.post('/:id/start-billing', authenticateToken, async (req, res) => {
  try {
    const own = await pool.query('SELECT id, service_plan_id FROM recurring_plans WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (!own.rows[0]?.service_plan_id) return res.status(404).json({ error: 'Billed plan not found' });
    const r = await planBilling.startSubscription(own.rows[0].id);
    res.json({ success: true, ...r });
  } catch (e) {
    console.error('Error starting plan billing:', e.message);
    res.status(e.code === 'SQUARE_RECONNECT' ? 409 : 400).json({ error: e.message, code: e.code });
  }
});

module.exports = router;
