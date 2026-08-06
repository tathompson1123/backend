// Two separate sending identities, and the reason matters.
//
// Everything used to send as noreply@sorceintegrations.com and reached the inbox.
// Moving it all to help@sorceintegrations.com pushed owner alerts into spam — not
// because the address is wrong, but because a From address is its own reputation
// record at Gmail. noreply@ had months of delivered-and-opened history; help@ started
// from nothing and inherited none of it.
//
// The deeper problem is that one identity carried everything. Marketing blasts, review
// chases and "you have a new lead" alerts all shared a reputation, so a single
// complaint-heavy campaign could push a business owner's alerts into spam. Splitting
// them means promotional mail can never drag transactional mail down again.
//
// Both default to the current address so nothing moves until the DNS for the new
// subdomain is actually verified in SendGrid. Point the env vars at it once it is:
//
//   SENDGRID_TRANSACTIONAL_FROM=notify@mail.sorceintegrations.com
//   SENDGRID_BULK_FROM=news@marketing.sorceintegrations.com
//
// Setting either before its domain is authenticated will send unsigned mail, which is
// worse than the problem being fixed — verify in SendGrid first.
const LEGACY_FROM = 'help@sorceintegrations.com';

const TRANSACTIONAL_EMAIL = process.env.SENDGRID_TRANSACTIONAL_FROM || LEGACY_FROM;
const BULK_EMAIL = process.env.SENDGRID_BULK_FROM || LEGACY_FROM;

// Where a reply to one of our own alerts should land.
//
// The transactional subdomain sends and never receives — mail.sorceintegrations.com has
// no MX and no A record, so anything sent back to notify@ hard-bounces. That makes
// "just omit Reply-To" the wrong fix for an owner alert: the reply black-holes.
//
// It used to be worse. Several owner alerts set Reply-To to the owner's own address,
// which is both useless (their reply arrives back in their own inbox) and an active
// deliverability problem — an external domain asking you to reply to yourself is a
// spoof shape. Microsoft scored one of these SCL:5 with SFV:SPM and filed it in Junk,
// with SPF, DKIM, DMARC and compauth all passing.
//
// The root domain's MX is Microsoft 365, so anything @sorceintegrations.com is a real
// mailbox and safe to point replies at.
const SUPPORT_EMAIL = process.env.SORCE_SUPPORT_EMAIL || 'help@sorceintegrations.com';

// Reply target for mail we send to a business owner about one of their customers.
//
// Prefer whoever the owner would actually want to reach — usually that customer, so
// hitting Reply just works. SMS-only leads have no email address, and those fall back to
// our own inbox so the reply reaches a human instead of bouncing.
function ownerAlertReplyTo(customerEmail, customerName) {
  if (customerEmail) {
    return customerName ? { name: customerName, email: customerEmail } : { email: customerEmail };
  }
  return { name: 'SORCE Support', email: SUPPORT_EMAIL };
}

// Alerts, receipts, verification, booking confirmations — mail a person asked for or
// needs. Must reach the inbox.
function transactionalFrom(name) {
  return { name: name || 'SORCE', email: TRANSACTIONAL_EMAIL };
}

// Campaigns and review chases — promotional mail that carries an unsubscribe and can
// attract complaints. Kept off the transactional identity on purpose.
function bulkFrom(name) {
  return { name: name || 'SORCE', email: BULK_EMAIL };
}

// A business's own name on the From line, still sent from our infrastructure. "via
// SORCE" is deliberate: a display name claiming to be another company over an address
// that plainly isn't theirs is a phishing shape, and filters read it that way.
function businessFrom(businessName, { bulk = false } = {}) {
  const base = bulk ? bulkFrom() : transactionalFrom();
  return {
    name: businessName ? `${businessName} via SORCE` : 'Your Service Provider',
    email: base.email,
  };
}

module.exports = {
  transactionalFrom,
  bulkFrom,
  businessFrom,
  ownerAlertReplyTo,
  TRANSACTIONAL_EMAIL,
  BULK_EMAIL,
  SUPPORT_EMAIL,
};
