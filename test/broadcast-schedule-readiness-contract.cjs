'use strict';

const assert = require('node:assert/strict');
const scheduleApi = require('../ui/broadcast-schedule-registry.js');

const originalWindow = global.window;
try {
  global.window = {};
  assert.equal(scheduleApi.schedulePersistenceReady(), false);
  let timerCalls = 0;
  const blocked = scheduleApi.createRegistry({
    now: () => 1000,
    setTimeout: () => { timerCalls += 1; return 1; },
    clearTimeout: () => {},
  });
  assert.throws(
    () => blocked.schedule({ id: 'timer-a', jobId: 'job-a', accountId: 'A', scheduledAt: 5000 }, async () => {}),
    error => error?.code === 'BROADCAST_SCHEDULE_PERSISTENCE_NOT_READY' && /持久化尚未就绪/.test(error.message),
    'future timer must fail closed before persistence has installed its durable creation subscriber',
  );
  assert.equal(timerCalls, 0, 'persistence-not-ready schedule must not arm a timer');
  assert.equal(blocked.timerCount('A'), 0);
  assert.equal(blocked.has('A', 'timer-a'), false);

  global.window = { GeekBroadcastSchedulePersistenceInstance: { awaitScheduledDurable: async () => true } };
  assert.equal(scheduleApi.schedulePersistenceReady(), true);
  const armed = [];
  const ready = scheduleApi.createRegistry({
    now: () => 1000,
    setTimeout: (fn, delay) => { armed.push({ fn, delay }); return armed.length; },
    clearTimeout: () => {},
  });
  ready.schedule({ id: 'timer-b', jobId: 'job-b', accountId: 'B', scheduledAt: 5000 }, async () => {});
  assert.equal(armed.length, 1, 'ready persistence may arm the normal scheduled timer');
  assert.equal(ready.timerCount('B'), 1);
} finally {
  if (originalWindow === undefined) delete global.window;
  else global.window = originalWindow;
}

console.log('BROADCAST_SCHEDULE_READINESS_CONTRACT_OK');
