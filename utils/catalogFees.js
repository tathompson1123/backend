// Standing fees a business charges on top of the services — a card processing fee,
// a shop-supplies fee, and so on. Configured once in the invoice fee catalog
// (invoice_items_catalog) and applied automatically.
//
// Shared by the booking-create paths and by utils/invoiceFromBooking.js so a booking
// and the invoice raised from it can never disagree about the fee. Bookings store a
// snapshot of what they applied (bookings.fees), and the invoice bills that snapshot
// rather than recomputing, so a customer is never charged a fee they weren't quoted.
//
// Only staff-created bookings carry fees. Online bookings — the public widget, the
// chat agent, the embed widget — deliberately don't, because the customer sees a total
// before confirming and a fee that appears only afterwards is a surprise charge.

const { pool } = require('../config/database');

function round2(value) {
  return Math.round((parseFloat(value) || 0) * 100) / 100;
}

/** Active standing fees for this business, in display order. */
async function loadCatalogFees(userId) {
  const result = await pool.query(
    `SELECT name, amount_type, amount, taxable
       FROM invoice_items_catalog
      WHERE user_id = $1 AND active = true
      ORDER BY category, name`,
    [userId]
  );
  return result.rows;
}

/**
 * Turn catalog rows into line items.
 *
 * Percentage fees are charged on `base` — the PRE-TAX subtotal — so a 3.5% card
 * processing fee is never a percentage of sales tax. Fixed fees are added to that base
 * first, since they're part of what's being processed; percentage fees are not, so two
 * of them can't compound and their order doesn't change the result.
 *
 * @param {{name: string, amount_type: string, amount: string|number, taxable: boolean}[]} fees
 * @param {number} base pre-tax subtotal of the service lines
 * @returns {{name: string, description: string|null, amount: number, taxable: boolean}[]}
 */
function buildFeeLines(fees, base) {
  const fixed = [];
  const percentage = [];
  for (const fee of fees || []) {
    if (!fee?.name) continue;
    const amount = parseFloat(fee.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    // 'percent' as well as 'percentage' — the employee app reads both spellings, so
    // rows could carry either.
    const isPercent = fee.amount_type === 'percentage' || fee.amount_type === 'percent';
    (isPercent ? percentage : fixed).push({ ...fee, amount });
  }

  const lines = fixed.map(fee => ({
    name: String(fee.name).slice(0, 255),
    description: null,
    amount: round2(fee.amount),
    taxable: !!fee.taxable,
  }));

  const percentBase = round2(base + lines.reduce((sum, l) => sum + l.amount, 0));
  for (const fee of percentage) {
    const amount = round2(percentBase * (fee.amount / 100));
    if (amount <= 0) continue;
    lines.push({
      name: String(fee.name).slice(0, 255),
      // The rate belongs in the description, not the name — the name is what the
      // processor prints as the line title, and "(3.5%)" glued on gets truncated.
      description: `${fee.amount}% of $${percentBase.toFixed(2)}`,
      amount,
      taxable: !!fee.taxable,
    });
  }
  return lines;
}

/**
 * Totals for a booking or invoice once standing fees are applied.
 *
 * The tax base excludes fees the business marked "No Tax" in the fee catalog
 * (invoice_items_catalog.taxable, which defaults to false) — taxing a card surcharge
 * is usually wrong, and that same rule is what each payment processor is told per line.
 *
 * `subtotal` is the PRE-TAX total including fees, so `subtotal + taxAmount === total`
 * holds exactly as it did before fees existed. `feeTotal` records how much of that
 * subtotal is fees, so the fee portion can be backed out again.
 *
 * @param {{userId: number, serviceSubtotal: number, taxRate: number, feeLines?: object[]}} params
 *   Pass feeLines to bill a stored snapshot instead of loading the catalog.
 */
async function resolveFeeTotals({ userId, serviceSubtotal, taxRate, feeLines }) {
  const services = round2(serviceSubtotal);
  const lines = feeLines || buildFeeLines(await loadCatalogFees(userId), services);

  const feeTotal = round2(lines.reduce((sum, f) => sum + Number(f.amount), 0));
  const taxableFeeTotal = round2(
    lines.filter(f => f.taxable).reduce((sum, f) => sum + Number(f.amount), 0)
  );

  const subtotal = round2(services + feeTotal);
  const taxableBase = round2(services + taxableFeeTotal);
  const rate = parseFloat(taxRate) || 0;
  const taxAmount = round2(taxableBase * rate);

  return {
    feeLines: lines,
    feeTotal,
    serviceSubtotal: services,
    subtotal,
    taxableBase,
    taxAmount,
    total: round2(subtotal + taxAmount),
  };
}

/**
 * The fee snapshot stored on a booking, or null when it predates fees.
 * Guards against a JSONB column that came back as text.
 */
function readFeeSnapshot(booking) {
  const raw = booking?.fees;
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { round2, loadCatalogFees, buildFeeLines, resolveFeeTotals, readFeeSnapshot };
