// Reading an iPhone Messages database (iMessage + SMS).
//
// The file is plain SQLite: `sms.db` inside an iPhone backup, or `chat.db` in
// ~/Library/Messages on a Mac. The schema is the same either way, so everything here
// works on both.
//
// Two things about this format cause almost all the trouble:
//
//  1. Timestamps are Apple epoch — offset from 2001-01-01, not 1970. iOS 11+ stores
//     NANOseconds; older rows store seconds. Both appear in a long-lived database.
//  2. On modern iOS `message.text` is usually NULL and the body lives in
//     `attributedBody`, an NSKeyedArchiver "typedstream" blob. Read only `text` and
//     most messages come back empty — this is the single biggest trap, so the decoder
//     below exists and the parser reports how often it was needed.

const { DatabaseSync } = require('node:sqlite');

// Seconds between 1970-01-01 and 2001-01-01.
const APPLE_EPOCH_OFFSET = 978307200;

/**
 * Apple timestamp -> JS Date. Handles both nanosecond (iOS 11+) and second (older)
 * encodings; anything above ~1e11 can only be nanoseconds, since seconds-since-2001
 * won't reach that until the year 5138.
 */
function appleDateToJs(value) {
  // Accepts a number, a BigInt or the TEXT form the query returns.
  const raw = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(raw) || raw === 0) return null;
  const seconds = Math.abs(raw) > 1e11 ? raw / 1e9 : raw;
  const ms = (seconds + APPLE_EPOCH_OFFSET) * 1000;
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Pull the message body out of an `attributedBody` typedstream blob.
 *
 * The archive holds an NSString whose bytes follow a `+` marker and a length prefix:
 * a single byte for short strings, or 0x81/0x82 introducing a 2- or 4-byte
 * little-endian length. Returns null rather than guessing when the shape isn't
 * recognised, so the caller can count failures instead of storing garbage.
 */
function decodeAttributedBody(blob) {
  if (!blob) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length === 0) return null;

  const marker = buf.indexOf('NSString', 0, 'latin1');
  if (marker === -1) return null;

  let i = buf.indexOf(0x2b, marker); // '+'
  if (i === -1) return null;
  i += 1;
  if (i >= buf.length) return null;

  let len = buf[i];
  i += 1;
  if (len === 0x81) {
    if (i + 2 > buf.length) return null;
    len = buf.readUInt16LE(i);
    i += 2;
  } else if (len === 0x82) {
    if (i + 4 > buf.length) return null;
    len = buf.readUInt32LE(i);
    i += 4;
  } else if (len >= 0x80) {
    // Some other multi-byte form we don't model — better to report a miss.
    return null;
  }

  if (!Number.isFinite(len) || len <= 0 || i + len > buf.length) return null;
  const text = buf.subarray(i, i + len).toString('utf8');
  return text.length > 0 ? text : null;
}

/** Last 10 digits, which is how a US number can be compared across formats. */
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : (digits || null);
}

function openMessagesDb(filePath) {
  // Read-only: never write to a copy of someone's message history.
  return new DatabaseSync(filePath, { readOnly: true });
}

/**
 * Every message, joined to its conversation and counterparty.
 *
 * Reactions and tapbacks are excluded (`associated_message_type` is non-zero on those)
 * — a thumbs-up on a message is not a reply, and counting it as one would make a dead
 * thread look answered.
 */
