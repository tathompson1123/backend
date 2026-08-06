#!/usr/bin/env node
//
// Sends the same real email through two providers so inbox placement can be compared.
//
// The point is to change exactly one variable. Same domain, same From, same template,
// same recipient — different sending infrastructure. If a message lands from one provider
// and is junked by the other, that isolates the sending IP reputation, which is the one
// thing you cannot observe directly: Microsoft's SNDS is keyed to IP ownership and the ESP
// owns the IPs, so there is no telemetry to read.
//
// Rules that make the result mean something:
//
//   1. Seed mailboxes must be untrained. Never click "not junk" on one. A mailbox that has
//      been corrected is useless as an instrument forever after — that confound is what
//      made an earlier round of testing uninterpretable.
//   2. Use real templates. This imports the production HTML builders rather than
//      approximating them, because a test on lookalike markup tells you nothing.
//   3. Record placement against the logged message ID, not memory.
//
// Usage:
//   node scripts/deliverability-ab.js --to a@outlook.com,b@gmail.com
//   node scripts/deliverability-ab.js --to a@outlook.com --template invoice
//   node scripts/deliverability-ab.js --to a@outlook.com --provider postmark
//
// Needs SENDGRID_API_KEY and/or POSTMARK_SERVER_TOKEN in .env.

const fs = require('fs');
const path = require('path');

try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

const { TRANSACTIONAL_EMAIL } = require('../utils/emailFrom');
const { installPlainTextFallback, htmlToText } = require('../utils/emailPlainText');
const { confirmationEmailHtml } = require('../utils/discoveryNotify');
const { buildInvoiceEmailHtml } = require('../utils/invoiceEmail');
const { plainEmail } = require('../utils/emailLayout');

const LOG = path.join(__dirname, '.deliverability-log.jsonl');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Fixed dummy data. Deliberately not randomised: two runs should differ only by provider,
// and a changing body would let content variation masquerade as a provider difference.
function buildMessage(template) {
  // Strips every content variable at once: no images, no links, no redirectors, no
  // gradients, no tables, no unicode marks. Same domain, same provider, same mailbox.
  //
  // It separates two things nothing else can. If this reaches the inbox while the real
  // template doesn't, the template's content is the problem and the sending setup is fine.
  // If even this is junked, content work is wasted effort — the domain or the IP is what's
  // being judged, and no amount of template editing will move it.
  if (template === 'minimal') {
    return {
      subject: 'Your appointment on Thursday, August 20',
      html: `<p>Hi Jordan,</p>
<p>This is a reminder that your appointment is booked for Thursday, August 20 at 10:00 AM. It should take about 30 minutes.</p>
<p>If you need to move it or cancel, reply to this message and we will take care of it.</p>
<p>Thanks,<br>SORCE Integrations</p>`,
    };
  }

  // The three below mirror their production call sites rather than importing a builder,
  // because those templates are assembled inline from database rows. Same plainEmail call
  // with the same arguments, so the rendered HTML is byte-identical to what a real send
  // produces for this data — which is what placement actually turns on. discovery and
  // invoice do import the real builders.
  const BIZ = "Thompson's Auto Detailing";

  if (template === 'booking') {
    return {
      subject: `Booking Confirmed — Full Car Detail on Thursday, August 20, 2026`,
      html: plainEmail({
        greeting: 'Hi Jordan,',
        paragraphs: [`Your booking with <strong>${BIZ}</strong> is confirmed. Here are your details.`],
        details: [
          { label: 'Booking #', value: 'BK-1043' },
          { label: 'Service', value: 'Full Car Detail' },
          { label: 'Date', value: 'Thursday, August 20, 2026' },
          { label: 'Time', value: '10:00 AM – 11:30 AM' },
          { label: 'Place', value: '123 Main St, Vancouver, WA' },
          { label: 'Total', value: '$289.50' },
        ],
        after: ['If you need to reschedule or have questions, please contact us directly. Thank you for your business.'],
        signature: `${BIZ}<br>123 Main St, Vancouver, WA`,
      }),
    };
  }

  if (template === 'cardonfile') {
    return {
      subject: `One last step to confirm your appointment — ${BIZ}`,
      html: plainEmail({
        greeting: 'Hi Jordan,',
        paragraphs: [
          `Your appointment with <strong>${BIZ}</strong> on Thursday, August 20, 2026 at 10:00 AM is almost confirmed.`,
          'We just need a card on file to complete the booking. <strong>We will not charge it</strong> — it is only held in case of a no-show, per our cancellation policy.',
        ],
        action: { label: 'Securely save a card on file', url: 'https://sorceintegrations.com/card-on-file/sample-token' },
        after: ['That link expires in 48 hours. If you have any questions, just contact us directly.'],
        signature: BIZ,
      }),
    };
  }

  if (template === 'reminder') {
    return {
      subject: 'Reminder: Full Car Detail on Thursday, August 20, 2026',
      html: plainEmail({
        greeting: 'Hi Jordan,',
        paragraphs: ['This is a reminder that your appointment for <strong>Full Car Detail</strong> is coming up in <strong>24 hours</strong>.'],
        details: [
          { label: 'Service', value: 'Full Car Detail' },
          { label: 'Date', value: 'Thursday, August 20, 2026' },
          { label: 'Time', value: '10:00 AM' },
          { label: 'Total', value: '$289.50' },
        ],
        after: [
          '<strong>Cancellation policy:</strong> We ask for 24 hours notice to cancel or reschedule.',
          'If you need to reschedule, please contact us directly.',
        ],
        signature: BIZ,
      }),
    };
  }

  if (template === 'invoice') {
    return {
      subject: 'Invoice INV-1043 from Thompson\'s Auto Detailing',
      html: buildInvoiceEmailHtml({
        businessName: "Thompson's Auto Detailing",
        customerName: 'Jordan Avery',
        invoiceNumber: 'INV-1043',
        amountDue: 289.5,
        dueDate: '2026-08-20',
        paymentUrl: 'https://sorceintegrations.com/pay/sample-token',
        items: [
          { description: 'Full car detail', quantity: 1, unit_price: 240, amount: 240 },
          { description: 'Interior protectant', quantity: 1, unit_price: 25, amount: 25 },
        ],
        subtotal: 265, taxAmount: 24.5, totalAmount: 289.5,
        notes: 'Thanks for choosing us.',
      }),
    };
  }

  // Default: the discovery-call confirmation, which is the one that has been junked.
  const call = {
    id: 0,
    name: 'Jordan Avery',
    email: 'jordan@example.com',
    phone: '+15555550123',
    company: 'Avery Landscaping',
    scheduled_at: '2026-08-20T17:00:00.000Z',
    duration_minutes: 30,
    timezone: 'America/Los_Angeles',
    zoom_join_url: 'https://us05web.zoom.us/j/00000000000',
    zoom_passcode: 'a1b2c3',
  };
  const rep = { name: 'Ty Thompson', title: 'Founder', bio: 'Works with service businesses on reviews, booking and lead follow-up.', photo_url: null };
  return {
    subject: 'Your SORCE discovery call is confirmed - Thursday Aug 20, 10:00 AM PDT',
    html: confirmationEmailHtml(call, rep),
  };
}

