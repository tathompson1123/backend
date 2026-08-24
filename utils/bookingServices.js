const { pool } = require('../config/database');

// Max length of a per-line service description. Square caps line-item names at 255
// and QuickBooks caps Description at 4000; 1000 is comfortably under both while
// still allowing a real paragraph.
const MAX_DESCRIPTION_LENGTH = 1000;

// Normalize an incoming service list into [{ id, price?: number, description?: string }].
// Accepts:
//   • [12, 13]                                        — legacy bare-ID array
//   • [{ id: 12 }, { id: 13, price: 80 }]             — per-item price override
//   • [{ serviceId: 12, price: '80', description }]   — either id key works
// A non-finite/negative price is dropped silently (we fall back to the catalog price).
// A blank/whitespace-only description is dropped so the default preset can fill in.
function normalizeServiceList(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(entry => {
      if (entry == null) return null;
      if (typeof entry === 'number' || typeof entry === 'string') {
        const id = Number(entry);
        return Number.isFinite(id) ? { id, price: undefined, description: undefined } : null;
      }
      const id = Number(entry.id ?? entry.serviceId);
      if (!Number.isFinite(id)) return null;
      let price;
      if (entry.price !== undefined && entry.price !== null && entry.price !== '') {
        const parsed = parseFloat(entry.price);
        if (Number.isFinite(parsed) && parsed >= 0) price = parsed;
      }
      // Three states, and they must stay distinct:
      //   key absent        → undefined → fall back to the service's default preset
      //   key present, blank→ null      → the user deliberately cleared it, leave it empty
      //   key present, text → string    → use it
      let description;
      if ('description' in entry) {
        const trimmed = String(entry.description ?? '').trim();
        description = trimmed ? trimmed.slice(0, MAX_DESCRIPTION_LENGTH) : null;
      }
      return { id, price, description };
    })
    .filter(Boolean);
}

// Build the ordered service list for a booking: mains first, then add-ons.
// Each entry carries the resolved DB row plus the effective per-booking price.
// Pass userId to scope to the current user's catalog (create flow), or null to skip
// scoping (edit flow — the booking itself is already user-scoped).
// existingDescriptions: optional Map(service_id → description) from the booking's
// current booking_items. The edit paths delete and re-insert every line, so without
// this a caller that omits `description` (the app's reschedule payload, any older
// client) would have the stored text replaced by the service's default preset.
// Precedence: explicit value from the caller → what's already stored → default preset.
async function resolveBookingServices({ userId, mains, addons, existingDescriptions }) {
  const allIds = [...mains.map(s => s.id), ...addons.map(s => s.id)];
  if (allIds.length === 0) return [];
  const query = userId
    ? 'SELECT id, name, price, duration_hours FROM services WHERE id = ANY($1::int[]) AND user_id = $2'
    : 'SELECT id, name, price, duration_hours FROM services WHERE id = ANY($1::int[])';
  const params = userId ? [allIds, userId] : [allIds];
  const result = await pool.query(query, params);
  const byId = new Map(result.rows.map(r => [Number(r.id), r]));

  // Fall back to each service's default description preset for any line the caller
  // didn't supply one for. The dashboard and app pre-fill this client-side, so this
  // mainly covers the public widget, embed, chat agent and any direct API use.
  // Only reach for defaults when a line has no explicit description AND nothing is
  // already stored for it.
  const needsDefault = [...mains, ...addons].some(
    s => s.description === undefined && !existingDescriptions?.has(Number(s.id))
  );
  const ownerId = needsDefault ? (userId || await resolveOwnerIdForServices(allIds)) : null;
  const defaultsByServiceId = ownerId
    ? await fetchDefaultDescriptions(ownerId, allIds)
    : new Map();

  const resolve = (entry, isAddon) => {
    const row = byId.get(Number(entry.id));
    if (!row) return null;
    const effectivePrice = entry.price !== undefined ? entry.price : parseFloat(row.price);
    const description = entry.description !== undefined
      ? entry.description
      : (existingDescriptions?.get(Number(row.id))
         ?? defaultsByServiceId.get(Number(row.id))
         ?? null);
    return {
      id: Number(row.id),
      name: row.name,
      duration_hours: parseFloat(row.duration_hours) || 0,
      price: effectivePrice,
      description,
      is_addon: isAddon,
    };
  };
  return [
    ...mains.map(s => resolve(s, false)).filter(Boolean),
    ...addons.map(s => resolve(s, true)).filter(Boolean),
  ];
}

// The edit flow calls resolveBookingServices with userId null (the booking is already
// user-scoped). Derive the owner from the services themselves so preset defaults still
// resolve. Returns null if the ids span multiple owners, which shouldn't happen.
async function resolveOwnerIdForServices(serviceIds) {
  const owners = await pool.query(
    'SELECT DISTINCT user_id FROM services WHERE id = ANY($1::int[])',
    [serviceIds]
  );
  return owners.rows.length === 1 ? Number(owners.rows[0].user_id) : null;
}

// Map of service_id → default description body. Used by the booking paths that have
// no description UI (public widget, embed, chat agent) so an invoice generated from
// one of those bookings still carries a real line description.
// Never throws: a missing table or a bad id must not take a booking down.
async function fetchDefaultDescriptions(userId, serviceIds) {
  const map = new Map();
  if (!userId || !serviceIds?.length) return map;
  try {
    // Include the user's global default (service_id IS NULL) — it applies to every
    // service that doesn't have one of its own. Ordering NULLS FIRST then letting the
    // per-service row overwrite means the specific default always wins.
    const presets = await pool.query(
      `SELECT service_id, body FROM service_description_presets
       WHERE user_id = $1 AND is_default AND (service_id IS NULL OR service_id = ANY($2::int[]))
       ORDER BY service_id NULLS FIRST`,
      [userId, serviceIds]
    );
    let globalDefault = null;
    for (const row of presets.rows) {
      if (row.service_id == null) globalDefault = row.body;
      else map.set(Number(row.service_id), row.body);
    }
    if (globalDefault) {
      for (const id of serviceIds) {
        if (!map.has(Number(id))) map.set(Number(id), globalDefault);
      }
    }
  } catch (err) {
    console.error('Could not load default service descriptions:', err.message);
  }
  return map;
}

// Current per-service descriptions on a booking, for the edit paths that delete and
// re-insert every booking_items row. Never throws — a lookup failure must not block
// the edit, it just means defaults apply as before.
async function fetchBookingDescriptions(bookingId) {
  const map = new Map();
  try {
    const rows = await pool.query(
      'SELECT service_id, description FROM booking_items WHERE booking_id = $1 AND description IS NOT NULL',
      [bookingId]
    );
    for (const row of rows.rows) map.set(Number(row.service_id), row.description);
  } catch (err) {
    console.error('Could not load existing booking descriptions:', err.message);
  }
  return map;
}

module.exports = {
  normalizeServiceList,
  resolveBookingServices,
  fetchDefaultDescriptions,
  fetchBookingDescriptions,
  MAX_DESCRIPTION_LENGTH,
};
