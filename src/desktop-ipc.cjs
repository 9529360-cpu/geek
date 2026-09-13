'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DESKTOP_IPC_CHANNELS = Object.freeze([
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

function installDesktopIpc(options = {}) {
  const {
    ipcMain,
    assertTrustedSender,
    app,
    getMainWindow,
    platformCatalog,
    runtimeAssetAllowed,
    resourcesDir,
    quitAndInstallForUpdate,
    Notification,
    nativeTheme,
    dialog,
    fs,
    pathModule = path,
    pathToFileURLImpl = pathToFileURL,
    logError = (...args) => console.error(...args),
  } = options;

  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('ipcMain handle/removeHandler API is required');
  }
  if (typeof assertTrustedSender !== 'function') throw new TypeError('assertTrustedSender is required');
  if (!app || typeof app.getVersion !== 'function' || typeof app.relaunch !== 'function' || typeof app.exit !== 'function') throw new TypeError('app is required');
  if (typeof getMainWindow !== 'function') throw new TypeError('getMainWindow is required');
  if (!platformCatalog || typeof platformCatalog !== 'object') throw new TypeError('platformCatalog is required');
  if (typeof runtimeAssetAllowed !== 'function') throw new TypeError('runtimeAssetAllowed is required');
  if (typeof resourcesDir !== 'string' || !resourcesDir) throw new TypeError('resourcesDir is required');
  if (typeof quitAndInstallForUpdate !== 'function') throw new TypeError('quitAndInstallForUpdate is required');
  if (typeof Notification !== 'function' || typeof Notification.isSupported !== 'function') throw new TypeError('Notification is required');
  if (!nativeTheme || !('shouldUseDarkColors' in nativeTheme)) throw new TypeError('nativeTheme is required');
  if (!dialog || typeof dialog.showSaveDialog !== 'function') throw new TypeError('dialog is required');
  if (!fs || typeof fs.writeFile !== 'function') throw new TypeError('fs promises API is required');
  if (!pathModule || typeof pathModule.join !== 'function') throw new TypeError('pathModule is required');
  if (typeof pathToFileURLImpl !== 'function') throw new TypeError('pathToFileURLImpl is required');
  if (typeof logError !== 'function') throw new TypeError('logError is required');

  const registeredChannels = new Set();
  let disposed = false;

  const register = (channel, handler) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      return handler(...args); // MUTATION: trusted-sender guard removed
    });
    registeredChannels.add(channel);
  };

  const liveMainWindow = () => {
    const window = getMainWindow();
    return window && !window.isDestroyed() ? window : null;
  };

  register('app:get-version', () => app.getVersion());
  register('platforms:list', () => Object.entries(platformCatalog).map(([type, cfg]) => ({
    type,
    name: cfg.name,
    short: cfg.short || type.slice(0, 2).toUpperCase(),
    needsExtension: !!cfg.needsExtension,
    isWebsite: type === 'website',
  })));
  register('bridge:get-preload-path', () => {
    if (!runtimeAssetAllowed('bridge')) throw new Error('翻译桥完整性校验失败，已阻止加载');
    return pathToFileURLImpl(pathModule.join(resourcesDir, 'bridge-preload.cjs')).href;
  });
  register('window:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });
  register('updater:install', () => quitAndInstallForUpdate());
  register('window:minimize', () => {
    liveMainWindow()?.minimize();
  });
  register('window:maximize', () => {
    const window = liveMainWindow();
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  register('window:close', () => {
    liveMainWindow()?.close();
  });
  register('notify:show', (payload) => {
    try {
      if (!Notification.isSupported()) return;
      const notification = new Notification({
        title: String(payload?.title || '新消息'),
        body: String(payload?.body || ''),
        silent: false,
        timeoutType: 'default',
      });
      notification.show();
    } catch (error) {
      logError('[notify] 失败', error.message);
    }
  });
  register('theme:get-system', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  register('file:save', async (payload) => {
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: '保存文件',
      defaultPath: payload?.defaultName || '导出.csv',
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, payload?.content || '', 'utf-8');
    return result.filePath;
  });

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const channel of registeredChannels) ipcMain.removeHandler(channel);
      registeredChannels.clear();
    },
  });
}

module.exports = {
  DESKTOP_IPC_CHANNELS,
  installDesktopIpc,
};
