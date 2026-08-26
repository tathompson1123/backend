#!/usr/bin/env node
// Parse an extracted Messages database into conversation threads.
//
//   node scripts/iphone/parse.js --db scripts/iphone/data/sms.db [--json out.json] [--limit 20]
//
// Prints a health report first, because the honest failure mode of this format is
// silent: if the attributedBody decoder doesn't work on a given iOS version, messages
// come back with no text and every thread looks empty rather than throwing. The
// "unreadable" figure is the number to check before trusting anything downstream.

const fs = require('fs');
const path = require('path');
const {
  openMessagesDb, readMessages, buildThreads, normalizePhone,
} = require('./messagesDb');

function pct(n, total) {
  return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`;
}

function daysAgo(date) {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function main() {
  const args = process.argv.slice(2);
  const argOf = (flag, fallback = null) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };

  const dbPath = argOf('--db', path.join(__dirname, 'data', 'sms.db'));
  const jsonOut = argOf('--json');
  const limit = parseInt(argOf('--limit', '15'), 10);

  if (!fs.existsSync(dbPath)) {
    console.error(`No database at ${dbPath}`);
    console.error('Run: node scripts/iphone/extract.js');
    process.exit(1);
  }

  const db = openMessagesDb(dbPath);
  const { messages, stats } = readMessages(db);
  const threads = buildThreads(messages);
  db.close();

  console.log('=== message body extraction ===');
  console.log(`  messages            ${stats.total}`);
  console.log(`  plain text column   ${stats.fromText} (${pct(stats.fromText, stats.total)})`);
  console.log(`  attributedBody      ${stats.fromAttributedBody} (${pct(stats.fromAttributedBody, stats.total)})`);
  console.log(`  unreadable          ${stats.noBody} (${pct(stats.noBody, stats.total)})`);
  console.log(`  no usable timestamp ${stats.undatedRows}`);

  // Attachment-only messages legitimately have no text, so a small share is expected.
  // A large one means the decoder needs work on this iOS version.
  if (stats.total > 0 && stats.noBody / stats.total > 0.15) {
    console.log('\n  WARNING: more than 15% of messages have no readable body.');
    console.log('  Some of that is picture messages, but this is high enough that the');
    console.log('  attributedBody decoder likely needs adjusting before analysing.');
  }

  const dated = messages.filter(m => m.sentAt);
  if (dated.length > 0) {
    console.log('\n=== range ===');
    console.log(`  oldest  ${dated[0].sentAt.toISOString().slice(0, 10)}`);
    console.log(`  newest  ${dated[dated.length - 1].sentAt.toISOString().slice(0, 10)}`);
  }

  const oneToOne = threads.filter(t => !t.isGroup);
  console.log('\n=== threads ===');
  console.log(`  total               ${threads.length}`);
  console.log(`  one-to-one          ${oneToOne.length}`);
  console.log(`  group               ${threads.length - oneToOne.length}`);
  console.log(`  ended with THEM     ${threads.filter(t => t.lastDirection === 'inbound').length}  <- candidates for "never replied"`);
  console.log(`  ended with me       ${threads.filter(t => t.lastDirection === 'outbound').length}`);

  console.log(`\n=== ${Math.min(limit, threads.length)} most recent threads ===`);
  for (const t of threads.slice(0, limit)) {
    const who = t.chatName || t.handles[0] || t.threadKey;
    const age = daysAgo(t.lastAt);
    console.log(
      `  ${String(who).slice(0, 26).padEnd(26)}` +
      ` ${String(t.messageCount).padStart(4)} msgs` +
      ` | in ${String(t.inboundCount).padStart(3)} out ${String(t.outboundCount).padStart(3)}` +
      ` | last ${t.lastDirection === 'inbound' ? 'THEM' : 'me  '}` +
      ` ${age === null ? '  ?' : String(age).padStart(4)}d ago` +
      (t.isGroup ? ' | group' : ''));
  }

  if (jsonOut) {
    // Dates serialise to ISO strings, which is what the analysis step wants anyway.
    const payload = {
      extractedAt: new Date().toISOString(),
      stats,
      threads: threads.map(t => ({
        ...t,
        messages: t.messages.map(m => ({
          direction: m.direction,
          sentAt: m.sentAt ? m.sentAt.toISOString() : null,
          body: m.body,
          hasAttachments: m.hasAttachments,
        })),
      })),
    };
    fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 1));
    console.log(`\nWrote ${jsonOut} (${(fs.statSync(jsonOut).size / 1048576).toFixed(1)} MB)`);
  }

  console.log('\nNothing was sent anywhere — this only read the local file.');
}

if (require.main === module) main();

module.exports = { normalizePhone };
