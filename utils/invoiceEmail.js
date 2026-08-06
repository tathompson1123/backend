const { escapeHtml: esc } = require('./escapeHtml');
const { plainEmail } = require('./emailLayout');

/**
 * Generates invoice email HTML.
 *
 * Rebuilt plain — see utils/emailLayout for why. This was a 600px card with a gradient
 * header band, five nested tables and an oversized Pay Now button: the same shape that got
 * a discovery confirmation filed as Junk by two unrelated ESPs while a plain email from the
 * same address reached the inbox. An invoice that lands in spam is worse than most: it
 * carries the payment link, so the business doesn't get paid and nobody finds out why.
 *
 * @param {object} opts
 * @param {string} opts.businessName
 * @param {string} opts.customerName
 * @param {string} opts.invoiceNumber
 * @param {number} opts.amountDue
 * @param {string} [opts.dueDate]       – ISO date string or display string
 * @param {string} opts.paymentUrl
 * @param {Array}  [opts.items]          – [{ description, quantity, unit_price|unitPrice, amount }]
 * @param {number} [opts.subtotal]
 * @param {number} [opts.taxAmount]
 * @param {number} [opts.totalAmount]
 * @param {string} [opts.notes]
 * @param {boolean} [opts.isReminder]
 */
function buildInvoiceEmailHtml(opts) {
  const {
    businessName, customerName, invoiceNumber, amountDue, dueDate,
    paymentUrl, items = [], subtotal, taxAmount, totalAmount, notes, isReminder,
  } = opts;

  // Anchor a date-only string at noon before formatting. "2026-08-20" parses as UTC
  // midnight, so rendering it in any negative-offset timezone printed the day before —
  // this was showing customers a due date one day early. bookingEmail's formatDate has
  // used the same noon trick for the same reason.
  const dueDateDisplay = dueDate
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate)) ? `${dueDate}T12:00:00` : dueDate)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const amt = (v) => parseFloat(v || 0).toFixed(2);
  // String() guards a null business_name — .toUpperCase() on it threw and took the whole
  // invoice send down with a 500. The heading no longer shouts, but the guard still matters.
  const business = String(businessName || 'your service provider');

  // Line items as one labelled block rather than a bordered table with a header row.
  const lineItems = items.map(it => {
    const qty = parseFloat(it.quantity) || 1;
    const price = parseFloat(it.unit_price ?? it.unitPrice ?? 0);
    const lineTotal = parseFloat(it.amount) || (qty * price);
    const label = esc(it.description || 'Item');
    // Plain "x" rather than &times;: htmlToText's entity catch-all replaces unknown
    // entities with a space, so the multiplier silently vanished from the text/plain part.
    return qty > 1
      ? `${label} x ${qty} — $${amt(lineTotal)}`
      : `${label} — $${amt(lineTotal)}`;
  }).join('<br>');

  const totals = [
    subtotal != null ? { label: 'Subtotal', value: `$${amt(subtotal)}` } : null,
    taxAmount && parseFloat(taxAmount) > 0 ? { label: 'Tax', value: `$${amt(taxAmount)}` } : null,
    { label: 'Amount due', value: `$${amt(amountDue)}` },
    dueDateDisplay ? { label: 'Due', value: esc(dueDateDisplay) } : null,
  ].filter(Boolean);

  return plainEmail({
    greeting: `Hi ${esc(customerName || 'there')},`,
    paragraphs: [
      isReminder
        ? `A quick reminder that invoice <strong>${esc(invoiceNumber)}</strong> from ${esc(business)} is still outstanding.`
        : `Here is invoice <strong>${esc(invoiceNumber)}</strong> from ${esc(business)}.`,
      lineItems || '',
    ],
    details: totals,
    action: { label: 'Pay this invoice', url: paymentUrl },
    after: [
      notes ? `<strong>Notes:</strong> ${esc(notes)}` : '',
      'If you have questions about this invoice, just reply to this email.',
    ],
    signature: `${esc(business)} &middot; sent via SORCE`,
  });
}

module.exports = { buildInvoiceEmailHtml };
