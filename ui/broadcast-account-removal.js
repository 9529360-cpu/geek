(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastAccountRemoval = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  let installed = false;
  let removalInFlight = false;

  function liveJobsForAccount(manager, accountId) {
    if (!manager || typeof manager.list !== 'function') return [];
    return manager.list(accountId).filter(job => job && !TERMINAL.has(job.state));
  }

  function waitForAccountTerminal(manager, accountId, options = {}) {
    if (!manager || !liveJobsForAccount(manager, accountId).length) return Promise.resolve(true);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000);
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    return new Promise((resolve, reject) => {
      let done = false;
      let unsubscribe = null;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimer(timer);
        try { unsubscribe?.(); } catch (_) {}
        if (error) reject(error); else resolve(true);
      };
      const check = () => {
        if (!liveJobsForAccount(manager, accountId).length) finish();
      };
      const timer = setTimer(() => {
        const error = new Error('群发任务未能安全停止，账号删除已取消。请稍后重试。');
        error.code = 'BROADCAST_ACCOUNT_REMOVE_STOP_TIMEOUT';
        finish(error);
      }, timeoutMs);
      unsubscribe = manager.subscribe(check);
      check();
    });
  }

  async function beforeAccountRemoval(accountId, options = {}) {
    const id = String(accountId || '');
    if (!id) throw new TypeError('accountId is required');
    const manager = options.manager || (typeof window !== 'undefined' ? window.GeekBroadcastJobs : null);
    if (!manager) return true;

    // Snapshot first; invoke by immutable jobId so switching the viewed account cannot
    // redirect the shutdown. Pending Jobs reuse #202's awaited durable-cancel control;
    // executing Jobs request stop and are then awaited to a terminal state.
    for (const job of liveJobsForAccount(manager, id)) {
      await manager.invoke(job.id, 'stop');
    }
    await waitForAccountTerminal(manager, id, options);
    return true;
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('click', event => {
      const item = event.target?.closest?.('#ctx-menu .ctx-item[data-act="delete"]');
      if (!item) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (removalInFlight) return;

      const menu = document.getElementById('ctx-menu');
      const accountId = String(menu?.dataset?.accountId || '');
      menu?.classList.add('hidden');
      if (!accountId) return;
      if (!confirm('删除账号将清除该账号的登录数据，确定？')) return;

      removalInFlight = true;
      item.setAttribute('aria-busy', 'true');
      void beforeAccountRemoval(accountId).then(async () => {
        // Main-process account-data boundary cleans durable scheduled attachment refs
        // before the existing accounts:remove handler may remove the account/partition.
        await window.api.accounts.remove(accountId);
        // app.js owns account/webview closure state. Reload only after backend deletion
        // succeeds so the UI is rebuilt from truth; on any failure it stays untouched.
        window.location.reload();
      }).catch(error => {
        alert(String(error?.message || error || '账号删除失败'));
      }).finally(() => {
        removalInFlight = false;
        item.removeAttribute('aria-busy');
      });
    }, true);
  }

  return Object.freeze({ liveJobsForAccount, waitForAccountTerminal, beforeAccountRemoval, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastAccountRemoval.install(), { once: true });
  else window.GeekBroadcastAccountRemoval.install();
}
