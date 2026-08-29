'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  externalDebuggingRequested,
  isExternalDebugProbeTarget,
  installExternalDebuggingProbeGuard,
} = require('../src/external-debugging-policy.cjs');

assert.equal(externalDebuggingRequested({ argv: [] }), false, 'normal launch must not infer a debugger from a local port');
assert.equal(externalDebuggingRequested({ argv: ['--remote-debugging-port=9222'] }), false, 'unrelated debug ports must not match the legacy 9344 mode');
assert.equal(externalDebuggingRequested({ argv: ['--remote-debugging-port=9344'] }), true, 'explicit 9344 remains detectable for clear unsupported errors');
assert.equal(isExternalDebugProbeTarget('http://127.0.0.1:9344/json'), true);
assert.equal(isExternalDebugProbeTarget('http://127.0.0.1:9344/json/version'), false);
assert.equal(isExternalDebugProbeTarget('http://localhost:9344/json'), false);

const calls = [];
const fakeHttp = {
  get(input) {
    calls.push(String(input));
    return { on() { return this; } };
  },
};
const originalGet = fakeHttp.get;
const guard = installExternalDebuggingProbeGuard({ httpModule: fakeHttp });
assert.equal(guard.installed, true);
assert.throws(
  () => fakeHttp.get('http://127.0.0.1:9344/json'),
  error => error?.code === 'EXTERNAL_BROADCAST_CDP_DISABLED',
  'legacy external broadcast CDP must stay disabled even when the developer remote-debug port exists',
);
assert.deepEqual(calls, []);
fakeHttp.get('http://127.0.0.1:1843/');
assert.deepEqual(calls, ['http://127.0.0.1:1843/'], 'unrelated localhost services must be untouched');
guard.restore();
assert.equal(fakeHttp.get, originalGet);

const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const policyIndex = entry.indexOf('installExternalDebuggingProbeGuard();');
const mainIndex = entry.indexOf("require('./main.cjs')");
assert.ok(policyIndex >= 0 && mainIndex > policyIndex, 'external broadcast CDP guard must install before legacy main.cjs can probe localhost');
assert.match(entry, /remoteDebuggingRequested\s*=\s*externalDebuggingRequested\(\{\s*argv:\s*process\.argv\s*\}\)/, 'entrypoint may detect explicit remote debugging only to fail unsupported attachment paths clearly');
assert.doesNotMatch(entry, /installExternalDebuggingProbeGuard\(\{\s*allowed:/, 'no launch mode may opt broadcast attachments back into the unbound legacy external target selector');

console.log('EXTERNAL_DEBUGGING_POLICY_CONTRACT_OK');
