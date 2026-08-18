'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'src', 'main.cjs');
let source = fs.readFileSync(mainPath, 'utf8');

function replaceOnce(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`找不到补丁锚点: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`补丁锚点不唯一: ${label}`);
  source = source.slice(0, first) + to + source.slice(first + from.length);
}

replaceOnce(
`  subscriptionWindow.once('ready-to-show', () => subscriptionWindow.show());
  subscriptionWindow.on('closed', () => { subscriptionWindow = null; });
  subscriptionWindow.loadFile(path.join(__dirname, '../ui/subscription.html'));
  return subscriptionWindow;`,
`  let subscriptionShown = false;
  const showSubscriptionWindow = () => {
    if (!subscriptionWindow || subscriptionWindow.isDestroyed()) return;
    subscriptionShown = true;
    if (subscriptionWindow.isMinimized()) subscriptionWindow.restore();
    subscriptionWindow.show();
    subscriptionWindow.focus();
  };
  subscriptionWindow.once('ready-to-show', showSubscriptionWindow);
  subscriptionWindow.webContents.once('did-finish-load', showSubscriptionWindow);
  subscriptionWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error('[subscription] 登录窗口加载失败:', errorCode, errorDescription, String(validatedURL || '').slice(0, 200));
    showSubscriptionWindow();
  });
  const visibilityWatchdog = setTimeout(() => {
    if (!subscriptionShown) showSubscriptionWindow();
  }, 1500);
  visibilityWatchdog.unref?.();
  subscriptionWindow.on('closed', () => {
    clearTimeout(visibilityWatchdog);
    subscriptionWindow = null;
  });
  subscriptionWindow.loadFile(path.join(__dirname, '../ui/subscription.html')).catch((error) => {
    console.error('[subscription] 登录窗口页面加载失败:', error.message);
    showSubscriptionWindow();
  });
  return subscriptionWindow;`,
  'subscription window visibility recovery'
);

replaceOnce(
`    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        showMainWindow();
      }
    });`,
`    tray.on('click', () => {
      const target = mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : (subscriptionWindow && !subscriptionWindow.isDestroyed() ? subscriptionWindow : null);
      if (!target) return;
      if (target.isVisible()) {
        target.hide();
      } else {
        showMainWindow();
      }
    });`,
  'tray fallback to subscription window'
);

replaceOnce(
`function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}`,
`function showMainWindow() {
  const target = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : (subscriptionWindow && !subscriptionWindow.isDestroyed() ? subscriptionWindow : null);
  if (!target) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}`,
  'showMainWindow fallback'
);

fs.writeFileSync(mainPath, source, 'utf8');

const testPath = path.join(root, 'test', 'window-visibility-contract.cjs');
fs.writeFileSync(testPath, `'use strict';\n\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nconst source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');\n\nassert.match(source, /subscriptionWindow\\.webContents\\.once\\('did-finish-load', showSubscriptionWindow\\)/, '登录窗口应在页面加载完成时主动显示');\nassert.match(source, /visibilityWatchdog = setTimeout[\\s\\S]*?showSubscriptionWindow\\(\\)[\\s\\S]*?1500/, '登录窗口应有显示超时兜底');\nassert.match(source, /登录窗口加载失败:[\\s\\S]*?showSubscriptionWindow\\(\\)/, '登录窗口加载失败时也应显示窗口供诊断');\nassert.match(source, /const target = mainWindow && !mainWindow\\.isDestroyed\\(\\)[\\s\\S]*?subscriptionWindow && !subscriptionWindow\\.isDestroyed\\(\\)/, '托盘恢复应回退到登录窗口');\nassert.match(source, /function showMainWindow\\(\\)[\\s\\S]*?subscriptionWindow[\\s\\S]*?target\\.show\\(\\)/, '显示窗口函数应支持登录窗口');\n\nconsole.log('WINDOW_VISIBILITY_CONTRACT_OK');\n`, 'utf8');

console.log('WINDOW_VISIBILITY_FIX_APPLIED');
