'use strict';

const ORDER_STATUSES = new Set(['pending', 'processing', 'paid', 'cancelled', 'expired']);

const SUBSCRIPTION_CHANNELS = Object.freeze([
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

function installSubscriptionIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const isTrustedSender = options.isTrustedSender;
  const getStore = options.getStore;
  const enterApp = options.enterApp;
  const closeWindow = options.closeWindow;

  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('ipcMain handle/removeHandler API is required');
  }
  if (typeof isTrustedSender !== 'function') throw new TypeError('isTrustedSender is required');
  if (typeof getStore !== 'function') throw new TypeError('getStore is required');
  if (typeof enterApp !== 'function') throw new TypeError('enterApp is required');
  if (typeof closeWindow !== 'function') throw new TypeError('closeWindow is required');

  let installed = false;

  function assertTrustedSender(event) {
    if (!isTrustedSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
  }

  function register(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event);
      return handler(...args);
    });
  }

  async function getOrderStatus(orderId) {
    const id = Number(orderId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('invalid_order_id');
    const data = await getStore().myOrders();
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    const order = orders.find((candidate) => Number(candidate?.id) === id);
    if (!order) return { id, status: 'missing' };
    const status = String(order.status || '').toLowerCase();
    return { id, status: ORDER_STATUSES.has(status) ? status : 'unknown' };
  }

  function safeReadinessResult(value = {}) {
    const result = {
      ready: value.ready === true,
      reason: String(value.reason || 'authorization-unavailable').slice(0, 64),
      retryable: value.retryable === true,
      quota: ['positive', 'exhausted', 'unknown'].includes(value.quota) ? value.quota : 'unknown',
    };
    if (Number.isSafeInteger(value.remaining_chars) && value.remaining_chars >= 0) {
      result.remaining_chars = value.remaining_chars;
    }
    return Object.freeze(result);
  }

  function classifyTranslationReadinessError(error) {
    const code = String(error?.code || '');
    const status = Number(error?.status) || 0;
    let reason = 'authorization-unavailable';
    let retryable = true;
    if (code === 'account_disabled') {
      reason = 'account-disabled';
      retryable = false;
    } else if (code === 'SUBSCRIPTION_LOGIN_REQUIRED' || status === 401 || status === 403) {
      reason = 'authorization-required';
      retryable = false;
    } else if (code === 'SUBSCRIPTION_SESSION_CHANGED') {
      reason = 'session-changed';
    } else if (
      code === 'SUBSCRIPTION_TOKEN_DECRYPT_FAILED'
      || code === 'SECURE_STORAGE_UNAVAILABLE'
      || code === 'SUBSCRIPTION_STATE_RECOVERY_REQUIRED'
    ) {
      reason = 'authorization-recovery-required';
      retryable = false;
    } else if (code === 'SUBSCRIPTION_REQUEST_TIMEOUT') {
      reason = 'authorization-unavailable';
    }
    // Once translation authorization fails, the earlier local state snapshot is
    // no longer proven to belong to the current login generation. Never project
    // its cached quota across logout/account-switch/auth races.
    return safeReadinessResult({
      ready: false,
      reason,
      retryable,
      quota: 'unknown',
    });
  }

  async function getTranslationReadiness() {
    const store = getStore();
    let state;
    try {
      state = await store.getState();
    } catch (error) {
      return classifyTranslationReadinessError(error);
    }
    if (!state?.loggedIn) {
      return safeReadinessResult({ ready: false, reason: 'login-required', retryable: false, quota: 'unknown' });
    }

    const rawRemaining = Number(state.remaining_chars);
    const positiveRemaining = Number.isSafeInteger(rawRemaining) && rawRemaining > 0 ? rawRemaining : null;
    const quota = state.valid === false ? 'exhausted' : (positiveRemaining != null ? 'positive' : 'unknown');
    const remainingChars = quota === 'exhausted' ? 0 : positiveRemaining;
    if (quota === 'exhausted') {
      return safeReadinessResult({
        ready: false,
        reason: 'quota-exhausted',
        retryable: false,
        quota,
        remaining_chars: 0,
      });
    }

    try {
      // Exercise the real short-lived translation authorization path in the main
      // process, but never return the token or account identity to the renderer.
      const token = await store.getTranslationToken();
      if (typeof token !== 'string' || !token) {
        return safeReadinessResult({
          ready: false,
          reason: 'authorization-unavailable',
          retryable: true,
          quota: 'unknown',
        });
      }
    } catch (error) {
      return classifyTranslationReadinessError(error);
    }

    return safeReadinessResult({
      ready: true,
      reason: 'ready',
      retryable: false,
      quota,
      remaining_chars: remainingChars,
    });
  }

  function install() {
    if (installed) return;
    installed = true;

    register('subscription:get-state', () => getStore().getState());
    register('subscription:refresh', () => getStore().refresh());
    register('subscription:login', (email, password) => getStore().login(String(email || ''), String(password || '')));
    register('subscription:register', (email, password) => getStore().register(String(email || ''), String(password || '')));
    register('subscription:create-order', plan => getStore().createOrder(String(plan || '')));
    register('subscription:get-order-status', orderId => getOrderStatus(orderId));
    register('subscription:get-quota', force => getStore().getQuota(force === true));
    register('subscription:translation-readiness', () => getTranslationReadiness());
    register('subscription:logout', () => getStore().logout());
    register('subscription:enter-app', () => enterApp());
    register('subscription:close-window', () => closeWindow());
  }

  function dispose() {
    if (!installed) return;
    installed = false;
    for (const channel of SUBSCRIPTION_CHANNELS) ipcMain.removeHandler(channel);
  }

  install();

  return Object.freeze({ dispose });
}

module.exports = {
  SUBSCRIPTION_CHANNELS,
  installSubscriptionIpc,
};