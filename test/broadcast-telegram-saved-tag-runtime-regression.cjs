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
// Contract: keep platform list refresh/readiness, preserve the real saved-tag owner selection when chips are only
// a partial rendering of that selection, and allow direct TG routing only for selected ids missing from the fresh list.

const chats = [
  { id: 'tg-a', name: 'A' },
  { id: 'tg-b', name: 'B' },
];

assert.deepEqual(api.resolveSavedTagSelection(['tg-visible'], ['tg-visible', 'tg-hidden'], 2), {
  ids: ['tg-visible', 'tg-hidden'],
  usesSavedTag: true,
}, 'an unchanged active saved tag must preserve durable ids hidden by Telegram virtual-list rendering');
assert.deepEqual(api.resolveSavedTagSelection(['tg-visible'], ['tg-visible', 'tg-hidden'], 1), {
  ids: ['tg-visible'],
  usesSavedTag: false,
}, 'manual recipient removal must stop restoring the original saved-tag ids');
assert.deepEqual(api.resolveSavedTagSelection(['tg-visible', 'tg-extra'], ['tg-visible', 'tg-hidden'], 3), {
  ids: ['tg-visible', 'tg-extra'],
  usesSavedTag: false,
}, 'manual recipient addition must use the current visible manual selection rather than the saved tag');
assert.deepEqual(api.resolveSavedTagSelection(['tg-visible'], ['tg-visible', 'tg-hidden', 'tg-hidden'], 2), {
  ids: ['tg-visible', 'tg-hidden'],
  usesSavedTag: true,
}, 'durable saved-tag ids are normalized before owner-count comparison');

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
assert.match(runtime, /await selectedCustomIds\(ctx\)/, 'custom target resolution must consult the active saved-tag owner selection before platform filtering');
assert.match(runtime, /accountData\.getAll\(ctx\.account\.id\)/, 'saved-tag recovery must re-read durable data from the current account scope');
assert.match(runtime, /#broadcast-recipient-tag-list \.bc-original-tag\.active/, 'durable ids may be reused only while a saved tag is visibly active');
assert.match(runtime, /getElementById\('bc-saved-lists'\)/, 'the hidden app.js owner select remains the tag-index source of truth');
assert.match(runtime, /querySelector\('\.bc-selected-count'\)/, 'the real app.js selection count must guard against replaying a tag after manual edits');
assert.match(runtime, /resolveCustomTargets\(chats, await selectedCustomIds\(ctx\), ctx\.platform\.family\)/, 'custom target resolution must use the narrow platform-aware resolver');
assert.match(runtime, /async function openTargetChat\(ctx, target\)/, 'runtime must own one explicit target-open boundary');
assert.match(runtime, /target\.telegramRouteFallback !== true/, 'direct routing must be limited to TG targets proven missing from the refreshed virtual list');
assert.match(runtime, /location\.hash = targetHash/, 'TG fallback must use the same href/hash identity already captured from Telegram');
assert.match(runtime, /GeekBroadcastSafety\.sameChat\(current, target\.id\)/, 'TG fallback must prove the expected chat before composer/send authorization continues');
assert.doesNotMatch(runtime, /if \(mode === 'custom'\) \{\s*targets = selectedChatTargets\(\)/, 'the failed #247 bypass must not return');

console.log('BROADCAST_TELEGRAM_SAVED_TAG_RUNTIME_REGRESSION_OK');
