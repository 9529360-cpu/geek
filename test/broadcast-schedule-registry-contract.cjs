'use strict';

const assert = require('node:assert/strict');
const { createRegistry, MAX_TIMER_DELAY_MS } = require('../ui/broadcast-schedule-registry.js');

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

console.log('BROADCAST_SCHEDULE_REGISTRY_CONTRACT_OK');
