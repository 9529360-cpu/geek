'use strict';

const DEFAULT_STABLE_UPTIME_MS = 30_000;
const DEFAULT_RESTART_DELAYS_MS = Object.freeze([500, 1500, 4500]);

function normalizeRestartDelays(values) {
  const delays = Array.from(values || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.floor(value));
  return delays.length > 0 ? delays : Array.from(DEFAULT_RESTART_DELAYS_MS);
}

function createRecoveryTracker(options = {}) {
  const stableUptimeMs = Number.isFinite(Number(options.stableUptimeMs))
    ? Math.max(0, Math.floor(Number(options.stableUptimeMs)))
    : DEFAULT_STABLE_UPTIME_MS;
  const restartDelaysMs = Object.freeze(normalizeRestartDelays(options.restartDelaysMs));
  const now = typeof options.now === 'function' ? options.now : Date.now;

  let startedAt = null;
  let unstableExits = 0;
  let blocked = false;

  function noteStart(timestamp = now()) {
    startedAt = Number(timestamp);
  }

  function noteRuntimeChange() {
    startedAt = null;
    unstableExits = 0;
    blocked = false;
  }

  function noteUnexpectedExit(timestamp = now()) {
    const exitAt = Number(timestamp);
    const uptimeMs = Number.isFinite(startedAt)
      ? Math.max(0, exitAt - startedAt)
      : 0;

    if (uptimeMs >= stableUptimeMs) unstableExits = 0;
    unstableExits += 1;
    startedAt = null;

    if (unstableExits > restartDelaysMs.length) {
      blocked = true;
      return Object.freeze({
        shouldRestart: false,
        blocked: true,
        unstableExits,
        uptimeMs,
        delayMs: null,
      });
    }

    return Object.freeze({
      shouldRestart: true,
      blocked: false,
      unstableExits,
      uptimeMs,
      delayMs: restartDelaysMs[unstableExits - 1],
    });
  }

  function snapshot() {
    return Object.freeze({
      blocked,
      unstableExits,
      startedAt,
      stableUptimeMs,
      restartDelaysMs,
    });
  }

  return Object.freeze({
    noteStart,
    noteRuntimeChange,
    noteUnexpectedExit,
    snapshot,
  });
}

module.exports = {
  DEFAULT_RESTART_DELAYS_MS,
  DEFAULT_STABLE_UPTIME_MS,
  createRecoveryTracker,
  normalizeRestartDelays,
};
