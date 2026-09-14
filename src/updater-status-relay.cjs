'use strict';

function createUpdaterStatusRelay(options = {}) {
  const getWindows = options.getWindows;
  const statusChannel = String(options.statusChannel || '');

  if (typeof getWindows !== 'function') throw new TypeError('getWindows is required');
  if (!statusChannel) throw new TypeError('statusChannel is required');

  let sequence = 0;
  let latestStatus = null;

  function cloneLatest() {
    return latestStatus ? { ...latestStatus } : null;
  }

  function deliver(window, status = latestStatus) {
    if (!status || !window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return false;
    const contents = window.webContents;
    if (!contents || typeof contents.send !== 'function') return false;
    try {
      contents.send(statusChannel, status);
      return true;
    } catch {
      return false;
    }
  }

  function currentWindows() {
    try {
      const windows = getWindows();
      return Array.isArray(windows) ? windows : [];
    } catch {
      return [];
    }
  }

  function publish(payload) {
    if (!payload || typeof payload !== 'object') throw new TypeError('updater status payload is required');
    const phase = String(payload.phase || '').trim();
    if (!phase) throw new TypeError('updater status phase is required');

    // A downloaded package is a pending-install capability, not a transient progress state.
    // Keep it authoritative until installation/process exit; a later downloaded event may
    // replace it (for example with a newer version), but checking/error/etc. must not hide it.
    if (latestStatus?.phase === 'downloaded' && phase !== 'downloaded') return cloneLatest();

    latestStatus = Object.freeze({
      ...payload,
      phase,
      sequence: ++sequence,
    });

    for (const window of currentWindows()) deliver(window, latestStatus);
    return cloneLatest();
  }

  function replayTo(window) {
    return deliver(window, latestStatus);
  }

  function replayAfterLoad(window) {
    if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return false;
    const contents = window.webContents;
    if (!contents || typeof contents.once !== 'function') return false;
    contents.once('did-finish-load', () => {
      replayTo(window);
    });
    return true;
  }

  return Object.freeze({
    publish,
    replayTo,
    replayAfterLoad,
    getLatest: cloneLatest,
  });
}

module.exports = { createUpdaterStatusRelay };
