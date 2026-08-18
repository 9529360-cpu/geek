'use strict';

function installSubscriptionWindowVisibilityRecovery({ app, delayMs = 1500, logger = console } = {}) {
  if (!app || typeof app.on !== 'function') throw new Error('app event source is required');

  app.on('browser-window-created', (_event, win) => {
    if (!win || !win.webContents) return;

    let timer = null;
    let closed = false;

    const clearWatchdog = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const isSubscriptionWindow = () => {
      const url = String(win.webContents.getURL?.() || '').replace(/\\/g, '/');
      return /\/subscription\.html(?:[?#]|$)/i.test(url);
    };

    const showIfSubscription = () => {
      try {
        if (closed || win.isDestroyed?.() || !isSubscriptionWindow()) return false;
        if (win.isMinimized?.()) win.restore?.();
        win.show?.();
        win.focus?.();
        clearWatchdog();
        return true;
      } catch (error) {
        logger?.error?.('[window] 登录窗口恢复失败:', error?.message || error);
        return false;
      }
    };

    win.webContents.once?.('did-finish-load', showIfSubscription);
    win.webContents.on?.('did-fail-load', (_loadEvent, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      logger?.error?.('[window] 登录窗口页面加载失败:', errorCode, errorDescription);
      showIfSubscription();
    });

    timer = setTimeout(showIfSubscription, Math.max(0, Number(delayMs) || 0));
    timer.unref?.();
    win.once?.('closed', () => {
      closed = true;
      clearWatchdog();
    });
  });
}

module.exports = { installSubscriptionWindowVisibilityRecovery };
