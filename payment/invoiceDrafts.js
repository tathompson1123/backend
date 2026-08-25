// Create a DRAFT invoice inside the merchant's own payment processor.
//
// The distinction from routes/invoices.js `send-*`: those create the invoice AND
// publish/finalize/send it, so the processor immediately emails the customer.
// These stop one step short. The invoice lands in the merchant's Square / Stripe /
// PayPal / QuickBooks dashboard unsent, for a human to eyeball and send.
//
// Every adapter returns the same shape:
//   { processor, externalId, reviewUrl, message }
//
// Clover is deliberately absent — Clover removed its public invoicing API, so there
// is no way to create an invoice in a Clover account programmatically. Callers get
// an explicit UNSUPPORTED error rather than a silent no-op.

const { pool } = require('../config/database');

const DRAFT_CAPABLE_PROCESSORS = ['square', 'stripe', 'paypal', 'quickbooks'];

// Thrown for conditions the user can fix (not connected, no email, Clover) so the
// route can answer 400 with a useful message instead of a generic 500.
class DraftInvoiceError extends Error {
  constructor(message, code = 'DRAFT_FAILED') {
    super(message);
    this.name = 'DraftInvoiceError';
    this.code = code;
  }
}

// ── Shared line-item shaping ─────────────────────────────────────────────────

// Normalize invoice_items rows into a processor-agnostic shape, then append tax and
// discount as their own lines where the processor has no first-class field for them.
// Tax lives on the invoice, not the line, so every adapter has to place it somehow.
function buildLines(invoice, items) {
  const lines = (items || [])
    .filter(item => item.name || item.description)
    .map(item => {
      const rawQuantity = parseFloat(item.quantity) || 1;
      const rawUnitPrice = parseFloat(item.unit_price) || 0;
      const amount = Math.round(rawUnitPrice * rawQuantity * 100) / 100;
      // Stripe rejects a non-integer quantity outright and Square needs a catalog
      // measurement unit for one, so a fractional quantity (2.5 hours of labour)
      // collapses to a single line at the full amount. The total is preserved exactly;
      // only the "× 2.5" breakdown is lost, which beats a failed draft.
      const isWholeQuantity = Number.isInteger(rawQuantity) && rawQuantity > 0;
      const quantity = isWholeQuantity ? rawQuantity : 1;
      const unitPrice = isWholeQuantity ? rawUnitPrice : amount;

      // Rows written before invoice_items.name existed carry the service name in
      // `description`, so the name falls back to it — compare against the resolved
      // name, not item.name, or those rows render "Full Detail / Full Detail".
      const rawName = item.name || item.description || 'Service';
      // Trimmed, and null rather than blank when there's nothing left: a
      // whitespace-only description satisfies every processor's 1-character minimum
      // while rendering as an empty note on the invoice.
      const trimmedDescription = String(item.description || '').trim();
      let description = trimmedDescription && trimmedDescription !== rawName
        ? trimmedDescription
        : null;
      if (!isWholeQuantity) {
        const note = `Qty ${rawQuantity} × $${rawUnitPrice.toFixed(2)}`;
        description = description ? `${description} (${note})` : note;
      }
      // taxable drives which lines Square applies the tax to. Defaults to true so a
      // row written before the column existed is still taxed as it always was.
      return {
        name: String(rawName).slice(0, 255),
        description, quantity, unitPrice, amount,
        taxable: item.taxable !== false,
      };
    });

  // An invoice with no line items still has to bill the right amount. Use the
  // PRE-tax subtotal — every adapter appends tax as its own line below, so seeding
  // this with the tax-inclusive total would bill the tax twice.
  if (lines.length === 0) {
    const subtotal = parseFloat(invoice.subtotal);
    const fallback = Number.isFinite(subtotal) && subtotal > 0
      ? subtotal
      : Math.max(0, (parseFloat(invoice.total_amount) || 0) - (parseFloat(invoice.tax_amount) || 0));
    lines.push({
      name: `Invoice ${invoice.invoice_number}`,
      description: invoice.notes || null,
      quantity: 1,
      unitPrice: fallback,
      amount: fallback,
      taxable: true,
    });
  }
  return lines;
}

