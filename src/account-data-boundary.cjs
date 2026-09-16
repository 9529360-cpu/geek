'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createAccountDataStore, createStoreError } = require('./account-data-store.cjs');
const { createAccountRemovalCleanupJournal } = require('./account-removal-cleanup-journal.cjs');

const ACCOUNT_DATA_CHANNELS = Object.freeze([
  'account-data:get-all',
  'account-data:set',
  'account-data:remove',
]);

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
  if (options.beforeAccountRemove !== undefined && typeof options.beforeAccountRemove !== 'function') {
    throw new TypeError('beforeAccountRemove must be a function');
  }

  const pathModule = options.pathModule || path;
  const fileURLToPathFn = options.fileURLToPath || fileURLToPath;
  const platform = options.platform || process.platform;
  const store = options.store || createAccountDataStore(options);
  const resolveAccountPartition = options.resolveAccountPartition || createAccountPartitionResolver(options);
  // Compatibility option name retained; live caller performs irreversible scheduled-attachment cleanup.
  // It must therefore run only after authoritative account deletion is known to have committed.
  const committedAccountCleanup = options.beforeAccountRemove || (async () => {});
  const cleanupJournal = options.cleanupJournal || (
    options.fs && typeof options.getUserDataDir === 'function'
      ? createAccountRemovalCleanupJournal({
        fs: options.fs,
        pathModule,
        filePath: pathModule.join(options.getUserDataDir(), 'account-removal-cleanup.json'),
      })
      : null
  );
  const onCleanupRecoveryError = typeof options.onCleanupRecoveryError === 'function'
    ? options.onCleanupRecoveryError
    : () => {};
  const expectedUiPath = pathModule.resolve(uiEntryPath);
  const comparablePath = (value) => platform === 'win32' ? value.toLowerCase() : value;
  const registeredChannels = new Set();
  let cleanupRecoveryTail = Promise.resolve();

  function reconcileCommittedCleanup() {
    if (!cleanupJournal) return Promise.resolve(Object.freeze({ recovered: [], cleared: [], failed: [] }));
    const run = cleanupRecoveryTail.catch(() => {}).then(() => cleanupJournal.recover({
      resolveAccountPartition,
      cleanup: committedAccountCleanup,
    }));
    cleanupRecoveryTail = run.catch((error) => {
      try { onCleanupRecoveryError(error); } catch {}
    });
    return run;
  }

  // Account State is loaded before this boundary is installed in production. A
  // durable finalizer left by a hard termination can therefore be reconciled as
  // soon as the boundary is composed, without waiting for renderer state.
  reconcileCommittedCleanup().catch(() => {});

  const register = (channel, handler) => {
    ipcMain.handle(channel, handler);
    registeredChannels.add(channel);
  };

  function assertMainRenderer(event) {
    const sender = event && event.sender;
    const frame = event && event.senderFrame;
    const win = sender ? BrowserWindow.fromWebContents(sender) : null;
    if (
      !sender
      || !frame
      || sender.mainFrame !== frame
      || !win
      || (typeof win.isDestroyed === 'function' && win.isDestroyed())
      || !win.webContents
      || win.webContents.id !== sender.id
    ) {
      throw createStoreError('ACCOUNT_DATA_SENDER_INVALID', '拒绝来自未授权页面的 IPC 请求');
    }
    let senderPath = '';
    try {
      senderPath = pathModule.resolve(fileURLToPathFn(new URL(frame.url)));
    } catch {
      throw createStoreError('ACCOUNT_DATA_SENDER_INVALID', '拒绝来自未授权页面的 IPC 请求');
    }
    if (comparablePath(senderPath) !== comparablePath(expectedUiPath)) {
      throw createStoreError('ACCOUNT_DATA_SENDER_INVALID', '拒绝来自未授权页面的 IPC 请求');
    }
    return win;
  }

  register('account-data:get-all', async (event, accountId) => {
    assertMainRenderer(event);
    const partition = await resolveAccountPartition(accountId);
    return store.getAll(partition);
  });

  register('account-data:set', async (event, accountId, key, value) => {
    assertMainRenderer(event);
    const partition = await resolveAccountPartition(accountId);
    return store.set(partition, key, value);
  });

  register('account-data:remove', async (event, accountId, key) => {
    assertMainRenderer(event);
    const partition = await resolveAccountPartition(accountId);
    return store.remove(partition, key);
  });

  async function clearUncommittedCleanupDebt(accountId) {
    if (!cleanupJournal) return;
    try { await cleanupJournal.clear(accountId); }
    catch (error) { try { onCleanupRecoveryError(error); } catch {} }
  }

  async function settleCommittedRemoval({ event, accountId, partition, response }) {
    let cleanupPending = false;
    try {
      await committedAccountCleanup({ event, accountId, partition });
      if (cleanupJournal) await cleanupJournal.clear(accountId);
    } catch (error) {
      cleanupPending = true;
      try { onCleanupRecoveryError(error); } catch {}
    }
    store.finalizeDelete(partition);
    return cleanupPending
      ? Object.freeze({ ok: true, deleted: true, cleanupPending: true })
      : response;
  }

  async function runAccountRemoval(event, accountId, removeImplementation, ...rest) {
    if (typeof removeImplementation !== 'function') throw new TypeError('removeImplementation must be a function');
    assertMainRenderer(event);
    const id = assertAccountId(accountId);
    const partition = await resolveAccountPartition(id);
    await reconcileCommittedCleanup();
    await store.beginDelete(partition);
    if (cleanupJournal) {
      try {
        await cleanupJournal.markPending({ accountId: id, partition });
      } catch (error) {
        store.cancelDelete(partition);
        throw error;
      }
    }

    let response;
    try {
      response = await removeImplementation(event, id, ...rest);
    } catch (error) {
      let removalCommitted = false;
      try {
        await resolveAccountPartition(id);
      } catch (probeError) {
        if (probeError?.code === 'ACCOUNT_DATA_ACCOUNT_MISSING') removalCommitted = true;
        else {
          store.cancelDelete(partition);
          throw error;
        }
      }
      if (!removalCommitted) {
        await clearUncommittedCleanupDebt(id);
        store.cancelDelete(partition);
        throw error;
      }
      return settleCommittedRemoval({ event, accountId: id, partition, response: Object.freeze({ ok: true, deleted: true, cleanupPending: true }) });
    }

    return settleCommittedRemoval({ event, accountId: id, partition, response });
  }

  return Object.freeze({
    store,
    resolveAccountPartition,
    runAccountRemoval,
    reconcileCommittedCleanup,
    dispose() {
      if (typeof ipcMain.removeHandler !== 'function') return;
      for (const channel of registeredChannels) ipcMain.removeHandler(channel);
      registeredChannels.clear();
    },
  });
}

module.exports = {
  ACCOUNT_DATA_CHANNELS,
  createAccountPartitionResolver,
  installAccountDataBoundary,
};
