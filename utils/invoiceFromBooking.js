const crypto = require('crypto');
const { pool } = require('../config/database');

// Turn a booking into a local invoice + invoice_items.
//
// Shared by POST /api/invoices/from-booking/:bookingId, the dashboard's
// "Create Draft Invoice" button, the employee app's equivalent and the automatic
// draft fired on every booking create (utils/autoDraftInvoice.js), so all of them
// produce byte-identical invoices.

/**
 * @param {number} userId
 * @param {number|string} bookingId
 * @param {{reuseExisting?: boolean}} [options] reuseExisting returns the existing
 *   invoice instead of erroring — the draft button needs that so a second click
 *   pushes the same invoice rather than refusing outright.
 * @returns {Promise<{invoice: object, items: object[], reused: boolean} | {error: string, status: number, invoiceId?: number}>}
 */
async function createInvoiceFromBooking(userId, bookingId, options = {}) {
  const bookingResult = await pool.query(
    `SELECT b.*, COALESCE(json_agg(json_build_object(
       'service_name', bi.service_name, 'service_price', bi.service_price,
       'quantity', bi.quantity, 'service_id', bi.service_id,
       'description', bi.description, 'is_addon', COALESCE(bi.is_addon, false)
     ) ORDER BY COALESCE(bi.is_addon, false), bi.id
     ) FILTER (WHERE bi.id IS NOT NULL), '[]'::json) as items
     FROM bookings b
     LEFT JOIN booking_items bi ON b.id = bi.booking_id
     WHERE b.id = $1 AND b.user_id = $2
     GROUP BY b.id`,
    [bookingId, userId]
  );

  if (bookingResult.rows.length === 0) {
    return { error: 'Booking not found', status: 404 };
  }
  const booking = bookingResult.rows[0];

  const existing = await pool.query(
    'SELECT * FROM invoices WHERE booking_id = $1',
    [bookingId]
  );

  if (existing.rows.length > 0) {
    const invoice = existing.rows[0];
    if (!options.reuseExisting) {
      return {
        error: 'Invoice already exists for this booking',
        status: 409,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
      };
    }
    const items = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
      [invoice.id]
    );
    return { invoice, items: items.rows, reused: true };
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const invoiceNumber = `INV-${dateStr}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const paymentLinkToken = crypto.randomBytes(32).toString('hex');
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Carry the booking's tax across. Dropping it left line items summing to the
  // subtotal while total_amount included tax, so every processor draft came out
  // with a line/total mismatch.
  const subtotal = parseFloat(booking.subtotal ?? booking.total_amount ?? 0);
  const total = parseFloat(booking.total_amount ?? subtotal);
  let taxRate = parseFloat(booking.tax_rate ?? 0);
  let taxAmount = parseFloat(booking.tax_amount ?? 0);
  if (!taxAmount && total > subtotal) {
    // Older rows recorded a tax-inclusive total but not the tax itself.
    taxAmount = Math.round((total - subtotal) * 100) / 100;
    if (!taxRate && subtotal > 0) taxRate = taxAmount / subtotal;
  }

  // All three writes go in one transaction. Without it, a failed line-item insert
  // leaves a committed invoice row with no items and no bookings.invoice_id link —
  // and every retry then trips the "invoice already exists" check above, so the
  // booking is permanently stuck behind an orphan that only manual SQL can clear.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invoiceResult = await client.query(
      `INSERT INTO invoices (
         user_id, booking_id, customer_id, invoice_number, customer_name, customer_email, customer_phone,
         subtotal, tax_rate, tax_amount, total_amount, amount_due, status, due_date, payment_link_token
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13, $14)
       RETURNING *`,
      [userId, bookingId, booking.customer_id, invoiceNumber, booking.customer_name,
       booking.customer_email, booking.customer_phone, subtotal,
       taxRate, taxAmount, total, total, dueDate, paymentLinkToken]
    );
    const invoice = invoiceResult.rows[0];

    // Service name and the description typed at booking time go in separate columns —
    // Square, PayPal and QuickBooks all render both.
    const created = [];
    for (const item of booking.items || []) {
      if (!item.service_name) continue;
      const quantity = parseFloat(item.quantity) || 1;
      const unitPrice = parseFloat(item.service_price) || 0;
      const row = await client.query(
        `INSERT INTO invoice_items (invoice_id, name, description, quantity, unit_price, amount, service_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [invoice.id, item.service_name, item.description || item.service_name,
         quantity, unitPrice, Math.round(unitPrice * quantity * 100) / 100, item.service_id]
      );
      created.push(row.rows[0]);
    }

    // Never downgrade a booking that is already paid. The auto-draft runs
    // fire-and-forget the instant a booking is created, so it can land after a deposit
    // or card-on-file payment has already marked the booking 'paid' — an unconditional
    // write would wipe that. CASE rather than a WHERE guard so invoice_id is still
    // linked either way, and it stays NULL-safe (payment_status is NULL on public
    // bookings, and NULL <> 'paid' is NULL, which would skip the row entirely).
    await client.query(
      `UPDATE bookings
          SET invoice_id = $1,
              payment_status = CASE WHEN payment_status = 'paid' THEN payment_status ELSE 'invoiced' END
        WHERE id = $2`,
      [invoice.id, bookingId]
    );

    await client.query('COMMIT');
    return { invoice, items: created, reused: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createInvoiceFromBooking };
