'use strict';

// Bounded diagnostics payloads for the updater lifecycle.
//
// Updater failures are currently only console output + a renderer status
// relay: if no window is watching, a failing update channel stays invisible
// in collected diagnostics. These payloads give each updater phase a
// diagnostics event with the same bounds the relay already uses (version
// 100 chars, error message 200 chars), and nothing else — no download URLs,
// no paths, no user data. The reporter never throws, so diagnostics can
// never break the update flow.

const PHASES = new Set(['checking', 'available', 'up-to-date', 'downloading', 'downloaded', 'error']);

function updaterDiagnosticsEvent(phase, info = {}) {
  if (!PHASES.has(phase)) throw new TypeError(`unknown updater diagnostics phase: ${phase}`);
  const event = `updater-${phase}`;
  switch (phase) {
    case 'available':
    case 'downloaded':
      return { event, metadata: { version: String(info.version || '').slice(0, 100) } };
    case 'downloading': {
      const percent = Number(info.percent);
      return { event, metadata: { percent: Number.isFinite(percent) ? Math.round(percent * 10) / 10 : 0 } };
    }
    case 'error':
      return { event, metadata: { message: String(info.message || '').slice(0, 200) } };
    default:
      return { event, metadata: {} };
  }
}

function reportUpdaterDiagnostics(diagnostics, phase, info = {}) {
  try {
    if (!diagnostics || typeof diagnostics.log !== 'function') return false;
    const { event, metadata } = updaterDiagnosticsEvent(phase, info);
    diagnostics.log(event, metadata);
    return true;
  } catch {
    return false;
  }
}

module.exports = { PHASES: Object.freeze([...PHASES]), updaterDiagnosticsEvent, reportUpdaterDiagnostics };
