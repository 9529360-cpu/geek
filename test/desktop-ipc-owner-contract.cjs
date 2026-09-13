'use strict';

const assert = require('node:assert/strict');
const { DESKTOP_IPC_CHANNELS, installDesktopIpc } = require('../src/desktop-ipc.cjs');

function createHarness(options = {}) {
  const handlers = new Map([['foreign:keep', async () => 'foreign']]);
  const removed = [];
  const calls = [];
  const writes = [];
  const notificationOptions = [];
  const notificationShows = [];
  const notificationErrors = [];
  let trusted = options.trusted !== false;
  let bridgeAllowed = options.bridgeAllowed !== false;
  let notificationSupported = options.notificationSupported !== false;
  let notificationFailure = options.notificationFailure || null;
  let dark = options.dark === true;
  let saveResult = options.saveResult || { canceled: false, filePath: '/tmp/export.csv' };
  let maximized = false;
  let destroyed = options.destroyed === true;

  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `duplicate desktop IPC registration: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    },
  };

  const mainWindow = {
    isDestroyed: () => destroyed,
    minimize: () => calls.push(['minimize']),
    isMaximized: () => maximized,
    maximize: () => { calls.push(['maximize']); maximized = true; },
    unmaximize: () => { calls.push(['unmaximize']); maximized = false; },
    close: () => calls.push(['close']),
  };

  function FakeNotification(payload) {
    if (notificationFailure === 'constructor') throw new Error('notification constructor failed');
    notificationOptions.push(payload);
    this.show = () => {
      if (notificationFailure === 'show') throw new Error('notification show failed');
      notificationShows.push(payload);
    };
  }
  FakeNotification.isSupported = () => {
    calls.push(['notification:isSupported']);
    return notificationSupported;
  };

  const app = {
    getVersion: () => { calls.push(['getVersion']); return '9.8.7'; },
    relaunch: () => calls.push(['relaunch']),
    exit: (code) => calls.push(['exit', code]),
  };
  const nativeTheme = {};
  Object.defineProperty(nativeTheme, 'shouldUseDarkColors', {
    enumerable: true,
    get() { calls.push(['theme']); return dark; },
  });
  const dialog = {
    async showSaveDialog(window, dialogOptions) {
      calls.push(['showSaveDialog', window, dialogOptions]);
      return saveResult;
    },
  };
  const fs = {
    async writeFile(...args) {
      writes.push(args);
    },
  };
  const platformCatalog = {
    whatsapp: { name: 'WhatsApp', short: 'WA', needsExtension: false },
    'line-business': { name: 'LINE Business', needsExtension: true },
    website: { name: 'Website', short: 'WEB', needsExtension: false },
  };

  const boundary = installDesktopIpc({
    ipcMain,
    assertTrustedSender: () => {
      if (!trusted) throw new Error('拒绝来自未授权页面的 IPC 请求');
    },
    app,
    getMainWindow: () => mainWindow,
    platformCatalog,
    runtimeAssetAllowed: (component) => {
      calls.push(['runtimeAssetAllowed', component]);
      return bridgeAllowed;
    },
    resourcesDir: '/runtime/resources',
    quitAndInstallForUpdate: () => { calls.push(['quitAndInstallForUpdate']); return 'UPDATE_RESULT'; },
    Notification: FakeNotification,
    nativeTheme,
    dialog,
    fs,
    pathModule: { join: (...parts) => parts.join('/') },
    pathToFileURLImpl: (filePath) => ({ href: `file://${filePath}` }),
    logError: (...args) => notificationErrors.push(args),
  });

  return {
    handlers,
    removed,
    calls,
    writes,
    notificationOptions,
    notificationShows,
    notificationErrors,
    mainWindow,
    boundary,
    setBridgeAllowed: value => { bridgeAllowed = value; },
    setNotificationSupported: value => { notificationSupported = value; },
    setNotificationFailure: value => { notificationFailure = value; },
    setDark: value => { dark = value; },
    setSaveResult: value => { saveResult = value; },
    setDestroyed: value => { destroyed = value; },
  };
}

async function invoke(harness, channel, ...args) {
  return harness.handlers.get(channel)({ sender: { id: 1 } }, ...args);
}

