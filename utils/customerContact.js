// Shared validation for the customer contact block on a booking.
//
// Email and phone are both required to complete a booking: the email is what the
// confirmation, reminder and invoice all go to, and the phone is what the SMS
// pipeline and the crew use on the day. A booking missing either one silently
// fails downstream rather than at the point of entry, so we reject it here.
//
// Deliberately NOT reformatting the phone number on write — `leads.phone` and
// `bookings.customer_phone` already hold a mix of formats and lookups match on
// several variants, so normalizing only new rows would widen that split.

// Intentionally permissive: one @, no whitespace, a dot in the domain. Anything
// stricter starts rejecting valid real-world addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Count digits rather than pattern-matching, so (555) 123-4567, 555.123.4567 and
// +1 555 123 4567 all pass. 10 digits = US/Canada, 11 = with country code; allow
// up to 15 (E.164 max) for international.
function digitCount(value) {
  return (String(value).match(/\d/g) || []).length;
}

/**
 * @param {{name?: string, email?: string, phone?: string}} customerInfo
 * @returns {{ok: true, name: string, email: string, phone: string} | {ok: false, error: string}}
 */
function validateCustomerContact(customerInfo) {
  const info = customerInfo || {};
  const name = String(info.name || '').trim();
  const email = String(info.email || '').trim();
  const phone = String(info.phone || '').trim();

  if (!name) return { ok: false, error: 'Customer name is required' };
  if (!email) return { ok: false, error: 'Customer email is required to complete a booking' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid customer email address' };
  if (!phone) return { ok: false, error: 'Customer phone number is required to complete a booking' };

  const digits = digitCount(phone);
  if (digits < 10 || digits > 15) {
    return { ok: false, error: 'Enter a valid customer phone number' };
  }

  return { ok: true, name, email, phone };
}

module.exports = { validateCustomerContact, EMAIL_RE };