function money(value) {
  return Math.round((parseFloat(value) || 0) * 100) / 100;
}

function cents(value) {
  return Math.round((parseFloat(value) || 0) * 100);
}

// Stable uid so the order-level tax and the line items that reference it agree.
const SALES_TAX_UID = 'sorce-sales-tax';

// Resolve the tax rate as a percentage. invoices.tax_rate is stored as a fraction
// (0.07 = 7%), but legacy rows carry a tax_amount with no usable rate, so fall back to
// deriving it from the taxable base. Returns 0 when there is no tax to apply.
function taxPercentage(invoice, taxableBase) {
  const rate = parseFloat(invoice.tax_rate);
  // Guard against a row that stored 7 to mean 7% — a real rate is never above 1.
  if (Number.isFinite(rate) && rate > 0) return rate > 1 ? rate : rate * 100;
  const amount = parseFloat(invoice.tax_amount) || 0;
  if (amount > 0 && taxableBase > 0) return (amount / taxableBase) * 100;
  return 0;
}

// Square accepts up to 4 decimal places on a tax percentage; trailing zeros are noise.
function trimPercent(percent) {
  return String(parseFloat(percent.toFixed(4)));
}

/**
 * Work out the tax to hand a processor natively: the percentage, and which lines it
 * applies to. Every adapter uses this so they can't drift apart on the rate or on
 * which lines are in the base.
 *
 * @returns {{percent: number, taxableBase: number, hasTaxableLines: boolean, applies: boolean}}
 */
