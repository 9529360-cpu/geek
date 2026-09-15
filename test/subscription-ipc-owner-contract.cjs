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
  const lease = Object.freeze({ token: 'must-never-cross-ipc', generation: 1, signal: null });
  const store = {
    getState: async () => { calls.push(['getState']); return { loggedIn: true }; },
    refresh: async () => { calls.push(['refresh']); return { refreshed: true }; },
    login: async (...args) => { calls.push(['login', ...args]); return { ok: true }; },
    register: async (...args) => { calls.push(['register', ...args]); return { ok: true }; },
    createOrder: async (...args) => { calls.push(['createOrder', ...args]); return { ok: true }; },
    myOrders: async () => {
      calls.push(['myOrders']);
      return { orders: [
        { id: 7, status: 'paid', amount: 25, tx_id: 'must-not-cross-ipc' },
        { id: 8, status: 'unexpected_future_state', amount: 48 },
      ] };
    },
    getQuota: async (...args) => { calls.push(['getQuota', ...args]); return { remaining_chars: 1 }; },
    getTranslationAuthorization: async () => {
      calls.push(['getTranslationAuthorization']);
      return lease;
    },
    assertTranslationAuthorizationCurrent: (candidate) => {
      calls.push(['assertTranslationAuthorizationCurrent']);
      assert.equal(candidate, lease, 'readiness must validate the exact authorization lease returned by Subscription owner');
    },
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
    'subscription:get-order-status',
    'subscription:get-quota',
    'subscription:translation-readiness',
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
    const paid = await handlers.get('subscription:get-order-status')({}, 7);
    const unknown = await handlers.get('subscription:get-order-status')({}, 8);
    const missing = await handlers.get('subscription:get-order-status')({}, 999);
    await handlers.get('subscription:get-quota')({}, 1);
    const readiness = await handlers.get('subscription:translation-readiness')({});
    await handlers.get('subscription:logout')({});
    await handlers.get('subscription:enter-app')({});
    await handlers.get('subscription:close-window')({});

    assert.deepEqual(paid, { id: 7, status: 'paid' }, 'order status IPC must expose only minimal current-order state');
    assert.deepEqual(unknown, { id: 8, status: 'unknown' }, 'unexpected server order states must fail closed');
    assert.deepEqual(missing, { id: 999, status: 'missing' }, 'missing order must not be inferred from account state');
    assert.equal(Object.hasOwn(paid, 'amount'), false, 'payment metadata must not cross the renderer boundary');
    assert.equal(Object.hasOwn(paid, 'tx_id'), false, 'transaction metadata must not cross the renderer boundary');
    assert.deepEqual(readiness, { ready: true, reason: 'ready', retryable: false, quota: 'unknown' });
    for (const forbidden of ['token', 'generation', 'signal']) {
      assert.equal(Object.hasOwn(readiness, forbidden), false, `${forbidden} must never cross readiness IPC`);
    }
    await assert.rejects(handlers.get('subscription:get-order-status')({}, 0), /invalid_order_id/);
    await assert.rejects(handlers.get('subscription:get-order-status')({}, Number.MAX_SAFE_INTEGER + 1), /invalid_order_id/);

    assert.deepEqual(calls, [
      ['getState'],
      ['refresh'],
      ['login', '123', ''],
      ['register', 'a@example.test', '456'],
      ['createOrder', ''],
      ['myOrders'],
      ['myOrders'],
      ['myOrders'],
      ['getQuota', false],
      ['getState'],
      ['getTranslationAuthorization'],
      ['assertTranslationAuthorizationCurrent'],
      ['getState'],
      ['assertTranslationAuthorizationCurrent'],
      ['assertTranslationAuthorizationCurrent'],
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
