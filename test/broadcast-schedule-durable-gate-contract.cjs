'use strict';

const assert = require('node:assert/strict');
const { createRegistry } = require('../ui/broadcast-schedule-registry.js');

(async () => {
  let now = 1000;
  let nextHandle = 1;
  const timers = new Map();
  const fakeSetTimeout = (fn, delay) => {
    const id = nextHandle++;
    timers.set(id, { fn, delay });
    return id;
  };
  const fakeClearTimeout = id => timers.delete(id);
  const fireOnly = async () => {
    const first = timers.entries().next().value;
    assert.ok(first, 'expected one armed timer');
    const [id, timer] = first;
    timers.delete(id);
    await timer.fn();
  };

  let gateCalls = 0;
  let dueCalls = 0;
  const blocked = createRegistry({
    now: () => now,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    beforeDue: async task => {
      gateCalls += 1;
      assert.equal(task.jobId, 'job-blocked');
      return false;
    },
  });
  blocked.schedule({ id: 'timer-blocked', jobId: 'job-blocked', accountId: 'A', scheduledAt: 2000 }, async () => { dueCalls += 1; });
  now = 2000;
  await fireOnly();
  assert.equal(gateCalls, 1, 'actual due edge must consult the durability gate');
  assert.equal(dueCalls, 0, 'failed creation durability must never reach onDue');
  assert.equal(blocked.has('A', 'timer-blocked'), false, 'blocked timer must be consumed rather than silently retried as executable');

  let released = false;
  let releaseGate;
  const durablePromise = new Promise(resolve => { releaseGate = () => { released = true; resolve(true); }; });
  const allowed = createRegistry({
    now: () => now,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    beforeDue: () => durablePromise,
  });
  allowed.schedule({ id: 'timer-ok', jobId: 'job-ok', accountId: 'B', scheduledAt: 3000 }, async () => { dueCalls += 1; });
  now = 3000;
  const pendingTimer = timers.entries().next().value;
  assert.ok(pendingTimer, 'durable timer must be armed');
  const [pendingId, pending] = pendingTimer;
  timers.delete(pendingId);
  const firing = pending.fn();
  await Promise.resolve();
  assert.equal(released, false);
  assert.equal(dueCalls, 0, 'onDue must wait while the initial durable write is unresolved');
  releaseGate();
  await firing;
  assert.equal(dueCalls, 1, 'onDue may run after durability is confirmed');
  assert.equal(allowed.has('B', 'timer-ok'), false);

  console.log('BROADCAST_SCHEDULE_DURABLE_GATE_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
