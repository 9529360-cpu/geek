'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const api = require(path.join(__dirname, '../ui/broadcast-job-manager.js'));
const scheduleApi = require(path.join(__dirname, '../ui/broadcast-schedule-registry.js'));

let tick = 1000;
const manager = api.createManager({ now: () => ++tick });

const a = manager.start({
  accountId: 'account-a', accountName: 'A', partition: 'persist:a', platformFamily: 'whatsapp', webviewId: 'wv-a',
  targets: [{ id: 'a1' }, { id: 'a2' }], message: 'hello A', files: [{ token: 'file-a' }], intervalMin: 5, intervalMax: 10,
});
const b = manager.start({
  accountId: 'account-b', accountName: 'B', partition: 'persist:b', platformFamily: 'telegram', webviewId: 'wv-b',
  targets: [{ id: 'b1' }], message: 'hello B', intervalMin: 8, intervalMax: 12,
});

assert.equal(manager.hasActive('account-a'), true, 'account A must have its own active job');
assert.equal(manager.hasActive('account-b'), true, 'account B must run concurrently with account A');
assert.equal(manager.getActive('account-a').id, a.id);
assert.equal(manager.getActive('account-b').id, b.id);
assert.equal(api.visibleFor(manager.getCurrent('account-a'), 'account-a'), true);
assert.equal(api.visibleFor(manager.getCurrent('account-a'), 'account-b'), false);
assert.throws(
  () => manager.start({ accountId: 'account-a', targets: [{ id: 'a3' }] }),
  /already has a running broadcast job/,
  'one account must not execute two broadcasts concurrently',
);

manager.update(a.id, { current: 1, ok: 1, nextSendAt: 5000 });
assert.equal(manager.get(a.id).current, 1);
assert.equal(manager.get(b.id).current, 0, 'A progress must not mutate B');

const draftTargets = [{ id: 'future-a' }];
const draftFiles = [{ token: 'future-file' }];
const futureA = manager.register({
  accountId: 'account-a', state: 'scheduled', scheduledAt: 9000,
  targets: draftTargets, files: draftFiles, message: 'future A',
});
draftTargets[0].id = 'mutated';
draftFiles[0].token = 'mutated';
assert.equal(manager.get(futureA.id).targets[0].id, 'future-a', 'scheduled target snapshot must be immutable');
assert.equal(manager.get(futureA.id).files[0].token, 'future-file', 'scheduled file snapshot must be immutable');
assert.equal(manager.getPending('account-a').length, 1, 'scheduled job may coexist with a running job for the same account');
assert.equal(manager.getActive('account-a').id, a.id, 'scheduled job must not occupy execution slot');

const queuedC1 = manager.register({ accountId: 'account-c', state: 'queued', scheduledAt: 7000, targets: [{ id: 'c1' }] });
const queuedC2 = manager.register({ accountId: 'account-c', state: 'scheduled', scheduledAt: 6000, targets: [{ id: 'c2' }] });
assert.equal(manager.getPending('account-c').length, 2, 'one account may hold multiple pending jobs');
assert.equal(manager.getNextPending('account-c').id, queuedC2.id, 'earliest pending job should be selected first');
assert.equal(manager.getCurrent('account-c').id, queuedC2.id, 'task UI should show earliest pending job when none is running');

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
  assert.equal(manager.getPending('account-a').length, 1, 'stopping active A must not delete future A');

  manager.update(b.id, { current: 1, ok: 1 });
  manager.complete(b.id, { current: 1, ok: 1, fail: 0 });
  assert.equal(manager.hasActive('account-b'), false);
  manager.dismiss(b.id);
  assert.equal(manager.getCurrent('account-b'), null, 'dismissed terminal task must leave the account task bar');

  assert.equal(Object.isFrozen(a.targets), true, 'job targets must be snapshotted');
  assert.equal(Object.isFrozen(a.files), true, 'job files must be snapshotted');
  assert.equal(a.partition, 'persist:a');
  assert.equal(a.webviewId, 'wv-a');
  assert.equal(a.message, 'hello A');

  let now = 1000;
  const fakeTimers = [];
  let timerId = 0;
  const registry = scheduleApi.createRegistry({
    now: () => now,
    setTimeout(fn, delay) { const handle = { id: ++timerId, fn, delay, cleared: false }; fakeTimers.push(handle); return handle; },
    clearTimeout(handle) { handle.cleared = true; },
  });
  const due = [];
  registry.schedule({ id: 'sched-a', accountId: 'account-a', scheduledAt: 4000, targets: [{ id: 'a' }], message: 'A' }, task => due.push(task.accountId));
  registry.schedule({ id: 'sched-b', accountId: 'account-b', scheduledAt: 5000, targets: [{ id: 'b' }], message: 'B' }, task => due.push(task.accountId));
  assert.equal(registry.timerCount('account-a'), 1);
  assert.equal(registry.timerCount('account-b'), 1);
  registry.rearmAccount('account-a', [{ id: 'sched-a2', scheduledAt: 6000, targets: [{ id: 'a2' }], message: 'A2' }], task => due.push(task.accountId));
  assert.equal(registry.timerCount('account-a'), 1, 'rearming A should replace only A timers');
  assert.equal(registry.timerCount('account-b'), 1, 'rearming A must not clear B timers');
  const liveB = fakeTimers.find(handle => !handle.cleared && handle.delay === 4000);
  assert.ok(liveB, 'B timer should remain armed');
  await liveB.fn();
  assert.deepEqual(due, ['account-b'], 'scheduled callback must preserve explicit account owner');

  console.log('BROADCAST_JOB_MANAGER_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
