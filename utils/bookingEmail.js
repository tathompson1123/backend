const sgMail = require('@sendgrid/mail');
const { pool } = require('../config/database');
const { TRANSACTIONAL_EMAIL } = require('../utils/emailFrom');

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
    // Send from a real, monitored, verified address rather than noreply@ — inbox filters
    // slightly favor senders that can receive replies, and help@ is domain-authenticated.
    const fromEmail = TRANSACTIONAL_EMAIL;

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

    // Plain-text version of the details — a text/html multipart email is far less
    // likely to be filtered to spam than an HTML-only one.
    const detailsText = [
      `Booking #: ${opts.bookingNumber}`,
      `Service: ${opts.serviceName}`,
      `Date: ${formattedDate}`,
      `Time: ${timeDisplay}`,
      location ? `Place: ${location}` : null,
      hasTax ? `Subtotal: $${subtotal.toFixed(2)}` : null,
      hasTax ? `Tax${taxPct ? ` (${taxPct}%)` : ''}: $${taxAmount.toFixed(2)}` : null,
      total > 0 ? `Total: $${total.toFixed(2)}` : null,
      opts.notes ? `Notes: ${opts.notes}` : null,
    ].filter(Boolean).join('\n');

    // Booking confirmations are transactional — no marketing links to track, and the
    // tracking pixel/link-rewrapping only adds spam-filter signals here. Turn it off.
    const trackingSettings = {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: false },
    };

    const isUpdated = opts.type === 'updated';
    const emails = [];

    // ── Customer email ─────────────────────────────────────────
    if (opts.customerEmail && !opts.skipCustomerEmail) {
      emails.push({
        to: opts.customerEmail,
        // "{Business} via SORCE" reads as a platform sending on the business's behalf,
        // which is less spoof-like to inbox filters than the business name alone coming
        // from a shared sorceintegrations.com address.
        from: { name: businessName ? `${businessName} via SORCE` : 'Your Service Provider', email: fromEmail },
        replyTo: ownerEmail ? { name: businessName || '', email: ownerEmail } : undefined,
        trackingSettings,
        subject: isUpdated
          ? `Booking Updated — ${opts.serviceName} on ${formattedDate}`
          : `Booking Confirmed — ${opts.serviceName} on ${formattedDate}`,
        text: `Hi ${opts.customerName},\n\n`
          + (isUpdated
              ? `Your booking with ${businessName || 'us'} has been updated. Here are your new details:`
              : `Your booking with ${businessName || 'us'} is confirmed. Here are your details:`)
          + `\n\n${detailsText}\n\n`
          + `If you need to reschedule or have questions, please contact us directly.\n`
          + `Thank you for your business!\n\n${businessName || ''}${businessAddress ? `\n${businessAddress}` : ''}`,
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
              ${businessAddress ? `<p style="color:#9ca3af;font-size:0.8rem;margin:0.25rem 0 0;">${businessAddress}</p>` : ''}
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
        trackingSettings,
        subject: isUpdated
          ? `Booking Updated: ${opts.serviceName} — ${opts.customerName}`
          : `New Booking: ${opts.serviceName} — ${opts.customerName}`,
        text: `${isUpdated ? 'Booking Updated' : 'New Booking Received'}\n\n`
          + `Customer: ${customerDetails}\n\n${detailsText}`,
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

/**
 * Notify the business owner that the SMS lead agent reached a booking agreement
 * with a lead. This does NOT create a booking — it asks the owner to confirm with
 * the customer and add it to the schedule manually. Owner-only email.
 *
 * @param {object} opts
 * @param {number} opts.userId        - Business owner user ID
 * @param {number} opts.leadId        - Lead ID (used to pull the SMS transcript)
 * @param {string} opts.customerName
 * @param {string} opts.customerPhone
 * @param {string} [opts.customerEmail]
 * @param {string} opts.serviceName   - Service the lead asked for (free text)
 * @param {string} opts.bookingDate   - "YYYY-MM-DD"
 * @param {string} opts.startTime     - "HH:MM"
 */
async function sendSmsBookingConfirmationRequest(opts) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('📧 SENDGRID_API_KEY not set — skipping SMS booking confirmation email');
    return;
  }

  try {
    const userResult = await pool.query(
      'SELECT business_name, email FROM users WHERE id = $1',
      [opts.userId]
    );
    if (!userResult.rows[0]?.email) return;
    const { business_name: businessName, email: ownerEmail } = userResult.rows[0];

    // Pull the SMS transcript so the owner has full context
    let transcriptHtml = '';
    if (opts.leadId) {
      const msgsResult = await pool.query(
        `SELECT direction, message FROM sms_messages
         WHERE lead_id = $1 ORDER BY created_at ASC, id ASC`,
        [opts.leadId]
      );
      transcriptHtml = msgsResult.rows.map(m => {
        const isCustomer = m.direction === 'incoming';
        const label = isCustomer ? (opts.customerName || 'Customer') : 'SMS Agent';
        // Strip the internal protocol token before showing the owner
        const cleanContent = String(m.message || '')
          .replace(/BOOKING_REQUEST\|[^\n]+\n?/g, '')
          .trim();
        if (!cleanContent) return '';
        const bg = isCustomer ? '#eff6ff' : '#f8fafc';
        const border = isCustomer ? '#bfdbfe' : '#e2e8f0';
        const labelColor = isCustomer ? '#1d4ed8' : '#475569';
        return `
          <div style="margin:0 0 10px 0;padding:10px 12px;background:${bg};border:1px solid ${border};border-radius:8px;">
            <div style="font-size:11px;font-weight:600;color:${labelColor};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">${label}</div>
            <div style="font-size:14px;color:#1f2937;white-space:pre-wrap;line-height:1.45;">${cleanContent}</div>
          </div>`;
      }).join('');
    }

    const formattedDate = opts.bookingDate ? formatDate(opts.bookingDate) : 'Not specified';
    const formattedTime = opts.startTime ? formatTime(opts.startTime) : 'Not specified';
    const customerDetails = [opts.customerName, opts.customerPhone, opts.customerEmail].filter(Boolean).join(' | ');
    const dashboardUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?view=leads`;

    await sgMail.send({
      to: ownerEmail,
      from: { name: 'SORCE SMS Agent', email: TRANSACTIONAL_EMAIL },
      replyTo: { email: ownerEmail },
      subject: `Action needed: confirm a booking from your SMS agent — ${opts.customerName || opts.customerPhone}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">
          <div style="background:#d97706;padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:1.4rem;">Booking Needs Confirmation</h1>
          </div>
          <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
            <p style="font-size:1rem;margin-top:0;">
              Your SMS lead agent reached a booking agreement with a customer. This is <strong>not yet on your schedule</strong> —
              reach out to confirm and add it manually.
            </p>
            <table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:15px;">
              <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;width:35%;">Customer</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${customerDetails}</td></tr>
              <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Service</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${opts.serviceName || 'Not specified'}</td></tr>
              <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Date</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${formattedDate}</td></tr>
              <tr><td style="padding:10px 12px;background:#f8f9fa;font-weight:600;">Time</td><td style="padding:10px 12px;">${formattedTime}</td></tr>
            </table>
            <a href="${dashboardUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px;">View Lead in Dashboard</a>
            ${transcriptHtml ? `
              <h2 style="font-size:1rem;font-weight:600;color:#1f2937;margin:2rem 0 0.75rem 0;">Conversation Transcript</h2>
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;">${transcriptHtml}</div>` : ''}
            <p style="color:#6b7280;font-size:0.85rem;margin:1.5rem 0 0 0;">${businessName || 'Your business'}</p>
          </div>
        </div>`,
    });
    console.log(`📧 SMS booking confirmation email sent for user ${opts.userId} — lead: ${opts.customerName || opts.customerPhone}`);
  } catch (err) {
    console.error('📧 SMS booking confirmation email error:', err.message);
    // Never throw — email failure must not break the SMS flow
  }
}

/**
 * Notify the business owner that a customer replied to an SMS marketing campaign.
 * Owner-only email — includes the customer's actual reply and the offer they
 * replied to, plus a link to the lead in the dashboard. Non-blocking.
 *
 * @param {object} opts
 * @param {number} opts.userId          - Business owner user ID
 * @param {number} [opts.leadId]        - Lead ID (for the dashboard link)
 * @param {string} opts.customerName
 * @param {string} opts.customerPhone
 * @param {string} opts.replyText       - What the customer texted back
 * @param {string} [opts.campaignMessage] - The campaign text they replied to
 */
async function sendSmsCampaignReplyNotification(opts) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('📧 SENDGRID_API_KEY not set — skipping SMS campaign reply email');
    return;
  }

  try {
    const userResult = await pool.query(
      'SELECT business_name, email FROM users WHERE id = $1',
      [opts.userId]
    );
    if (!userResult.rows[0]?.email) return;
    const { business_name: businessName, email: ownerEmail } = userResult.rows[0];

    const who = [opts.customerName, opts.customerPhone].filter(Boolean).join(' · ') || 'A customer';
    const dashboardUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?view=leads`;
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    await sgMail.send({
      to: ownerEmail,
      from: { name: 'SORCE SMS Campaign', email: TRANSACTIONAL_EMAIL },
      replyTo: { email: ownerEmail },
      subject: `New reply to your SMS campaign — ${opts.customerName || opts.customerPhone}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
          <div style="background:#16a34a;padding:2rem;text-align:center;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:1.4rem;">Someone Replied to Your SMS Campaign</h1>
          </div>
          <div style="padding:2rem;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
            <p style="font-size:1rem;margin-top:0;"><strong>${esc(who)}</strong> replied to your text blast. They've been added to your Leads.</p>
            <div style="margin:1.25rem 0;padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
              <div style="font-size:11px;font-weight:600;color:#15803d;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Their reply</div>
              <div style="font-size:15px;color:#1f2937;white-space:pre-wrap;line-height:1.5;">${esc(opts.replyText) || '(no text)'}</div>
            </div>
            ${opts.campaignMessage ? `
              <div style="margin:0 0 1.5rem 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                <div style="font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">The offer they replied to</div>
                <div style="font-size:14px;color:#475569;white-space:pre-wrap;line-height:1.45;">${esc(opts.campaignMessage)}</div>
              </div>` : ''}
            <a href="${dashboardUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px;">View Lead in Dashboard</a>
            <p style="color:#6b7280;font-size:0.85rem;margin:1.5rem 0 0 0;">${esc(businessName) || 'Your business'}</p>
          </div>
        </div>`,
    });
    console.log(`📧 SMS campaign reply email sent for user ${opts.userId} — ${opts.customerName || opts.customerPhone}`);
  } catch (err) {
    console.error('📧 SMS campaign reply email error:', err.message);
    // Never throw — email failure must not break the inbound SMS flow
  }
}

module.exports = { sendBookingEmails, sendSmsBookingConfirmationRequest, sendSmsCampaignReplyNotification };
