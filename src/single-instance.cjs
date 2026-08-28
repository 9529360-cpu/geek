'use strict';

function focusPrimaryWindow(BrowserWindow) {
  const windows = typeof BrowserWindow?.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : [];
  const win = windows.find(candidate => candidate && !(typeof candidate.isDestroyed === 'function' && candidate.isDestroyed()));
  if (!win) return false;
  try { if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore(); } catch {}
  try { win.show?.(); } catch {}
  try { win.focus?.(); } catch {}
  return true;
}

function installSingleInstanceGuard({ app, BrowserWindow }) {
  if (!app || typeof app.requestSingleInstanceLock !== 'function') throw new TypeError('app.requestSingleInstanceLock is required');
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) {
    if (typeof app.exit === 'function') app.exit(0);
    else app.quit?.();
    return false;
  }
  app.on?.('second-instance', () => { focusPrimaryWindow(BrowserWindow); });
  return true;
}

module.exports = { focusPrimaryWindow, installSingleInstanceGuard };
