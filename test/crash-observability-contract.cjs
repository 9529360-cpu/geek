'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_MAX_CRASH_DUMPS,
  installCrashReporting,
  reportPreviousNativeCrash,
  pruneCrashDumps,
} = require('../src/crash-observability.cjs');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

(async () => {
  // installCrashReporting: dump path set before start, upload off, no submitURL.
  {
    const calls = [];
    const app = {
      setPath(name, value) { calls.push(['setPath', name, value]); },
    };
    const crashReporter = {
      start(options) { calls.push(['start', options]); },
    };
    const result = installCrashReporting({
      crashReporter, app, userDataDir: '/tmp/geek-user-data', path,
    });
    assert.equal(result.started, true);
    assert.equal(result.crashDumpsDir, path.join('/tmp/geek-user-data', 'crash-dumps'));
    assert.equal(calls[0][0], 'setPath');
    assert.equal(calls[0][1], 'crashDumps');
    assert.equal(calls[0][2], result.crashDumpsDir);
    assert.equal(calls[1][0], 'start');
    assert.equal(calls[1][1].uploadToServer, false);
    assert.equal(Object.hasOwn(calls[1][1], 'submitURL'), false, 'must never configure an upload target');
    assert.equal(calls[1][1].productName, 'Geek');
  }

  // installCrashReporting never throws and degrades to not-started.
  {
    const throwingReporter = { start() { throw new Error('boom'); } };
    assert.equal(installCrashReporting({
      crashReporter: throwingReporter, app: {}, userDataDir: '/tmp/x', path,
    }).started, false);
    assert.equal(installCrashReporting({
      crashReporter: null, app: {}, userDataDir: '/tmp/x', path,
    }).started, false);
    assert.equal(installCrashReporting({
      crashReporter: {}, app: {}, userDataDir: '', path,
    }).started, false);
  }

  // reportPreviousNativeCrash: logs once per crash id, date + id only.
  {
    const dir = tempDir('geek-crash-report-');
    try {
      const logs = [];
      const diagnostics = { log(event, metadata) { logs.push({ event, metadata }); } };
      const crashReporter = {
        getLastCrashReport: () => ({ date: new Date('2026-10-21T08:00:00.000Z'), id: 'crash-id-1' }),
      };
      const options = { crashReporter, diagnostics, fs, path, userDataDir: dir };
      assert.equal(reportPreviousNativeCrash(options), true);
      assert.equal(logs.length, 1);
      assert.equal(logs[0].event, 'previous-session-native-crash');
      assert.deepEqual(Object.keys(logs[0].metadata).sort(), ['date', 'id']);
      assert.equal(logs[0].metadata.date, '2026-10-21T08:00:00.000Z');
      assert.equal(logs[0].metadata.id, 'crash-id-1');
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, 'crash-dumps', '.last-reported-crash.json'), 'utf8')).id,
        'crash-id-1',
      );
      // Same crash id again: no repeat log.
      assert.equal(reportPreviousNativeCrash(options), false);
      assert.equal(logs.length, 1);
      // A new crash id logs again.
      crashReporter.getLastCrashReport = () => ({ date: '2026-10-21T09:00:00Z', id: 'crash-id-2' });
      assert.equal(reportPreviousNativeCrash(options), true);
      assert.equal(logs.length, 2);
      assert.equal(logs[1].metadata.id, 'crash-id-2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // reportPreviousNativeCrash: null report / throwing reporter degrade silently.
  {
    const logs = [];
    const diagnostics = { log(event, metadata) { logs.push({ event, metadata }); } };
    assert.equal(reportPreviousNativeCrash({
      crashReporter: { getLastCrashReport: () => null },
      diagnostics, fs, path, userDataDir: tempDir('geek-crash-null-'),
    }), false);
    assert.equal(reportPreviousNativeCrash({
      crashReporter: { getLastCrashReport() { throw new Error('boom'); } },
      diagnostics, fs, path, userDataDir: tempDir('geek-crash-throw-'),
    }), false);
    assert.equal(logs.length, 0);
  }

  // pruneCrashDumps: keeps newest N .dmp files, leaves everything else alone.
  {
    const dir = tempDir('geek-crash-prune-');
    try {
      const now = Date.now();
      for (let i = 0; i < 7; i += 1) {
        const file = path.join(dir, `crash-${i}.dmp`);
        fs.writeFileSync(file, 'dump');
        fs.utimesSync(file, new Date(now - i * 1000), new Date(now - i * 1000));
      }
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
      fs.mkdirSync(path.join(dir, 'subdir'));
      const result = pruneCrashDumps({ fs, path, dir, keep: DEFAULT_MAX_CRASH_DUMPS });
      assert.equal(result.kept, 5);
      assert.equal(result.removed, 2);
      assert.equal(fs.existsSync(path.join(dir, 'crash-0.dmp')), true);
      assert.equal(fs.existsSync(path.join(dir, 'crash-4.dmp')), true);
      assert.equal(fs.existsSync(path.join(dir, 'crash-5.dmp')), false);
      assert.equal(fs.existsSync(path.join(dir, 'crash-6.dmp')), false);
      assert.equal(fs.existsSync(path.join(dir, 'notes.txt')), true);
      assert.equal(fs.existsSync(path.join(dir, 'subdir')), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // pruneCrashDumps: missing directory degrades silently.
  {
    assert.deepEqual(
      pruneCrashDumps({ fs, path, dir: path.join(os.tmpdir(), 'geek-no-such-dir-xyz') }),
      { kept: 0, removed: 0 },
    );
  }

  console.log('CRASH_OBSERVABILITY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
