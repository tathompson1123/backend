const sgMail = require('@sendgrid/mail');
const { pool } = require('../config/database');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
 * Format a date string like "2026-02-23" → "Monday, February 23, 2026"
 */
function formatDate(dateStr) {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Format time like "14:30" → "2:30 PM"
 */
function formatTime(timeStr) {
  if (!timeStr) return timeStr;
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Send booking confirmation or updated emails — customer email + owner notification.
 * Non-blocking: errors are logged but don't throw.
 *
 * @param {object} opts
 * @param {number} opts.userId       - Business owner user ID
 * @param {string} opts.bookingNumber
 * @param {string} opts.customerName
 * @param {string} opts.customerEmail
 * @param {string} opts.customerPhone
 * @param {string} opts.serviceName
 * @param {string} opts.bookingDate  - "YYYY-MM-DD"
 * @param {string} opts.startTime    - "HH:MM"
 * @param {string} opts.endTime      - "HH:MM"
 * @param {number} opts.subtotal     - price before tax
 * @param {number} opts.taxRate      - decimal (e.g. 0.098)
 * @param {number} opts.taxAmount    - dollar amount of tax
 * @param {number} opts.total        - subtotal + tax
 * @param {number} opts.price        - legacy: used if subtotal/total not provided
 * @param {string} opts.location     - service location address (optional)
 * @param {string} opts.notes
 * @param {string} opts.type         - 'confirmation' (default) or 'updated'
 */
async function sendBookingEmails(opts) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('📧 SENDGRID_API_KEY not set — skipping booking emails');
    return;
  }

  try {
    // Get business info
    const userResult = await pool.query(
      `SELECT u.business_name, u.email,
              NULLIF(TRIM(CONCAT_WS(', ', NULLIF(bi.address,''), NULLIF(bi.city,''), NULLIF(bi.state,''))), '') AS business_address
       FROM users u
       LEFT JOIN business_information bi ON bi.user_id = u.id
       WHERE u.id = $1`,
      [opts.userId]
    );
    if (userResult.rows.length === 0) return;

    const { business_name: businessName, email: ownerEmail, business_address: businessAddress } = userResult.rows[0];

    // Use provided location, or fall back to the business address
    const location = opts.location || businessAddress;
    const fromEmail = 'noreply@sorceintegrations.com';

    const formattedDate = formatDate(opts.bookingDate);
    const formattedStart = formatTime(opts.startTime);
    const formattedEnd = opts.endTime ? formatTime(opts.endTime) : null;
    const timeDisplay = formattedEnd ? `${formattedStart} – ${formattedEnd}` : formattedStart;

    // Prefer subtotal/total breakdown; fall back to legacy price field
    const subtotal = opts.subtotal != null ? parseFloat(opts.subtotal) : parseFloat(opts.price || 0);
    const taxAmount = opts.taxAmount != null ? parseFloat(opts.taxAmount) : 0;
    const total = opts.total != null ? parseFloat(opts.total) : subtotal;
    const hasTax = taxAmount > 0;
    const taxPct = opts.taxRate ? (opts.taxRate * 100).toFixed(2).replace(/\.?0+$/, '') : null;

    const detailsHtml = `
      <table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:15px;">
        <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;width:40%;">Booking #</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${opts.bookingNumber}</td></tr>
        <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Service</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${opts.serviceName}</td></tr>
        <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Date</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${formattedDate}</td></tr>
        <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Time</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${timeDisplay}</td></tr>
        ${location ? `<tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Place</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${location}</td></tr>` : ''}
        ${hasTax ? `<tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Subtotal</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">$${subtotal.toFixed(2)}</td></tr>` : ''}
        ${hasTax ? `<tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Tax${taxPct ? ` (${taxPct}%)` : ''}</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">$${taxAmount.toFixed(2)}</td></tr>` : ''}
        ${total > 0 ? `<tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Total</td><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:700;">$${total.toFixed(2)}</td></tr>` : ''}
        ${opts.notes ? `<tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Notes</td><td style="padding:10px 12px;">${opts.notes}</td></tr>` : ''}
      </table>`;

    const isUpdated = opts.type === 'updated';
    const emails = [];

    // ── Customer email ─────────────────────────────────────────
    if (opts.customerEmail) {
      emails.push({
        to: opts.customerEmail,
        from: { name: businessName || 'Your Service Provider', email: fromEmail },
        replyTo: ownerEmail ? { name: businessName || '', email: ownerEmail } : undefined,
        subject: isUpdated
          ? `Booking Updated — ${opts.serviceName} on ${formattedDate}`
          : `Booking Confirmed — ${opts.serviceName} on ${formattedDate}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
            <div style="background:${isUpdated ? '#d97706' : '#1d4ed8'};padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
              <h1 style="color:#fff;margin:0;font-size:1.5rem;">${isUpdated ? 'Booking Updated' : 'Booking Confirmed!'}</h1>
            </div>
            <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
              <p style="font-size:1rem;margin-top:0;">Hi ${opts.customerName},</p>
              <p>${isUpdated
                ? `Your booking with <strong>${businessName || 'us'}</strong> has been updated. Here are your new details:`
                : `Your booking with <strong>${businessName || 'us'}</strong> is confirmed. Here are your details:`
              }</p>
              ${detailsHtml}
              <p style="color:#6b7280;font-size:0.9rem;margin-top:2rem;">
                If you need to reschedule or have questions, please contact us directly.<br>
                Thank you for your business!
              </p>
              <p style="color:#6b7280;font-size:0.9rem;margin:0;">${businessName || ''}</p>
            </div>
          </div>`,
      });
    }

    // ── Owner notification ─────────────────────────────────────
    if (ownerEmail) {
      const customerDetails = [opts.customerName, opts.customerEmail, opts.customerPhone].filter(Boolean).join(' | ');
      emails.push({
        to: ownerEmail,
        from: { name: 'SORCE Bookings', email: fromEmail },
        replyTo: ownerEmail ? { email: ownerEmail } : undefined,
        subject: isUpdated
          ? `Booking Updated: ${opts.serviceName} — ${opts.customerName}`
          : `New Booking: ${opts.serviceName} — ${opts.customerName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
            <div style="background:${isUpdated ? '#d97706' : '#16a34a'};padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
              <h1 style="color:#fff;margin:0;font-size:1.5rem;">${isUpdated ? 'Booking Updated' : 'New Booking Received'}</h1>
            </div>
            <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
              <p style="font-size:1rem;margin-top:0;"><strong>Customer:</strong> ${customerDetails}</p>
              ${detailsHtml}
            </div>
          </div>`,
      });
    }

    if (emails.length > 0) {
      await sgMail.send(emails.length === 1 ? emails[0] : emails);
      console.log(`📧 Booking emails sent for ${opts.bookingNumber}`);
    }
  } catch (err) {
    console.error('📧 Booking email error:', err.message);
    // Never throw — email failure must not break booking creation
  }
}

module.exports = { sendBookingEmails };
