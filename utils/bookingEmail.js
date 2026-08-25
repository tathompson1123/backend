const sgMail = require('@sendgrid/mail');
const { pool } = require('../config/database');
const { TRANSACTIONAL_EMAIL, ownerAlertReplyTo } = require('../utils/emailFrom');
const { escapeHtml: esc } = require('../utils/escapeHtml');
const { plainEmail } = require('../utils/emailLayout');

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

    // Standing fees, itemised. A fee rolled silently into the subtotal is a charge the
    // customer can't account for, so each one gets its own line, and the subtotal row
    // appears whenever there are fees even if there's no tax to show.
    const fees = (Array.isArray(opts.fees) ? opts.fees : [])
      .filter(fee => fee && Number(fee.amount) > 0);
    const showBreakdown = hasTax || fees.length > 0;

    // Labelled lines rather than the striped table this used to be. See utils/emailLayout:
    // the 600px-card shape with colour bands and nested tables is what got a discovery
    // confirmation junked by two separate ESPs while a plain email from the same address
    // reached the inbox.
    const details = [
      { label: 'Booking #', value: esc(opts.bookingNumber) },
      { label: 'Service', value: esc(opts.serviceName) },
      { label: 'Date', value: esc(formattedDate) },
      { label: 'Time', value: esc(timeDisplay) },
      location ? { label: 'Place', value: esc(location) } : null,
      showBreakdown ? { label: 'Subtotal', value: `$${subtotal.toFixed(2)}` } : null,
      ...fees.map(fee => ({ label: esc(fee.name), value: `$${Number(fee.amount).toFixed(2)}` })),
      hasTax ? { label: `Tax${taxPct ? ` (${taxPct}%)` : ''}`, value: `$${taxAmount.toFixed(2)}` } : null,
      total > 0 ? { label: 'Total', value: `$${total.toFixed(2)}` } : null,
      opts.notes ? { label: 'Notes', value: esc(opts.notes) } : null,
    ].filter(Boolean);

    // Plain-text version of the details — a text/html multipart email is far less
    // likely to be filtered to spam than an HTML-only one.
    const detailsText = [
      `Booking #: ${opts.bookingNumber}`,
      `Service: ${opts.serviceName}`,
      `Date: ${formattedDate}`,
      `Time: ${timeDisplay}`,
      location ? `Place: ${location}` : null,
      showBreakdown ? `Subtotal: $${subtotal.toFixed(2)}` : null,
      ...fees.map(fee => `${fee.name}: $${Number(fee.amount).toFixed(2)}`),
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
        html: plainEmail({
          greeting: `Hi ${esc(opts.customerName)},`,
          paragraphs: [
            isUpdated
              ? `Your booking with <strong>${esc(businessName || 'us')}</strong> has been updated. Here are your new details.`
              : `Your booking with <strong>${esc(businessName || 'us')}</strong> is confirmed. Here are your details.`,
          ],
          details,
          after: [
            'If you need to reschedule or have questions, please contact us directly. Thank you for your business.',
          ],
          signature: [esc(businessName || ''), esc(businessAddress || '')].filter(Boolean).join('<br>'),
        }),
      });
    }

    // ── Owner notification ─────────────────────────────────────
    if (ownerEmail) {
      const customerDetails = [opts.customerName, opts.customerEmail, opts.customerPhone].filter(Boolean).join(' | ');
      emails.push({
        to: ownerEmail,
        from: { name: 'SORCE Bookings', email: fromEmail },
        // Reply reaches the customer who just booked, which is who the owner would want.
        replyTo: ownerAlertReplyTo(opts.customerEmail, opts.customerName),
        trackingSettings,
        subject: isUpdated
          ? `Booking Updated: ${opts.serviceName} — ${opts.customerName}`
          : `New Booking: ${opts.serviceName} — ${opts.customerName}`,
        text: `${isUpdated ? 'Booking Updated' : 'New Booking Received'}\n\n`
          + `Customer: ${customerDetails}\n\n${detailsText}`,
        html: plainEmail({
          paragraphs: [
            isUpdated ? 'A booking has been updated.' : 'You have a new booking.',
            `<strong>Customer:</strong> ${esc(customerDetails)}`,
          ],
          details,
        }),
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
        // Was a tinted bubble per message. The speaker's name in bold carries the same
        // information without a coloured box each, which is a lot of markup for a long
        // thread and part of what pushed these emails into a marketing shape.
        return `<p style="margin:0 0 8px;"><strong>${esc(label)}:</strong> `
          + `<span style="white-space:pre-wrap;">${esc(cleanContent)}</span></p>`;
      }).join('');
    }

    const formattedDate = opts.bookingDate ? formatDate(opts.bookingDate) : 'Not specified';
    const formattedTime = opts.startTime ? formatTime(opts.startTime) : 'Not specified';
    const customerDetails = [opts.customerName, opts.customerPhone, opts.customerEmail].filter(Boolean).join(' | ');
    const dashboardUrl = `${process.env.FRONTEND_URL || 'https://sorceintegrations.com'}/dashboard?view=leads`;

    await sgMail.send({
      to: ownerEmail,
      from: { name: 'SORCE SMS Agent', email: TRANSACTIONAL_EMAIL },
      // Usually an SMS-only lead, so this normally falls back to our inbox.
      replyTo: ownerAlertReplyTo(opts.customerEmail, opts.customerName),
      subject: `Action needed: confirm a booking from your SMS agent — ${opts.customerName || opts.customerPhone}`,
      html: plainEmail({
        paragraphs: [
          'Your SMS lead agent reached a booking agreement with a customer. This is <strong>not yet on your schedule</strong> — reach out to confirm and add it manually.',
        ],
        details: [
          { label: 'Customer', value: esc(customerDetails) },
          { label: 'Service', value: esc(opts.serviceName || 'Not specified') },
          { label: 'Date', value: esc(formattedDate) },
          { label: 'Time', value: esc(formattedTime) },
        ],
        action: { label: 'View the lead in your dashboard', url: dashboardUrl },
        // Transcript stays, minus the per-message tinted bubbles — the labels carry who
        // said what without needing a coloured box each.
        after: transcriptHtml ? [`<strong>Conversation transcript</strong>${transcriptHtml}`] : [],
        signature: esc(businessName || 'Your business'),
      }),
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

    await sgMail.send({
      to: ownerEmail,
      from: { name: 'SORCE SMS Campaign', email: TRANSACTIONAL_EMAIL },
      // Campaign replies arrive over SMS, so there is no customer address here.
      replyTo: ownerAlertReplyTo(),
      subject: `New reply to your SMS campaign — ${opts.customerName || opts.customerPhone}`,
      html: plainEmail({
        paragraphs: [
          `<strong>${esc(who)}</strong> replied to your text blast. They've been added to your Leads.`,
          `<strong>Their reply:</strong> <span style="white-space:pre-wrap;">${esc(opts.replyText) || '(no text)'}</span>`,
          opts.campaignMessage
            ? `<strong>The offer they replied to:</strong> <span style="white-space:pre-wrap;">${esc(opts.campaignMessage)}</span>`
            : '',
        ],
        action: { label: 'View the lead in your dashboard', url: dashboardUrl },
        signature: esc(businessName) || 'Your business',
      }),
    });
    console.log(`📧 SMS campaign reply email sent for user ${opts.userId} — ${opts.customerName || opts.customerPhone}`);
  } catch (err) {
    console.error('📧 SMS campaign reply email error:', err.message);
    // Never throw — email failure must not break the inbound SMS flow
  }
}

module.exports = { sendBookingEmails, sendSmsBookingConfirmationRequest, sendSmsCampaignReplyNotification };
