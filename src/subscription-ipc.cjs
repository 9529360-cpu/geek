'use strict';

const SUBSCRIPTION_CHANNELS = Object.freeze([
  'subscription:get-state',
  'subscription:refresh',
  'subscription:login',
  'subscription:register',
  'subscription:create-order',
  'subscription:get-quota',
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

  function install() {
    if (installed) return;
    installed = true;

    register('subscription:get-state', () => getStore().getState());
    register('subscription:refresh', () => getStore().refresh());
    register('subscription:login', (email, password) => getStore().login(String(email || ''), String(password || '')));
    register('subscription:register', (email, password) => getStore().register(String(email || ''), String(password || '')));
    register('subscription:create-order', plan => getStore().createOrder(String(plan || '')));
    register('subscription:get-quota', force => getStore().getQuota(force === true));
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
