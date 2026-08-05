const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { TRANSACTIONAL_EMAIL } = require('../utils/emailFrom');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sorceintegrations.com';

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcTotals(items, taxRate = 0, discountAmount = 0) {
  const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const taxAmount = subtotal * taxRate;
  const totalAmount = subtotal + taxAmount - discountAmount;
  return { subtotal, taxAmount, totalAmount };
}

async function getEstimateWithItems(id, userId) {
  const result = await pool.query(
    `SELECT e.*,
       json_agg(json_build_object(
         'id', ei.id, 'description', ei.description,
         'quantity', ei.quantity, 'unit_price', ei.unit_price, 'amount', ei.amount, 'service_id', ei.service_id
       )) FILTER (WHERE ei.id IS NOT NULL) as items
     FROM estimates e
     LEFT JOIN estimate_items ei ON e.id = ei.estimate_id
     WHERE e.id = $1 AND e.user_id = $2
     GROUP BY e.id`,
    [id, userId]
  );
  return result.rows[0] || null;
}

// ── GET /api/estimates ────────────────────────────────────────────────────────

router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, startDate, endDate, customerId } = req.query;

    let query = `
      SELECT e.*,
        json_agg(json_build_object(
          'id', ei.id, 'description', ei.description,
          'quantity', ei.quantity, 'unit_price', ei.unit_price, 'amount', ei.amount
        )) FILTER (WHERE ei.id IS NOT NULL) as items
      FROM estimates e
      LEFT JOIN estimate_items ei ON e.id = ei.estimate_id
      WHERE e.user_id = $1
    `;
    const params = [userId];
    let p = 1;

    if (status)     { p++; query += ` AND e.status = $${p}`;          params.push(status); }
    if (startDate)  { p++; query += ` AND e.issue_date >= $${p}`;     params.push(startDate); }
    if (endDate)    { p++; query += ` AND e.issue_date <= $${p}`;     params.push(endDate); }
    if (customerId) { p++; query += ` AND e.customer_id = $${p}`;     params.push(customerId); }

    query += ' GROUP BY e.id ORDER BY e.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ estimates: result.rows });
  } catch (err) {
    console.error('Error fetching estimates:', err.message);
    res.status(500).json({ error: 'Failed to fetch estimates' });
  }
});

// ── GET /api/estimates/settings ──────────────────────────────────────────────

router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query('SELECT default_tax_rate FROM users WHERE id = $1', [userId]);
    res.json({ defaultTaxRate: result.rows[0]?.default_tax_rate || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ── GET /api/estimates/catalog ────────────────────────────────────────────────
// Reuse the same invoice_items_catalog table

router.get('/catalog', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM invoice_items_catalog WHERE user_id = $1 AND active = true ORDER BY name",
      [req.user.userId]
    );
    res.json({ items: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// ── GET /api/estimates/:id ────────────────────────────────────────────────────

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const estimate = await getEstimateWithItems(req.params.id, req.user.userId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    res.json({ estimate });
  } catch (err) {
    console.error('Error fetching estimate:', err.message);
    res.status(500).json({ error: 'Failed to fetch estimate' });
  }
});

// ── POST /api/estimates ───────────────────────────────────────────────────────

router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { customerId, customerName, customerEmail, customerPhone, items, notes, terms, validUntil, taxRate, discountAmount, links, attachments } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    // EST-YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix  = crypto.randomBytes(2).toString('hex').toUpperCase();
    const estimateNumber = `EST-${dateStr}-${suffix}`;

    const effectiveTaxRate = taxRate || 0;
    const effectiveDiscount = discountAmount || 0;
    const { subtotal, taxAmount, totalAmount } = calcTotals(items, effectiveTaxRate, effectiveDiscount);
    const viewToken = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
      `INSERT INTO estimates (
         user_id, customer_id, estimate_number, customer_name, customer_email, customer_phone,
         subtotal, tax_rate, tax_amount, discount_amount, total_amount,
         status, valid_until, notes, terms, view_token, links, attachments
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [userId, customerId || null, estimateNumber, customerName, customerEmail, customerPhone,
       subtotal, effectiveTaxRate, taxAmount, effectiveDiscount, totalAmount,
       validUntil || null, notes, terms, viewToken,
       JSON.stringify(links || []), JSON.stringify(attachments || [])]
    );

    const estimate = result.rows[0];
    for (const item of items) {
      await pool.query(
        `INSERT INTO estimate_items (estimate_id, description, quantity, unit_price, amount, service_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [estimate.id, item.description, item.quantity, item.unitPrice, item.quantity * item.unitPrice, item.serviceId || null]
      );
    }

    res.json({ success: true, estimate });
  } catch (err) {
    console.error('Error creating estimate:', err.message);
    res.status(500).json({ error: 'Failed to create estimate' });
  }
});

