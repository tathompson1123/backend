// Moves every running plan subscription onto a Square variation priced with sales tax.
// Subscriptions started before tax was added still bill the bare plan price.
//
//   node scripts/migrate-plans-add-tax.js           # DRY RUN: lists what would change
//   node scripts/migrate-plans-add-tax.js --apply   # swaps the subscriptions in Square
//
// This changes what real customers are charged, so it never runs on its own and defaults
// to a dry run. Square's SWAP_PLAN takes effect at the start of the next billing period:
// nothing is charged mid-cycle. Each customer keeps the price they agreed to
// (recurring_plans.price_cents) with the owner's sales tax on top. Safe to re-run: a
// subscription already on its taxed variation is skipped.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/database');
const planBilling = require('../utils/planBilling');
const { getSquareClient } = require('../utils/squareCardOnFile');

const APPLY = process.argv.includes('--apply');
const money = (c) => `$${(c / 100).toFixed(2)}`;

(async () => {
  const { rows } = await pool.query(
    `SELECT rp.id, rp.user_id, rp.customer_name, rp.price_cents, rp.square_subscription_id,
            rp.square_plan_variation_id AS current_variation, rp.billing_status,
            sp.id AS sp_id, sp.name AS sp_name, sp.price AS sp_price, sp.frequency AS sp_frequency,
            sp.square_plan_id, sp.square_plan_variation_id, sp.square_price_cents, sp.square_cadence
     FROM recurring_plans rp JOIN service_plans sp ON sp.id = rp.service_plan_id
     WHERE rp.square_subscription_id IS NOT NULL AND rp.billing_status IN ('active', 'paused')
     ORDER BY rp.user_id, rp.id`
  );
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} running plan subscriptions\n`);

  const variations = new Map(); // one Square variation per (user, plan, price), not per customer
  let changed = 0;
  for (const rp of rows) {
    const rate = await planBilling.getTaxRate(rp.user_id);
    const baseCents = rp.price_cents || planBilling.cents(rp.sp_price);
    const taxCents = Math.round(baseCents * rate);
    const label = `#${rp.id} ${rp.customer_name} (${rp.sp_name}): ${money(baseCents)} -> ${money(baseCents + taxCents)}`;
    if (!taxCents) { console.log(`skip   ${label}  (no tax rate set)`); continue; }
    if (!APPLY) { console.log(`would  ${label}  (${+(rate * 100).toFixed(3)}% tax)`); changed++; continue; }

    try {
      const vKey = `${rp.user_id}|${rp.sp_id}|${baseCents}`;
      if (!variations.has(vKey)) {
        const priceChanged = baseCents !== planBilling.cents(rp.sp_price);
        variations.set(vKey, await planBilling.ensureSquareVariation(rp.user_id, {
          id: rp.sp_id, name: rp.sp_name, price: baseCents / 100, frequency: rp.sp_frequency,
          square_plan_id: rp.square_plan_id, square_plan_variation_id: rp.square_plan_variation_id,
          square_price_cents: rp.square_price_cents, square_cadence: rp.square_cadence,
        }, { persist: !priceChanged }));
      }
      const variationId = variations.get(vKey);
      if (variationId === rp.current_variation) { console.log(`skip   ${label}  (already taxed)`); continue; }

      const { client } = await getSquareClient(rp.user_id);
      await client.subscriptionsApi.swapPlan(rp.square_subscription_id, { newPlanVariationId: variationId });
      await pool.query('UPDATE recurring_plans SET square_plan_variation_id = $1, updated_at = NOW() WHERE id = $2', [variationId, rp.id]);
      console.log(`done   ${label}`);
      changed++;
    } catch (e) {
      console.log(`FAILED ${label}: ${planBilling.squareError(e).message}`);
    }
  }
  console.log(`\n${APPLY ? 'Swapped' : 'Would swap'} ${changed} of ${rows.length}.${APPLY ? '' : ' Re-run with --apply to do it.'}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
