(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastFileLifecycle = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  const pendingScheduledDrafts = new Map();
  let installed = false;

  function fileTokens(files) {
    return [...new Set((Array.isArray(files) ? files : [])
      .map(file => String(file?.filePath || file?.token || ''))
      .filter(Boolean))];
  }

  function activeAccountId() {
    return document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
  }

  function releaseFiles(files) {
    const tokens = fileTokens(files);
    const release = window.api?.file?.release;
    if (!tokens.length || typeof release !== 'function') return false;
    Promise.resolve(release(tokens)).catch(() => {});
    return true;
  }

  function futureScheduleSelected() {
    const enabled = document.getElementById('broadcast-schedule-toggle')?.checked === true;
    const raw = document.getElementById('broadcast-schedule-time')?.value || '';
    const scheduledAt = raw ? new Date(raw).getTime() : NaN;
    return enabled && Number.isFinite(scheduledAt) && scheduledAt > Date.now();
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    const manager = window.GeekBroadcastJobs;
    if (!manager || typeof manager.subscribe !== 'function') return;
    installed = true;

    manager.subscribe(event => {
      if (!event?.job) return;
      const accountId = String(event.job.accountId || '');
      if (event.type === 'created' && event.job.state === 'scheduled' && pendingScheduledDrafts.has(accountId)) {
        releaseFiles(pendingScheduledDrafts.get(accountId));
        pendingScheduledDrafts.delete(accountId);
      }
      if (!TERMINAL.has(String(event.job.state || ''))) return;
      // Immediate Jobs retain their short capabilities in job.files until terminal.
      // Scheduled Jobs use durable refs and their materialized tokens are owned by
      // the main-process scheduled attachment boundary instead.
      releaseFiles(event.job.files);
    });

    // Register before broadcast-runtime.js. At event time runtime is installed, so
    // this capture listener can snapshot/release capabilities around private draft
    // mutations without exposing canonical paths or mutating runtime state itself.
    document.addEventListener('click', event => {
      const runtime = window.GeekBroadcastRuntimeInstance;
      if (!runtime || typeof runtime.filesFor !== 'function') return;
      const accountId = activeAccountId();
      if (!accountId) return;

      const remove = event.target?.closest?.('[data-runtime-file-index]');
      if (remove) {
        const files = runtime.filesFor(accountId);
        const index = Number(remove.dataset.runtimeFileIndex);
        if (Number.isInteger(index) && index >= 0 && index < files.length) releaseFiles([files[index]]);
        return;
      }

      const open = event.target?.closest?.('#bc-menu-send');
      if (open && !manager.hasActive(accountId)) {
        pendingScheduledDrafts.delete(accountId);
        releaseFiles(runtime.filesFor(accountId));
        return;
      }

      const send = event.target?.closest?.('#broadcast-send');
      if (send && futureScheduleSelected()) pendingScheduledDrafts.set(accountId, runtime.filesFor(accountId));
    }, true);
  }

  return Object.freeze({ install, fileTokens });
});

if (typeof window !== 'undefined') {
  window.GeekBroadcastFileLifecycle.install();
}
