'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createAccountDataStore, createStoreError } = require('./account-data-store.cjs');

const ACCOUNT_DATA_CHANNELS = Object.freeze([
  'account-data:get-all',
  'account-data:set',
  'account-data:remove',
]);
const REMOVE_ACCOUNT_CHANNEL = 'accounts:remove';

function assertAccountId(accountId) {
  const value = String(accountId || '');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw createStoreError('ACCOUNT_DATA_ACCOUNT_INVALID', '无效的账号 ID');
  }
  return value;
}

function createAccountPartitionResolver(options = {}) {
  const fs = options.fs;
  const getUserDataDir = options.getUserDataDir;
  if (!fs || typeof fs.readFile !== 'function') throw new TypeError('fs.readFile is required');
  if (typeof getUserDataDir !== 'function') throw new TypeError('getUserDataDir is required');

  return async function resolveAccountPartition(accountId) {
    const id = assertAccountId(accountId);
    const file = path.join(getUserDataDir(), 'accounts.json');
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (cause) {
      const error = createStoreError('ACCOUNT_DATA_ACCOUNT_STATE_UNAVAILABLE', '账号状态不可用');
      error.cause = cause;
      throw error;
    }
    const accounts = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.accounts) ? parsed.accounts : [];
    const account = accounts.find((item) => item && item.id === id);
    if (!account) throw createStoreError('ACCOUNT_DATA_ACCOUNT_MISSING', '账号沙箱不存在');
    const expected = `persist:webview-page-${id}`;
    if (account.partition && account.partition !== expected) {
      throw createStoreError('ACCOUNT_DATA_PARTITION_MISMATCH', '账号沙箱不合法');
    }
    return expected;
  };
}

function installAccountDataBoundary(options = {}) {
  const { ipcMain, BrowserWindow, uiEntryPath } = options;
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required');
  if (!BrowserWindow || typeof BrowserWindow.fromWebContents !== 'function') throw new TypeError('BrowserWindow is required');
  if (!uiEntryPath) throw new TypeError('uiEntryPath is required');

  const pathModule = options.pathModule || path;
  const fileURLToPathFn = options.fileURLToPath || fileURLToPath;
  const platform = options.platform || process.platform;
  const store = options.store || createAccountDataStore(options);
  const resolveAccountPartition = options.resolveAccountPartition || createAccountPartitionResolver(options);
  const expectedUiPath = pathModule.resolve(uiEntryPath);
  const comparablePath = (value) => platform === 'win32' ? value.toLowerCase() : value;
  const expectedRegistrations = new Set([...ACCOUNT_DATA_CHANNELS, REMOVE_ACCOUNT_CHANNEL]);
  const intercepted = new Set();
  const originalHandleMethod = ipcMain.handle;
  const callOriginalHandle = (channel, handler) => originalHandleMethod.call(ipcMain, channel, handler);

  function assertMainRenderer(event) {
    const sender = event && event.sender;
    const win = sender ? BrowserWindow.fromWebContents(sender) : null;
    if (!sender || !win || (typeof win.isDestroyed === 'function' && win.isDestroyed()) || !win.webContents || win.webContents.id !== sender.id) {
      throw createStoreError('ACCOUNT_DATA_SENDER_INVALID', '拒绝来自未授权页面的 IPC 请求');
    }
    let senderPath = '';
    try {
      senderPath = pathModule.resolve(fileURLToPathFn(new URL(win.webContents.getURL())));
    } catch {
      throw createStoreError('ACCOUNT_DATA_SENDER_INVALID', '拒绝来自未授权页面的 IPC 请求');
    }
    if (comparablePath(senderPath) !== comparablePath(expectedUiPath)) {
      throw createStoreError('ACCOUNT_DATA_SENDER_INVALID', '拒绝来自未授权页面的 IPC 请求');
    }
    return win;
  }

  callOriginalHandle('account-data:get-all', async (event, accountId) => {
    assertMainRenderer(event);
    const partition = await resolveAccountPartition(accountId);
    return store.getAll(partition);
  });

  callOriginalHandle('account-data:set', async (event, accountId, key, value) => {
    assertMainRenderer(event);
    const partition = await resolveAccountPartition(accountId);
    return store.set(partition, key, value);
  });

  callOriginalHandle('account-data:remove', async (event, accountId, key) => {
    assertMainRenderer(event);
    const partition = await resolveAccountPartition(accountId);
    return store.remove(partition, key);
  });

  function restoreIfComplete() {
    if (intercepted.size === expectedRegistrations.size && ipcMain.handle !== originalHandleMethod) {
      ipcMain.handle = originalHandleMethod;
    }
  }

  ipcMain.handle = function interceptedHandle(channel, listener) {
    if (!expectedRegistrations.has(channel)) {
      return originalHandleMethod.call(this, channel, listener);
    }
    intercepted.add(channel);

    if (ACCOUNT_DATA_CHANNELS.includes(channel)) {
      restoreIfComplete();
      return undefined;
    }

    const result = callOriginalHandle(channel, async (event, accountId, ...rest) => {
      assertMainRenderer(event);
      const partition = await resolveAccountPartition(accountId);
      await store.beginDelete(partition);
      try {
        const response = await listener(event, accountId, ...rest);
        store.finalizeDelete(partition);
        return response;
      } catch (error) {
        try {
          await resolveAccountPartition(accountId);
          store.cancelDelete(partition);
        } catch {
          store.finalizeDelete(partition);
        }
        throw error;
      }
    });
    restoreIfComplete();
    return result;
  };

  return Object.freeze({
    store,
    resolveAccountPartition,
    restore: () => { ipcMain.handle = originalHandleMethod; },
  });
}

module.exports = {
  ACCOUNT_DATA_CHANNELS,
  createAccountPartitionResolver,
  installAccountDataBoundary,
};
