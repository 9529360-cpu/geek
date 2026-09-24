'use strict';

const CHANNEL = 'webview:recover-whatsapp-runtime';
const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';
const WHATSAPP_URL = WHATSAPP_ORIGIN + '/';
const SAFE_STORAGES = Object.freeze(['serviceworkers', 'cachestorage']);

function isWhatsAppAccount(account) {
  return account?.type === 'whatsapp' || account?.type === 'whatsapp-pure';
}

function createWhatsappRuntimeRecovery(options = {}) {
  const ipcMain = options.ipcMain;
  const assertTrustedSender = options.assertTrustedSender;
  const accountState = options.accountState;
  const getSessionForPartition = options.getSessionForPartition;
  const diagnostics = options.diagnostics;
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') throw new TypeError('ipcMain required');
  if (typeof assertTrustedSender !== 'function') throw new TypeError('assertTrustedSender required');
  if (!accountState || typeof accountState.getSnapshot !== 'function') throw new TypeError('accountState required');
  if (typeof getSessionForPartition !== 'function') throw new TypeError('getSessionForPartition required');

  let installed = false;

  async function recover(event, accountId) {
    assertTrustedSender(event);
    const id = String(accountId || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('INVALID_ACCOUNT_ID');

    const account = accountState.getSnapshot().accounts.find(item => item.id === id);
    if (!account || !isWhatsAppAccount(account)) throw new Error('WHATSAPP_ACCOUNT_REQUIRED');
    const expectedPartition = `persist:webview-page-${id}`;
    if (account.partition !== expectedPartition) throw new Error('WHATSAPP_PARTITION_MISMATCH');

    const ses = getSessionForPartition(account.partition);
    if (!ses) throw new Error('WHATSAPP_SESSION_MISSING');

    // Repair only the web-app delivery layer. Cookies, localStorage and IndexedDB
    // carry the linked-device identity and must remain untouched.
    await ses.clearStorageData({
      origin: WHATSAPP_ORIGIN,
      storages: [...SAFE_STORAGES],
    });
    await ses.clearCache();
    if (typeof ses.clearCodeCaches === 'function') {
      await ses.clearCodeCaches({ urls: [WHATSAPP_URL] });
    }
    if (typeof ses.clearHostResolverCache === 'function') {
      await ses.clearHostResolverCache();
    }
    if (typeof ses.flushStorageData === 'function') {
      await ses.flushStorageData();
    }

    diagnostics?.log?.('whatsapp-runtime-recovered', {
      accountId: id,
      serviceWorker: true,
      cacheStorage: true,
      httpCache: true,
      codeCache: typeof ses.clearCodeCaches === 'function',
    });
    return Object.freeze({ ok: true });
  }

  function install() {
    if (installed) throw new Error('whatsapp runtime recovery already installed');
    ipcMain.handle(CHANNEL, recover);
    installed = true;
    return api;
  }

  function dispose() {
    if (!installed) return;
    ipcMain.removeHandler(CHANNEL);
    installed = false;
  }

  const api = Object.freeze({ install, dispose, recover });
  return api;
}

module.exports = {
  CHANNEL,
  WHATSAPP_ORIGIN,
  WHATSAPP_URL,
  SAFE_STORAGES,
  isWhatsAppAccount,
  createWhatsappRuntimeRecovery,
};
