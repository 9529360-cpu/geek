'use strict';

const assert = require('node:assert/strict');
const { SUBSCRIPTION_CHANNELS, installSubscriptionIpc } = require('../src/subscription-ipc.cjs');

function createHarness({ trusted = true } = {}) {
  const handlers = new Map();
  const removed = [];
  const calls = [];
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `duplicate subscription IPC registration: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  const store = {
    getState: async () => { calls.push(['getState']); return { loggedIn: true }; },
    refresh: async () => { calls.push(['refresh']); return { refreshed: true }; },
    login: async (...args) => { calls.push(['login', ...args]); return { ok: true }; },
    register: async (...args) => { calls.push(['register', ...args]); return { ok: true }; },
    createOrder: async (...args) => { calls.push(['createOrder', ...args]); return { ok: true }; },
    getQuota: async (...args) => { calls.push(['getQuota', ...args]); return { remaining_chars: 1 }; },
    reportUsage: async (...args) => { calls.push(['reportUsage', ...args]); return { ok: true }; },
    logout: async () => { calls.push(['logout']); return { ok: true }; },
  };
  const boundary = installSubscriptionIpc({
    ipcMain,
    isTrustedSender: () => trusted,
    getStore: () => store,
    enterApp: async () => { calls.push(['enterApp']); return { ok: true }; },
    closeWindow: async () => { calls.push(['closeWindow']); return { ok: true }; },
  });
  return { handlers, removed, calls, boundary };
}

(async () => {
  assert.deepEqual([...SUBSCRIPTION_CHANNELS], [
    'subscription:get-state',
    'subscription:refresh',
    'subscription:login',
    'subscription:register',
    'subscription:create-order',
    'subscription:get-quota',
    'subscription:report-usage',
    'subscription:logout',
    'subscription:enter-app',
    'subscription:close-window',
  ]);

  {
    const { handlers, calls, boundary } = createHarness({ trusted: false });
    for (const channel of SUBSCRIPTION_CHANNELS) {
      await assert.rejects(
        handlers.get(channel)({ sender: { id: 99 } }, 'x', 'y'),
        /拒绝来自未授权页面的 IPC 请求/,
        `${channel} must reject an untrusted sender before any side effect`
      );
    }
    assert.deepEqual(calls, [], 'untrusted subscription IPC must not reach store or window callbacks');
    boundary.dispose();
  }

  {
    const { handlers, removed, calls, boundary } = createHarness({ trusted: true });
    await handlers.get('subscription:get-state')({});
    await handlers.get('subscription:refresh')({});
    await handlers.get('subscription:login')({}, 123, null);
    await handlers.get('subscription:register')({}, 'a@example.test', 456);
    await handlers.get('subscription:create-order')({}, null);
    await handlers.get('subscription:get-quota')({}, 1);
    await handlers.get('subscription:report-usage')({}, '42');
    await handlers.get('subscription:logout')({});
    await handlers.get('subscription:enter-app')({});
    await handlers.get('subscription:close-window')({});

    assert.deepEqual(calls, [
      ['getState'],
      ['refresh'],
      ['login', '123', ''],
      ['register', 'a@example.test', '456'],
      ['createOrder', ''],
      ['getQuota', false],
      ['reportUsage', 42],
      ['logout'],
      ['enterApp'],
      ['closeWindow'],
    ]);

    boundary.dispose();
    assert.deepEqual(removed, [...SUBSCRIPTION_CHANNELS]);
    assert.equal(handlers.size, 0, 'dispose must remove every subscription channel');
    boundary.dispose();
    assert.deepEqual(removed, [...SUBSCRIPTION_CHANNELS], 'dispose must be idempotent');
  }

  console.log('SUBSCRIPTION_IPC_OWNER_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