(async () => {
  assert.deepEqual([...DESKTOP_IPC_CHANNELS], [
    'app:get-version',
    'platforms:list',
    'bridge:get-preload-path',
    'window:relaunch',
    'updater:install',
    'window:minimize',
    'window:maximize',
    'window:close',
    'notify:show',
    'theme:get-system',
    'file:save',
  ]);

  {
    const harness = createHarness();
    assert.deepEqual(
      [...harness.handlers.keys()].filter(channel => channel !== 'foreign:keep'),
      [...DESKTOP_IPC_CHANNELS],
      'Desktop IPC owner must register the exact channel set'
    );
    assert.throws(() => {
      const duplicateIpcMain = {
        handle(channel, handler) {
          assert.equal(harness.handlers.has(channel), false, `duplicate desktop IPC registration: ${channel}`);
          harness.handlers.set(channel, handler);
        },
        removeHandler(channel) { harness.handlers.delete(channel); },
      };
      installDesktopIpc({
        ipcMain: duplicateIpcMain,
        assertTrustedSender: () => {},
        app: { getVersion() {}, relaunch() {}, exit() {} },
        getMainWindow: () => harness.mainWindow,
        platformCatalog: {},
        runtimeAssetAllowed: () => true,
        resourcesDir: '/runtime/resources',
        quitAndInstallForUpdate: () => {},
        Notification: Object.assign(function Notification() {}, { isSupported: () => false }),
        nativeTheme: { shouldUseDarkColors: false },
        dialog: { showSaveDialog: async () => ({ canceled: true }) },
        fs: { writeFile: async () => {} },
      });
    }, /duplicate desktop IPC registration: app:get-version/);
    harness.boundary.dispose();
  }

  {
    const harness = createHarness({ trusted: false });
    for (const channel of DESKTOP_IPC_CHANNELS) {
      await assert.rejects(
        invoke(harness, channel, { title: 'x', body: 'y', content: 'z' }),
        /拒绝来自未授权页面的 IPC 请求/,
        `${channel} must reject an untrusted sender before any side effect`
      );
    }
    assert.deepEqual(harness.calls, [], 'untrusted desktop IPC must not reach any side effect');
    assert.deepEqual(harness.writes, [], 'untrusted file:save must not write');
    assert.deepEqual(harness.notificationOptions, [], 'untrusted notify:show must not construct a Notification');
    assert.deepEqual(harness.notificationShows, [], 'untrusted notify:show must not show a Notification');
    harness.boundary.dispose();
  }

  {
    const harness = createHarness();
    assert.equal(await invoke(harness, 'app:get-version'), '9.8.7');
    assert.deepEqual(await invoke(harness, 'platforms:list'), [
      { type: 'whatsapp', name: 'WhatsApp', short: 'WA', needsExtension: false, isWebsite: false },
      { type: 'line-business', name: 'LINE Business', short: 'LI', needsExtension: true, isWebsite: false },
      { type: 'website', name: 'Website', short: 'WEB', needsExtension: false, isWebsite: true },
    ]);

    harness.setBridgeAllowed(false);
    await assert.rejects(invoke(harness, 'bridge:get-preload-path'), /翻译桥完整性校验失败，已阻止加载/);
    harness.setBridgeAllowed(true);
    assert.equal(await invoke(harness, 'bridge:get-preload-path'), 'file:///runtime/resources/bridge-preload.cjs');

    await invoke(harness, 'window:relaunch');
    assert.deepEqual(harness.calls.filter(call => call[0] === 'relaunch' || call[0] === 'exit'), [
      ['relaunch'],
      ['exit', 0],
    ]);
    assert.equal(await invoke(harness, 'updater:install'), 'UPDATE_RESULT');

    await invoke(harness, 'window:minimize');
    await invoke(harness, 'window:maximize');
    await invoke(harness, 'window:maximize');
    await invoke(harness, 'window:close');
    assert.deepEqual(harness.calls.filter(call => ['minimize', 'maximize', 'unmaximize', 'close'].includes(call[0])), [
      ['minimize'],
      ['maximize'],
      ['unmaximize'],
      ['close'],
    ]);
    harness.setDestroyed(true);
    await invoke(harness, 'window:minimize');
    await invoke(harness, 'window:maximize');
    await invoke(harness, 'window:close');
    assert.equal(harness.calls.filter(call => ['minimize', 'maximize', 'unmaximize', 'close'].includes(call[0])).length, 4, 'destroyed main window must not receive window commands');

    await invoke(harness, 'notify:show', { body: 42 });
    assert.deepEqual(harness.notificationOptions, [{ title: '新消息', body: '42', silent: false, timeoutType: 'default' }]);
    assert.equal(harness.notificationShows.length, 1);

    harness.setNotificationSupported(false);
    await invoke(harness, 'notify:show', { title: 'ignored' });
    assert.equal(harness.notificationOptions.length, 1, 'unsupported notifications must not be constructed');

    harness.setNotificationSupported(true);
    harness.setNotificationFailure('constructor');
    await invoke(harness, 'notify:show', { title: 'constructor error' });
    harness.setNotificationFailure('show');
    await invoke(harness, 'notify:show', { title: 'show error' });
    assert.deepEqual(harness.notificationErrors, [
      ['[notify] 失败', 'notification constructor failed'],
      ['[notify] 失败', 'notification show failed'],
    ], 'notification failures must be logged and swallowed');

    harness.setDark(true);
    assert.equal(await invoke(harness, 'theme:get-system'), 'dark');
    harness.setDark(false);
    assert.equal(await invoke(harness, 'theme:get-system'), 'light');

    harness.setDestroyed(false);
    harness.setSaveResult({ canceled: true });
    assert.equal(await invoke(harness, 'file:save', { defaultName: 'a.csv', content: 'a' }), null);
    assert.deepEqual(harness.writes, []);

    harness.setSaveResult({ canceled: false, filePath: '/tmp/final.csv' });
    assert.equal(await invoke(harness, 'file:save', { defaultName: 'custom.csv', content: 'x,y' }), '/tmp/final.csv');
    assert.deepEqual(harness.writes, [['/tmp/final.csv', 'x,y', 'utf-8']]);
    const saveDialogCall = harness.calls.filter(call => call[0] === 'showSaveDialog').at(-1);
    assert.equal(saveDialogCall[1], harness.mainWindow);
    assert.deepEqual(saveDialogCall[2], {
      title: '保存文件',
      defaultPath: 'custom.csv',
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
    });

    harness.boundary.dispose();
    assert.deepEqual(harness.removed, [...DESKTOP_IPC_CHANNELS]);
    assert.equal(harness.handlers.size, 1, 'dispose must preserve handlers owned by other modules');
    assert.equal(harness.handlers.has('foreign:keep'), true, 'dispose must not remove foreign handlers');
    harness.boundary.dispose();
    assert.deepEqual(harness.removed, [...DESKTOP_IPC_CHANNELS], 'dispose must be idempotent');
  }

  console.log('DESKTOP_IPC_OWNER_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