// ── PUT /api/estimates/:id ────────────────────────────────────────────────────

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { customerId, customerName, customerEmail, customerPhone, items, notes, terms, validUntil, taxRate, discountAmount, links, attachments } = req.body;

    const existing = await getEstimateWithItems(id, userId);
    if (!existing) return res.status(404).json({ error: 'Estimate not found' });
    if (!['draft', 'sent'].includes(existing.status)) {
      return res.status(400).json({ error: 'Only draft or sent estimates can be edited' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    const effectiveTaxRate = taxRate ?? existing.tax_rate;
    const effectiveDiscount = discountAmount ?? existing.discount_amount;
    const { subtotal, taxAmount, totalAmount } = calcTotals(items, effectiveTaxRate, effectiveDiscount);

    await pool.query(
      `UPDATE estimates SET
         customer_id=$1, customer_name=$2, customer_email=$3, customer_phone=$4,
         subtotal=$5, tax_rate=$6, tax_amount=$7, discount_amount=$8, total_amount=$9,
         valid_until=$10, notes=$11, terms=$12, links=$13, attachments=$14, updated_at=NOW()
       WHERE id=$15 AND user_id=$16`,
      [customerId || null, customerName, customerEmail, customerPhone,
       subtotal, effectiveTaxRate, taxAmount, effectiveDiscount, totalAmount,
       validUntil || null, notes, terms,
       JSON.stringify(links || []), JSON.stringify(attachments || []),
       id, userId]
    );

    // Replace line items
    await pool.query('DELETE FROM estimate_items WHERE estimate_id = $1', [id]);
    for (const item of items) {
      await pool.query(
        `INSERT INTO estimate_items (estimate_id, description, quantity, unit_price, amount, service_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, item.description, item.quantity, item.unitPrice, item.quantity * item.unitPrice, item.serviceId || null]
      );
    }

    const updated = await getEstimateWithItems(id, userId);
    res.json({ success: true, estimate: updated });
  } catch (err) {
    console.error('Error updating estimate:', err.message);
    res.status(500).json({ error: 'Failed to update estimate' });
  }
});

// ── DELETE /api/estimates/:id ─────────────────────────────────────────────────

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM estimates WHERE id=$1 AND user_id=$2 AND status='draft' RETURNING id",
      [id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Draft estimate not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete estimate' });
  }
});

// ── POST /api/estimates/:id/send ──────────────────────────────────────────────

router.post('/:id/send', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT e.*, u.business_name, u.email as owner_email FROM estimates e
       JOIN users u ON u.id = e.user_id
       WHERE e.id=$1 AND e.user_id=$2`,
      [id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estimate not found' });
    const estimate = result.rows[0];
    if (!estimate.customer_email) return res.status(400).json({ error: 'Customer email is required to send estimate' });

    const viewUrl = `${FRONTEND_URL}/estimate/${estimate.view_token}`;

    const validUntilStr = estimate.valid_until
      ? new Date(estimate.valid_until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;

    // Build links & attachments sections for email
    const estimateLinks = Array.isArray(estimate.links) ? estimate.links : [];
    const linksHtml = estimateLinks.filter(l => l.url).length > 0
      ? `<div style="margin:16px 0;"><strong style="color:#374151;">Links:</strong><ul style="padding-left:20px;margin:8px 0;">
           ${estimateLinks.filter(l => l.url).map(l =>
             `<li style="margin:4px 0;"><a href="${l.url}" style="color:#d97706;">${l.label || l.url}</a></li>`
           ).join('')}
         </ul></div>`
      : '';
    const estimateAttachments = Array.isArray(estimate.attachments) ? estimate.attachments : [];
    const attachmentsHtml = estimateAttachments.filter(a => a.url).length > 0
      ? `<div style="margin:16px 0;"><strong style="color:#374151;">Media:</strong><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;">
           ${estimateAttachments.filter(a => a.url).map(a => {
             const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(a.url);
             return isImg
               ? `<div><img src="${a.url}" alt="${a.name || ''}" style="max-width:180px;max-height:120px;border-radius:6px;border:1px solid #e5e7eb;"/>${a.name ? `<p style="font-size:11px;color:#9ca3af;margin:3px 0 0;">${a.name}</p>` : ''}</div>`
               : `<a href="${a.url}" style="color:#d97706;font-size:13px;">${a.name || a.url}</a>`;
           }).join('')}
         </div></div>`
      : '';

    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      await sgMail.send({
        to: estimate.customer_email,
        from: { name: estimate.business_name || 'SORCE', email: TRANSACTIONAL_EMAIL },
        replyTo: estimate.owner_email ? { name: estimate.business_name || '', email: estimate.owner_email } : undefined,
        subject: `Estimate ${estimate.estimate_number} from ${estimate.business_name}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <h2 style="color:#d97706;">${estimate.business_name}</h2>
            <p>Hi ${estimate.customer_name},</p>
            <p>Please review your estimate.</p>
            <div style="background:#f9fafb;border-radius:8px;padding:20px;margin:20px 0;">
              <p style="margin:0;"><strong>Estimate:</strong> ${estimate.estimate_number}</p>
              <p style="margin:8px 0 0;"><strong>Total:</strong> $${parseFloat(estimate.total_amount).toFixed(2)}</p>
              ${validUntilStr ? `<p style="margin:8px 0 0;"><strong>Valid Until:</strong> ${validUntilStr}</p>` : ''}
            </div>
            <div style="text-align:center;margin:30px 0;">
              <a href="${viewUrl}" style="background-color:#d97706;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">View Estimate</a>
            </div>
            ${linksHtml}
            ${attachmentsHtml}
            ${estimate.notes ? `<p style="color:#666;font-size:14px;"><strong>Notes:</strong> ${estimate.notes}</p>` : ''}
          </div>
        `
      });
    } catch (emailErr) {
      console.error('Failed to send estimate email:', emailErr.message);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    await pool.query(
      "UPDATE estimates SET status='sent', sent_at=NOW(), updated_at=NOW() WHERE id=$1",
      [id]
    );
    res.json({ success: true, message: `Estimate sent to ${estimate.customer_email}` });
  } catch (err) {
    console.error('Error sending estimate:', err.message);
    res.status(500).json({ error: 'Failed to send estimate' });
  }
});

// ── POST /api/estimates/:id/remind ────────────────────────────────────────────

router.post('/:id/remind', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT e.*, u.business_name FROM estimates e
       JOIN users u ON u.id = e.user_id
       WHERE e.id=$1 AND e.user_id=$2 AND e.status IN ('sent','viewed')`,
      [id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estimate not found or not in a sendable state' });
    const estimate = result.rows[0];
    const viewUrl = `${FRONTEND_URL}/estimate/${estimate.view_token}`;

    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: estimate.customer_email,
      from: TRANSACTIONAL_EMAIL,
      subject: `Reminder: Estimate ${estimate.estimate_number} from ${estimate.business_name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#d97706;">Estimate Reminder</h2>
          <p>Hi ${estimate.customer_name},</p>
          <p>Just a friendly reminder to review your estimate <strong>${estimate.estimate_number}</strong> for <strong>$${parseFloat(estimate.total_amount).toFixed(2)}</strong>.</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${viewUrl}" style="background-color:#d97706;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">View Estimate</a>
          </div>
        </div>
      `
    });

    await pool.query("UPDATE estimates SET reminder_sent_at=NOW() WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error sending reminder:', err.message);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

// ── POST /api/estimates/:id/void ──────────────────────────────────────────────

router.post('/:id/void', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE estimates SET status='expired', updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status NOT IN ('converted','expired') RETURNING id",
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estimate not found or already expired' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to expire estimate' });
  }
});

// ── POST /api/estimates/:id/mark-accepted ─────────────────────────────────────

router.post('/:id/mark-accepted', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE estimates SET status='accepted', accepted_at=NOW(), updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status NOT IN ('converted','expired') RETURNING id",
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estimate not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark estimate as accepted' });
  }
});

// ── POST /api/estimates/:id/mark-rejected ────────────────────────────────────

router.post('/:id/mark-rejected', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE estimates SET status='rejected', rejected_at=NOW(), updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status NOT IN ('converted','expired') RETURNING id",
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estimate not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark estimate as rejected' });
  }
});

// ── POST /api/estimates/:id/convert-to-invoice ───────────────────────────────

router.post('/:id/convert-to-invoice', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = req.user.userId;
    const { id } = req.params;
    const { dueDate, sendNow, processor } = req.body;

    // Fetch estimate with items
    const estResult = await client.query(
      `SELECT e.*, json_agg(json_build_object(
         'description', ei.description, 'quantity', ei.quantity,
         'unit_price', ei.unit_price, 'amount', ei.amount, 'service_id', ei.service_id
       )) FILTER (WHERE ei.id IS NOT NULL) as items
       FROM estimates e
       LEFT JOIN estimate_items ei ON e.id = ei.estimate_id
       WHERE e.id=$1 AND e.user_id=$2 AND e.status NOT IN ('converted','expired')
       GROUP BY e.id`,
      [id, userId]
    );
    if (estResult.rows.length === 0) return res.status(404).json({ error: 'Estimate not found or not convertible' });
    const estimate = estResult.rows[0];

    // Generate invoice number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix  = crypto.randomBytes(2).toString('hex').toUpperCase();
    const invoiceNumber = `INV-${dateStr}-${suffix}`;
    const paymentLinkToken = crypto.randomBytes(32).toString('hex');

    const invResult = await client.query(
      `INSERT INTO invoices (
         user_id, customer_id, invoice_number, customer_name, customer_email, customer_phone,
         subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_due,
         status, due_date, notes, terms, payment_link_token
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$14,$15,$16)
       RETURNING *`,
      [userId, estimate.customer_id, invoiceNumber,
       estimate.customer_name, estimate.customer_email, estimate.customer_phone,
       estimate.subtotal, estimate.tax_rate, estimate.tax_amount,
       estimate.discount_amount, estimate.total_amount, estimate.total_amount,
       dueDate || null, estimate.notes, estimate.terms, paymentLinkToken]
    );
    const invoice = invResult.rows[0];

    // Copy line items
    const items = estimate.items || [];
    for (const item of items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, service_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [invoice.id, item.description, item.quantity, item.unit_price, item.amount, item.service_id || null]
      );
    }

    // Mark estimate as converted
    await client.query(
      "UPDATE estimates SET status='converted', converted_invoice_id=$1, converted_at=NOW(), updated_at=NOW() WHERE id=$2",
      [invoice.id, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, invoice, estimateId: id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error converting estimate to invoice:', err.message);
    res.status(500).json({ error: 'Failed to convert estimate to invoice' });
  } finally {
    client.release();
  }
});

// ── GET /api/estimates/view/:token  (PUBLIC — no auth) ────────────────────────

router.get('/view/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*,
         json_agg(json_build_object(
           'description', ei.description, 'quantity', ei.quantity,
           'unit_price', ei.unit_price, 'amount', ei.amount
         )) FILTER (WHERE ei.id IS NOT NULL) as items,
         u.business_name
       FROM estimates e
       LEFT JOIN estimate_items ei ON e.id = ei.estimate_id
       JOIN users u ON u.id = e.user_id
       WHERE e.view_token=$1
       GROUP BY e.id, u.business_name`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Estimate not found' });
    const estimate = result.rows[0];

    // Mark as viewed (once)
    if (estimate.status === 'sent') {
      await pool.query(
        "UPDATE estimates SET status='viewed', viewed_at=NOW() WHERE view_token=$1",
        [req.params.token]
      );
      estimate.status = 'viewed';
    }

    // Return only the fields the customer needs (no sensitive tokens)
    const { view_token, ...safeEstimate } = estimate;
    res.json({ estimate: safeEstimate });
  } catch (err) {
    console.error('Error fetching public estimate:', err.message);
    res.status(500).json({ error: 'Failed to load estimate' });
  }
});

// ── POST /api/estimates/view/:token/respond  (PUBLIC — no auth) ───────────────
// Customer accepts or declines the estimate

router.post('/view/:token/respond', async (req, res) => {
  try {
    const { response } = req.body; // 'accept' | 'decline'
    if (!['accept', 'decline'].includes(response)) {
      return res.status(400).json({ error: 'Invalid response. Must be "accept" or "decline"' });
    }

    const result = await pool.query(
      "SELECT * FROM estimates WHERE view_token=$1 AND status IN ('sent','viewed')",
      [req.params.token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Estimate not found or no longer open' });
    }

    if (response === 'accept') {
      await pool.query(
        "UPDATE estimates SET status='accepted', accepted_at=NOW(), updated_at=NOW() WHERE view_token=$1",
        [req.params.token]
      );
    } else {
      await pool.query(
        "UPDATE estimates SET status='rejected', rejected_at=NOW(), updated_at=NOW() WHERE view_token=$1",
        [req.params.token]
      );
    }

    res.json({ success: true, response });
  } catch (err) {
    console.error('Error responding to estimate:', err.message);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

module.exports = router;
