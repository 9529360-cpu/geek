'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_RESTART_DELAYS_MS,
  DEFAULT_STABLE_UPTIME_MS,
  createRecoveryTracker,
  normalizeRestartDelays,
} = require('../scripts/dev-loop-recovery.cjs');

assert.deepEqual(normalizeRestartDelays([100, 200.9, -1, '300']), [100, 200, 300]);
assert.deepEqual(normalizeRestartDelays([]), Array.from(DEFAULT_RESTART_DELAYS_MS));
assert.equal(DEFAULT_STABLE_UPTIME_MS, 30_000);

{
  const tracker = createRecoveryTracker({
    stableUptimeMs: 30_000,
    restartDelaysMs: [100, 200, 400],
  });

  tracker.noteStart(1_000);
  assert.deepEqual(tracker.noteUnexpectedExit(1_500), {
    shouldRestart: true,
    blocked: false,
    unstableExits: 1,
    uptimeMs: 500,
    delayMs: 100,
  });

  tracker.noteStart(2_000);
  assert.equal(tracker.noteUnexpectedExit(2_500).delayMs, 200);
  tracker.noteStart(3_000);
  assert.equal(tracker.noteUnexpectedExit(3_500).delayMs, 400);
  tracker.noteStart(4_000);
  assert.deepEqual(tracker.noteUnexpectedExit(4_500), {
    shouldRestart: false,
    blocked: true,
    unstableExits: 4,
    uptimeMs: 500,
    delayMs: null,
  });
  assert.equal(tracker.snapshot().blocked, true);

  tracker.noteRuntimeChange();
  assert.equal(tracker.snapshot().blocked, false);
  assert.equal(tracker.snapshot().unstableExits, 0);

  tracker.noteStart(10_000);
  assert.deepEqual(tracker.noteUnexpectedExit(40_000), {
    shouldRestart: true,
    blocked: false,
    unstableExits: 1,
    uptimeMs: 30_000,
    delayMs: 100,
  });
}

console.log('dev-loop recovery contract passed');
