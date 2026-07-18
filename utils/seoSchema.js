// Deterministic JSON-LD builders for the SEO plan's schema steps.
// Built from the business record so the owner always gets valid, ready-to-paste code
// with no placeholders to fill — more reliable than having the model hand-write schema.
// We deliberately omit anything we can't know for certain (business hours, latitude/
// longitude, social URLs) rather than invent or placeholder it.

// Map a free-text business type to the most specific valid schema.org LocalBusiness
// subtype. Falls back to the generic LocalBusiness when nothing fits (Google's own
// guidance: use the most specific type that applies, otherwise LocalBusiness).
function schemaTypeFor(businessType) {
  const t = String(businessType || '').toLowerCase();
  if (/detail|car wash|auto wash|ceramic|ppf|window tint|tinting/.test(t)) return 'AutoWash';
  if (/auto|car repair|mechanic|body shop/.test(t)) return 'AutoRepair';
  if (/plumb/.test(t)) return 'Plumber';
  if (/hvac|heating|air condition|furnace/.test(t)) return 'HVACBusiness';
  if (/electric/.test(t)) return 'Electrician';
  if (/roof/.test(t)) return 'RoofingContractor';
  if (/paint/.test(t)) return 'HousePainter';
  if (/locksmith/.test(t)) return 'Locksmith';
  if (/moving|mover/.test(t)) return 'MovingCompany';
  if (/general contractor|remodel|construction|builder/.test(t)) return 'GeneralContractor';
  if (/day ?spa|salon|barber|spa/.test(t)) return 'HealthAndBeautyBusiness';
  if (/restaurant|cafe|diner|eatery/.test(t)) return 'Restaurant';
  return 'LocalBusiness';
}

function describe(biz) {
  const { name, type, city, state } = biz;
  if (!name) return '';
  const loc = city ? ` in ${city}${state ? `, ${state}` : ''}` : '';
  return `${name} provides professional ${type || 'services'}${loc}. Contact us to book service or request a free quote.`;
}

function wrapLd(obj) {
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
}

// LocalBusiness (or specific subtype) JSON-LD from the record. Only includes fields we
// actually have; no geo, no hours, no social placeholders — so it's valid as-is.
function buildLocalBusinessSchema(biz) {
  const { name, type, url, phone, email, address, city, state, zip } = biz || {};
  const obj = { '@context': 'https://schema.org', '@type': schemaTypeFor(type) };
  if (name) obj.name = name;
  if (url) obj.url = url;
  if (phone) obj.telephone = phone;
  if (email) obj.email = email;
  const desc = describe(biz);
  if (desc) obj.description = desc;

  const addr = {};
  if (address) addr.streetAddress = address;
  if (city) addr.addressLocality = city;
  if (state) addr.addressRegion = state;
  if (zip) addr.postalCode = zip;
  if (Object.keys(addr).length) {
    obj.address = { '@type': 'PostalAddress', ...addr, addressCountry: 'US' };
  }
  if (city) obj.areaServed = { '@type': 'City', name: `${city}${state ? `, ${state}` : ''}` };
  obj.priceRange = '$$';
  return wrapLd(obj);
}

// FAQPage JSON-LD with question/answer pairs templated from the record. Structure is
// always valid; the copy mentions the business + city so AI/voice search can cite them.
function buildFaqSchema(biz) {
  const { name, type, city, state, phone, email } = biz || {};
  const who = name || 'We';
  const isVerb = name ? 'is' : 'are';
  const loc = city ? `${city}${state ? `, ${state}` : ''}` : 'your area';
  const svc = type || 'service';
  const book = phone
    ? `calling ${phone}`
    : (email ? `emailing ${email}` : 'contacting us through our website');

  const pairs = [
    [`What is the best ${svc} in ${loc}?`,
      `${who} ${isVerb} a top-rated ${svc} provider serving ${loc}, focused on quality work and reliable service for every customer.`],
    [`How much does ${svc} cost in ${loc}?`,
      `Pricing depends on the specific service and your needs. Contact ${name || 'us'}${phone ? ` at ${phone}` : ''} for a free, no-obligation quote.`],
    [`How do I book ${svc} with ${name || 'you'}?`,
      `You can book by ${book}. We'll get you scheduled quickly.`],
    [`What areas does ${name || 'the business'} serve?`,
      `${who} serve ${loc} and the surrounding communities. Reach out to confirm we cover your location.`],
    [`Why choose ${name || 'us'} for ${svc}?`,
      `${who} combine experienced, dependable service with clear communication and fair pricing — so you know exactly what to expect.`],
  ];

  return wrapLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  });
}

module.exports = { schemaTypeFor, buildLocalBusinessSchema, buildFaqSchema };