async function viaSendGrid({ to, from, subject, html, text }) {
  if (!process.env.SENDGRID_API_KEY) return { provider: 'sendgrid', skipped: 'SENDGRID_API_KEY not set' };
  const sgMail = require('@sendgrid/mail');
  // Same patch production runs, so the plain-text part and tracking settings match.
  installPlainTextFallback(sgMail);
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const [res] = await sgMail.send({ to, from: { name: 'SORCE', email: from }, subject, html, text });
  return {
    provider: 'sendgrid',
    statusCode: res?.statusCode,
    messageId: res?.headers?.['x-message-id'] || null,
  };
}

async function viaPostmark({ to, from, subject, html, text }) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return { provider: 'postmark', skipped: 'POSTMARK_SERVER_TOKEN not set' };
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Postmark-Server-Token': token },
    body: JSON.stringify({
      From: `SORCE <${from}>`,
      To: to,
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
      // 'outbound' is the transactional stream. Campaigns must never use it — Postmark
      // polices that separation and suspends accounts that blur it.
      MessageStream: 'outbound',
      TrackOpens: false,
      // Explicit, not inherited from the server's default. SendGrid's link rewriting was
      // turned off because it was the likely cause of the junking — leaving Postmark's on
      // would reintroduce the same variable pointing the other way and invalidate the
      // comparison.
      TrackLinks: 'None',
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { provider: 'postmark', error: `${res.status} ${j.Message || ''}`.trim(), code: j.ErrorCode };
  return { provider: 'postmark', statusCode: res.status, messageId: j.MessageID || null };
}

(async () => {
  const recipients = String(arg('to', '')).split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) {
    console.error('Need --to with at least one address.\n  node scripts/deliverability-ab.js --to a@outlook.com,b@gmail.com');
    process.exit(1);
  }
  const template = arg('template', 'discovery');
  const which = arg('provider', 'both');
  const from = process.env.SENDGRID_TRANSACTIONAL_FROM || TRANSACTIONAL_EMAIL;

  const { subject, html } = buildMessage(template);
  const text = htmlToText(html);

  const imgs = (html.match(/<img/gi) || []).length;
  const tbls = (html.match(/<table/gi) || []).length;
  const grads = (html.match(/linear-gradient/gi) || []).length;

  console.log(`template : ${template}`);
  console.log(`from     : ${from}`);
  console.log(`subject  : ${subject}`);
  console.log(`html     : ${html.length} bytes, ${(html.length / text.length).toFixed(1)}:1 vs text`);
  console.log(`text part: ${text.length} chars`);
  console.log(`markup   : img=${imgs} table=${tbls} gradient=${grads}`);
  console.log(`providers: ${which}`);
  console.log('');

  // --dry renders and measures without sending. Useful for checking a template before
  // spending a send on a seed mailbox, since every message to one is a message that can't
  // be un-sent and the mailbox is only useful while it stays unengaged.
  if (process.argv.includes('--dry')) {
    console.log('--dry: nothing sent.');
    console.log('--- text/plain ---');
    console.log(text);
    return;
  }

  const senders = [];
  if (which === 'both' || which === 'sendgrid') senders.push(viaSendGrid);
  if (which === 'both' || which === 'postmark') senders.push(viaPostmark);

  for (const to of recipients) {
    for (const send of senders) {
      let out;
      try { out = await send({ to, from, subject, html, text }); }
      catch (err) { out = { provider: send === viaSendGrid ? 'sendgrid' : 'postmark', error: err.message }; }

      const row = { sentAt: new Date().toISOString(), to, from, template, subject, ...out, placement: null };
      fs.appendFileSync(LOG, JSON.stringify(row) + '\n');

      const status = out.skipped ? `SKIPPED (${out.skipped})` : out.error ? `ERROR ${out.error}` : `ok id=${out.messageId}`;
      console.log(`  ${out.provider.padEnd(9)} -> ${to.padEnd(30)} ${status}`);
    }
  }

  console.log('');
  console.log(`Logged to ${LOG}`);
  console.log('Now open each seed mailbox and record Inbox or Spam. Do NOT click "not junk" —');
  console.log('that trains the filter and burns the mailbox as an instrument for future runs.');
})();
