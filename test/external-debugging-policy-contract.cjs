'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  externalDebuggingRequested,
  isExternalDebugProbeTarget,
  installExternalDebuggingProbeGuard,
} = require('../src/external-debugging-policy.cjs');

assert.equal(externalDebuggingRequested({ argv: [] }), false);
assert.equal(externalDebuggingRequested({ argv: ['--remote-debugging-port=9222'] }), false);
assert.equal(externalDebuggingRequested({ argv: ['--remote-debugging-port=9344'] }), true);

// Node http.get accepts URL/string, options objects, and URL + overriding options.
// The fail-closed boundary must recognize the same effective legacy CDP target
// regardless of which supported call shape reaches it.
assert.equal(isExternalDebugProbeTarget('http://127.0.0.1:9344/json'), true);
assert.equal(isExternalDebugProbeTarget(new URL('http://127.0.0.1:9344/json?source=legacy')), true);
assert.equal(isExternalDebugProbeTarget({ hostname: '127.0.0.1', port: 9344, path: '/json' }), true);
assert.equal(isExternalDebugProbeTarget({ host: '127.0.0.1', port: '9344', path: '/json?source=legacy' }), true);
assert.equal(isExternalDebugProbeTarget(
  'http://127.0.0.1:1843/',
  { hostname: '127.0.0.1', port: 9344, path: '/json' },
), true);
assert.equal(isExternalDebugProbeTarget('http://127.0.0.1:9344/json/version'), false);
assert.equal(isExternalDebugProbeTarget('http://localhost:9344/json'), false);
assert.equal(isExternalDebugProbeTarget({ host: '127.0.0.1', hostname: 'localhost', port: 9344, path: '/json' }), false);
assert.equal(isExternalDebugProbeTarget({ protocol: 'https:', hostname: '127.0.0.1', port: 9344, path: '/json' }), false);
assert.equal(isExternalDebugProbeTarget(
  'http://127.0.0.1:9344/json',
  { hostname: 'localhost' },
), false);

const calls = [];
const fakeHttp = {
  get(input, ...args) {
    calls.push([input, ...args]);
    return { on() { return this; } };
  },
};
const originalGet = fakeHttp.get;
const guard = installExternalDebuggingProbeGuard({ httpModule: fakeHttp });
assert.equal(guard.installed, true);
for (const invoke of [
  () => fakeHttp.get('http://127.0.0.1:9344/json'),
  () => fakeHttp.get({ hostname: '127.0.0.1', port: 9344, path: '/json' }),
  () => fakeHttp.get(
    'http://127.0.0.1:1843/',
    { hostname: '127.0.0.1', port: 9344, path: '/json' },
    () => {},
  ),
]) {
  assert.throws(
    invoke,
    error => error?.code === 'EXTERNAL_BROADCAST_CDP_DISABLED',
  );
}
assert.equal(calls.length, 0, 'every supported representation of the disabled legacy target must fail before I/O');
const allowedTarget = { hostname: '127.0.0.1', port: 1843, path: '/' };
fakeHttp.get(allowedTarget);
assert.equal(calls.length, 1);
assert.equal(calls[0][0], allowedTarget, 'unrelated localhost services must pass through unchanged');
guard.restore();
assert.equal(fakeHttp.get, originalGet);

const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const policyIndex = entry.indexOf('installExternalDebuggingProbeGuard();');
const mainIndex = entry.indexOf("require('./main.cjs')");
assert.ok(policyIndex >= 0 && mainIndex > policyIndex, 'external broadcast CDP probe guard stays an early runtime boundary');
assert.match(main, /remoteDebuggingRequested\s*=\s*externalDebuggingRequested\(\{\s*argv:\s*process\.argv\s*\}\)/, 'main composition may detect explicit remote debugging only to fail unsupported Telegram attachment paths clearly');
assert.match(main, /TG_NATIVE_ATTACH_EXTERNAL_DEBUG_UNSUPPORTED/, 'Telegram native attachments must fail closed under explicit external debugging');
assert.doesNotMatch(entry, /installExternalDebuggingProbeGuard\(\{\s*allowed:/, 'no launch mode may opt broadcast attachments back into the unbound legacy external target selector');

console.log('EXTERNAL_DEBUGGING_POLICY_CONTRACT_OK');
