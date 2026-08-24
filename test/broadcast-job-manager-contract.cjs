'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const api = require(path.join(__dirname, '../ui/broadcast-job-manager.js'));

let tick = 1000;
const manager = api.createManager({ now: () => ++tick });

const a = manager.start({
  accountId: 'account-a',
  accountName: 'A',
  partition: 'persist:a',
  platformFamily: 'whatsapp',
  webviewId: 'wv-a',
  targets: [{ id: 'a1' }, { id: 'a2' }],
  message: 'hello A',
  files: [{ token: 'file-a' }],
  intervalMin: 5,
  intervalMax: 10,
});
const b = manager.start({
  accountId: 'account-b',
  accountName: 'B',
  partition: 'persist:b',
  platformFamily: 'telegram',
  webviewId: 'wv-b',
  targets: [{ id: 'b1' }],
  message: 'hello B',
  intervalMin: 8,
  intervalMax: 12,
});

assert.equal(manager.hasActive('account-a'), true, 'account A must have its own active job');
assert.equal(manager.hasActive('account-b'), true, 'account B must run concurrently with account A');
assert.equal(manager.getActive('account-a').id, a.id);
assert.equal(manager.getActive('account-b').id, b.id);
assert.equal(api.visibleFor(manager.getCurrent('account-a'), 'account-a'), true);
assert.equal(api.visibleFor(manager.getCurrent('account-a'), 'account-b'), false);

assert.throws(
  () => manager.start({ accountId: 'account-a', targets: [{ id: 'a3' }] }),
  /already has an active broadcast job/,
  'one account must not run two ordinary broadcasts concurrently',
);

manager.update(a.id, { current: 1, ok: 1, nextSendAt: 5000 });
assert.equal(manager.get(a.id).current, 1);
assert.equal(manager.get(a.id).ok, 1);
assert.equal(manager.get(b.id).current, 0, 'A progress must not mutate B');

let pausedA = 0;
let resumedA = 0;
let stoppedA = 0;
manager.attachControls(a.id, {
  pause: async () => { pausedA += 1; },
  resume: async () => { resumedA += 1; },
  stop: async () => { stoppedA += 1; },
});

(async () => {
  await manager.invoke(a.id, 'pause');
  assert.equal(pausedA, 1);
  assert.equal(manager.get(a.id).state, 'paused');
  assert.equal(manager.get(b.id).state, 'running', 'pausing A must not affect B');

  await manager.invoke(a.id, 'resume');
  assert.equal(resumedA, 1);
  assert.equal(manager.get(a.id).state, 'running');

  await manager.invoke(a.id, 'stop');
  assert.equal(stoppedA, 1);
  assert.equal(manager.get(a.id).state, 'stopping');
  manager.markStopped(a.id, { current: 1, ok: 1, fail: 0 });
  assert.equal(manager.hasActive('account-a'), false);
  assert.equal(manager.hasActive('account-b'), true, 'stopping A must leave B running');

  manager.update(b.id, { current: 1, ok: 1 });
  manager.complete(b.id, { current: 1, ok: 1, fail: 0 });
  assert.equal(manager.hasActive('account-b'), false);
  assert.equal(manager.getCurrent('account-b').state, 'completed');
  manager.dismiss(b.id);
  assert.equal(manager.getCurrent('account-b').dismissed, true);

  assert.equal(Object.isFrozen(a.targets), true, 'job targets must be snapshotted');
  assert.equal(Object.isFrozen(a.files), true, 'job files must be snapshotted');
  assert.equal(a.partition, 'persist:a');
  assert.equal(a.webviewId, 'wv-a');
  assert.equal(a.message, 'hello A');
  assert.equal(a.intervalMin, 5);
  assert.equal(a.intervalMax, 10);

  console.log('BROADCAST_JOB_MANAGER_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
