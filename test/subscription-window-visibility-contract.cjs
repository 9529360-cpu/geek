'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { installSubscriptionWindowVisibilityRecovery } = require('../src/subscription-window-visibility.cjs');

const updater = fs.readFileSync(path.join(__dirname, '..', 'src', 'updater.cjs'), 'utf8');
assert.match(updater, /installSubscriptionWindowVisibilityRecovery\(\{ app \}\)/,
  '主进程启动阶段必须安装登录窗口恢复器');

class FakeWebContents extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
  }
  getURL() { return this.url; }
}

class FakeWindow extends EventEmitter {
  constructor(url) {
    super();
    this.webContents = new FakeWebContents(url);
    this.shown = 0;
    this.focused = 0;
    this.restored = 0;
    this.destroyed = false;
    this.minimized = false;
  }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  restore() { this.restored += 1; this.minimized = false; }
  show() { this.shown += 1; }
  focus() { this.focused += 1; }
}

(async () => {
  const app = new EventEmitter();
  installSubscriptionWindowVisibilityRecovery({ app, delayMs: 20, logger: { error() {} } });

  const subscription = new FakeWindow('file:///C:/app/ui/subscription.html');
  app.emit('browser-window-created', {}, subscription);
  subscription.webContents.emit('did-finish-load');
  assert.equal(subscription.shown, 1, '登录窗口加载完成后应主动显示');
  assert.equal(subscription.focused, 1, '登录窗口加载完成后应获得焦点');

  const main = new FakeWindow('file:///C:/app/ui/index.html');
  app.emit('browser-window-created', {}, main);
  main.webContents.emit('did-finish-load');
  assert.equal(main.shown, 0, '普通主窗口不应被恢复器额外显示');

  const failedSubscription = new FakeWindow('about:blank');
  app.emit('browser-window-created', {}, failedSubscription);
  failedSubscription.webContents.emit(
    'did-fail-load',
    {},
    -105,
    'NAME_NOT_RESOLVED',
    'file:///C:/app/ui/subscription.html?startup=1',
    true,
  );
  assert.equal(failedSubscription.shown, 1, '主框架登录页加载失败时应使用 validatedURL 恢复窗口可见性');
  assert.equal(failedSubscription.focused, 1, '加载失败后的登录窗口应获得焦点');
  failedSubscription.webContents.url = 'file:///C:/app/ui/subscription.html';
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(failedSubscription.shown, 1, '加载失败恢复成功后必须取消超时 watchdog，避免重复显示');

  const unrelatedFailure = new FakeWindow('about:blank');
  app.emit('browser-window-created', {}, unrelatedFailure);
  unrelatedFailure.webContents.emit(
    'did-fail-load',
    {},
    -105,
    'NAME_NOT_RESOLVED',
    'file:///C:/app/ui/index.html',
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(unrelatedFailure.shown, 0, '非登录页主框架加载失败不得被恢复器显示');

  const subframeFailure = new FakeWindow('about:blank');
  app.emit('browser-window-created', {}, subframeFailure);
  subframeFailure.webContents.emit(
    'did-fail-load',
    {},
    -105,
    'NAME_NOT_RESOLVED',
    'file:///C:/app/ui/subscription.html',
    false,
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(subframeFailure.shown, 0, '子框架失败不得获得登录窗口恢复权限');

  const watchdog = new FakeWindow('file:///C:/app/ui/subscription.html?test=1');
  watchdog.minimized = true;
  app.emit('browser-window-created', {}, watchdog);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(watchdog.shown, 1, 'ready-to-show 异常时超时兜底仍应显示登录窗口');
  assert.equal(watchdog.restored, 1, '最小化登录窗口应先恢复');

  console.log('SUBSCRIPTION_WINDOW_VISIBILITY_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
