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

const LOG = path.join(__dirname, '.deliverability-log.jsonl');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Fixed dummy data. Deliberately not randomised: two runs should differ only by provider,
// and a changing body would let content variation masquerade as a provider difference.
function buildMessage(template) {
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

  console.log(`template : ${template}`);
  console.log(`from     : ${from}`);
  console.log(`subject  : ${subject}`);
  console.log(`text part: ${text.length} chars`);
  console.log(`providers: ${which}`);
  console.log('');

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
