'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const CHANNELS = Object.freeze({
  myOrders: 'subscription:my-orders',
  openPasswordReset: 'subscription:open-password-reset',
});
const PASSWORD_RESET_URL = 'https://geek.bbnba.com/forgot-password';

function installAccountCenterBoundary(options = {}) {
  const ipcMain = options.ipcMain;
  const BrowserWindow = options.BrowserWindow;
  const shell = options.shell;
  const safeStorage = options.safeStorage;
  const createSubscriptionStore = options.createSubscriptionStore;
  const userDataDir = String(options.userDataDir || '');
  const uiEntryPath = path.resolve(String(options.uiEntryPath || ''));
  const subscriptionEntryPath = path.resolve(String(options.subscriptionEntryPath || ''));
  const pathModule = options.pathModule || path;
  const fileURLToPathFn = options.fileURLToPath || fileURLToPath;
  const platform = options.platform || process.platform;

  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required');
  if (!BrowserWindow || typeof BrowserWindow.fromWebContents !== 'function') throw new TypeError('BrowserWindow is required');
  if (!shell || typeof shell.openExternal !== 'function') throw new TypeError('shell.openExternal is required');
  if (!safeStorage) throw new TypeError('safeStorage is required');
  if (typeof createSubscriptionStore !== 'function') throw new TypeError('createSubscriptionStore is required');
  if (!userDataDir) throw new TypeError('userDataDir is required');

  const comparable = value => platform === 'win32' ? value.toLowerCase() : value;
  const allowedPaths = new Set([uiEntryPath, subscriptionEntryPath].map(value => comparable(pathModule.resolve(value))));

  function assertTrustedSender(event) {
    const sender = event?.sender;
    const owner = sender ? BrowserWindow.fromWebContents(sender) : null;
    if (!owner) throw new Error('ACCOUNT_CENTER_OWNER_INVALID');
    let senderPath = '';
    try {
      const url = String(sender.getURL?.() || '');
      if (!url.startsWith('file:')) throw new Error('not-file');
      senderPath = comparable(pathModule.resolve(fileURLToPathFn(url)));
    } catch {
      throw new Error('ACCOUNT_CENTER_OWNER_INVALID');
    }
    if (!allowedPaths.has(senderPath)) throw new Error('ACCOUNT_CENTER_OWNER_INVALID');
  }

  function freshStore() {
    const store = createSubscriptionStore({ userDataDir });
    store._injectCrypto({
      encrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
        return safeStorage.encryptString(String(value)).toString('base64');
      },
      decrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('SECURE_STORAGE_UNAVAILABLE');
        return safeStorage.decryptString(Buffer.from(String(value), 'base64'));
      },
    });
    return store;
  }

  ipcMain.handle(CHANNELS.myOrders, async (event) => {
    assertTrustedSender(event);
    return freshStore().myOrders();
  });

  ipcMain.handle(CHANNELS.openPasswordReset, async (event) => {
    assertTrustedSender(event);
    await shell.openExternal(PASSWORD_RESET_URL);
    return { ok: true };
  });

  return Object.freeze({ channels: CHANNELS, passwordResetUrl: PASSWORD_RESET_URL });
}

module.exports = { CHANNELS, PASSWORD_RESET_URL, installAccountCenterBoundary };
