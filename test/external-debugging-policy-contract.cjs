'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  externalDebuggingAllowed,
  isExternalDebugProbeTarget,
  installExternalDebuggingProbeGuard,
} = require('../src/external-debugging-policy.cjs');

assert.equal(externalDebuggingAllowed({ isPackaged: true, argv: ['--remote-debugging-port=9344'] }), false, 'packaged clients must never enable legacy external CDP');
assert.equal(externalDebuggingAllowed({ isPackaged: false, argv: [] }), false, 'normal development launch must not infer authorization from a local port');
assert.equal(externalDebuggingAllowed({ isPackaged: false, argv: ['--remote-debugging-port=9222'] }), false, 'unrelated debug ports must not authorize the hard-coded 9344 transport');
assert.equal(externalDebuggingAllowed({ isPackaged: false, argv: ['--remote-debugging-port=9344'] }), true, 'explicit unpackaged 9344 launch preserves the development fallback');
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
const guard = installExternalDebuggingProbeGuard({ allowed: false, httpModule: fakeHttp });
assert.equal(guard.installed, true);
assert.throws(
  () => fakeHttp.get('http://127.0.0.1:9344/json'),
  error => error?.code === 'EXTERNAL_CDP_NOT_AUTHORIZED',
  'unauthorized localhost probe must fail before any local HTTP request is made',
);
assert.deepEqual(calls, []);
fakeHttp.get('http://127.0.0.1:1843/');
assert.deepEqual(calls, ['http://127.0.0.1:1843/'], 'unrelated localhost services must be untouched');
guard.restore();
assert.equal(fakeHttp.get, originalGet);

const allowedHttp = { get() { return 'ok'; } };
const allowedOriginal = allowedHttp.get;
const allowedGuard = installExternalDebuggingProbeGuard({ allowed: true, httpModule: allowedHttp });
assert.equal(allowedGuard.installed, false);
assert.equal(allowedHttp.get, allowedOriginal);

const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const policyIndex = entry.indexOf('installExternalDebuggingProbeGuard');
const mainIndex = entry.indexOf("require('./main.cjs')");
assert.ok(policyIndex >= 0 && mainIndex > policyIndex, 'external CDP policy must install before legacy main.cjs can probe localhost');
assert.match(entry, /externalDebuggingAllowed\(\{[\s\S]*isPackaged:\s*app\.isPackaged,[\s\S]*argv:\s*process\.argv/, 'entrypoint must bind authorization to packaging state and explicit argv');

console.log('EXTERNAL_DEBUGGING_POLICY_CONTRACT_OK');
