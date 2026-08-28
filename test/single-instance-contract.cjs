'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { focusPrimaryWindow, installSingleInstanceGuard } = require('../src/single-instance.cjs');

let restored = 0;
let shown = 0;
let focused = 0;
const win = {
  isDestroyed: () => false,
  isMinimized: () => true,
  restore: () => { restored += 1; },
  show: () => { shown += 1; },
  focus: () => { focused += 1; },
};
const BrowserWindow = { getAllWindows: () => [win] };
assert.equal(focusPrimaryWindow(BrowserWindow), true);
assert.deepEqual([restored, shown, focused], [1, 1, 1]);

let secondInstance = null;
let exitCode = null;
const primaryApp = {
  requestSingleInstanceLock: () => true,
  on: (event, handler) => { if (event === 'second-instance') secondInstance = handler; },
  exit: code => { exitCode = code; },
};
assert.equal(installSingleInstanceGuard({ app: primaryApp, BrowserWindow }), true);
assert.equal(typeof secondInstance, 'function', 'primary instance must install second-instance focus handler');
secondInstance();
assert.equal(exitCode, null);
assert.equal(focused, 2, 'second launch should focus the existing primary window');

let duplicateExit = null;
let duplicateListenerInstalled = false;
const duplicateApp = {
  requestSingleInstanceLock: () => false,
  on: () => { duplicateListenerInstalled = true; },
  exit: code => { duplicateExit = code; },
};
assert.equal(installSingleInstanceGuard({ app: duplicateApp, BrowserWindow }), false);
assert.equal(duplicateExit, 0, 'duplicate instance must exit before Chromium/session bootstrap');
assert.equal(duplicateListenerInstalled, false);

const mainEntry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const profileAt = mainEntry.indexOf('configureRuntimeEnvironment({');
const setPathAt = mainEntry.indexOf("app.setPath('userData', earlyUserDataDir)");
const lockAt = mainEntry.indexOf('installSingleInstanceGuard({ app, BrowserWindow })');
const ipcAt = mainEntry.indexOf('installBroadcastFileBoundary({');
const mainAt = mainEntry.indexOf("require('./main.cjs')");
assert.ok(profileAt >= 0 && setPathAt > profileAt && lockAt > setPathAt, 'runtime profile/userData must be fixed before acquiring the lock');
assert.ok(ipcAt > lockAt && mainAt > lockAt, 'IPC boundaries and main runtime must load only after the single-instance decision');
assert.match(mainEntry, /if \(primaryInstance\) \{[\s\S]*installBroadcastFileBoundary\([\s\S]*require\('\.\/main\.cjs'\);[\s\S]*\}/, 'duplicate process must not bootstrap the application runtime');

console.log('SINGLE_INSTANCE_CONTRACT_OK');
