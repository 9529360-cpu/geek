'use strict';

const assert = require('node:assert/strict');
const {
  CHANNEL,
  WHATSAPP_ORIGIN,
  WHATSAPP_URL,
  SAFE_STORAGES,
  createWhatsappRuntimeRecovery,
} = require('../src/whatsapp-runtime-recovery.cjs');

function fakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) { handlers.set(channel, fn); },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

(async () => {
  const calls = [];
  const ipcMain = fakeIpc();
  const session = {
    async clearStorageData(options) { calls.push(['clearStorageData', options]); },
    async clearCache() { calls.push(['clearCache']); },
    async clearCodeCaches(options) { calls.push(['clearCodeCaches', options]); },
    async clearHostResolverCache() { calls.push(['clearHostResolverCache']); },
    async flushStorageData() { calls.push(['flushStorageData']); },
  };
  const accountState = {
    getSnapshot() {
      return {
        accounts: [
          { id: 'wa-a', type: 'whatsapp', partition: 'persist:webview-page-wa-a' },
          { id: 'tg-a', type: 'telegram-z', partition: 'persist:webview-page-tg-a' },
          { id: 'forged', type: 'whatsapp', partition: 'persist:other' },
        ],
      };
    },
  };
  let trusted = 0;
  const api = createWhatsappRuntimeRecovery({
    ipcMain,
    assertTrustedSender() { trusted += 1; },
    accountState,
    getSessionForPartition(partition) {
      calls.push(['session', partition]);
      return session;
    },
  }).install();

  assert.equal(ipcMain.handlers.has(CHANNEL), true);
  const result = await ipcMain.handlers.get(CHANNEL)({}, 'wa-a');
  assert.deepEqual(result, { ok: true });
  assert.equal(trusted, 1);
  assert.deepEqual(calls[0], ['session', 'persist:webview-page-wa-a']);
  assert.deepEqual(calls[1], ['clearStorageData', {
    origin: WHATSAPP_ORIGIN,
    storages: [...SAFE_STORAGES],
  }]);
  assert.deepEqual(calls[2], ['clearCache']);
  assert.deepEqual(calls[3], ['clearCodeCaches', { urls: [WHATSAPP_URL] }]);
  assert.deepEqual(calls[4], ['clearHostResolverCache']);
  assert.deepEqual(calls[5], ['flushStorageData']);

  const serialized = JSON.stringify(calls);
  for (const forbidden of ['cookies', 'localstorage', 'indexdb', 'indexeddb']) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, forbidden + ' must not be cleared');
  }

  await assert.rejects(() => ipcMain.handlers.get(CHANNEL)({}, 'tg-a'), /WHATSAPP_ACCOUNT_REQUIRED/);
  await assert.rejects(() => ipcMain.handlers.get(CHANNEL)({}, 'forged'), /WHATSAPP_PARTITION_MISMATCH/);
  await assert.rejects(() => ipcMain.handlers.get(CHANNEL)({}, '../bad'), /INVALID_ACCOUNT_ID/);

  api.dispose();
  assert.equal(ipcMain.handlers.has(CHANNEL), false);

  console.log('WHATSAPP_RUNTIME_RECOVERY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
