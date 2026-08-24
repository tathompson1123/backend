// Auto-draft an invoice into the merchant's payment processor when a booking is taken.
//
// This is the unattended twin of the "Draft Invoice in Square" button: same builder
// (utils/invoiceFromBooking.js), same adapters (payment/invoiceDrafts.js), so a booking
// that auto-drafts is indistinguishable from one drafted by hand. The invoice lands in
// Square / Stripe / PayPal / QuickBooks as a DRAFT — nothing is emailed to the customer
// until the owner sends it from there.
//
// Wired into all three booking-create paths — the web dashboard (routes/bookings.js),
// the employee app (routes/employee-api.js) and the public website widget
// (routes/public.js). Called fire-and-forget, so it must NEVER throw and must never be
// able to fail a booking. A processor outage costs the merchant a draft, not the job.

const { pool } = require('../config/database');
const { createInvoiceFromBooking } = require('./invoiceFromBooking');
const { createDraftInvoice, getDraftCapableConnections } = require('../payment/invoiceDrafts');

/**
 * @param {{userId: number, bookingId: number|string, source?: string}} params
 * @returns {Promise<{drafted: boolean, skipped?: string, processor?: string,
 *   invoiceId?: number, externalId?: string, reviewUrl?: string, error?: string}>}
 *   Always resolves. `skipped` names the reason nothing was drafted.
 */
async function autoDraftInvoiceForBooking({ userId, bookingId, source = 'dashboard' }) {
  const tag = `[auto-draft] booking ${bookingId} (${source})`;
  try {
    const { capable, cloverOnly, autoDraft } = await getDraftCapableConnections(userId);

    // Order matters: check the switch and the connection BEFORE building anything.
    // createInvoiceFromBooking writes an invoice row and flips the booking to
    // payment_status='invoiced', so building first would leave that side effect on
    // every booking of every user who has no processor connected and never asked for
    // invoicing at all.
    if (!autoDraft) return { drafted: false, skipped: 'disabled' };
    if (capable.length === 0) {
      // Not an error worth alarming on — Clover-only and not-yet-connected merchants
      // simply have nowhere to put a draft. The manual button explains it in the UI.
      return { drafted: false, skipped: cloverOnly ? 'clover_only' : 'no_processor' };
    }

    // The first capable connection is the primary one (getDraftCapableConnections
    // orders by is_primary), which is the "preferred processor" for this merchant.
    const processor = capable[0];

    // reuseExisting so a booking that somehow already has an invoice drafts that one
    // rather than erroring — matches the manual button exactly.
    const built = await createInvoiceFromBooking(userId, bookingId, { reuseExisting: true });
    if (built.error) {
      console.error(`${tag} could not build invoice: ${built.error}`);
      return { drafted: false, skipped: 'build_failed', error: built.error };
    }

    const draft = await createDraftInvoice({
      userId,
      processor,
      invoice: built.invoice,
      items: built.items,
    });

    console.log(`${tag} drafted ${built.invoice.invoice_number} into ${draft.processor} (${draft.externalId})`);
    return {
      drafted: true,
      processor: draft.processor,
      invoiceId: built.invoice.id,
      externalId: draft.externalId,
      reviewUrl: draft.reviewUrl,
    };
  } catch (error) {
    // Swallowed on purpose. The local invoice already exists at this point, so the
    // merchant keeps a SORCE invoice and the manual "Draft Invoice" button retries the
    // processor half against that same invoice — the claim released in
    // createDraftInvoice makes that retry immediate.
    console.error(`${tag} failed: ${error.message}`);
    return { drafted: false, skipped: 'draft_failed', error: error.message };
  }
}

/**
 * Fire-and-forget wrapper for the booking-create routes. Returns nothing and can
 * never reject, so a caller cannot accidentally couple booking creation to a
 * processor round-trip by awaiting it.
 */
function queueAutoDraftInvoice({ userId, bookingId, source }) {
  autoDraftInvoiceForBooking({ userId, bookingId, source }).catch(() => {});
}

/** Read the toggle. Defaults to on for rows written before the column existed. */
async function isAutoDraftEnabled(userId) {
  const result = await pool.query('SELECT auto_draft_invoices FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.auto_draft_invoices !== false;
}

async function setAutoDraftEnabled(userId, enabled) {
  await pool.query('UPDATE users SET auto_draft_invoices = $1 WHERE id = $2', [!!enabled, userId]);
  return !!enabled;
}

module.exports = {
  autoDraftInvoiceForBooking,
  queueAutoDraftInvoice,
  isAutoDraftEnabled,
  setAutoDraftEnabled,
};
