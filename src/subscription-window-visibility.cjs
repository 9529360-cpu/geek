'use strict';

function installSubscriptionWindowVisibilityRecovery(win, { delayMs = 1500, logger = console } = {}) {
  if (!win || !win.webContents) throw new Error('subscription window is required');

  let timer = null;
  let closed = false;

  const clearWatchdog = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const show = () => {
    try {
      if (closed || win.isDestroyed?.()) return false;
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

  win.webContents.once?.('did-finish-load', show);
  win.webContents.on?.('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    logger?.error?.('[window] 登录窗口页面加载失败:', errorCode, errorDescription);
    show();
  });

  timer = setTimeout(show, Math.max(0, Number(delayMs) || 0));
  timer.unref?.();

  win.once?.('closed', () => {
    closed = true;
    clearWatchdog();
  });

  return { show, clearWatchdog };
}

module.exports = { installSubscriptionWindowVisibilityRecovery };
