'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  UNSAFE_ELECTRON_SWITCHES,
  argvSwitchNames,
  findUnsafeElectronSwitches,
  assertSafeElectronStartup,
} = require('../src/electron-startup-security.cjs');

assert.deepEqual(
  UNSAFE_ELECTRON_SWITCHES,
  ['ignore-certificate-errors', 'disable-web-security', 'no-sandbox', 'allow-running-insecure-content'],
  'startup policy must keep the explicit Electron security downgrade set reviewable',
);

assert.deepEqual(argvSwitchNames(['electron', '.', '--remote-debugging-port=9344', '--enable-automation']), [
  'remote-debugging-port',
  'enable-automation',
]);
assert.deepEqual(argvSwitchNames(['electron', '.', '--', '--no-sandbox']), [], 'arguments after -- are application payload, not Chromium switches');

assert.deepEqual(
  findUnsafeElectronSwitches({ argv: ['electron', '.', '--IGNORE-CERTIFICATE-ERRORS', '--disable-web-security=true'] }),
  ['ignore-certificate-errors', 'disable-web-security'],
);
assert.deepEqual(
  findUnsafeElectronSwitches({ argv: ['electron', '.', '--remote-debugging-port=9344', '--enable-automation', '--test-type=webdriver'] }),
  [],
  'supported developer/E2E flags must remain available',
);

const commandLine = {
  hasSwitch(name) {
    return name === 'no-sandbox';
  },
};
assert.deepEqual(
  findUnsafeElectronSwitches({ argv: ['electron', '.'], commandLine }),
  ['no-sandbox'],
  'Electron commandLine authority must catch unsafe switches even when argv does not expose them',
);

assert.throws(
  () => assertSafeElectronStartup({ argv: ['electron', '.', '--allow-running-insecure-content'] }),
  error => error?.code === 'UNSAFE_ELECTRON_STARTUP_SWITCH'
    && Array.isArray(error?.switches)
    && error.switches.length === 1
    && error.switches[0] === 'allow-running-insecure-content',
);
assert.deepEqual(assertSafeElectronStartup({ argv: ['electron', '.'] }), { ok: true, blocked: [] });

const root = path.join(__dirname, '..');
const entry = fs.readFileSync(path.join(root, 'src/main-entry.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const importAt = entry.indexOf("require('./electron-startup-security.cjs')");
const guardAt = entry.indexOf('assertSafeElectronStartup({');
const identityAt = entry.indexOf('configureRuntimeEnvironment({');
const mainAt = entry.indexOf("require('./main.cjs')");
assert.ok(importAt >= 0 && guardAt > importAt, 'main entry must install the startup security policy');
assert.ok(identityAt > guardAt && mainAt > guardAt, 'unsafe Electron switches must fail before runtime identity or product window creation');
assert.match(entry, /argv:\s*process\.argv[\s\S]{0,80}commandLine:\s*app\.commandLine/, 'startup guard must compare both argv and Electron commandLine authority');
assert.match(entry, /catch \(error\)[\s\S]{0,320}process\.exit\(1\)/, 'blocked startup must terminate immediately instead of leaving Electron in an app-load-error process');
assert.doesNotMatch(main, /appendSwitch\(\s*['"](?:ignore-certificate-errors|disable-web-security|no-sandbox|allow-running-insecure-content)['"]/, 'product main process must never append a blocked security downgrade itself');

console.log('ELECTRON_STARTUP_SECURITY_CONTRACT_OK');