function resolveLineTax(invoice, lines) {
  const taxable = lines.filter(line => line.taxable);
  const taxableBase = Math.round(taxable.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const percent = taxPercentage(invoice, taxableBase);
  return {
    percent,
    taxableBase,
    hasTaxableLines: taxable.length > 0,
    applies: percent > 0 && taxable.length > 0,
  };
}

function dueDateString(invoice) {
  const due = invoice.due_date
    ? new Date(invoice.due_date)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return due.toISOString().split('T')[0];
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return { given: parts[0] || '', family: parts.slice(1).join(' ') || '' };
}

async function getConnection(userId, processor) {
  const result = await pool.query(
    'SELECT * FROM payment_connections WHERE user_id = $1 AND processor = $2 AND is_active = true',
    [userId, processor]
  );
  if (result.rows.length === 0) {
    throw new DraftInvoiceError(
      `${processor.charAt(0).toUpperCase()}${processor.slice(1)} is not connected. Connect it in Payment Settings first.`,
      'NOT_CONNECTED'
    );
  }
  return result.rows[0];
}

// ── Square ───────────────────────────────────────────────────────────────────
// Square invoices are born in DRAFT state; the existing send-square route creates
// one and then POSTs /publish. We simply don't publish.

async function createSquareDraft({ userId, invoice, items }) {
  const { randomUUID } = require('crypto');
  const { Client, Environment } = require('square/legacy');
  const { getValidSquareToken } = require('../utils/squareAuth');

  let accessToken, locationId;
  try {
    ({ accessToken, locationId } = await getValidSquareToken(userId));
  } catch {
    throw new DraftInvoiceError('Square is not connected. Connect it in Payment Settings first.', 'NOT_CONNECTED');
  }

  const isSandbox = process.env.SQUARE_ENVIRONMENT === 'sandbox';
  const client = new Client({
    bearerAuthCredentials: { accessToken },
    environment: isSandbox ? Environment.Sandbox : Environment.Production,
  });
  // Raw fetch for the invoice calls — the legacy SDK schema strips
  // accepted_payment_methods. Same reasoning as routes/invoices.js send-square.
  const base = isSandbox ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Square-Version': '2025-01-23',
  };

  const total = cents(invoice.total_amount);
  if (total <= 0) throw new DraftInvoiceError('Invoice total must be greater than $0.', 'ZERO_TOTAL');

  const { given, family } = splitName(invoice.customer_name);

  // Find or create the Square customer — the invoice recipient needs a customer_id.
  let customerId;
  const { result: search } = await client.customersApi.searchCustomers({
    query: { filter: { emailAddress: { exact: invoice.customer_email } } },
  });
  if (search.customers?.length > 0) {
    customerId = search.customers[0].id;
  } else {
    const body = { emailAddress: invoice.customer_email, idempotencyKey: randomUUID() };
    if (given) body.givenName = given;
    if (family) body.familyName = family;
    const { result: created } = await client.customersApi.createCustomer(body);
    customerId = created.customer.id;
  }

  // Square line items carry a name and an optional note — use both so the typed
  // description shows up under the service name rather than replacing it.
  const lines = buildLines(invoice, items);
  const lineItems = lines.map(line => {
    const item = {
      name: line.name,
      quantity: String(line.quantity),
      basePriceMoney: { amount: BigInt(cents(line.unitPrice)), currency: 'USD' },
    };
    if (line.description) item.note = line.description.slice(0, 500);
    // Only taxable lines reference the tax below, so a non-taxable fee (a card
    // surcharge, typically) is left out of the tax base.
    if (line.taxable) item.appliedTaxes = [{ taxUid: SALES_TAX_UID }];
    return item;
  });

  // Sales tax is a real Square tax, not a line item, so Square computes and displays
  // it as tax on the invoice — the merchant's tax reporting in Square then sees it as
  // tax rather than as another service sold. LINE_ITEM scope (rather than ORDER) is
  // what lets non-taxable fees sit outside the base.
  const tax = resolveLineTax(invoice, lines);

  // Discounts go in the order's `discounts` array, NOT as a negative line item —
  // Square rejects a negative base_price_money with INVALID_VALUE.
  const order = { locationId, customerId, lineItems };
  if (tax.applies) {
    order.taxes = [{
      uid: SALES_TAX_UID,
      name: 'Sales Tax',
      // Square wants a percentage string ("7.25"), not a fraction or an amount.
      percentage: trimPercent(tax.percent),
      scope: 'LINE_ITEM',
      type: 'ADDITIVE',
    }];
  }
  const discountCents = cents(invoice.discount_amount);
  if (discountCents > 0) {
    order.discounts = [{
      name: 'Discount',
      amountMoney: { amount: BigInt(discountCents), currency: 'USD' },
      scope: 'ORDER',
    }];
  }

  const { result: orderResult } = await client.ordersApi.createOrder({
    order,
    idempotencyKey: randomUUID(),
  });

  const squareInvoice = {
    location_id: locationId,
    order_id: orderResult.order.id,
    primary_recipient: { customer_id: customerId },
    payment_requests: [{ request_type: 'BALANCE', due_date: dueDateString(invoice) }],
    accepted_payment_methods: {
      card: true,
      square_gift_card: false,
      bank_account: false,
      buy_now_pay_later: false,
      cash_app_pay: false,
    },
    delivery_method: 'EMAIL',
    title: `Invoice for ${invoice.customer_name || invoice.customer_email}`,
  };

  // Square rejects description: "" with VALUE_TOO_SHORT (minimum 1 character) rather
  // than treating it as absent, so the key is omitted entirely when there are no
  // notes — which is the common case for a booking nobody typed a note on. Trimmed
  // first so whitespace-only notes don't sneak past as a "present" value.
  const squareDescription = String(invoice.notes || '').trim();
  if (squareDescription) squareInvoice.description = squareDescription.slice(0, 500);

  const response = await fetch(`${base}/v2/invoices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ idempotency_key: randomUUID(), invoice: squareInvoice }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.errors?.map(e => `${e.code}: ${e.detail}`).join('; ') || JSON.stringify(data));
  }

  // No /publish call — this is the whole point. The invoice sits in Square as a draft.
  return {
    processor: 'square',
    externalId: data.invoice.id,
    reviewUrl: `https://app.squareup.com/dashboard/invoices/${data.invoice.id}`,
    message: 'Draft invoice created in Square. Review it there, then send.',
  };
}

// ── Stripe ───────────────────────────────────────────────────────────────────
// A Stripe invoice stays a draft until finalizeInvoice() is called, so we create it
// and stop. Note this uses the PLATFORM key with a Connect account header — the old
// send-stripe route read conn.stripe_access_token, a column nothing ever writes.

