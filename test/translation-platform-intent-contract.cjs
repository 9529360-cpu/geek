'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
const whatsapp = fs.readFileSync(path.join(root, 'ui', 'translation-whatsapp-rehydrate.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'src', 'translation-runtime.cjs'), 'utf8');

assert.match(
  adapters,
  /translateHistory:[^}]+intent: 'message-display'/,
  'Telegram visible/history translation must be explicit background work',
);
assert.match(
  adapters,
  /text: original, source: setting\.source[^}]+intent: 'outgoing-send'/,
  'Telegram translated send must carry explicit outgoing intent',
);
assert.match(
  adapters,
  /chatId: cid, intent: 'message-display'/,
  'LINE visible translation must carry explicit background intent',
);
assert.match(
  adapters,
  /text: original, source: setting\.sendFrom[^}]+intent: 'outgoing-send'/,
  'LINE translated send must carry explicit outgoing intent',
);
assert.match(
  adapters,
  /const intent = body\.intent === 'outgoing-send' \? 'outgoing-send' : 'message-display'/,
  'Telegram/LINE bridge transport must fail unknown or missing intent toward background priority',
);
assert.match(
  whatsapp,
  /intent = body\.intent === 'outgoing-send' \? 'outgoing-send' : 'message-display'/,
  'WhatsApp bridge transport must fail unknown or missing intent toward background priority',
);
assert.match(
  runtime,
  /normalizeTranslationIntent\(body\.intent\)/,
  'main-process runtime must normalize the explicit intent again at the trust boundary',
);
assert.doesNotMatch(
  runtime,
  /messageTarget|sendTo|activeElement|document\.|querySelector/,
  'main-process scheduling priority must not be inferred from languages or renderer UI state',
);

console.log('TRANSLATION_PLATFORM_INTENT_CONTRACT_OK');
