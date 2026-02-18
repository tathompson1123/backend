const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { triggerLeadFormAgent } = require('./leads');

async function getUserBySiteKey(siteKey) {
  const result = await pool.query('SELECT id FROM users WHERE site_key = $1', [siteKey]);
  return result.rows[0] || null;
}

/**
 * POST /api/webhooks/form/:siteKey
 * Accepts form submission data from external platforms (Wix, Squarespace, WordPress, Zapier).
 * Creates a lead and triggers the SMS lead agent — fully reliable alternative to embed form intercept.
 *
 * Body: { name, email, phone, service, message, platform, page_url }
 * At least one of name/email/phone is required.
 */
router.post('/form/:siteKey', async (req, res) => {
  try {
    const { siteKey } = req.params;
    const { name, email, phone, service, message, platform, page_url } = req.body;

    // Resolve userId from siteKey
    const user = await getUserBySiteKey(siteKey);
    if (!user) {
      return res.status(404).json({ error: 'Invalid site key' });
    }
    const userId = user.id;

    // Require at least one contact field
    if (!name && !email && !phone) {
      return res.status(400).json({ error: 'At least one of name, email, or phone is required' });
    }

    // Duplicate check: same email+phone submitted within 5 minutes
    if (email || phone) {
      const dup = await pool.query(
        `SELECT id FROM leads
         WHERE user_id = $1
           AND (email = $2 OR phone = $3)
           AND created_at > NOW() - INTERVAL '5 minutes'`,
        [userId, email || '', phone || '']
      );
      if (dup.rows.length > 0) {
        return res.json({ success: true, duplicate: true, message: 'Lead already submitted recently' });
      }
    }

    // Insert lead — source must be 'lead_form' to trigger SMS agent
    const result = await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, status, source, service, message, sms_consent, created_at)
       VALUES ($1, $2, $3, $4, 'new', 'lead_form', $5, $6, true, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        userId,
        name || '',
        email || '',
        phone || '',
        service || (platform ? `via ${platform}` : ''),
        message || (page_url ? `Submitted from: ${page_url}` : '')
      ]
    );

    const newLead = result.rows[0];
    console.log(`📨 Webhook lead: ${name || email || phone} via ${platform || 'external'} → user ${userId}`);

    // Trigger SMS lead agent (non-blocking)
    triggerLeadFormAgent(userId, newLead).catch(err =>
      console.error('Webhook: triggerLeadFormAgent error:', err.message)
    );

    res.json({ success: true, leadId: newLead.id });
  } catch (error) {
    console.error('Webhook form error:', error.message);
    res.status(500).json({ error: 'Failed to process form submission' });
  }
});

module.exports = router;
