'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { createUpdaterStatusRelay } = require('../src/updater-status-relay.cjs');

const root = path.join(__dirname, '..');
const updaterPath = path.join(root, 'src', 'updater.cjs');
const originalLoad = Module._load;
const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
const hadResourcesPath = Object.prototype.hasOwnProperty.call(process, 'resourcesPath');
const originalResourcesPath = process.resourcesPath;

function createTimerHarness() {
  let nextId = 1;
  const timers = new Map();
  const cleared = [];

  function setTimeoutMock(fn, delay) {
    const timer = {
      id: nextId++,
      fn,
      delay,
      unrefCalled: false,
      unref() { this.unrefCalled = true; },
    };
    timers.set(timer.id, timer);
    return timer;
  }

  function clearTimeoutMock(timer) {
    if (!timer) return;
    cleared.push(timer.id);
    timers.delete(timer.id);
  }

  function activeTimers() {
    return [...timers.values()];
  }

  async function fire(timer) {
    assert.ok(timer && timers.has(timer.id), 'timer must still be active before firing');
    timers.delete(timer.id); // mimic one-shot timer removal before callback runs
    return timer.fn();
  }

  return { setTimeoutMock, clearTimeoutMock, activeTimers, fire, cleared };
}

(async () => {
  const timerHarness = createTimerHarness();
  global.setTimeout = timerHarness.setTimeoutMock;
  global.clearTimeout = timerHarness.clearTimeoutMock;
  process.resourcesPath = path.join(root, 'test-fixtures', 'updater');

  const appListeners = new Map();
  const app = {
    isPackaged: true,
    on(event, handler) { appListeners.set(event, handler); },
  };
  const BrowserWindow = { getAllWindows: () => [] };
  const autoUpdater = new EventEmitter();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = true;

  let checkCalls = 0;
  autoUpdater.checkForUpdatesAndNotify = async () => {
    checkCalls += 1;
    if (checkCalls === 2) autoUpdater.emit('update-downloaded', { version: '1.2.23' });
    return { updateInfo: { version: checkCalls === 2 ? '1.2.23' : '1.2.22' } };
  };

  let installCalls = 0;
  autoUpdater.quitAndInstall = () => { installCalls += 1; };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent?.filename === updaterPath) {
      if (request === 'electron-updater') return { autoUpdater };
      if (request === 'electron') return { app, BrowserWindow };
      if (request === 'node:fs') return { existsSync: () => true };
      if (request === './updater-policy.cjs') return { shouldCheckForUpdates: () => true };
      if (request === './subscription-window-visibility.cjs') {
        return { installSubscriptionWindowVisibilityRecovery: () => {} };
      }
      if (request === './updater-status-relay.cjs') return { createUpdaterStatusRelay };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[require.resolve(updaterPath)];
  const updater = require(updaterPath);
  updater.initAutoUpdater();

  assert.equal(autoUpdater.autoDownload, true, 'updater must keep automatic download behavior');
  assert.equal(autoUpdater.autoInstallOnAppQuit, true, 'normal app exit must keep automatic install behavior');
  assert.equal(autoUpdater.allowPrerelease, false, 'prerelease channel must remain disabled');
  assert.equal(appListeners.has('browser-window-created'), true, 'future-window updater replay must remain installed');

  let timers = timerHarness.activeTimers();
  assert.equal(timers.length, 1, 'init must schedule exactly one initial update check');
  assert.equal(timers[0].delay, 10 * 1000, 'initial update check delay must remain 10 seconds');
  assert.equal(timers[0].unrefCalled, true, 'update timer must not keep the app alive by itself');

  await timerHarness.fire(timers[0]);
  assert.equal(checkCalls, 1, 'first scheduled check must call electron-updater once');
  timers = timerHarness.activeTimers();
  assert.equal(timers.length, 1, 'before a package is downloaded, the long-running recheck loop must continue');
  assert.equal(timers[0].delay, 6 * 60 * 60 * 1000, 'recheck interval must remain six hours');

  // The second check emits update-downloaded while checkForUpdatesAndNotify is still in flight.
  // The handler and the finally block together must leave no future recheck timer behind.
  await timerHarness.fire(timers[0]);
  assert.equal(checkCalls, 2, 'second scheduled check must execute');
  assert.equal(timerHarness.activeTimers().length, 0, 'downloaded pending-install state must stop future periodic checks');

  // Stray updater events after the package is ready do not create timers either.
  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('error', new Error('temporary network failure after download'));
  autoUpdater.emit('update-not-available');
  assert.equal(timerHarness.activeTimers().length, 0, 'post-download transient events must not revive the recheck loop');

  assert.equal(updater.quitAndInstallForUpdate(), true, 'downloaded package must remain manually installable');
  assert.equal(installCalls, 1, 'manual install must delegate to electron-updater exactly once');
  assert.equal(updater.isUpdateInstalling(), true, 'installing state must remain observable after manual install starts');
  assert.equal(timerHarness.activeTimers().length, 0, 'manual install must not revive update checks');

  console.log('UPDATER_PENDING_INSTALL_CONTRACT_OK');
})().finally(() => {
  Module._load = originalLoad;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
  if (hadResourcesPath) process.resourcesPath = originalResourcesPath;
  else delete process.resourcesPath;
  delete require.cache[require.resolve(updaterPath)];
}).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
