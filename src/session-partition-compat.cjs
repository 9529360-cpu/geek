'use strict';

const ACCOUNT_PARTITION_LEAF = /^webview-page-[A-Za-z0-9_-]{1,100}$/;

function resolvePersistPartition(sessionValue) {
  if (!sessionValue) return '';
  let storagePath = '';
  if (typeof sessionValue.storagePath === 'string') {
    storagePath = sessionValue.storagePath;
  } else if (typeof sessionValue.getStoragePath === 'function') {
    try { storagePath = sessionValue.getStoragePath() || ''; } catch { storagePath = ''; }
  }
  if (!storagePath) return '';
  const leaf = String(storagePath).split(/[\\/]/).filter(Boolean).pop() || '';
  return ACCOUNT_PARTITION_LEAF.test(leaf) ? `persist:${leaf}` : '';
}

function installSessionPartitionCompat({ app, sessionModule } = {}) {
  if (!app || typeof app.whenReady !== 'function') throw new TypeError('app.whenReady is required');
  if (!sessionModule) throw new TypeError('sessionModule is required');

  let installed = false;
  let installError = null;
  const ready = app.whenReady().then(() => {
    const sample = sessionModule.defaultSession;
    if (!sample) throw new Error('SESSION_PARTITION_COMPAT_NO_SESSION');
    const proto = Object.getPrototypeOf(sample);
    if (!proto) throw new Error('SESSION_PARTITION_COMPAT_NO_PROTOTYPE');

    // Never override a native/future Electron implementation.
    if ('partition' in sample || Object.getOwnPropertyDescriptor(proto, 'partition')) return false;

    Object.defineProperty(proto, 'partition', {
      configurable: true,
      enumerable: false,
      get() {
        return resolvePersistPartition(this);
      },
    });
    installed = true;
    return true;
  }).catch((error) => {
    installError = error;
    throw error;
  });

  return Object.freeze({
    ready,
    isInstalled: () => installed,
    getInstallError: () => installError,
  });
}

module.exports = {
  resolvePersistPartition,
  installSessionPartitionCompat,
};
