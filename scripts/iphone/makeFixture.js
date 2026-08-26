// Build a synthetic Apple Messages database for testing the parser.
//
//   node scripts/iphone/makeFixture.js && node scripts/iphone/parse.js --db scripts/iphone/data/test-sms.db
//
// Covers the cases that actually break this format, so a regression shows up here
// rather than on someone's real message history:
//   - a body stored ONLY in attributedBody (modern iOS), short and long length prefixes
//   - a legacy SECONDS timestamp alongside modern NANOsecond ones
//   - a tapback, which must not count as a reply
//   - an attachment-only message, which legitimately has no text
//   - a group thread, which must be flagged rather than treated as one customer
//
// The output lands in data/ and is gitignored along with any real extract.

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const out = require('path').join(__dirname, 'data', 'test-sms.db');
fs.mkdirSync(require('path').dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
const db = new DatabaseSync(out);

db.exec(`
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT, service_name TEXT);
CREATE TABLE message (
  ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB,
  handle_id INTEGER, service TEXT, date INTEGER, is_from_me INTEGER,
  cache_has_attachments INTEGER, associated_message_type INTEGER, item_type INTEGER
);
CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
`);

// Build a typedstream-ish attributedBody the way real ones are shaped:
// ...NSString... '+' <length> <utf8 bytes>
function attributedBody(text) {
  const body = Buffer.from(text, 'utf8');
  const head = Buffer.from('\x04\x0bstreamtyped\x81\xe8\x03\x84\x01\x40\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01\x2b', 'latin1');
  let lenPart;
  if (body.length < 0x80) {
    lenPart = Buffer.from([body.length]);
  } else {
    lenPart = Buffer.alloc(3);
    lenPart[0] = 0x81;
    lenPart.writeUInt16LE(body.length, 1);
  }
  const tail = Buffer.from('\x86\x84\x02iI\x00\x84\x84', 'latin1');
  return Buffer.concat([head, lenPart, body, tail]);
}

// Apple epoch nanoseconds for a given ISO date.
const APPLE = 978307200;
const ns = iso => Math.round((new Date(iso).getTime() / 1000 - APPLE) * 1e9);
const sec = iso => Math.round(new Date(iso).getTime() / 1000 - APPLE); // legacy encoding

db.prepare('INSERT INTO handle VALUES (?,?,?)').run(1, '+12065551234', 'iMessage');
db.prepare('INSERT INTO handle VALUES (?,?,?)').run(2, '(206) 555-9876', 'SMS');
db.prepare('INSERT INTO handle VALUES (?,?,?)').run(3, 'someone@example.com', 'iMessage');

db.prepare('INSERT INTO chat VALUES (?,?,?,?,?)').run(1, 'x1', '+12065551234', null, 'iMessage');
db.prepare('INSERT INTO chat VALUES (?,?,?,?,?)').run(2, 'x2', '(206) 555-9876', null, 'SMS');
db.prepare('INSERT INTO chat VALUES (?,?,?,?,?)').run(3, 'x3', 'chat9999', 'Crew', 'iMessage');

const ins = db.prepare(`INSERT INTO message
  (ROWID, guid, text, attributedBody, handle_id, service, date, is_from_me,
   cache_has_attachments, associated_message_type, item_type)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

let id = 1;
const add = (o) => ins.run(id, 'g' + id++, o.text ?? null, o.blob ?? null, o.handle, o.service ?? 'iMessage',
  o.date, o.fromMe ? 1 : 0, o.att ? 1 : 0, o.assoc ?? 0, o.item ?? 0);

// Thread 1: modern iOS — text NULL, body in attributedBody. Ends with THEM.
add({ blob: attributedBody('Hi, how much for a full detail on a Tahoe?'), handle: 1, date: ns('2026-06-01T15:00:00Z') });
add({ blob: attributedBody('For a Tahoe that would be $399. I can do Thursday.'), handle: 1, date: ns('2026-06-01T15:20:00Z'), fromMe: true });
add({ blob: attributedBody('That is more than I hoped. Let me talk to my wife.'), handle: 1, date: ns('2026-06-01T16:00:00Z') });
// a tapback that must NOT count as a reply
add({ blob: attributedBody('Liked "That is more than I hoped"'), handle: 1, date: ns('2026-06-01T16:05:00Z'), fromMe: true, assoc: 2000 });

// Thread 2: legacy SECONDS timestamp + plain text column. I promised and never followed up.
add({ text: 'Do you do ceramic coating?', handle: 2, service: 'SMS', date: sec('2026-05-02T18:00:00Z') });
add({ text: "Yes! I'll send you a quote Monday.", handle: 2, service: 'SMS', date: sec('2026-05-02T18:30:00Z'), fromMe: true });

// Thread 3: group chat + an attachment-only message (legitimately no body)
add({ blob: attributedBody('Crew, who is covering Saturday?'), handle: 3, date: ns('2026-07-10T12:00:00Z') });
add({ text: null, blob: null, handle: 1, date: ns('2026-07-10T12:05:00Z'), att: 1 });

db.prepare('INSERT INTO chat_message_join VALUES (?,?)').run(1, 1);
db.prepare('INSERT INTO chat_message_join VALUES (?,?)').run(1, 2);
db.prepare('INSERT INTO chat_message_join VALUES (?,?)').run(1, 3);
db.prepare('INSERT INTO chat_message_join VALUES (?,?)').run(1, 4);
db.prepare('INSERT INTO chat_message_join VALUES (?,?)').run(2, 5);
db.prepare('INSERT INTO chat_message_join VALUES (?,?)').run(2, 6);
db.prepare('INSERT INTO chat_message_join VALUES (?,?)').run(3, 7);
db.prepare('INSERT INTO chat_message_join VALUES (?,?)').run(3, 8);

db.close();
console.log('fixture written:', out);
