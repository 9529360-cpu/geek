'use strict';

const fs = require('node:fs');
const file = 'src/main.cjs';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

function replaceOnce(from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(from, to);
}

replaceOnce(
  "const { createSubscriptionStore } = require('./subscription.cjs');\n",
  "const { createSubscriptionStore } = require('./subscription.cjs');\nconst { installSubscriptionIpc } = require('./subscription-ipc.cjs');\n",
  'subscription ipc import'
);

replaceOnce(
  "let subscriptionWindow = null;\nlet subscriptionStore = null;\nlet subscriptionCheckDone = false;\n",
  "let subscriptionWindow = null;\nlet subscriptionStore = null;\nlet subscriptionCheckDone = false;\nlet subscriptionIpcBoundary = null;\n",
  'subscription ipc boundary state'
);

const oldOwner = `function registerSubscriptionIpcHandlers() {
  ipcMain.handle('subscription:get-state', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().getState();
  });
  ipcMain.handle('subscription:refresh', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().refresh();
  });
  ipcMain.handle('subscription:login', async (event, email, password) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().login(String(email || ''), String(password || ''));
  });
  ipcMain.handle('subscription:register', async (event, email, password) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().register(String(email || ''), String(password || ''));
  });
  ipcMain.handle('subscription:create-order', async (event, plan) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().createOrder(String(plan || ''));
  });
  ipcMain.handle('subscription:get-quota', async (event, force) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().getQuota(force === true);
  });
  ipcMain.handle('subscription:report-usage', async (event, chars) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().reportUsage(Number(chars) || 0);
  });
  ipcMain.handle('subscription:logout', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().logout();
  });
  ipcMain.handle('subscription:enter-app', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    if (subscriptionWindow && !subscriptionWindow.isDestroyed()) subscriptionWindow.close();
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    else mainWindow.show();
    return { ok: true };
  });
  ipcMain.handle('subscription:close-window', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    if (subscriptionWindow && !subscriptionWindow.isDestroyed()) subscriptionWindow.close();
    if (!mainWindow || mainWindow.isDestroyed()) { isQuitting = true; app.quit(); }
    return { ok: true };
  });
}

`;
replaceOnce(oldOwner, '', 'legacy subscription ipc owner');

replaceOnce(
  "  registerIpcHandlers();\n  registerSubscriptionIpcHandlers();\n  await enforceSubscriptionGate();\n",
  `  registerIpcHandlers();
  subscriptionIpcBoundary = installSubscriptionIpc({
    ipcMain,
    isTrustedSender: isTrustedSubscriptionSender,
    getStore: initSubscriptionStore,
    enterApp: async () => {
      if (subscriptionWindow && !subscriptionWindow.isDestroyed()) subscriptionWindow.close();
      if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
      else mainWindow.show();
      return { ok: true };
    },
    closeWindow: async () => {
      if (subscriptionWindow && !subscriptionWindow.isDestroyed()) subscriptionWindow.close();
      if (!mainWindow || mainWindow.isDestroyed()) { isQuitting = true; app.quit(); }
      return { ok: true };
    },
  });
  await enforceSubscriptionGate();
`,
  'subscription ipc composition'
);

replaceOnce(
  `  ipcMain.removeHandler('window:relaunch');
  ipcMain.removeHandler('subscription:get-state');
  ipcMain.removeHandler('subscription:refresh');
  ipcMain.removeHandler('subscription:login');
  ipcMain.removeHandler('subscription:register');
  ipcMain.removeHandler('subscription:create-order');
  ipcMain.removeHandler('subscription:logout');
  ipcMain.removeHandler('subscription:enter-app');
  ipcMain.removeHandler('subscription:close-window');
`,
  `  subscriptionIpcBoundary?.dispose();
  subscriptionIpcBoundary = null;
  ipcMain.removeHandler('window:relaunch');
`,
  'subscription ipc teardown'
);

if (/ipcMain\.(?:handle|removeHandler)\('subscription:/.test(source)) {
  throw new Error('main retains direct subscription IPC ownership');
}
if (/registerSubscriptionIpcHandlers/.test(source)) {
  throw new Error('main retains legacy subscription IPC owner');
}

fs.writeFileSync(file, source);
