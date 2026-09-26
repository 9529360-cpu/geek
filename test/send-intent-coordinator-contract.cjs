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
    platform: 'future-chat',
    webviewId: '77',
    webviewGeneration: 4,
    conversationId: 'conversation-private',
    composerGeneration: 9,
    submitPermitId: 'permit-private',
    ...overrides,
  };
}

function harness(options = {}) {
  let time = options.start || 1000;
  let seq = 0;
  const coordinator = api.createCoordinator({
    now: () => time,
    idFactory: options.idFactory || (() => `intent-${++seq}`),
    maxRecords: options.maxRecords || 16,
  });
  return { coordinator, now: () => time, setTime: value => { time = value; } };
}
const secretSource = 'PRIVATE-MESSAGE-CONTENT';
const policy = { translate: true, target: 'it', nested: { mode: 'strict' } };
const h = harness();
const created = h.coordinator.begin({
  ...binding(),
  sourceSnapshot: secretSource,
  transformPolicy: policy,
  deadlineAt: 5000,
});
assert.equal(created.state, 'created');
assert.equal(created.platform, 'future-chat');
assert.equal(h.coordinator.readSource(created.intentId), secretSource);
policy.nested.mode = 'mutated';
assert.equal(h.coordinator.readTransformPolicy(created.intentId).nested.mode, 'strict');
assert.equal(Object.isFrozen(h.coordinator.readTransformPolicy(created.intentId)), true);
assert.equal(Object.isFrozen(h.coordinator.readTransformPolicy(created.intentId).nested), true);

const projected = JSON.stringify(h.coordinator.get(created.intentId));
for (const forbidden of [secretSource, 'account-A', 'persist:webview-page-account-A', 'conversation-private', 'permit-private']) {
  assert.equal(projected.includes(forbidden), false, `projection leaked ${forbidden}`);
}
assert.equal(h.coordinator.signal(created.intentId).aborted, false);
assert.equal(h.coordinator.startTransform(created.intentId).state, 'transforming');
assert.equal(h.coordinator.markReady(created.intentId).state, 'ready');
for (const field of api.BINDING_FIELDS) {
  const altered = binding();
  if (field === 'webviewGeneration' || field === 'composerGeneration') altered[field] += 1;
  else altered[field] = String(altered[field]) + '-stale';
  assert.throws(
    () => h.coordinator.beginCommit(created.intentId, altered),
    error => error?.code === 'SEND_INTENT_STALE_CONTEXT' && error?.field === field
      && !String(error?.message || '').includes(secretSource),
    `mismatch ${field} must fail closed`,
  );
}
assert.equal(h.coordinator.get(created.intentId).state, 'ready');
assert.equal(h.coordinator.beginCommit(created.intentId, binding()).state, 'committing');
h.setTime(9000);
assert.equal(h.coordinator.markSent(created.intentId).state, 'sent', 'confirmed commit must remain recordable after deadline');
assert.throws(() => h.coordinator.cancel(created.intentId), error => error?.code === 'SEND_INTENT_COMMIT_IN_PROGRESS');
assert.equal(h.coordinator.forget(created.intentId), true);
assert.equal(h.coordinator.size(), 0);
assert.throws(() => h.coordinator.get(created.intentId), error => error?.code === 'SEND_INTENT_NOT_FOUND');
const deadline = harness();
const expiredBeforeTransform = deadline.coordinator.begin({ ...binding(), sourceSnapshot: 'x', deadlineAt: 1100 });
deadline.setTime(1100);
assert.throws(() => deadline.coordinator.startTransform(expiredBeforeTransform.intentId), error => error?.code === 'SEND_INTENT_DEADLINE_EXCEEDED');
assert.equal(deadline.coordinator.get(expiredBeforeTransform.intentId).state, 'created');

