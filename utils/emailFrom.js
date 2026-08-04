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
  TRANSACTIONAL_EMAIL,
  BULK_EMAIL,
};
