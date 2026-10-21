'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const updater = fs.readFileSync(path.join(__dirname, '../src/updater.cjs'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

// The updater must load the diagnostics reporter and accept a diagnostics sink.
assert.match(updater, /require\('\.\/updater-diagnostics\.cjs'\)/, 'updater must load the diagnostics reporter');
assert.match(updater, /function initAutoUpdater\(options = \{\}\)/, 'initAutoUpdater must accept options');
assert.match(updater, /diagnosticsSink = options\.diagnostics/, 'initAutoUpdater must adopt a valid diagnostics sink');

// Every lifecycle phase must report to diagnostics in addition to the relay.
for (const phase of ['checking', 'available', 'up-to-date', 'downloading', 'downloaded', 'error']) {
  assert.ok(
    updater.includes(`reportUpdaterDiagnostics(diagnosticsSink, '${phase}'`),
    `updater must report the ${phase} phase to diagnostics`,
  );
}

// The renderer relay must be untouched: six sendStatus calls, one per phase.
assert.equal((updater.match(/sendStatus\(\{ phase:/g) || []).length, 6, 'updater must keep all six relay calls');

// The main process must hand its diagnostics instance to the updater.
assert.match(main, /initAutoUpdater\(\{ diagnostics \}\)/, 'main.cjs must pass diagnostics to initAutoUpdater');

console.log('UPDATER_DIAGNOSTICS_INTEGRATION_CONTRACT_OK');