deadline.setTime(1200);
const expiredBeforeCommit = deadline.coordinator.begin({ ...binding(), sourceSnapshot: 'y', deadlineAt: 1400 });
deadline.coordinator.startTransform(expiredBeforeCommit.intentId);
deadline.coordinator.markReady(expiredBeforeCommit.intentId);
deadline.setTime(1400);
assert.throws(() => deadline.coordinator.beginCommit(expiredBeforeCommit.intentId, binding()), error => error?.code === 'SEND_INTENT_DEADLINE_EXCEEDED');
assert.equal(deadline.coordinator.get(expiredBeforeCommit.intentId).state, 'ready');

const cancelled = harness();
const cancelIntent = cancelled.coordinator.begin({ ...binding(), sourceSnapshot: 'cancel-me', deadlineAt: 5000 });
cancelled.coordinator.startTransform(cancelIntent.intentId);
assert.equal(cancelled.coordinator.cancel(cancelIntent.intentId, 'CHAT_SWITCHED').state, 'cancelled');
assert.equal(cancelled.coordinator.signal(cancelIntent.intentId).aborted, true);
assert.equal(cancelled.coordinator.signal(cancelIntent.intentId).reason?.code, 'CHAT_SWITCHED');
assert.equal(cancelled.coordinator.cancel(cancelIntent.intentId).state, 'cancelled', 'cancel is idempotent once cancelled');
const failure = harness();
const failed = failure.coordinator.begin({ ...binding(), sourceSnapshot: 'never-log-this', deadlineAt: 5000 });
failure.coordinator.startTransform(failed.intentId);
assert.equal(failure.coordinator.fail(failed.intentId, 'TRANSFORM_FAILED').state, 'failed');
assert.equal(failure.coordinator.signal(failed.intentId).aborted, true);
assert.equal(JSON.stringify(failure.coordinator.get(failed.intentId)).includes('never-log-this'), false);

const capacity = harness({ maxRecords: 2 });
const c1 = capacity.coordinator.begin({ ...binding({ conversationId: 'c1' }), sourceSnapshot: '1', deadlineAt: 5000 });
capacity.coordinator.begin({ ...binding({ conversationId: 'c2' }), sourceSnapshot: '2', deadlineAt: 5000 });
assert.throws(
  () => capacity.coordinator.begin({ ...binding({ conversationId: 'c3' }), sourceSnapshot: '3', deadlineAt: 5000 }),
  error => error?.code === 'SEND_INTENT_CAPACITY',
);
capacity.coordinator.fail(c1.intentId, 'TEST_TERMINAL');
capacity.coordinator.begin({ ...binding({ conversationId: 'c3' }), sourceSnapshot: '3', deadlineAt: 5000 });
assert.equal(capacity.coordinator.size(), 2, 'oldest terminal record is pruned before new admission');

const transitions = harness();
const t = transitions.coordinator.begin({ ...binding(), sourceSnapshot: 't', deadlineAt: 5000 });
assert.throws(() => transitions.coordinator.markReady(t.intentId), error => error?.code === 'SEND_INTENT_INVALID_STATE');
assert.throws(() => transitions.coordinator.markSent(t.intentId), error => error?.code === 'SEND_INTENT_INVALID_STATE');
assert.throws(() => transitions.coordinator.forget(t.intentId), error => error?.code === 'SEND_INTENT_NOT_TERMINAL');
const duplicate = harness({ idFactory: () => 'same-intent' });
duplicate.coordinator.begin({ ...binding(), sourceSnapshot: 'a', deadlineAt: 5000 });
assert.throws(
  () => duplicate.coordinator.begin({ ...binding({ conversationId: 'other' }), sourceSnapshot: 'b', deadlineAt: 5000 }),
  error => error?.code === 'SEND_INTENT_DUPLICATE',
);

assert.doesNotMatch(source, /querySelector|executeJavaScript|window\.WPP|GeekBroadcast/, 'coordinator must not own platform or Broadcast mechanics');
assert.doesNotMatch(source, /Math\.random/, 'transaction identity must not use Math.random');

console.log('SEND_INTENT_COORDINATOR_CONTRACT_OK');
