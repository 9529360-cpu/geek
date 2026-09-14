(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastAccountRemoval = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  let installed = false;
  let removalInFlight = false;
  let dialogAccountId = '';
  let dialogReturnAccountId = '';

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

  function accountRow(accountId, doc = document) {
    return [...doc.querySelectorAll('.nav-account[data-id]')]
      .find(row => String(row.dataset.id || '') === String(accountId || '')) || null;
  }

  function accountName(accountId, doc = document) {
    return String(accountRow(accountId, doc)?.querySelector('.nav-account-name')?.textContent || '当前账号').trim() || '当前账号';
  }

  function restoreAccountFocus(accountId, doc = document) {
    const row = accountRow(accountId, doc);
    const more = row?.querySelector('.shell-account-menu-button');
    const main = row?.querySelector('.nav-account-main');
    const target = more && more.offsetParent !== null ? more : main;
    target?.focus?.({ preventScroll: true });
    return !!target;
  }

  function injectDialogStyles(doc = document) {
    if (doc.getElementById('account-remove-confirm-style')) return;
    const style = doc.createElement('style');
    style.id = 'account-remove-confirm-style';
    style.textContent = `
      .account-remove-confirm-overlay{position:fixed;inset:0;z-index:420;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.56);backdrop-filter:blur(5px)}
      .account-remove-confirm-overlay.hidden{display:none}
      .account-remove-confirm{width:min(430px,calc(100vw - 32px));padding:20px;border:1px solid var(--border-standard);border-radius:14px;background:var(--bg-surface);box-shadow:0 28px 90px rgba(0,0,0,.48);color:var(--text-primary)}
      .account-remove-confirm__icon{display:grid;place-items:center;width:42px;height:42px;margin-bottom:13px;border-radius:12px;background:color-mix(in srgb,#e5484d 14%,transparent);color:#ff6b70;font-size:20px;font-weight:800}
      .account-remove-confirm h2{margin:0;font-size:16px;line-height:1.35}.account-remove-confirm p{margin:8px 0 0;color:var(--text-secondary);font-size:12px;line-height:1.65}.account-remove-confirm strong{color:var(--text-primary)}
      .account-remove-confirm__warning{margin-top:12px;padding:9px 10px;border:1px solid color-mix(in srgb,#e5484d 26%,var(--border-standard));border-radius:9px;background:color-mix(in srgb,#e5484d 8%,var(--bg-elevated));color:var(--text-secondary);font-size:11px;line-height:1.55}
      .account-remove-confirm__status{min-height:18px;margin-top:10px;color:var(--text-tertiary);font-size:11px;line-height:1.45}.account-remove-confirm__status[data-state="error"]{color:#ff8f8f}
      .account-remove-confirm__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.account-remove-confirm__actions button{height:34px;padding:0 14px;border:1px solid var(--border-standard);border-radius:8px;background:var(--bg-elevated);color:var(--text-primary);font:inherit;font-size:12px;cursor:pointer}.account-remove-confirm__actions button:hover{background:var(--bg-hover)}
      .account-remove-confirm__actions .danger{border-color:color-mix(in srgb,#e5484d 50%,var(--border-standard));background:#c93f44;color:#fff}.account-remove-confirm__actions .danger:hover{background:#b7373c}.account-remove-confirm__actions button:disabled{cursor:wait;opacity:.56}
      .account-remove-confirm__actions button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
      @media (prefers-reduced-motion:reduce){.account-remove-confirm-overlay,.account-remove-confirm{animation:none!important;transition:none!important}}
    `;
    doc.head.appendChild(style);
  }

  function ensureDialog(doc = document) {
    let overlay = doc.getElementById('account-remove-confirm-overlay');
    if (overlay) return overlay;
    injectDialogStyles(doc);
    overlay = doc.createElement('div');
    overlay.id = 'account-remove-confirm-overlay';
    overlay.className = 'account-remove-confirm-overlay hidden';
    overlay.innerHTML = `
      <section class="account-remove-confirm" role="alertdialog" aria-modal="true" aria-labelledby="account-remove-confirm-title" aria-describedby="account-remove-confirm-description account-remove-confirm-warning">
        <div class="account-remove-confirm__icon" aria-hidden="true">!</div>
        <h2 id="account-remove-confirm-title">删除账号？</h2>
        <p id="account-remove-confirm-description">将清除 <strong id="account-remove-confirm-name">当前账号</strong> 的本机登录数据和账号配置。</p>
        <div id="account-remove-confirm-warning" class="account-remove-confirm__warning">如果该账号有正在执行或等待中的群发任务，极客会先安全停止这些任务，再执行删除。此操作完成后不可撤销。</div>
        <div id="account-remove-confirm-status" class="account-remove-confirm__status" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="account-remove-confirm__actions">
          <button type="button" id="account-remove-cancel">取消</button>
          <button type="button" id="account-remove-confirm" class="danger">删除账号</button>
        </div>
      </section>`;
    doc.body.appendChild(overlay);
    return overlay;
  }

  function dialogControls(overlay) {
    return [...overlay.querySelectorAll('button:not(:disabled)')];
  }

  function setDialogPending(overlay, pending) {
    const dialog = overlay.querySelector('[role="alertdialog"]');
    const cancel = overlay.querySelector('#account-remove-cancel');
    const confirmButton = overlay.querySelector('#account-remove-confirm');
    dialog?.setAttribute('aria-busy', pending ? 'true' : 'false');
    if (cancel) cancel.disabled = !!pending;
    if (confirmButton) {
      confirmButton.disabled = !!pending;
      confirmButton.textContent = pending ? '正在删除…' : '删除账号';
    }
  }

  function setDialogStatus(overlay, message, state = '') {
    const status = overlay.querySelector('#account-remove-confirm-status');
    if (!status) return;
    status.textContent = String(message || '');
    status.dataset.state = state;
  }

  function closeDialog({ restoreFocus = true } = {}, doc = document) {
    const overlay = doc.getElementById('account-remove-confirm-overlay');
    if (!overlay || overlay.classList.contains('hidden') || removalInFlight) return false;
    overlay.classList.add('hidden');
    overlay.removeAttribute('data-account-id');
    const returnId = dialogReturnAccountId;
    dialogAccountId = '';
    dialogReturnAccountId = '';
    setDialogStatus(overlay, '');
    setDialogPending(overlay, false);
    if (restoreFocus && returnId) restoreAccountFocus(returnId, doc);
    return true;
  }

  function openDialog(accountId, doc = document) {
    const id = String(accountId || '');
    if (!id || removalInFlight) return false;
    const overlay = ensureDialog(doc);
    dialogAccountId = id;
    dialogReturnAccountId = id;
    overlay.dataset.accountId = id;
    const name = overlay.querySelector('#account-remove-confirm-name');
    if (name) name.textContent = accountName(id, doc);
    setDialogStatus(overlay, '');
    setDialogPending(overlay, false);
    overlay.classList.remove('hidden');
    overlay.querySelector('#account-remove-cancel')?.focus({ preventScroll: true });
    return true;
  }

  async function confirmDialogRemoval(doc = document, win = window) {
    if (removalInFlight || !dialogAccountId) return false;
    const overlay = ensureDialog(doc);
    const accountId = dialogAccountId;
    let reloadRequested = false;
    removalInFlight = true;
    setDialogPending(overlay, true);
    setDialogStatus(overlay, '正在安全停止群发任务并删除账号…');
    try {
      await beforeAccountRemoval(accountId);
      // Main-process account-data boundary cleans durable scheduled attachment refs
      // before the existing accounts:remove handler may remove the account/partition.
      await win.api.accounts.remove(accountId);
      // app.js owns account/webview closure state. Reload only after backend deletion
      // succeeds so the UI is rebuilt from truth; on any failure it stays untouched.
      win.location.reload();
      reloadRequested = true;
      return true;
    } catch (error) {
      setDialogPending(overlay, false);
      setDialogStatus(overlay, String(error?.message || error || '账号删除失败'), 'error');
      overlay.querySelector('#account-remove-cancel')?.focus({ preventScroll: true });
      return false;
    } finally {
      if (!reloadRequested) removalInFlight = false;
    }
  }

  function handleDialogKeydown(event, doc = document) {
    const overlay = doc.getElementById('account-remove-confirm-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (event.key === 'Escape' && !removalInFlight) {
      event.preventDefault();
      closeDialog({ restoreFocus: true }, doc);
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = dialogControls(overlay);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const current = controls.indexOf(doc.activeElement);
    const next = event.shiftKey
      ? (current <= 0 ? controls.length - 1 : current - 1)
      : (current < 0 || current === controls.length - 1 ? 0 : current + 1);
    event.preventDefault();
    controls[next]?.focus({ preventScroll: true });
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const overlay = ensureDialog(document);
    overlay.addEventListener('keydown', event => handleDialogKeydown(event, document));
    overlay.addEventListener('click', event => {
      if (event.target === overlay && !removalInFlight) {
        event.preventDefault();
        closeDialog({ restoreFocus: true }, document);
        return;
      }
      if (event.target?.closest?.('#account-remove-cancel')) {
        event.preventDefault();
        closeDialog({ restoreFocus: true }, document);
        return;
      }
      if (event.target?.closest?.('#account-remove-confirm')) {
        event.preventDefault();
        void confirmDialogRemoval(document, window);
      }
    });

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
      openDialog(accountId, document);
    }, true);
  }

  return Object.freeze({
    liveJobsForAccount,
    waitForAccountTerminal,
    beforeAccountRemoval,
    accountName,
    openDialog,
    closeDialog,
    handleDialogKeydown,
    install,
  });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastAccountRemoval.install(), { once: true });
  else window.GeekBroadcastAccountRemoval.install();
}
