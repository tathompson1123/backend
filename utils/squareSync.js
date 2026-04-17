const { Client, Environment } = require('square/legacy');

function makeClient(accessToken) {
  return new Client({
    bearerAuthCredentials: { accessToken },
    environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? Environment.Sandbox : Environment.Production,
  });
}

async function syncSquarePayments(userId, accessToken, pool) {
  const client = makeClient(accessToken);
  const beginTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { result } = await client.paymentsApi.listPayments(beginTime);
  const squarePayments = result.payments || [];

  let synced = 0;
  for (const p of squarePayments) {
    const amount = p.amountMoney ? Number(p.amountMoney.amount) / 100 : 0;
    const refundAmount = p.refundedMoney ? Number(p.refundedMoney.amount) / 100 : 0;
    const status = p.status === 'COMPLETED' ? 'completed' : p.status.toLowerCase();
    const cardBrand = p.cardDetails?.card?.cardBrand?.toLowerCase() || null;
    const cardLast4 = p.cardDetails?.card?.last4 || null;

    await pool.query(
      `INSERT INTO payments (user_id, processor, processor_payment_id, amount, refund_amount,
         status, card_brand, card_last_four, payment_method, metadata, created_at, updated_at)
       VALUES ($1, 'square', $2, $3, $4, $5, $6, $7, 'card', $8, $9, NOW())
       ON CONFLICT (processor_payment_id) WHERE processor_payment_id IS NOT NULL
       DO UPDATE SET status = EXCLUDED.status, refund_amount = EXCLUDED.refund_amount, updated_at = NOW()`,
      [userId, p.id, amount, refundAmount, status, cardBrand, cardLast4,
       JSON.stringify({ sourceType: p.sourceType, locationId: p.locationId, orderId: p.orderId }),
       p.createdAt]
    );
    synced++;
  }
  return synced;
}

async function syncSquareInvoices(userId, accessToken, locationId, pool) {
  const client = makeClient(accessToken);
  const { result } = await client.invoicesApi.listInvoices(locationId);
  const allItems = result.invoices || [];

  const invoiceStatusMap = {
    DRAFT: 'draft', UNPAID: 'sent', SCHEDULED: 'sent',
    PARTIALLY_PAID: 'partial', PAID: 'paid',
    REFUNDED: 'refunded', CANCELLED: 'cancelled',
    FAILED: 'overdue', PAYMENT_PENDING: 'sent',
  };
  const estimateStatusMap = {
    DRAFT: 'draft', UNPAID: 'sent', ACCEPTED: 'accepted',
    REJECTED: 'rejected', CANCELLED: 'expired',
  };

  let invoicesSynced = 0;
  let estimatesSynced = 0;

  for (const inv of allItems) {
    const isEstimate = inv.invoiceType === 'ESTIMATE';
    const rawTotal = inv.paymentRequests?.[0]?.computedAmountMoney?.amount
      ?? inv.paymentRequests?.[0]?.requestedMoney?.amount;
    const totalAmount = rawTotal ? Number(rawTotal) / 100 : 0;
    const customerName = inv.primaryRecipient?.givenName
      ? `${inv.primaryRecipient.givenName} ${inv.primaryRecipient.familyName || ''}`.trim()
      : inv.primaryRecipient?.companyName || null;
    const customerEmail = inv.primaryRecipient?.emailAddress || null;

    if (isEstimate) {
      const status = estimateStatusMap[inv.status] || 'draft';
      const estimateNumber = `SQ-EST-${inv.invoiceNumber || inv.id}`;
      const validUntil = inv.paymentRequests?.[0]?.dueDate || null;
      await pool.query(
        `INSERT INTO estimates (user_id, estimate_number, customer_name, customer_email,
           subtotal, tax_amount, tax_rate, total_amount, discount_amount,
           status, valid_until, notes, square_estimate_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 0, 0, $5, 0, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (square_estimate_id) WHERE square_estimate_id IS NOT NULL DO UPDATE SET
           status = EXCLUDED.status, total_amount = EXCLUDED.total_amount,
           valid_until = EXCLUDED.valid_until, updated_at = NOW()`,
        [userId, estimateNumber, customerName, customerEmail,
         totalAmount, status, validUntil, inv.description || null, inv.id, inv.createdAt]
      );
      estimatesSynced++;
    } else {
      const status = invoiceStatusMap[inv.status] || 'sent';
      const rawPaid = inv.paymentRequests?.[0]?.totalCompletedAmountMoney?.amount;
      const amountPaid = rawPaid ? Number(rawPaid) / 100 : 0;
      const amountDue = Math.max(0, totalAmount - amountPaid);
      const dueDate = inv.paymentRequests?.[0]?.dueDate || null;
      const invoiceNumber = `SQ-${inv.invoiceNumber || inv.id}`;
      const paidAt = status === 'paid' ? inv.updatedAt : null;
      await pool.query(
        `INSERT INTO invoices (user_id, invoice_number, customer_name, customer_email,
           subtotal, total_amount, amount_paid, amount_due, status, issue_date, due_date,
           paid_at, payment_processor, notes, square_invoice_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, 'square', $12, $13, $14, NOW())
         ON CONFLICT (invoice_number) DO UPDATE SET
           status = EXCLUDED.status, amount_paid = EXCLUDED.amount_paid,
           amount_due = EXCLUDED.amount_due, paid_at = EXCLUDED.paid_at,
           square_invoice_id = EXCLUDED.square_invoice_id, updated_at = NOW()`,
        [userId, invoiceNumber, customerName, customerEmail,
         totalAmount, amountPaid, amountDue,
         status, inv.createdAt?.split('T')[0], dueDate,
         paidAt, inv.description || null, inv.id, inv.createdAt]
      );
      invoicesSynced++;
    }
  }
  return { invoicesSynced, estimatesSynced };
}

module.exports = { syncSquarePayments, syncSquareInvoices };
