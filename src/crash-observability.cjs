'use strict';

// Native crash observability, local-only.
//
// JS exceptions are already visible through the uncaughtExceptionMonitor +
// diagnostics pipeline, but a native (non-JS) main/renderer crash leaves no
// record at all. This module closes that gap without any egress and without
// changing user-visible behavior:
// - crash dumps stay on disk under userData/crash-dumps and are never
//   uploaded (uploadToServer: false, no submitURL);
// - on startup, if the previous run ended in a native crash, one bounded
//   diagnostics event is logged (report date + id only, never dump content),
//   and only once per crash id;
// - dumps are pruned to the newest MAX_CRASH_DUMPS files so the directory
//   cannot grow without bound.
//
// Every entry point is defensive: observability must never break startup,
// so failures degrade to a no-op instead of throwing.

const DEFAULT_MAX_CRASH_DUMPS = 5;
const MARKER_FILENAME = '.last-reported-crash.json';

function installCrashReporting({ crashReporter, app, userDataDir, path }) {
  try {
    if (!userDataDir || !path || typeof path.join !== 'function') return { crashDumpsDir: '', started: false };
    const dir = path.join(String(userDataDir), 'crash-dumps');
    try {
      if (app && typeof app.setPath === 'function') app.setPath('crashDumps', dir);
    } catch {
      // Keep the platform default dump directory; reporting still starts below.
    }
    if (!crashReporter || typeof crashReporter.start !== 'function') return { crashDumpsDir: dir, started: false };
    crashReporter.start({ productName: 'Geek', companyName: 'Geek', uploadToServer: false });
    return { crashDumpsDir: dir, started: true };
  } catch {
    return { crashDumpsDir: '', started: false };
  }
}

function normalizeReportDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return String(value || '').slice(0, 64);
}

function reportPreviousNativeCrash({ crashReporter, diagnostics, fs, path, userDataDir }) {
  try {
    if (!crashReporter || typeof crashReporter.getLastCrashReport !== 'function') return false;
    if (!diagnostics || typeof diagnostics.log !== 'function') return false;
    if (!fs || !path || typeof path.join !== 'function') return false;
    const report = crashReporter.getLastCrashReport();
    const id = report && typeof report.id === 'string' ? report.id.slice(0, 128) : '';
    if (!id) return false;
    const dir = path.join(String(userDataDir || ''), 'crash-dumps');
    const markerPath = path.join(dir, MARKER_FILENAME);
    let lastId = '';
    try {
      lastId = JSON.parse(fs.readFileSync(markerPath, 'utf8') || '{}').id || '';
    } catch {
      lastId = '';
    }
    if (lastId === id) return false;
    diagnostics.log('previous-session-native-crash', { date: normalizeReportDate(report.date), id });
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(markerPath, JSON.stringify({ id }));
    } catch {
      // The event is already logged; a missing marker only risks one repeat log.
    }
    return true;
  } catch {
    return false;
  }
}

function pruneCrashDumps({ fs, path, dir, keep = DEFAULT_MAX_CRASH_DUMPS }) {
  try {
    if (!fs || !path || typeof path.join !== 'function' || !dir) return { kept: 0, removed: 0 };
    const limit = Number.isSafeInteger(keep) && keep >= 0 ? keep : DEFAULT_MAX_CRASH_DUMPS;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dumps = [];
    for (const entry of entries) {
      if (!entry || typeof entry.isFile !== 'function' || !entry.isFile()) continue;
      if (!entry.name.endsWith('.dmp')) continue;
      try {
        dumps.push({ name: entry.name, mtimeMs: fs.statSync(path.join(dir, entry.name)).mtimeMs });
      } catch {
        // Unstatable files are left alone; they are not counted as kept.
      }
    }
    dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let removed = 0;
    for (const dump of dumps.slice(limit)) {
      try {
        fs.unlinkSync(path.join(dir, dump.name));
        removed += 1;
      } catch {
        // A failed delete is not a startup failure.
      }
    }
    return { kept: Math.min(dumps.length, limit), removed };
  } catch {
    return { kept: 0, removed: 0 };
  }
}

module.exports = {
  DEFAULT_MAX_CRASH_DUMPS,
  installCrashReporting,
  reportPreviousNativeCrash,
  pruneCrashDumps,
};