function readMessages(db) {
  const rows = db.prepare(`
    SELECT
      m.ROWID              AS id,
      m.guid               AS guid,
      m.text               AS text,
      m.attributedBody     AS attributed_body,
      m.is_from_me         AS is_from_me,
      -- Read as TEXT. A nanosecond Apple timestamp is ~8.0e17, past
      -- Number.MAX_SAFE_INTEGER, and node:sqlite throws ERR_OUT_OF_RANGE rather than
      -- returning it. Parsing the string costs ~178ns of precision on a value we only
      -- need to millisecond resolution.
      CAST(m.date AS TEXT) AS date,
      m.service            AS service,
      m.cache_has_attachments AS has_attachments,
      m.associated_message_type AS assoc_type,
      h.id                 AS handle,
      c.ROWID              AS chat_id,
      c.chat_identifier    AS chat_identifier,
      c.display_name       AS chat_display_name
    FROM message m
    LEFT JOIN handle h            ON h.ROWID = m.handle_id
    LEFT JOIN chat_message_join j ON j.message_id = m.ROWID
    LEFT JOIN chat c              ON c.ROWID = j.chat_id
    WHERE COALESCE(m.associated_message_type, 0) = 0
      AND COALESCE(m.item_type, 0) = 0
    ORDER BY m.date ASC
  `).all();

  const stats = { total: rows.length, fromText: 0, fromAttributedBody: 0, noBody: 0, undatedRows: 0 };

  const messages = rows.map(row => {
    let body = row.text && String(row.text).trim() ? String(row.text) : null;
    if (body) {
      stats.fromText += 1;
    } else {
      body = decodeAttributedBody(row.attributed_body);
      if (body) stats.fromAttributedBody += 1;
      else stats.noBody += 1;
    }

    const sentAt = appleDateToJs(row.date);
    if (!sentAt) stats.undatedRows += 1;

    return {
      id: row.id,
      guid: row.guid,
      chatId: row.chat_id,
      // chat_identifier is the thread key; handle is the individual sender. For a 1:1
      // thread they match, and for a group the handle is who spoke.
      threadKey: row.chat_identifier || row.handle || `chat:${row.chat_id}`,
      chatName: row.chat_display_name || null,
      handle: row.handle || null,
      phone: normalizePhone(row.handle),
      direction: row.is_from_me === 1 ? 'outbound' : 'inbound',
      service: row.service || null,
      hasAttachments: row.has_attachments === 1,
      body,
      sentAt,
    };
  });

  return { messages, stats };
}

/**
 * Group messages into conversations, newest activity first.
 *
 * A group chat is flagged rather than dropped: "I'll get back to you" in a group thread
 * is still a dropped commitment, but it shouldn't be treated as one customer.
 */
function buildThreads(messages) {
  const byThread = new Map();

  for (const msg of messages) {
    if (!byThread.has(msg.threadKey)) {
      byThread.set(msg.threadKey, {
        threadKey: msg.threadKey,
        chatName: msg.chatName,
        handles: new Set(),
        phones: new Set(),
        messages: [],
      });
    }
    const thread = byThread.get(msg.threadKey);
    if (msg.handle) thread.handles.add(msg.handle);
    if (msg.phone) thread.phones.add(msg.phone);
    thread.messages.push(msg);
  }

  const threads = [...byThread.values()].map(thread => {
    const withBody = thread.messages.filter(m => m.body);
    const last = thread.messages[thread.messages.length - 1];
    const lastInbound = [...thread.messages].reverse().find(m => m.direction === 'inbound');
    const lastOutbound = [...thread.messages].reverse().find(m => m.direction === 'outbound');

    return {
      threadKey: thread.threadKey,
      chatName: thread.chatName,
      handles: [...thread.handles],
      phones: [...thread.phones],
      // More than one counterparty means a group thread, not a customer conversation.
      isGroup: thread.handles.size > 1,
      messageCount: thread.messages.length,
      readableCount: withBody.length,
      inboundCount: thread.messages.filter(m => m.direction === 'inbound').length,
      outboundCount: thread.messages.filter(m => m.direction === 'outbound').length,
      firstAt: thread.messages.find(m => m.sentAt)?.sentAt || null,
      lastAt: last?.sentAt || null,
      lastDirection: last?.direction || null,
      lastInboundAt: lastInbound?.sentAt || null,
      lastOutboundAt: lastOutbound?.sentAt || null,
      messages: thread.messages,
    };
  });

  threads.sort((a, b) => (b.lastAt?.getTime() || 0) - (a.lastAt?.getTime() || 0));
  return threads;
}

module.exports = {
  APPLE_EPOCH_OFFSET,
  appleDateToJs,
  decodeAttributedBody,
  normalizePhone,
  openMessagesDb,
  readMessages,
  buildThreads,
};