async function createStripeDraft({ userId, invoice, items }) {
  const Stripe = require('stripe');
  const conn = await getConnection(userId, 'stripe');
  if (!conn.stripe_account_id) {
    throw new DraftInvoiceError('Stripe connection is incomplete. Reconnect Stripe in Payment Settings.', 'NOT_CONNECTED');
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new DraftInvoiceError('Stripe is not configured on the server.', 'NOT_CONFIGURED');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const opts = { stripeAccount: conn.stripe_account_id };

  let customerId;
  const existing = await stripe.customers.list({ email: invoice.customer_email, limit: 1 }, opts);
  if (existing.data.length > 0) {
    customerId = existing.data[0].id;
  } else {
    const customer = await stripe.customers.create(
      { email: invoice.customer_email, name: invoice.customer_name || undefined },
      opts
    );
    customerId = customer.id;
  }

  const daysUntilDue = invoice.due_date
    ? Math.max(1, Math.ceil((new Date(invoice.due_date) - Date.now()) / 86400000))
    : 30;

  // Create the draft first so the items can be attached directly to it. Creating
  // items against the bare customer risks sweeping in stray pending items.
  const draft = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: daysUntilDue,
    auto_advance: false, // never let Stripe finalize and email this on its own
    description: invoice.notes || undefined,
    metadata: { local_invoice_id: String(invoice.id), invoice_number: invoice.invoice_number },
  }, opts);

  // Sales tax is a Stripe TaxRate attached to the taxable lines, not a line of its own,
  // so Stripe reports it as tax and the invoice shows a proper tax row. Non-taxable
  // lines simply don't reference the rate, which is how a "No Tax" fee stays out of
  // the base.
  const lines = buildLines(invoice, items);
  const tax = resolveLineTax(invoice, lines);
  const taxRateId = tax.applies
    ? await findOrCreateStripeTaxRate(stripe, opts, tax.percent)
    : null;

  // Stripe invoice items expose a single description field, so fold the service name
  // and the typed description together.
  for (const line of lines) {
    const params = {
      customer: customerId,
      invoice: draft.id,
      quantity: line.quantity,
      unit_amount: cents(line.unitPrice),
      currency: 'usd',
      description: line.description ? `${line.name} — ${line.description}` : line.name,
    };
    if (taxRateId && line.taxable) params.tax_rates = [taxRateId];
    await stripe.invoiceItems.create(params, opts);
  }
  const discountAmount = cents(invoice.discount_amount);
  if (discountAmount > 0) {
    await stripe.invoiceItems.create(
      { customer: customerId, invoice: draft.id, amount: -discountAmount, currency: 'usd', description: 'Discount' },
      opts
    );
  }

  return {
    processor: 'stripe',
    externalId: draft.id,
    reviewUrl: `https://dashboard.stripe.com/${conn.stripe_account_id}/invoices/${draft.id}`,
    message: 'Draft invoice created in Stripe. Review it there, then finalize and send.',
  };
}

// Stripe TaxRate objects are immutable and permanent — the percentage can never be
// edited — so creating one per invoice would litter the merchant's account with
// duplicates. Look for a matching rate first and only create when there isn't one.
// These live on the connected account, so each merchant accumulates just their own.
async function findOrCreateStripeTaxRate(stripe, opts, percent) {
  const DISPLAY_NAME = 'Sales Tax';
  // Stripe stores percentage as a number with up to 4 decimal places.
  const target = Math.round(percent * 10000) / 10000;

  const existing = await stripe.taxRates.list({ active: true, limit: 100 }, opts);
  const match = existing.data.find(rate =>
    !rate.inclusive &&
    rate.display_name === DISPLAY_NAME &&
    Math.round(rate.percentage * 10000) / 10000 === target
  );
  if (match) return match.id;

  const created = await stripe.taxRates.create(
    { display_name: DISPLAY_NAME, percentage: target, inclusive: false },
    opts
  );
  return created.id;
}

// ── PayPal ───────────────────────────────────────────────────────────────────
// POST /v2/invoicing/invoices creates a DRAFT. The send-paypal route follows it with
// /send; we don't.

