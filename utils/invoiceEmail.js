/**
 * Generates polished invoice email HTML.
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

  const dueDateDisplay = dueDate
    ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const amt = (v) => parseFloat(v || 0).toFixed(2);

  const headline = isReminder
    ? `PAYMENT REMINDER FROM ${businessName.toUpperCase()}`
    : `YOU'VE RECEIVED AN INVOICE FROM ${businessName.toUpperCase()}`;

  // Line items rows
  const itemRows = items.map(it => {
    const qty = parseFloat(it.quantity) || 1;
    const price = parseFloat(it.unit_price ?? it.unitPrice ?? 0);
    const lineTotal = parseFloat(it.amount) || (qty * price);
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:14px;">${it.description || '-'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:14px;text-align:center;">${qty}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:14px;text-align:right;">$${amt(price)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#111827;font-size:14px;text-align:right;font-weight:600;">$${amt(lineTotal)}</td>
      </tr>`;
  }).join('');

  const hasItems = items.length > 0;
  const displayTotal = totalAmount != null ? amt(totalAmount) : amt(amountDue);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#d97706,#f59e0b);padding:36px 40px;text-align:center;">
            <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1px;">${headline}</h1>
            <p style="margin:0;color:rgba(255,255,255,0.85);font-size:14px;">Invoice ${invoiceNumber}</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 0;">
            <p style="margin:0;color:#374151;font-size:16px;line-height:1.6;">
              Hi ${customerName || 'there'},
            </p>
            <p style="margin:8px 0 0;color:#6b7280;font-size:15px;line-height:1.6;">
              ${isReminder
                ? `This is a friendly reminder that your invoice <strong>${invoiceNumber}</strong> is still outstanding.`
                : `Please find your invoice details below.`}
            </p>
          </td>
        </tr>

        <!-- Invoice Card -->
        <tr>
          <td style="padding:24px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">

              <!-- Invoice meta -->
              <tr>
                <td style="padding:20px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="vertical-align:top;">
                        <p style="margin:0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Invoice</p>
                        <p style="margin:4px 0 0;color:#111827;font-size:16px;font-weight:700;font-family:monospace;">${invoiceNumber}</p>
                      </td>
                      <td style="vertical-align:top;text-align:right;">
                        <p style="margin:0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Date</p>
                        <p style="margin:4px 0 0;color:#374151;font-size:14px;font-weight:600;">${today}</p>
                        ${dueDateDisplay ? `
                        <p style="margin:12px 0 0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Due Date</p>
                        <p style="margin:4px 0 0;color:#374151;font-size:14px;font-weight:600;">${dueDateDisplay}</p>
                        ` : ''}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              ${hasItems ? `
              <!-- Line Items -->
              <tr>
                <td style="padding:0 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #e5e7eb;">
                    <tr style="background-color:#f3f4f6;">
                      <th style="padding:10px 12px;text-align:left;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Description</th>
                      <th style="padding:10px 12px;text-align:center;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Qty</th>
                      <th style="padding:10px 12px;text-align:right;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Price</th>
                      <th style="padding:10px 12px;text-align:right;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Total</th>
                    </tr>
                    ${itemRows}
                  </table>
                </td>
              </tr>
              ` : ''}

              <!-- Totals -->
              <tr>
                <td style="padding:16px 24px 20px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${subtotal != null ? `
                    <tr>
                      <td style="padding:4px 0;color:#6b7280;font-size:14px;">Subtotal</td>
                      <td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">$${amt(subtotal)}</td>
                    </tr>` : ''}
                    ${taxAmount && parseFloat(taxAmount) > 0 ? `
                    <tr>
                      <td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td>
                      <td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">$${amt(taxAmount)}</td>
                    </tr>` : ''}
                    <tr>
                      <td colspan="2" style="padding:8px 0 0;"><div style="border-top:2px solid #e5e7eb;"></div></td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0 0;color:#111827;font-size:18px;font-weight:800;">Amount Due</td>
                      <td style="padding:8px 0 0;text-align:right;color:#d97706;font-size:22px;font-weight:800;">$${amt(amountDue)}</td>
                    </tr>
                  </table>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        ${notes ? `
        <!-- Notes -->
        <tr>
          <td style="padding:0 40px 16px;">
            <p style="margin:0 0 4px;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Notes</p>
            <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">${notes}</p>
          </td>
        </tr>
        ` : ''}

        <!-- Pay Now Button -->
        <tr>
          <td style="padding:8px 40px 36px;text-align:center;">
            <a href="${paymentUrl}" style="display:inline-block;background:linear-gradient(135deg,#d97706,#f59e0b);color:#ffffff;padding:16px 48px;text-decoration:none;border-radius:12px;font-weight:800;font-size:18px;letter-spacing:0.5px;box-shadow:0 4px 14px rgba(217,119,6,0.4);">
              Pay Now
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">
              If you have questions about this invoice, reply to this email.
            </p>
            <p style="margin:8px 0 0;color:#d1d5db;font-size:11px;">
              Sent by ${businessName} via SORCE
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildInvoiceEmailHtml };
