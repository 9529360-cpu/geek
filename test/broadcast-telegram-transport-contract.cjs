'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '../ui/app.js');
const source = fs.readFileSync(appPath, 'utf8');

const start = source.indexOf("function platformTransportFor(account, wv)");
const end = source.indexOf("window.GeekPlatformTransports = Object.freeze", start);
assert.ok(start >= 0 && end > start, 'platformTransportFor block must exist');
const block = source.slice(start, end);

assert.match(
  block,
  /const transport = family === 'telegram' \? BROADCAST_ADAPTERS\['telegram-z'\] : BROADCAST_ADAPTERS\[family\]/,
  'Telegram must keep using the canonical telegram-z adapter'
);

const sendStart = block.indexOf("async sendText(text = '')");
assert.ok(sendStart >= 0, 'platform sendText implementation must exist');
const sendBlock = block.slice(sendStart, block.indexOf('\n      },', sendStart) + '\n      },'.length);

assert.match(
  sendBlock,
  /const script = typeof transport\.send === 'function' \? transport\.send\(text\) : transport\.send;/,
  'sendText must delegate to the selected platform adapter send implementation'
);
assert.doesNotMatch(
  sendBlock,
  /family === 'telegram'/,
  'sendText must not grow a Telegram-only submit path alongside the canonical adapter'
);
assert.doesNotMatch(
  sendBlock,
  /NO_SEND_BUTTON|Button\.send\.main-button/,
  'the removed narrow Telegram button selector must not return'
);

// Attachment transport is intentionally separate and must remain available.
assert.match(source, /sendTelegramAttachments/, 'Telegram attachment path must remain untouched');

console.log('BROADCAST_TELEGRAM_TRANSPORT_CONTRACT_OK');