async function createPayPalDraft({ userId, invoice, items }) {
  const conn = await getConnection(userId, 'paypal');
  const isSandbox = process.env.PAYPAL_ENVIRONMENT === 'sandbox';
  const base = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${conn.paypal_client_id}:${conn.paypal_client_secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!tokenRes.ok) throw new Error('Failed to get a PayPal access token');
  const { access_token } = await tokenRes.json();

  const { given, family } = splitName(invoice.customer_name);
  const lines = buildLines(invoice, items);

  // PayPal's per-item `tax` is a PERCENTAGE, so it needs the rate rather than our flat
  // tax_amount — deriving a percentage from an amount was what made this unreliable
  // before, and resolveLineTax now supplies the real one. Applied per line so a
  // "No Tax" fee simply carries no tax object.
  const tax = resolveLineTax(invoice, lines);

  const payload = {
    detail: {
      invoice_number: invoice.invoice_number,
      invoice_date: new Date().toISOString().split('T')[0],
      currency_code: 'USD',
      payment_term: { term_type: 'DUE_ON_DATE', due_date: dueDateString(invoice) },
    },
    primary_recipients: [{
      billing_info: {
        email_address: invoice.customer_email,
        name: { given_name: given, surname: family },
      },
    }],
    items: lines.map(line => {
      const item = {
        name: line.name.slice(0, 200),
        quantity: String(line.quantity),
        unit_amount: { currency_code: 'USD', value: line.unitPrice.toFixed(2) },
      };
      if (line.description) item.description = line.description.slice(0, 1000);
      if (tax.applies && line.taxable) {
        item.tax = { name: 'Sales Tax', percent: trimPercent(tax.percent) };
      }
      return item;
    }),
    // Be explicit rather than inheriting PayPal's defaults. tax_inclusive false means
    // the percentages above are added on top; tax_calculated_after_discount false keeps
    // the base the same one our own tax_amount was computed from, so a discounted
    // invoice doesn't quietly tax a different figure than the local record.
    configuration: {
      tax_inclusive: false,
      tax_calculated_after_discount: false,
    },
  };

  // Set only when there's something to say. PayPal's string fields are validated with
  // a minimum length too, so a blank note is a present-but-invalid value rather than
  // an absent one — the same trap Square's description sprang.
  const paypalNote = String(invoice.notes || '').trim();
  if (paypalNote) payload.detail.note = paypalNote.slice(0, 4000);

  const discount = money(invoice.discount_amount);
  if (discount > 0) {
    payload.amount = {
      breakdown: {
        discount: { invoice_discount: { amount: { currency_code: 'USD', value: discount.toFixed(2) } } },
      },
    };
  }

  const createRes = await fetch(`${base}/v2/invoicing/invoices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!createRes.ok) throw new Error(`PayPal draft creation failed: ${await createRes.text()}`);
  const created = await createRes.json();

  // No /send call — the invoice stays a PayPal draft.
  const dashboard = isSandbox ? 'https://www.sandbox.paypal.com' : 'https://www.paypal.com';
  return {
    processor: 'paypal',
    externalId: created.id,
    reviewUrl: `${dashboard}/invoice/s/details/${created.id}`,
    message: 'Draft invoice created in PayPal. Review it there, then send.',
  };
}

// ── QuickBooks Online ────────────────────────────────────────────────────────
// QBO has no explicit "draft" flag: an invoice exists once created, and is simply
// unsent until you POST /send. Creating without sending is the draft equivalent —
// it appears in the QBO invoice list for review.

async function createQuickBooksDraft({ userId, invoice, items }) {
  const { getValidQuickBooksToken, quickBooksApiBase, quickBooksAppBase } = require('../utils/quickbooksAuth');
  const { accessToken, realmId } = await getValidQuickBooksToken(userId);

  const request = async (path, options = {}) => {
    const res = await fetch(`${quickBooksApiBase()}/v3/company/${realmId}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!res.ok) {
      const detail = body?.Fault?.Error?.map(e => e.Detail || e.Message).join('; ') || text;
      throw new Error(`QuickBooks ${path} failed: ${detail}`);
    }
    return body;
  };

  // QBO requires a Customer reference. Match on email, then display name, else create.
  const escaped = String(invoice.customer_email || '').replace(/'/g, "\\'");
  const displayName = (invoice.customer_name || invoice.customer_email || 'Customer').slice(0, 100);
  const escapedName = displayName.replace(/'/g, "\\'");

  const found = await request(
    `/query?query=${encodeURIComponent(
      `SELECT Id, DisplayName FROM Customer WHERE PrimaryEmailAddr = '${escaped}' OR DisplayName = '${escapedName}' MAXRESULTS 1`
    )}`
  );

  let customerRef = found?.QueryResponse?.Customer?.[0]?.Id;
  if (!customerRef) {
    const { given, family } = splitName(invoice.customer_name);
    const createdCustomer = await request('/customer', {
      method: 'POST',
      body: JSON.stringify({
        DisplayName: displayName,
        GivenName: given || undefined,
        FamilyName: family || undefined,
        PrimaryEmailAddr: invoice.customer_email ? { Address: invoice.customer_email } : undefined,
        PrimaryPhone: invoice.customer_phone ? { FreeFormNumber: invoice.customer_phone } : undefined,
      }),
    });
    customerRef = createdCustomer.Customer.Id;
  }

  // Every QBO sales line needs an Item. Find or create a generic "Services" item
  // rather than mirroring the whole SORCE catalog into QuickBooks — the line's
  // Description carries the detail, which is what shows on the printed invoice.
  const itemRef = await findOrCreateServiceItem(request);

  // Whether this company even does sales tax, and whether QuickBooks computes it
  // itself. Read once per draft; a failure here falls back to the explicit tax line
  // below rather than posting a draft with no tax on it at all.
  const taxPrefs = await readQuickBooksTaxPrefs(request);

  const sourceLines = buildLines(invoice, items);
  const tax = resolveLineTax(invoice, sourceLines);

  // Native tax means marking each line taxable or not and letting QuickBooks apply the
  // company's tax code, rather than selling the customer a "Sales Tax" service. Only
  // possible when the company actually has sales tax turned on.
  const useNativeTax = taxPrefs.usingSalesTax && tax.applies;

  const toSalesLine = (line) => {
    const detail = {
      ItemRef: { value: itemRef },
      Qty: line.quantity,
      UnitPrice: line.unitPrice,
    };
    // TAX / NON is how QuickBooks expresses per-line taxability, so a "No Tax" fee
    // stays out of the base exactly as it does on the other processors.
    if (useNativeTax) {
      detail.TaxCodeRef = { value: line.taxable ? 'TAX' : 'NON' };
    }
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: line.amount,
      Description: (line.description ? `${line.name} — ${line.description}` : line.name).slice(0, 4000),
      SalesItemLineDetail: detail,
    };
  };

  const lines = sourceLines.map(toSalesLine);

  // Fallback only. Automated Sales Tax companies compute TxnTaxDetail server-side and
  // silently discard a TotalTax sent on create, so when native tax isn't available the
  // tax has to ride as an explicit sales line or the draft posts short by the whole
  // tax amount.
  if (!useNativeTax) {
    const qboTax = money(invoice.tax_amount);
    if (qboTax > 0) {
      lines.push(toSalesLine({
        name: 'Sales Tax', description: null, quantity: 1, unitPrice: qboTax, amount: qboTax, taxable: false,
      }));
    }
  }

  const discount = money(invoice.discount_amount);
  if (discount > 0) {
    lines.push({
      DetailType: 'DiscountLineDetail',
      Amount: discount,
      DiscountLineDetail: { PercentBased: false },
    });
  }

  const payload = {
    CustomerRef: { value: String(customerRef) },
    DocNumber: String(invoice.invoice_number || '').slice(0, 21) || undefined,
    TxnDate: new Date().toISOString().split('T')[0],
    DueDate: dueDateString(invoice),
    Line: lines,
    CustomerMemo: invoice.notes ? { value: String(invoice.notes).slice(0, 1000) } : undefined,
    BillEmail: invoice.customer_email ? { Address: invoice.customer_email } : undefined,
    // EmailStatus NotSet keeps it out of QBO's "to send" queue — a true draft.
    EmailStatus: 'NotSet',
  };

  if (useNativeTax) {
    // Automated Sales Tax works out the rate from the addresses on the transaction, so
    // it is handed the taxability and left to compute. A manual-sales-tax company has
    // no such engine, so it needs the tax code named explicitly — without one the
    // TAX-marked lines would post with zero tax.
    if (!taxPrefs.partnerTaxEnabled && taxPrefs.taxCodeRef) {
      payload.TxnTaxDetail = { TxnTaxCodeRef: { value: taxPrefs.taxCodeRef } };
    }
  }

  const created = await request('/invoice', { method: 'POST', body: JSON.stringify(payload) });
  const qboInvoice = created.Invoice;

  return {
    processor: 'quickbooks',
    externalId: String(qboInvoice.Id),
    reviewUrl: `${quickBooksAppBase()}/app/invoice?txnId=${qboInvoice.Id}`,
    message: 'Draft invoice created in QuickBooks. Review it there, then send.',
  };
}

