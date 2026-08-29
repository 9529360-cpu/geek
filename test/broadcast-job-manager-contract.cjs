'use strict';

const assert = require('node:assert/strict');
const jobApi = require('../ui/broadcast-job-manager.js');
const scheduleApi = require('../ui/broadcast-schedule-registry.js');

(async () => {
  let clock = 1000;
  const manager = jobApi.createManager({ now: () => clock });
  const events = [];
  manager.subscribe(event => events.push(event));

  const a = manager.start({
    id: 'job-a',
    accountId: 'account-a',
    accountName: 'A',
    partition: 'persist:a',
    platformFamily: 'whatsapp',
    webviewId: 'wv-a',
    targets: [{ id: 'a1', name: 'Alice' }],
    message: 'hello A',
    files: [{ filePath: 'opaque-a', name: 'a.png' }],
  });
  assert.equal(a.state, 'running');
  assert.equal(manager.hasActive('account-a'), true);

  const futureA = manager.register({
    id: 'job-a-future', accountId: 'account-a', state: 'scheduled', scheduledAt: 6000,
    targets: [{ id: 'a2', name: 'Future' }], attachmentRefs: [{ ref: 'opaque-ref', name: 'future.pdf' }], message: 'later',
  });
  assert.equal(futureA.state, 'scheduled');
  assert.equal(manager.getPending('account-a').length, 1);

  assert.throws(() => manager.start({ id: 'job-a-2', accountId: 'account-a', targets: [] }), /already has a running broadcast job/);

  const b = manager.start({ id: 'job-b', accountId: 'account-b', targets: [{ id: 'b1' }], message: 'hello B' });
  assert.equal(b.state, 'running', 'different accounts may execute concurrently');
  assert.equal(manager.hasActive('account-b'), true);

  let paused = false;
  let resumed = false;
  let stopped = false;
  manager.attachControls(a.id, {
    pause: async () => { paused = true; },
    resume: async () => { resumed = true; },
    stop: async () => { stopped = true; },
  });

  clock = 2000;
  await manager.invoke(a.id, 'pause');
  assert.equal(paused, true);
  assert.equal(manager.get(a.id).state, 'paused');

  clock = 3000;
  await manager.invoke(a.id, 'resume');
  assert.equal(resumed, true);
  assert.equal(manager.get(a.id).state, 'running');

  clock = 4000;
  await manager.invoke(a.id, 'stop');
  assert.equal(stopped, true);
  assert.equal(manager.get(a.id).state, 'stopping');
  manager.markStopped(a.id, { current: 1, ok: 1, fail: 0 });
  assert.equal(manager.hasActive('account-a'), false);

  manager.transition(futureA.id, 'queued');
  assert.equal(manager.get(futureA.id).state, 'queued');
  manager.transition(futureA.id, 'running');
  assert.equal(manager.hasActive('account-a'), true, 'queued job may take the account slot after previous terminal state');
  manager.complete(futureA.id, { current: 1, ok: 1, fail: 0 });

  manager.update(b.id, { current: 1, ok: 1 });
  manager.complete(b.id, { current: 1, ok: 1, fail: 0 });
  assert.equal(manager.hasActive('account-b'), false);
  manager.dismiss(b.id);
  assert.equal(manager.getCurrent('account-b'), null, 'dismissed terminal task must leave the account task bar');

  assert.equal(Object.isFrozen(a.targets), true, 'job targets must be snapshotted');
  assert.equal(Object.isFrozen(a.files), true, 'job files must be snapshotted');
  assert.equal(Object.isFrozen(futureA.attachmentRefs), true, 'job durable attachment refs must be snapshotted');
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
  now = 5000;
  await liveB.fn();
  assert.deepEqual(due, ['account-b'], 'scheduled callback must preserve explicit account owner');

  console.log('BROADCAST_JOB_MANAGER_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
