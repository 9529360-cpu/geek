'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  CHANNELS,
  PASSWORD_RESET_URL,
  installAccountCenterBoundary,
} = require('../src/account-center-boundary.cjs');

(async () => {
  const handlers = new Map();
  const opened = [];
  const calls = [];
  const uiEntryPath = path.resolve('/app/ui/index.html');
  const subscriptionEntryPath = path.resolve('/app/ui/subscription.html');
  const sender = { getURL: () => pathToFileURL(uiEntryPath).href };
  const subscriptionSender = { getURL: () => pathToFileURL(subscriptionEntryPath).href };
  const foreignSender = { getURL: () => 'https://example.com/' };
  const owner = {};

  const boundary = installAccountCenterBoundary({
    ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
    BrowserWindow: {
      fromWebContents(value) {
        if (value === sender || value === subscriptionSender || value === foreignSender) return owner;
        return null;
      },
    },
    shell: { async openExternal(url) { opened.push(url); } },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`enc:${value}`),
      decryptString: value => String(value),
    },
    createSubscriptionStore: ({ userDataDir }) => ({
      _injectCrypto(crypto) { calls.push(['crypto', typeof crypto.encrypt, typeof crypto.decrypt]); },
      async myOrders() {
        calls.push(['orders', userDataDir]);
        return { ok: true, orders: [{ id: 9, status: 'pending' }] };
      },
    }),
    userDataDir: path.resolve('/user-data'),
    uiEntryPath,
    subscriptionEntryPath,
  });

  assert.deepEqual(boundary.channels, CHANNELS);
  assert.equal(handlers.size, 2);

  const orders = await handlers.get(CHANNELS.myOrders)({ sender });
  assert.equal(orders.orders[0].id, 9);
  assert.deepEqual(calls[0], ['crypto', 'function', 'function']);
  assert.equal(calls[1][0], 'orders');

  await handlers.get(CHANNELS.openPasswordReset)({ sender: subscriptionSender });
  assert.deepEqual(opened, [PASSWORD_RESET_URL]);
  assert.equal(PASSWORD_RESET_URL, 'https://geek.bbnba.com/forgot-password');

  await assert.rejects(
    handlers.get(CHANNELS.myOrders)({ sender: foreignSender }),
    /ACCOUNT_CENTER_OWNER_INVALID/,
  );
  await assert.rejects(
    handlers.get(CHANNELS.openPasswordReset)({ sender: foreignSender }),
    /ACCOUNT_CENTER_OWNER_INVALID/,
  );

  console.log('ACCOUNT_CENTER_BOUNDARY_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
