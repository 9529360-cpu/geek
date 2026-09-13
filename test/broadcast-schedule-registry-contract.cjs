'use strict';
const assert = require('node:assert/strict');
const { createRegistry, MAX_TIMER_DELAY_MS } = require('../ui/broadcast-schedule-registry.js');

(async () => {
  assert.ok(MAX_TIMER_DELAY_MS > 0 && MAX_TIMER_DELAY_MS < 0x80000000, 'timer chunk must stay inside signed 32-bit range');

  let now = 1000;
  let nextHandle = 1;
  const timers = new Map();
  const delays = [];
  function fakeSetTimeout(fn, delay) {
    const id = nextHandle++;
    delays.push(delay);
    timers.set(id, fn);
    return id;
  }
  function fakeClearTimeout(id) { timers.delete(id); }
  async function fireNext() {
    const [id, fn] = timers.entries().next().value || [];
    assert.ok(id, 'expected an armed timer');
    timers.delete(id);
    await fn();
  }

  const registry = createRegistry({ now: () => now, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout });
  let dueCount = 0;
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const task = registry.schedule({ id: 'far', accountId: 'A', scheduledAt: now + ninetyDays }, async () => { dueCount += 1; });
  assert.equal(task.id, 'far');
  assert.equal(delays[0], MAX_TIMER_DELAY_MS, 'far-future schedule must arm only one safe timer chunk');
  assert.equal(dueCount, 0);

  now += MAX_TIMER_DELAY_MS;
  await fireNext();
  assert.equal(dueCount, 0, 'first bounded wake must not run a far-future task');
  assert.ok(delays.at(-1) <= MAX_TIMER_DELAY_MS, 're-armed timer must stay bounded');

  while (now < task.scheduledAt) {
    const step = Math.min(MAX_TIMER_DELAY_MS, task.scheduledAt - now);
    now += step;
    await fireNext();
  }
  assert.equal(dueCount, 1, 'task must fire exactly once at/after scheduledAt');
  assert.equal(registry.has('A', 'far'), false, 'completed schedule must be removed');

  now = 5000;
  const cancelRegistry = createRegistry({ now: () => now, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout });
  cancelRegistry.schedule({ id: 'cancelled', accountId: 'B', scheduledAt: now + ninetyDays }, async () => { dueCount += 100; });
  assert.equal(cancelRegistry.cancel('B', 'cancelled'), true);
  assert.equal(cancelRegistry.has('B', 'cancelled'), false);
  assert.equal(cancelRegistry.timerCount('B'), 0, 'cancel must clear the currently armed chunk');

  // An already-started timer cannot be physically cancelled. If a replacement
  // generation with the same logical key is scheduled while the old callback is
  // suspended in the async durability gate, the stale completion must not send or
  // delete the replacement task.
  now = 10000;
  const raceTimers = new Map();
  let raceHandle = 1;
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  let beforeDueCalls = 0;
  const raceRegistry = createRegistry({
    now: () => now,
    setTimeout(fn) { const id = raceHandle++; raceTimers.set(id, fn); return id; },
    clearTimeout(id) { raceTimers.delete(id); },
    beforeDue() { beforeDueCalls += 1; return beforeDueCalls === 1 ? oldGate : true; },
  });
  let oldDue = 0;
  let newDue = 0;
  raceRegistry.schedule({ id: 'same', accountId: 'R', scheduledAt: now, generation: 'old' }, async () => { oldDue += 1; });
  const [oldHandle, oldCallback] = raceTimers.entries().next().value || [];
  assert.ok(oldHandle, 'old generation must arm a timer');
  raceTimers.delete(oldHandle);
  const oldRun = oldCallback();
  await Promise.resolve();

  const replacement = raceRegistry.schedule({ id: 'same', accountId: 'R', scheduledAt: now + 1000, generation: 'new' }, async () => { newDue += 1; });
  assert.equal(raceRegistry.has('R', 'same'), true);
  assert.equal(raceRegistry.timerCount('R'), 1, 'replacement generation must remain armed while old callback is suspended');

  releaseOld(true);
  await oldRun;
  assert.equal(oldDue, 0, 'stale generation must not call onDue after a replacement owns the logical task key');
  assert.equal(raceRegistry.has('R', 'same'), true, 'stale finally must not delete the replacement task');
  assert.equal(raceRegistry.list('R')[0], replacement, 'registry must still point at the replacement generation');
  assert.equal(raceRegistry.timerCount('R'), 1, 'replacement timer must remain registered');

  now += 1000;
  const [newHandle, newCallback] = raceTimers.entries().next().value || [];
  assert.ok(newHandle, 'replacement timer must still be fireable');
  raceTimers.delete(newHandle);
  await newCallback();
  assert.equal(newDue, 1, 'replacement generation must run exactly once when due');
  assert.equal(raceRegistry.has('R', 'same'), false, 'current generation must remove itself after completion');
  assert.equal(raceRegistry.timerCount('R'), 0);

  console.log('BROADCAST_SCHEDULE_REGISTRY_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
