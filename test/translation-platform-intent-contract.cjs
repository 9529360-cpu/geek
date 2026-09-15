'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
const whatsapp = fs.readFileSync(path.join(root, 'ui', 'translation-whatsapp-rehydrate.js'), 'utf8');
const whatsappSend = fs.readFileSync(path.join(root, 'ui', 'whatsapp-translation-hook-recovery.js'), 'utf8');
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
  /const intent = body\.intent === 'outgoing-send' \? 'outgoing-send' : 'message-display'/,
  'WhatsApp bridge transport must fail unknown or missing intent toward background priority',
);
assert.match(
  whatsappSend,
  /route: setting\.route,[\s\S]{0,120}chatId,[\s\S]{0,120}intent: 'outgoing-send'/,
  'WhatsApp native translated-send owner must carry explicit outgoing intent',
);
assert.doesNotMatch(
  whatsapp,
  /pendingOutgoingIntent|recordOutgoingIntent|activeComposerText|isComposerTarget|isSendButtonTarget|OUTGOING_INTENT_TTL_MS/,
  'WhatsApp background adapter must never infer scheduling priority from DOM gestures, focus, or composer text',
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
