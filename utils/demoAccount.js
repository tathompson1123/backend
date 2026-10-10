// Demo accounts: what they're filled with, and how they become real.
//
// A demo account is built from a discovery-call booking. Everything in it is example or
// default — a service guessed from what the prospect told us, an example location, the
// prospect themself as the one real contact (so a text/email blast demo lands on their
// own phone and inbox) — until payment is collected and the account is converted.
// Seeded rows are flagged is_example so conversion can remove exactly them and nothing
// else the rep added by hand during the call.

const { pool } = require('../config/database');

// Example location until they give us a real one (Thompson's home market).
const DEFAULT_LOCATION = { address: '123 Example St', city: 'Olympia', state: 'WA', zip: '98501' };

// First keyword match wins. Name/price/duration are plausible examples, not promises.
const SERVICE_GUESSES = [
  { re: /detail|auto|car wash|ceramic|tint|wrap|ppf|mobile detail/i, name: 'Full Interior & Exterior Detail', description: 'Complete wash, clay, polish and interior deep clean.', price: 249, hours: 3 },
  { re: /landscap|lawn|mow|yard|garden|tree|irrigation/i, name: 'Weekly Lawn Maintenance', description: 'Mowing, edging, blowing and cleanup.', price: 65, hours: 1 },
  { re: /hvac|heating|cooling|air condition|furnace|a\/c/i, name: 'AC Tune-Up & Inspection', description: 'Full system inspection, cleaning and performance check.', price: 129, hours: 1.5 },
  { re: /plumb|drain|water heater|pipe/i, name: 'Plumbing Inspection & Repair', description: 'Diagnose and fix leaks, clogs and fixture issues.', price: 149, hours: 1.5 },
  { re: /electric/i, name: 'Electrical Safety Inspection', description: 'Panel, outlet and wiring safety check.', price: 139, hours: 1.5 },
  { re: /clean|maid|janitor|carpet|pressure wash|power wash|window/i, name: 'Standard Cleaning', description: 'Thorough top-to-bottom cleaning.', price: 159, hours: 2.5 },
  { re: /roof|gutter|siding/i, name: 'Roof & Gutter Inspection', description: 'Inspection with a written estimate.', price: 99, hours: 1 },
  { re: /paint/i, name: 'Interior Painting Estimate', description: 'On-site walkthrough and quote.', price: 0, hours: 1 },
  { re: /pest|exterminat/i, name: 'General Pest Treatment', description: 'Interior and exterior treatment.', price: 119, hours: 1 },
  { re: /barber|salon|hair|nail|spa|massage|lash|brow/i, name: 'Signature Appointment', description: 'Our most popular service.', price: 75, hours: 1 },
];
const GENERIC_SERVICE = { name: 'Standard Service', description: 'Example service — replace with what you actually offer.', price: 150, hours: 1 };

pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS is_example BOOLEAN DEFAULT FALSE`)
  .then(() => pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_example BOOLEAN DEFAULT FALSE`))
  .catch(e => console.error('is_example migration error:', e.message));

function guessService(text) {
  return SERVICE_GUESSES.find(g => g.re.test(text)) || GENERIC_SERVICE;
}

// Everything the prospect told us about their business, from the booking form and the
// qualifying quiz if they went through it.
async function describeProspect(call) {
  const lead = (await pool.query(
    `SELECT industry, notes FROM sorce_leads WHERE discovery_call_id = $1 ORDER BY id DESC LIMIT 1`,
    [call.id]
  ).catch(() => ({ rows: [] }))).rows[0];
  return [lead?.industry, call.company, call.notes, lead?.notes].filter(Boolean).join(' ');
}

async function seedDemoAccount(userId, call) {
  // Location: example until they give a real one.
  await pool.query(
    `INSERT INTO business_information (user_id, phone, email, address, city, state, zip_code, center_zip_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, call.phone || '', call.email || '', DEFAULT_LOCATION.address,
     DEFAULT_LOCATION.city, DEFAULT_LOCATION.state, DEFAULT_LOCATION.zip]
  );

  // One example service guessed from what they entered.
  const svc = guessService(await describeProspect(call));
  await pool.query(
    `INSERT INTO services (user_id, name, description, duration_hours, price, location_type, is_example)
     VALUES ($1, $2, $3, $4, $5, 'business_address', TRUE)`,
    [userId, svc.name, svc.description, svc.hours, svc.price]
  );

  // The prospect is the one real contact, so a campaign demo reaches them. Two sample
  // names with no phone or email fill out the list without ever being messaged.
  const contacts = [
    [call.name, call.email || null, call.phone || null],
    ['Sample Customer', null, null],
    ['Example Client', null, null],
  ];
  for (const [name, email, phone] of contacts) {
    await pool.query(
      `INSERT INTO customers (user_id, name, email, phone, is_example) VALUES ($1, $2, $3, $4, TRUE)`,
      [userId, name, email, phone]
    );
  }
}

// Turn a demo account into a real one: lift the demo limits and remove everything that
// was only example data. Safe to run twice. Called by the "Convert" button and by the
// payment webhook, so a customer who pays through Stripe converts without anyone clicking.
async function convertDemoAccount(userId) {
  const u = (await pool.query(
    `SELECT is_demo, twilio_phone_sid, twilio_phone_number FROM users WHERE id = $1`, [userId]
  )).rows[0];
  if (!u) return { converted: false, reason: 'not_found' };
  if (!u.is_demo) return { converted: false, reason: 'already_real' };

  await pool.query(`DELETE FROM services WHERE user_id = $1 AND is_example = TRUE`, [userId]);
  await pool.query(`DELETE FROM customers WHERE user_id = $1 AND is_example = TRUE`, [userId]);
  // Blank the example location only if it's still the placeholder, so a real address the
  // rep typed in during the call survives.
  await pool.query(
    `UPDATE business_information
        SET address = '', city = '', state = '', zip_code = '', center_zip_code = ''
      WHERE user_id = $1 AND address = $2 AND zip_code = $3`,
    [userId, DEFAULT_LOCATION.address, DEFAULT_LOCATION.zip]
  );
  await pool.query(`UPDATE users SET is_demo = FALSE WHERE id = $1`, [userId]);

  // Still on the shared demo number — a dedicated one is bought on first payment.
  return { converted: true, needsDedicatedNumber: !u.twilio_phone_sid };
}

module.exports = { seedDemoAccount, convertDemoAccount, DEFAULT_LOCATION };
