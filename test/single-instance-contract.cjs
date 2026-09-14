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
assert.equal(typeof secondInstance, 'function');
secondInstance();
assert.equal(exitCode, null);
assert.equal(focused, 2);

let duplicateExit = null;
let duplicateListenerInstalled = false;
const duplicateApp = {
  requestSingleInstanceLock: () => false,
  on: () => { duplicateListenerInstalled = true; },
  exit: code => { duplicateExit = code; },
};
assert.equal(installSingleInstanceGuard({ app: duplicateApp, BrowserWindow }), false);
assert.equal(duplicateExit, 0);
assert.equal(duplicateListenerInstalled, false);

const mainEntry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const profileAt = mainEntry.indexOf('configureRuntimeEnvironment({');
const userDataBindAt = mainEntry.indexOf('prepareUserDataPath({ app, fs: nodeFs, userDataDir: earlyUserDataDir })');
const lockAt = mainEntry.indexOf('installSingleInstanceGuard({ app, BrowserWindow })');
const sessionAt = mainEntry.indexOf('installSessionPartitionCompat({ app, sessionModule: session })');
const navigationAt = mainEntry.indexOf('installAccountScopedWebviewNavigationBoundary({');
const permissionAt = mainEntry.indexOf('installAccountSessionPermissionBoundary({');
const externalDebugAt = mainEntry.indexOf('installExternalDebuggingProbeGuard()');
const mainAt = mainEntry.indexOf("require('./main.cjs')");
assert.ok(profileAt >= 0 && userDataBindAt > profileAt && lockAt > userDataBindAt, 'profile-specific userData must be prepared and bound before taking the single-instance lock');
assert.ok(sessionAt > lockAt && navigationAt > sessionAt && permissionAt > navigationAt && externalDebugAt > permissionAt && mainAt > externalDebugAt, 'true early runtime/security boundaries must remain behind the single-instance decision and ahead of main');
assert.doesNotMatch(mainEntry, /installBroadcastFileBoundary|installScheduledBroadcastAttachmentBoundary|installAccountDataBoundary|installAccountTypeBoundary/, 'deferred IPC capabilities must not return to startup interception');
assert.match(mainEntry, /if \(primaryInstance\) \{[\s\S]*sessionPartitionCompat\.ready[\s\S]*require\('\.\/main\.cjs'\)[\s\S]*\}/, 'main bootstrap remains inside the primary-instance boundary');
console.log('SINGLE_INSTANCE_CONTRACT_OK');
