'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const api = require(runtimePath);

// BRT-20260829-TG-SAVED-TAG-RUNTIME
// 9b7007a: manual TG custom recipients send; saved-tag restore can lose recipients at send-time list refresh.
// 8eca203: removing that refresh entirely regressed manual TG sending.
// Contract: keep platform list refresh/readiness, preserve selected TG ids missing from the refreshed virtual list,
// and only allow direct TG hash fallback for those preserved ids. Existing same-chat authorization remains mandatory.

const chats = [
  { id: 'tg-a', name: 'A' },
  { id: 'tg-b', name: 'B' },
];
assert.deepEqual(api.resolveCustomTargets(chats, ['tg-a'], 'telegram'), [
  { id: 'tg-a', name: 'A' },
], 'mounted manual TG recipients keep the established listChats-derived target shape');
assert.deepEqual(api.resolveCustomTargets(chats, ['tg-a', 'tg-a', 'tg-missing'], 'telegram'), [
  { id: 'tg-a', name: 'A' },
  { id: 'tg-missing', name: 'tg-missing', telegramRouteFallback: true },
], 'saved TG recipients missing only from the refreshed virtual list remain in the immutable Job snapshot without duplication');
assert.equal(api.resolveCustomTargets(chats, ['tg-a'], 'telegram')[0].telegramRouteFallback, undefined, 'mounted/manual TG targets must never opt into direct-route fallback');
assert.deepEqual(api.resolveCustomTargets(chats, ['wa-missing'], 'whatsapp'), [], 'WA custom target behavior is unchanged');
assert.deepEqual(api.resolveCustomTargets(chats, ['line-missing'], 'line'), [], 'LINE custom target behavior is unchanged');

assert.match(runtime, /const chats = await ctx\.platform\.listChats\(\);/, 'custom TG send must retain the existing platform list refresh/readiness barrier');
assert.match(runtime, /resolveCustomTargets\(chats, selectedChatIds\(\), ctx\.platform\.family\)/, 'custom target resolution must use the narrow platform-aware resolver');
assert.match(runtime, /async function openTargetChat\(ctx, target\)/, 'runtime must own one explicit target-open boundary');
assert.match(runtime, /target\.telegramRouteFallback !== true/, 'direct routing must be limited to TG targets proven missing from the refreshed virtual list');
assert.match(runtime, /location\.hash = targetHash/, 'TG fallback must use the same href/hash identity already captured from Telegram');
assert.match(runtime, /GeekBroadcastSafety\.sameChat\(current, target\.id\)/, 'TG fallback must prove the expected chat before composer/send authorization continues');
assert.doesNotMatch(runtime, /if \(mode === 'custom'\) \{\s*targets = selectedChatTargets\(\)/, 'the failed #247 bypass must not return');

console.log('BROADCAST_TELEGRAM_SAVED_TAG_RUNTIME_REGRESSION_OK');
