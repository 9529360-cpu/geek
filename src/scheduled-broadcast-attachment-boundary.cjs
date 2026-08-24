'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createScheduledBroadcastAttachmentStore } = require('./scheduled-broadcast-attachments.cjs');

const CHANNELS = Object.freeze({
  persist: 'broadcast-scheduled-attachments:persist',
  materialize: 'broadcast-scheduled-attachments:materialize',
  cleanup: 'broadcast-scheduled-attachments:cleanup',
});

function boundaryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function installScheduledBroadcastAttachmentBoundary(options = {}) {
  const { ipcMain, BrowserWindow, fs, uiEntryPath, ephemeralRegistry, getUserDataDir } = options;
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required');
  if (!BrowserWindow || typeof BrowserWindow.fromWebContents !== 'function') throw new TypeError('BrowserWindow is required');
  if (!fs) throw new TypeError('fs is required');
  if (!uiEntryPath) throw new TypeError('uiEntryPath is required');
  if (!ephemeralRegistry || typeof ephemeralRegistry.resolve !== 'function' || typeof ephemeralRegistry.registerSelection !== 'function') {
    throw new TypeError('ephemeralRegistry is required');
  }
  if (typeof getUserDataDir !== 'function') throw new TypeError('getUserDataDir is required');

  const pathModule = options.pathModule || path;
  const fileURLToPathFn = options.fileURLToPath || fileURLToPath;
  const platform = options.platform || process.platform;
  const expectedUiPath = pathModule.resolve(uiEntryPath);
  const comparable = value => platform === 'win32' ? value.toLowerCase() : value;
  let store = null;

  function assertMainRenderer(event) {
    const sender = event?.sender;
    const win = sender ? BrowserWindow.fromWebContents(sender) : null;
    if (!sender || !win || (typeof win.isDestroyed === 'function' && win.isDestroyed()) || !win.webContents || win.webContents.id !== sender.id) {
      throw boundaryError('SCHEDULED_BROADCAST_ATTACHMENT_OWNER_INVALID');
    }
    let senderPath = '';
    try { senderPath = pathModule.resolve(fileURLToPathFn(new URL(win.webContents.getURL()))); }
    catch { throw boundaryError('SCHEDULED_BROADCAST_ATTACHMENT_OWNER_INVALID'); }
    if (comparable(senderPath) !== comparable(expectedUiPath)) throw boundaryError('SCHEDULED_BROADCAST_ATTACHMENT_OWNER_INVALID');
    return { ownerId: String(sender.id) };
  }

  function getStore() {
    if (!store) {
      const userDataDir = String(getUserDataDir() || '');
      if (!userDataDir) throw boundaryError('SCHEDULED_BROADCAST_ATTACHMENT_STORE_UNAVAILABLE');
      store = createScheduledBroadcastAttachmentStore({
        fs,
        pathModule,
        storePath: pathModule.join(userDataDir, 'scheduled-broadcast-attachments.json'),
      });
    }
    return store;
  }

  ipcMain.handle(CHANNELS.persist, async (event, payload) => {
    const { ownerId } = assertMainRenderer(event);
    const source = payload && typeof payload === 'object' ? payload : {};
    const accountId = String(source.accountId || '');
    const taskId = String(source.taskId || '');
    const tokens = Array.isArray(source.fileTokens) ? source.fileTokens.map(value => String(value || '')) : [];
    if (!tokens.length || tokens.length > ephemeralRegistry.limits.maxFiles || new Set(tokens).size !== tokens.length) {
      throw boundaryError('SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID');
    }
    const selected = [];
    for (const token of tokens) selected.push(await ephemeralRegistry.resolve(token, ownerId));
    const refs = await getStore().registerPaths({
      accountId,
      taskId,
      filePaths: selected.map(file => file.filePath),
    });
    return refs.map(ref => ({ ref: ref.ref, name: ref.name, size: ref.size, mime: ref.mime }));
  });

  ipcMain.handle(CHANNELS.materialize, async (event, payload) => {
    const { ownerId } = assertMainRenderer(event);
    const source = payload && typeof payload === 'object' ? payload : {};
    const accountId = String(source.accountId || '');
    const taskId = String(source.taskId || '');
    const refs = Array.isArray(source.refs) ? source.refs.map(value => String(value || '')) : [];
    const resolved = await getStore().resolveMany(refs, { accountId, taskId });
    const selected = await ephemeralRegistry.registerSelection(resolved.map(file => file.filePath), ownerId);
    return selected.map(file => ({ token: file.token, name: file.name, size: file.size, mime: file.mime }));
  });

  ipcMain.handle(CHANNELS.cleanup, async (event, payload) => {
    assertMainRenderer(event);
    const source = payload && typeof payload === 'object' ? payload : {};
    return getStore().cleanupTask(String(source.accountId || ''), String(source.taskId || ''));
  });

  return Object.freeze({
    channels: CHANNELS,
    getStore,
  });
}

module.exports = {
  CHANNELS,
  installScheduledBroadcastAttachmentBoundary,
};
