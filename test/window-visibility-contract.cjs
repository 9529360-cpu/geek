'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installWindowVisibilityRecovery } = require('../src/window-visibility.cjs');

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
  installWindowVisibilityRecovery({ app, BrowserWindow: function BrowserWindow() {}, delayMs: 20, logger: { error() {} } });

  const subscription = new FakeWindow('file:///C:/app/ui/subscription.html');
  app.emit('browser-window-created', {}, subscription);
  subscription.webContents.emit('did-finish-load');
  assert.equal(subscription.shown, 1, '登录窗口加载完成后应主动显示');
  assert.equal(subscription.focused, 1, '登录窗口加载完成后应获得焦点');

  const main = new FakeWindow('file:///C:/app/ui/index.html');
  app.emit('browser-window-created', {}, main);
  main.webContents.emit('did-finish-load');
  assert.equal(main.shown, 0, '普通主窗口不应被恢复器额外显示');

  const watchdog = new FakeWindow('file:///C:/app/ui/subscription.html?test=1');
  watchdog.minimized = true;
  app.emit('browser-window-created', {}, watchdog);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(watchdog.shown, 1, 'ready-to-show 异常时超时兜底仍应显示登录窗口');
  assert.equal(watchdog.restored, 1, '最小化登录窗口应先恢复');

  console.log('WINDOW_VISIBILITY_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
