// Two separate sending identities, and which mail goes on which one is the whole point.
//
// Splitting them is right: when one identity carried marketing blasts, review chases and
// "you have a new lead" alerts together, a single complaint-heavy campaign could push a
// business owner's alerts into spam. Promotional mail can no longer drag transactional
// mail down.
//
// What was wrong was the direction. Transactional went onto a brand-new subdomain,
// notify@mail.sorceintegrations.com, and every one of those emails went to Junk at
// Microsoft — three different templates in two days, all with SPF, DKIM, DMARC and
// compauth passing. The headers were unambiguous: SCL:5, SFV:SPM, CAT:SPM, BCL:0,
// IPV:NLI. Nothing wrong with the mail; no reputation behind the sender. At 7-32 emails a
// day on a shared SendGrid pool there is no volume to build any with, either.
//
// A From address is its own reputation record. Moving noreply@ to help@ cost the inbox
// once, and moving help@ to a new subdomain cost it again. So put the mail that MUST land
// on the identity that already has history, and put the mail that can afford weeks of
// inconsistent delivery on the new subdomain while it warms up. That is the opposite of
// what was done, and it still keeps the two apart:
//
//   SENDGRID_TRANSACTIONAL_FROM=noreply@sorceintegrations.com      <- months of history
//   SENDGRID_BULK_FROM=news@marketing.sorceintegrations.com        <- new, warming
//
// Two things also make mail.sorceintegrations.com a weaker identity than the root domain
// on paper, and both are worth fixing before anything transactional moves back onto it:
// it has no MX and no A record, so filters see a From domain that cannot receive mail,
// and it has no SPF TXT of its own. Neither breaks authentication — the envelope passes
// on em5237.mail.sorceintegrations.com via SendGrid's CNAME — but "domain can't receive
// mail" is a signal receivers do score.
//
// The default is noreply@ rather than help@ deliberately: if the env var is ever unset,
// the fallback should be the address with the best history, not the one that already lost
// the inbox once.
const LEGACY_FROM = 'noreply@sorceintegrations.com';

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
