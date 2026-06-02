const { pool } = require('../config/database');

// Normalize an incoming service list into [{ id, price?: number }]. Accepts:
//   • [12, 13]                              — legacy bare-ID array
//   • [{ id: 12 }, { id: 13, price: 80 }]   — new shape (per-item price override)
//   • [{ serviceId: 12, price: '80' }]      — either id key works
// A non-finite/negative price is dropped silently (we fall back to the catalog price).
function normalizeServiceList(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(entry => {
      if (entry == null) return null;
      if (typeof entry === 'number' || typeof entry === 'string') {
        const id = Number(entry);
        return Number.isFinite(id) ? { id, price: undefined } : null;
      }
      const id = Number(entry.id ?? entry.serviceId);
      if (!Number.isFinite(id)) return null;
      let price;
      if (entry.price !== undefined && entry.price !== null && entry.price !== '') {
        const parsed = parseFloat(entry.price);
        if (Number.isFinite(parsed) && parsed >= 0) price = parsed;
      }
      return { id, price };
    })
    .filter(Boolean);
}

// Build the ordered service list for a booking: mains first, then add-ons.
// Each entry carries the resolved DB row plus the effective per-booking price.
// Pass userId to scope to the current user's catalog (create flow), or null to skip
// scoping (edit flow — the booking itself is already user-scoped).
async function resolveBookingServices({ userId, mains, addons }) {
  const allIds = [...mains.map(s => s.id), ...addons.map(s => s.id)];
  if (allIds.length === 0) return [];
  const query = userId
    ? 'SELECT id, name, price, duration_hours FROM services WHERE id = ANY($1::int[]) AND user_id = $2'
    : 'SELECT id, name, price, duration_hours FROM services WHERE id = ANY($1::int[])';
  const params = userId ? [allIds, userId] : [allIds];
  const result = await pool.query(query, params);
  const byId = new Map(result.rows.map(r => [Number(r.id), r]));
  const resolve = (entry, isAddon) => {
    const row = byId.get(Number(entry.id));
    if (!row) return null;
    const effectivePrice = entry.price !== undefined ? entry.price : parseFloat(row.price);
    return {
      id: Number(row.id),
      name: row.name,
      duration_hours: parseFloat(row.duration_hours) || 0,
      price: effectivePrice,
      is_addon: isAddon,
    };
  };
  return [
    ...mains.map(s => resolve(s, false)).filter(Boolean),
    ...addons.map(s => resolve(s, true)).filter(Boolean),
  ];
}

module.exports = { normalizeServiceList, resolveBookingServices };
