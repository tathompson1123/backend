const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { MAX_DESCRIPTION_LENGTH } = require('../utils/bookingServices');

// Reusable line-item descriptions for services.
//
// A preset with service_id set belongs to that service. A preset with service_id
// NULL is a "global" preset offered on every service (boilerplate like travel/
// disposal wording). Exactly one preset per service may be is_default; that one
// pre-fills the description box when the service is added to a booking.
//
// Read routes are also exposed to the employee app via routes/employee-api.js so
// the two booking forms offer the same list.

const MAX_LABEL_LENGTH = 120;

// Shared read used by both this router and the employee app.
async function listPresets(userId, serviceId) {
  const params = [userId];
  let where = 'p.user_id = $1';
  // Ignore a non-numeric ?serviceId rather than passing NaN to pg, which errors with
  // "invalid input syntax for type integer" and surfaces as a 500.
  const numericServiceId = Number(serviceId);
  if (serviceId !== undefined && serviceId !== '' && Number.isFinite(numericServiceId)) {
    // Include global presets alongside the service's own.
    params.push(numericServiceId);
    where += ' AND (p.service_id = $2 OR p.service_id IS NULL)';
  }
  const result = await pool.query(
    `SELECT p.id, p.service_id, p.label, p.body, p.is_default, p.sort_order, s.name AS service_name
     FROM service_description_presets p
     LEFT JOIN services s ON s.id = p.service_id
     WHERE ${where}
     ORDER BY p.service_id NULLS LAST, p.is_default DESC, p.sort_order, p.id`,
    params
  );
  return result.rows;
}

// Validate + normalize a preset body from the request. Returns {ok, ...} so callers
// can return a specific message rather than a generic 400.
function parsePresetBody(body) {
  const label = String(body?.label ?? '').trim();
  const text = String(body?.body ?? '').trim();
  if (!label) return { ok: false, error: 'A preset needs a short label' };
  if (!text) return { ok: false, error: 'A preset needs description text' };

  // service_id is optional: omitted/null means the preset applies to every service.
  let serviceId = null;
  if (body.serviceId !== undefined && body.serviceId !== null && body.serviceId !== '') {
    serviceId = Number(body.serviceId);
    if (!Number.isFinite(serviceId)) return { ok: false, error: 'Invalid service' };
  }

  return {
    ok: true,
    label: label.slice(0, MAX_LABEL_LENGTH),
    body: text.slice(0, MAX_DESCRIPTION_LENGTH),
    serviceId,
    isDefault: Boolean(body.isDefault),
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
  };
}

// A service may only have one default. Clear the incumbent before setting a new one,
// otherwise the partial unique index rejects the write.
async function clearExistingDefault(client, userId, serviceId, exceptId) {
  const params = [userId];
  let scope;
  if (serviceId === null) {
    scope = 'service_id IS NULL';
  } else {
    params.push(serviceId);
    scope = `service_id = $${params.length}`;
  }
  let exclusion = '';
  if (exceptId) {
    params.push(exceptId);
    exclusion = ` AND id <> $${params.length}`;
  }
  await client.query(
    `UPDATE service_description_presets SET is_default = false
     WHERE user_id = $1 AND ${scope} AND is_default${exclusion}`,
    params
  );
}

// Confirm a service belongs to the caller before attaching a preset to it.
async function assertOwnsService(userId, serviceId) {
  if (serviceId === null) return true;
  const owned = await pool.query(
    'SELECT 1 FROM services WHERE id = $1 AND user_id = $2',
    [serviceId, userId]
  );
  return owned.rows.length > 0;
}

// GET /api/service-descriptions?serviceId=12
// Omit serviceId to get every preset (the settings screen lists them all).
router.get('/', authenticateToken, async (req, res) => {
  try {
    const rows = await listPresets(req.user.userId, req.query.serviceId);
    res.json({ presets: rows });
  } catch (error) {
    console.error('Error listing service descriptions:', error.message);
    res.status(500).json({ error: 'Failed to load description presets' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const parsed = parsePresetBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const userId = req.user.userId;
  if (!(await assertOwnsService(userId, parsed.serviceId))) {
    return res.status(404).json({ error: 'Service not found' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (parsed.isDefault) await clearExistingDefault(client, userId, parsed.serviceId, null);
    const result = await client.query(
      `INSERT INTO service_description_presets (user_id, service_id, label, body, is_default, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, parsed.serviceId, parsed.label, parsed.body, parsed.isDefault, parsed.sortOrder]
    );
    await client.query('COMMIT');
    res.status(201).json({ preset: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating service description:', error.message);
    res.status(500).json({ error: 'Failed to save description preset' });
  } finally {
    client.release();
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const parsed = parsePresetBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const userId = req.user.userId;
  if (!(await assertOwnsService(userId, parsed.serviceId))) {
    return res.status(404).json({ error: 'Service not found' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (parsed.isDefault) {
      await clearExistingDefault(client, userId, parsed.serviceId, Number(req.params.id));
    }
    const result = await client.query(
      `UPDATE service_description_presets
       SET service_id = $1, label = $2, body = $3, is_default = $4, sort_order = $5, updated_at = NOW()
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [parsed.serviceId, parsed.label, parsed.body, parsed.isDefault, parsed.sortOrder,
       req.params.id, userId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Preset not found' });
    }
    await client.query('COMMIT');
    res.json({ preset: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating service description:', error.message);
    res.status(500).json({ error: 'Failed to update description preset' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM service_description_presets WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Preset not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting service description:', error.message);
    res.status(500).json({ error: 'Failed to delete description preset' });
  }
});

module.exports = router;
module.exports.listPresets = listPresets;
