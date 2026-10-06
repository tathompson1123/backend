// Moves every active Pro subscription from the old price to $250/mo.
//
//   node scripts/migrate-pro-to-250.js           # DRY RUN: lists what would change
//   node scripts/migrate-pro-to-250.js --apply   # actually updates Stripe
//
// This changes what real customers are charged, so it never runs on its own and
// defaults to a dry run. Prorations are off: the new price applies from the next
// renewal, not mid-cycle. Trialing subs are updated too, so they convert at $250.
// Scale (custom-quoted) subscriptions are skipped by design.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');

const NEW_AMOUNT = parseInt(process.env.PLAN_AMOUNT_PRO || '25000', 10);
const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

(async () => {
  const { rows } = await pool.query(
    `SELECT id, email, stripe_subscription_id FROM users
      WHERE stripe_subscription_id IS NOT NULL AND (plan = 'pro' OR base_plan = 'pro')
      ORDER BY id`
  );
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} Pro subscribers, target $${(NEW_AMOUNT / 100).toFixed(2)}/mo\n`);

  let price = null;
  let changed = 0;
  for (const u of rows) {
    try {
      const sub = await stripe.subscriptions.retrieve(u.stripe_subscription_id);
      if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
        console.log(`skip  #${u.id} ${u.email}: status ${sub.status}`); continue;
      }
      const item = sub.items.data[0];
      const current = item?.price?.unit_amount;
      if (current === NEW_AMOUNT) { console.log(`ok    #${u.id} ${u.email}: already $${NEW_AMOUNT / 100}`); continue; }
      if (sub.items.data.length !== 1) { console.log(`skip  #${u.id} ${u.email}: ${sub.items.data.length} items, review by hand`); continue; }

      console.log(`${APPLY ? 'move ' : 'would'} #${u.id} ${u.email}: $${(current / 100).toFixed(2)} -> $${(NEW_AMOUNT / 100).toFixed(2)} (${sub.status})`);
      if (APPLY) {
        if (!price) {
          price = await stripe.prices.create({
            currency: 'usd', unit_amount: NEW_AMOUNT, recurring: { interval: 'month' },
            product_data: { name: 'Pro Plan' },
          });
        }
        await stripe.subscriptions.update(sub.id, {
          items: [{ id: item.id, price: price.id }],
          proration_behavior: 'none',
          metadata: { ...sub.metadata, plan: 'pro' },
        });
        changed++;
      }
    } catch (e) {
      console.log(`FAIL  #${u.id} ${u.email}: ${e.message}`);
    }
  }
  console.log(`\n${APPLY ? `Updated ${changed}` : 'Nothing changed (dry run). Re-run with --apply to execute.'}`);
  await pool.end();
})();
