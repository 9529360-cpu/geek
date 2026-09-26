'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = require('../ui/send-intent-coordinator.js');
const source = fs.readFileSync(path.join(root, 'ui', 'send-intent-coordinator.js'), 'utf8');

function binding(overrides = {}) {
  return {
    accountId: 'account-A',
    partition: 'persist:webview-page-account-A',
    platform: 'telegram',
    webviewId: '77',
    webviewGeneration: 4,
    conversationId: 'chat-A',
    composerGeneration: 9,
    submitPermitId: 'permit-private',
    ...overrides,
  };
}

function ownerContext(overrides = {}) {
  const value = binding(overrides);
  delete value.submitPermitId;
  return value;
}

function createReadyHarness() {
  let time = 1000;
  const coordinator = api.createCoordinator({
    now: () => time,
    idFactory: () => 'intent-rebind',
    maxRecords: 8,
  });
  const created = coordinator.begin({
    ...binding(),
    sourceSnapshot: 'private-source',
    transformPolicy: { target: 'en' },
    deadlineAt: 5000,
  });
  coordinator.startTransform(created.intentId);
  return { coordinator, intentId: created.intentId, setTime: value => { time = value; } };
}

const h = createReadyHarness();
assert.equal(h.coordinator.get(h.intentId).state, 'transforming');

for (const field of ['accountId', 'partition', 'platform', 'webviewId', 'webviewGeneration', 'conversationId']) {
  const changed = ownerContext();
  if (field === 'webviewGeneration') changed[field] += 1;
  else changed[field] = String(changed[field]) + '-stale';
  assert.throws(
    () => h.coordinator.rebindComposerGenerationOwned(h.intentId, changed),
    error => error?.code === 'SEND_INTENT_STALE_CONTEXT' && error?.field === field,
    'owner rebind must reject stale ' + field,
  );
  assert.equal(h.coordinator.get(h.intentId).state, 'transforming');
}

assert.throws(
  () => h.coordinator.rebindComposerGenerationOwned(h.intentId, ownerContext({ composerGeneration: 8 })),
  error => error?.code === 'SEND_INTENT_STALE_CONTEXT' && error?.field === 'composerGeneration',
  'owner rebind must never move composer generation backwards',
);

assert.equal(
  h.coordinator.rebindComposerGenerationOwned(h.intentId, ownerContext({ composerGeneration: 9 })).state,
  'transforming',
  'equal generation is a safe no-op',
);
assert.equal(
  h.coordinator.rebindComposerGenerationOwned(h.intentId, ownerContext({ composerGeneration: 12 })).state,
  'transforming',
  'owner may advance commit composer generation during transform',
);

const projected = JSON.stringify(h.coordinator.get(h.intentId));
for (const forbidden of ['permit-private', 'account-A', 'persist:webview-page-account-A', 'chat-A', 'private-source']) {
  assert.equal(projected.includes(forbidden), false, 'public projection leaked ' + forbidden);
}

h.coordinator.markReady(h.intentId);
assert.throws(
  () => h.coordinator.rebindComposerGenerationOwned(h.intentId, ownerContext({ composerGeneration: 13 })),
  error => error?.code === 'SEND_INTENT_INVALID_STATE',
  'ready intent must not be rebound',
);
assert.throws(
  () => h.coordinator.beginCommitOwned(h.intentId, ownerContext({ composerGeneration: 9 })),
  error => error?.code === 'SEND_INTENT_STALE_CONTEXT' && error?.field === 'composerGeneration',
  'commit must validate against the advanced private commit binding',
);
assert.equal(h.coordinator.get(h.intentId).state, 'ready');
assert.equal(
  h.coordinator.beginCommitOwned(h.intentId, ownerContext({ composerGeneration: 12 })).state,
  'committing',
);
assert.throws(
  () => h.coordinator.rebindComposerGenerationOwned(h.intentId, ownerContext({ composerGeneration: 13 })),
  error => error?.code === 'SEND_INTENT_INVALID_STATE',
);

const terminal = createReadyHarness();
terminal.coordinator.rebindComposerGenerationOwned(terminal.intentId, ownerContext({ composerGeneration: 10 }));
terminal.coordinator.fail(terminal.intentId, 'TEST_FAILURE');
assert.throws(
  () => terminal.coordinator.rebindComposerGenerationOwned(terminal.intentId, ownerContext({ composerGeneration: 11 })),
  error => error?.code === 'SEND_INTENT_INVALID_STATE',
  'terminal intent must not be rebound',
);

const rebindStart = source.indexOf('function rebindComposerGenerationOwned');
const rebindEnd = source.indexOf('\n    function beginCommit(', rebindStart);
const rebindSource = source.slice(rebindStart, rebindEnd);
assert.ok(rebindStart >= 0 && rebindEnd > rebindStart, 'rebind owner must exist');
assert.doesNotMatch(rebindSource, /currentBinding\.submitPermitId|input\.submitPermitId/, 'rebind caller must not provide permit identity');
assert.match(rebindSource, /record\.binding\.submitPermitId/, 'coordinator must preserve permit identity internally');
assert.match(source, /intentId, binding, commitBinding: binding, sourceSnapshot/, 'admission binding and commit binding must be separate records');

console.log('SEND_INTENT_COMPOSER_REBIND_CONTRACT_OK');
