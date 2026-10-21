'use strict';

const assert = require('node:assert/strict');
const { updaterDiagnosticsEvent, reportUpdaterDiagnostics } = require('../src/updater-diagnostics.cjs');

(() => {
  assert.deepEqual(updaterDiagnosticsEvent('checking'), { event: 'updater-checking', metadata: {} });
  assert.deepEqual(updaterDiagnosticsEvent('up-to-date'), { event: 'updater-up-to-date', metadata: {} });
  assert.deepEqual(
    updaterDiagnosticsEvent('available', { version: '1.2.34' }),
    { event: 'updater-available', metadata: { version: '1.2.34' } },
  );
  assert.deepEqual(
    updaterDiagnosticsEvent('downloaded', { version: '1.2.34' }),
    { event: 'updater-downloaded', metadata: { version: '1.2.34' } },
  );

  // Bounds match the relay: version 100 chars, error message 200 chars.
  assert.equal(updaterDiagnosticsEvent('available', { version: 'v'.repeat(150) }).metadata.version.length, 100);
  assert.equal(updaterDiagnosticsEvent('error', { message: 'e'.repeat(300) }).metadata.message.length, 200);
  assert.equal(updaterDiagnosticsEvent('error', { message: '' }).metadata.message, '');

  // Percent rounds to one decimal; non-finite input degrades to 0.
  assert.equal(updaterDiagnosticsEvent('downloading', { percent: 12.34 }).metadata.percent, 12.3);
  assert.equal(updaterDiagnosticsEvent('downloading', { percent: 50 }).metadata.percent, 50);
  assert.equal(updaterDiagnosticsEvent('downloading', { percent: Number.NaN }).metadata.percent, 0);
  assert.equal(updaterDiagnosticsEvent('downloading', {}).metadata.percent, 0);

  // Unknown phases fail fast in the pure builder (the reporter swallows it).
  assert.throws(() => updaterDiagnosticsEvent('bogus'), /unknown updater diagnostics phase/);

  // Reporter: good path logs event + metadata and returns true.
  {
    const logs = [];
    const diagnostics = { log(event, metadata) { logs.push({ event, metadata }); } };
    assert.equal(reportUpdaterDiagnostics(diagnostics, 'downloaded', { version: '1.2.34' }), true);
    assert.deepEqual(logs, [{ event: 'updater-downloaded', metadata: { version: '1.2.34' } }]);
  }

  // Reporter never throws: missing sink, throwing log, unknown phase.
  {
    assert.equal(reportUpdaterDiagnostics(null, 'checking'), false);
    assert.equal(reportUpdaterDiagnostics({}, 'checking'), false);
    assert.equal(reportUpdaterDiagnostics({ log() { throw new Error('boom'); } }, 'checking'), false);
    assert.equal(reportUpdaterDiagnostics({ log() { throw new Error('must not be called'); } }, 'bogus'), false);
  }

  console.log('UPDATER_DIAGNOSTICS_CONTRACT_OK');
})();
