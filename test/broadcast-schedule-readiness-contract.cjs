'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

const safety = fs.readFileSync(path.join(__dirname, '../ui/broadcast-safety.js'), 'utf8');
const gateIndex = safety.indexOf("document.addEventListener('click'");
const loaderIndex = safety.indexOf("loadScript('./broadcast-job-manager.js'");
assert.ok(gateIndex >= 0 && loaderIndex > gateIndex, 'future-schedule click gate must install before dynamic runtime loading starts');
assert.match(safety, /closest\?\.\('#broadcast-send'\)/, 'gate must own the real broadcast send button in capture phase');
assert.match(safety, /broadcast-schedule-toggle/, 'gate must read the real schedule enable control');
assert.match(safety, /broadcast-schedule-time/, 'gate must read the real schedule timestamp control');
assert.match(safety, /stopImmediatePropagation\(\)/, 'blocked future schedules must not reach legacy or runtime send handlers');
assert.match(safety, /GeekBroadcastSchedulePersistenceInstance/, 'gate must require the installed persistence instance before allowing a future schedule');
assert.doesNotMatch(safety, /window\.alert|\balert\s*\(/, 'persistence-not-ready feedback must not open a system alert');
assert.match(safety, /broadcast-workbench-status/, 'blocked future schedules should report through the existing Workbench status');
assert.match(safety, /setAttribute\('aria-live', 'polite'\)/, 'gate feedback must be announced without stealing focus');
const preventIndex = safety.indexOf('event.preventDefault();');
const stopIndex = safety.indexOf('event.stopImmediatePropagation();');
assert.ok(preventIndex >= 0 && stopIndex > preventIndex, 'send must be blocked before the inline feedback path');

console.log('BROADCAST_SCHEDULE_READINESS_CONTRACT_OK');
