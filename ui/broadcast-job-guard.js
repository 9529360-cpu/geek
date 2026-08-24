(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastJobGuard = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  let installed = false;

  function activeAccountId() {
    return document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
  }

  function failureMessages(job) {
    return Array.isArray(job?.failed)
      ? job.failed.map(item => String(item?.message || item?.reason || '')).filter(Boolean)
      : [];
  }

  function renderHardFailure(manager) {
    const bar = document.getElementById('broadcast-job-bar');
    if (!bar) return;
    const job = manager.getCurrent(activeAccountId());
    const messages = job?.state === 'failed' ? failureMessages(job) : [];
    bar.dataset.hardFailure = messages.length ? '1' : '';
    let detail = bar.querySelector('.bc-job-hard-failure');
    if (!messages.length) {
      detail?.remove();
      return;
    }
    if (!detail) {
      detail = document.createElement('div');
      detail.className = 'bc-job-hard-failure';
      const meta = bar.querySelector('.bc-job-meta');
      meta?.insertAdjacentElement('afterend', detail);
    }
    detail.textContent = messages[0];
  }

  function cancelJobTimers(job) {
    if (!job?.id || !job?.accountId) return;
    const scheduler = window.GeekBroadcastRuntimeInstance?.scheduler;
    if (!scheduler || typeof scheduler.cancel !== 'function') return;
    scheduler.cancel(job.accountId, `timer-${job.id}`);
    scheduler.cancel(job.accountId, `persisted-${job.id}`);
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    const manager = window.GeekBroadcastJobs;
    if (!manager) return;
    installed = true;

    const style = document.createElement('style');
    style.id = 'broadcast-job-guard-style';
    style.textContent = '.bc-job-hard-failure{margin:4px 0 0 15px;color:#ff9b91;font-size:10.5px;line-height:1.35;word-break:break-word}#broadcast-job-bar[data-hard-failure="1"] [data-act="failures"]{display:inline-flex!important}';
    document.head.appendChild(style);

    document.addEventListener('click', event => {
      const open = event.target?.closest?.('#bc-menu-send');
      if (!open) return;
      const accountId = activeAccountId();
      if (!accountId || !manager.hasActive(accountId)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById('broadcast-overlay')?.classList.add('hidden');
      const bar = document.getElementById('broadcast-job-bar');
      bar?.classList.remove('hidden');
      renderHardFailure(manager);
    }, true);

    manager.subscribe(event => {
      if (event?.job && TERMINAL.has(event.job.state)) cancelJobTimers(event.job);
      queueMicrotask(() => renderHardFailure(manager));
    });
    document.addEventListener('click', () => queueMicrotask(() => renderHardFailure(manager)), true);
    renderHardFailure(manager);
  }

  return Object.freeze({ install, failureMessages });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastJobGuard.install(), { once: true });
  else window.GeekBroadcastJobGuard.install();
}