/**
 * Read the company's sales-tax setup.
 *
 * partnerTaxEnabled true means Automated Sales Tax — QuickBooks owns the rate and
 * computes it from the transaction's addresses, so its figure can legitimately differ
 * from ours. Never throws: a company we can't read is treated as "no native tax" so
 * the caller falls back to an explicit tax line rather than dropping the tax.
 */
async function readQuickBooksTaxPrefs(request) {
  try {
    const prefs = await request('/preferences');
    const taxPrefs = prefs?.Preferences?.TaxPrefs || {};
    return {
      usingSalesTax: taxPrefs.UsingSalesTax === true,
      partnerTaxEnabled: taxPrefs.PartnerTaxEnabled === true,
      taxCodeRef: taxPrefs.TaxGroupCodeRef?.value ? String(taxPrefs.TaxGroupCodeRef.value) : null,
    };
  } catch {
    return { usingSalesTax: false, partnerTaxEnabled: false, taxCodeRef: null };
  }
}

// QBO sales lines can't exist without an Item. One shared service item keeps the
// merchant's QuickBooks product list clean; the detail lives in each line's Description.
async function findOrCreateServiceItem(request) {
  const existing = await request(
    `/query?query=${encodeURIComponent("SELECT Id FROM Item WHERE Name = 'Services' MAXRESULTS 1")}`
  );
  const foundId = existing?.QueryResponse?.Item?.[0]?.Id;
  if (foundId) return String(foundId);

  // A Service item needs an income account; pick the merchant's first income account.
  const accounts = await request(
    `/query?query=${encodeURIComponent("SELECT Id FROM Account WHERE AccountType = 'Income' MAXRESULTS 1")}`
  );
  const incomeAccountId = accounts?.QueryResponse?.Account?.[0]?.Id;
  if (!incomeAccountId) {
    throw new DraftInvoiceError(
      'QuickBooks has no income account to post this invoice to. Add one in QuickBooks, then try again.',
      'QBO_NO_INCOME_ACCOUNT'
    );
  }

  const created = await request('/item', {
    method: 'POST',
    body: JSON.stringify({
      Name: 'Services',
      Type: 'Service',
      IncomeAccountRef: { value: String(incomeAccountId) },
    }),
  });
  return String(created.Item.Id);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

const ADAPTERS = {
  square: createSquareDraft,
  stripe: createStripeDraft,
  paypal: createPayPalDraft,
  quickbooks: createQuickBooksDraft,
};

/**
 * Create a draft invoice in the given processor and record the result locally.
 *
 * @param {{userId: number, processor: string, invoice: object, items: object[]}} params
 * @returns {Promise<{processor: string, externalId: string, reviewUrl: string, message: string}>}
 */
async function createDraftInvoice({ userId, processor, invoice, items }) {
  const key = String(processor || '').toLowerCase();

  if (key === 'clover') {
    throw new DraftInvoiceError(
      'Clover removed its invoicing API, so invoices cannot be created in Clover automatically. ' +
      'Connect Square, Stripe, PayPal or QuickBooks, or send a SORCE invoice instead.',
      'UNSUPPORTED_PROCESSOR'
    );
  }

  const adapter = ADAPTERS[key];
  if (!adapter) {
    throw new DraftInvoiceError(`${processor} can't create draft invoices.`, 'UNSUPPORTED_PROCESSOR');
  }

  if (!invoice.customer_email) {
    throw new DraftInvoiceError('A customer email is required to create a draft invoice.', 'NO_EMAIL');
  }

  const idColumn = {
    square: 'square_invoice_id',
    stripe: 'stripe_invoice_id',
    paypal: 'paypal_invoice_id',
    quickbooks: 'quickbooks_invoice_id',
  }[key];

  // Idempotency. Each adapter mints a fresh idempotency key per call, so without a
  // guard a double-click (or the auto-draft racing the manual button) puts TWO drafts
  // in the merchant's account and the second overwrites the first's id, orphaning it.
  // If we already drafted this invoice into this processor, hand back the existing one.
  const existingId = invoice[idColumn];
  if (existingId) {
    return {
      processor: key,
      externalId: existingId,
      reviewUrl: invoice.processor_draft_url || null,
      alreadyExisted: true,
      message: `This invoice is already drafted in ${key}. Review and send it there.`,
    };
  }

  // The check above reads a row fetched by the caller, so it cannot see a draft that
  // started after that read. Claim the invoice atomically instead: one UPDATE decides
  // the winner even across Railway instances, which an in-process lock could not.
  // The staleness window releases a claim whose process died mid-call.
  const claim = await pool.query(
    `UPDATE invoices SET draft_claimed_at = NOW()
     WHERE id = $1
       AND ${idColumn} IS NULL
       AND (draft_claimed_at IS NULL OR draft_claimed_at < NOW() - INTERVAL '2 minutes')
     RETURNING id`,
    [invoice.id]
  );

  if (claim.rowCount === 0) {
    // Lost the race. Either the other caller has already finished (id now set, so
    // return it) or it is still in flight (say so rather than creating a second draft).
    const fresh = await pool.query(
      `SELECT ${idColumn} AS external_id, processor_draft_url FROM invoices WHERE id = $1`,
      [invoice.id]
    );
    const row = fresh.rows[0];
    if (row?.external_id) {
      return {
        processor: key,
        externalId: row.external_id,
        reviewUrl: row.processor_draft_url || null,
        alreadyExisted: true,
        message: `This invoice is already drafted in ${key}. Review and send it there.`,
      };
    }
    throw new DraftInvoiceError(
      `A draft for this invoice is already being created in ${key}. Give it a moment, then refresh.`,
      'DRAFT_IN_PROGRESS'
    );
  }

  let result;
  try {
    result = await adapter({ userId, invoice, items });
  } catch (err) {
    // Release the claim so the user can retry immediately instead of waiting out the
    // staleness window on a draft that never got created.
    await pool.query('UPDATE invoices SET draft_claimed_at = NULL WHERE id = $1', [invoice.id]).catch(() => {});
    throw err;
  }

  // Persist the processor's id so the guard above catches the next click, and so the
  // UI can link straight to the draft.
  await pool.query(
    `UPDATE invoices
     SET ${idColumn} = $1, payment_processor = $2, processor_draft_url = $3, updated_at = NOW()
     WHERE id = $4`,
    [result.externalId, key, result.reviewUrl, invoice.id]
  );

  return result;
}

// Which of the user's connected processors can actually take a draft invoice.
// The UI uses this to decide whether to show the button at all, and to explain
// Clover rather than silently omitting it.
async function getDraftCapableConnections(userId) {
  const [result, settings] = await Promise.all([
    pool.query(
      'SELECT processor, is_primary FROM payment_connections WHERE user_id = $1 AND is_active = true ORDER BY is_primary DESC, created_at ASC',
      [userId]
    ),
    pool.query('SELECT auto_draft_invoices FROM users WHERE id = $1', [userId]),
  ]);
  const connected = result.rows.map(r => r.processor);
  const capable = connected.filter(p => DRAFT_CAPABLE_PROCESSORS.includes(p));
  return {
    connected,
    capable,
    // True when the only thing they've connected is Clover — the UI shows the
    // "Clover has no invoice API" note in that case.
    cloverOnly: connected.length > 0 && connected.every(p => p === 'clover'),
    // Whether new bookings draft automatically, and where they land. The UI renders
    // the toggle from this, and the manual button's copy changes when it is on.
    autoDraft: settings.rows[0]?.auto_draft_invoices !== false,
    autoDraftProcessor: capable[0] || null,
  };
}

module.exports = {
  createDraftInvoice,
  getDraftCapableConnections,
  buildLines,
  DraftInvoiceError,
  DRAFT_CAPABLE_PROCESSORS,
};
