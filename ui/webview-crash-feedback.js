(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekWebviewCrashFeedback = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RELOAD_START_GRACE_MS = 1500;
  const RELOAD_READY_TIMEOUT_MS = 45000;

  function createTracker(options = {}) {
    const setTimer = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    const clearTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
    const states = new Map();
    const listeners = new Set();
    let sequence = 0;

    function emit(accountId) {
      const id = String(accountId || '');
      const snapshot = states.get(id) || null;
      for (const listener of listeners) {
        try { listener(id, snapshot); } catch (_) {}
      }
    }

    function clearStateTimer(state) {
      if (state?.timer != null) clearTimer(state.timer);
    }

    function block(accountId, generation) {
      const id = String(accountId || '');
      const current = states.get(id);
      if (!current || current.generation !== generation) return false;
      clearStateTimer(current);
      states.set(id, Object.freeze({ phase: 'blocked', stage: current.stage, generation, timer: null }));
      emit(id);
      return true;
    }

    function armDeadline(accountId, generation, delay) {
      return setTimer(() => block(accountId, generation), delay);
    }

    function crashed(accountId) {
      const id = String(accountId || '').trim();
      if (!id) return null;
      clearStateTimer(states.get(id));
      const generation = ++sequence;
      const next = Object.freeze({
        phase: 'recovering',
        stage: 'waiting-start',
        generation,
        timer: armDeadline(id, generation, RELOAD_START_GRACE_MS),
      });
      states.set(id, next);
      emit(id);
      return next;
    }

    function loading(accountId) {
      const id = String(accountId || '').trim();
      const current = states.get(id);
      if (!current || current.phase !== 'recovering') return current || null;
      clearStateTimer(current);
      const next = Object.freeze({
        phase: 'recovering',
        stage: 'loading',
        generation: current.generation,
        timer: armDeadline(id, current.generation, RELOAD_READY_TIMEOUT_MS),
      });
      states.set(id, next);
      emit(id);
      return next;
    }

    function ready(accountId) {
      const id = String(accountId || '').trim();
      const current = states.get(id);
      if (!current) return false;
      clearStateTimer(current);
      states.delete(id);
      emit(id);
      return true;
    }

    function get(accountId) {
      return states.get(String(accountId || '')) || null;
    }

    function ids() {
      return [...states.keys()];
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return Object.freeze({ crashed, loading, ready, remove: ready, get, ids, subscribe });
  }

  function normalizeAccounts(value) {
    const list = Array.isArray(value?.accounts) ? value.accounts : (Array.isArray(value) ? value : []);
    return list
      .filter(account => account && account.id && account.partition)
      .map(account => ({ id: String(account.id), partition: String(account.partition) }));
  }

  function webviewPartition(webview) {
    return String(webview?.partition || webview?.getAttribute?.('partition') || '');
  }

  function findAccountForWebview(accounts, webview) {
    const partition = webviewPartition(webview);
    if (!partition) return null;
    return normalizeAccounts(accounts).find(account => account.partition === partition) || null;
  }

  function install(options = {}) {
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;
    if (window.__geekWebviewCrashFeedbackInstalled) return window.__geekWebviewCrashFeedbackInstalled;

    const tracker = options.tracker || createTracker(options);
    const boundWebviews = new WeakSet();
    const ownerByWebview = new WeakMap();
    const lifecycleByWebview = new WeakMap();
    let accounts = [];
    let accountsRefresh = null;

    const listAccounts = async () => {
      if (accountsRefresh) return accountsRefresh;
      const list = window.api?.accounts?.list;
      if (typeof list !== 'function') return accounts;
      accountsRefresh = Promise.resolve()
        .then(() => list())
        .then(result => {
          accounts = normalizeAccounts(result);
          return accounts;
        })
        .catch(() => accounts)
        .finally(() => { accountsRefresh = null; });
      return accountsRefresh;
    };

    async function resolveAccountId(webview) {
      const cached = ownerByWebview.get(webview);
      if (cached) return cached;
      const account = findAccountForWebview(await listAccounts(), webview);
      if (!account) return '';
      ownerByWebview.set(webview, account.id);
      return account.id;
    }

    function withAccount(webview, callback) {
      const cached = ownerByWebview.get(webview);
      if (cached) {
        callback(cached);
        return;
      }
      void resolveAccountId(webview).then(accountId => {
        if (accountId) callback(accountId);
      });
    }

    function ensureStyle() {
      if (document.getElementById('webview-crash-feedback-style')) return;
      const style = document.createElement('style');
      style.id = 'webview-crash-feedback-style';
      style.textContent = `
        .wv-crash-state{margin-left:auto;flex:0 0 auto;font-size:9.5px;line-height:17px;padding:0 5px;border-radius:999px;border:1px solid var(--border-standard);background:var(--bg-elevated);color:#d6a84a}
        .wv-crash-state[data-phase="blocked"]{color:#ff7d74;border-color:color-mix(in srgb,#ff7d74 40%,var(--border-standard))}
        .wv-crash-feedback{position:fixed;right:18px;bottom:18px;z-index:120;display:none;max-width:360px;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;border:1px solid color-mix(in srgb,#ff7d74 40%,var(--border-standard));background:var(--bg-elevated);box-shadow:0 12px 38px rgba(0,0,0,.28);color:var(--text-primary)}
        .wv-crash-feedback[data-open="true"]{display:flex}
        .wv-crash-feedback-copy{min-width:0;display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:1.35}
        .wv-crash-feedback-copy small{color:var(--text-tertiary);font-size:10.5px}
        .wv-crash-feedback button{flex:0 0 auto;border:1px solid var(--border-standard);background:var(--accent);color:#fff;border-radius:8px;padding:7px 10px;font:inherit;cursor:pointer}
      `;
      document.head.appendChild(style);
    }

    function ensureBanner() {
      let banner = document.getElementById('webview-crash-feedback');
      if (banner) return banner;
      banner = document.createElement('div');
      banner.id = 'webview-crash-feedback';
      banner.className = 'wv-crash-feedback';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = '<div class="wv-crash-feedback-copy"><strong>当前账号页面需要重新加载</strong><small>其他账号不受影响。重新加载只会恢复当前账号页面。</small></div><button type="button">重新加载</button>';
      banner.querySelector('button')?.addEventListener('click', () => { void reloadActiveBlockedAccount(); });
      document.body.appendChild(banner);
      return banner;
    }

    function activeAccountId() {
      return String(document.querySelector('.nav-account.active[data-id]')?.dataset?.id || '');
    }

    function render() {
      document.querySelectorAll('.nav-account[data-id]').forEach(item => {
        const id = String(item.dataset.id || '');
        const state = tracker.get(id);
        let badge = item.querySelector('.wv-crash-state');
        if (!state) {
          badge?.remove();
          item.removeAttribute('data-webview-crash-state');
          return;
        }
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'wv-crash-state';
          (item.querySelector('.nav-account-main') || item).appendChild(badge);
        }
        badge.dataset.phase = state.phase;
        badge.textContent = state.phase === 'blocked' ? '需恢复' : '恢复中';
        badge.title = state.phase === 'blocked' ? '账号页面已停止自动恢复，请重新加载' : '账号页面正在自动恢复';
        item.dataset.webviewCrashState = state.phase;
      });

      const banner = ensureBanner();
      const id = activeAccountId();
      const blocked = tracker.get(id)?.phase === 'blocked';
      banner.dataset.open = blocked ? 'true' : 'false';
      banner.dataset.accountId = blocked ? id : '';
    }

    async function reloadActiveBlockedAccount() {
      const accountId = activeAccountId();
      if (!accountId || tracker.get(accountId)?.phase !== 'blocked') return false;
      const freshAccounts = await listAccounts();
      const account = freshAccounts.find(item => item.id === accountId);
      if (!account) {
        tracker.remove(accountId);
        render();
        return false;
      }
      const webview = [...document.querySelectorAll('webview')]
        .find(candidate => webviewPartition(candidate) === account.partition);
      if (!webview || typeof webview.reload !== 'function') return false;

      // Manual recovery starts visible recovery, but never touches app.js's automatic
      // two-per-minute crash budget. A failed/no-op reload naturally returns to blocked.
      tracker.crashed(accountId);
      try {
        webview.reload();
        return true;
      } catch (_) {
        return false;
      } finally {
        render();
      }
    }

    function bindWebview(webview) {
      if (!webview || boundWebviews.has(webview) || typeof webview.addEventListener !== 'function') return;
      boundWebviews.add(webview);
      const lifecycle = { loading: false, startedThisTurn: false };
      lifecycleByWebview.set(webview, lifecycle);
      void resolveAccountId(webview);

      webview.addEventListener('did-start-loading', () => {
        lifecycle.loading = true;
        lifecycle.startedThisTurn = true;
        // app.js may call reload() synchronously from its earlier render-process-gone
        // listener. Keep this marker through the current event stack so our later crash
        // listener can observe that recovery already started, then clear it immediately.
        queueMicrotask(() => { lifecycle.startedThisTurn = false; });
        withAccount(webview, accountId => {
          tracker.loading(accountId);
          render();
        });
      });

      webview.addEventListener('dom-ready', () => {
        lifecycle.loading = false;
        withAccount(webview, accountId => {
          tracker.ready(accountId);
          render();
        });
      });

      webview.addEventListener('render-process-gone', () => {
        const recoveryStartedInThisTurn = lifecycle.startedThisTurn;
        withAccount(webview, accountId => {
          tracker.crashed(accountId);
          if (recoveryStartedInThisTurn) tracker.loading(accountId);
          render();
        });
      });
    }

    function bindCurrentWebviews() {
      document.querySelectorAll('webview').forEach(bindWebview);
    }

    async function refreshAccountsAndRender() {
      const fresh = await listAccounts();
      const live = new Set(fresh.map(account => account.id));
      for (const id of tracker.ids()) {
        if (!live.has(id)) tracker.remove(id);
      }
      bindCurrentWebviews();
      render();
    }

    ensureStyle();
    ensureBanner();
    tracker.subscribe(render);

    const webviewContainer = document.getElementById('webview-container');
    if (webviewContainer && typeof MutationObserver === 'function') {
      new MutationObserver(() => { void refreshAccountsAndRender(); })
        .observe(webviewContainer, { childList: true, subtree: true });
    }
    const accountContainer = document.getElementById('nav-accounts');
    if (accountContainer && typeof MutationObserver === 'function') {
      new MutationObserver(() => { void refreshAccountsAndRender(); })
        .observe(accountContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('click', event => {
      if (event.target?.closest?.('.nav-account-main')) queueMicrotask(render);
    }, true);

    bindCurrentWebviews();
    void refreshAccountsAndRender();

    const installed = Object.freeze({ tracker, render, reloadActiveBlockedAccount, bindWebview });
    window.__geekWebviewCrashFeedbackInstalled = installed;
    return installed;
  }

  return Object.freeze({
    RELOAD_START_GRACE_MS,
    RELOAD_READY_TIMEOUT_MS,
    createTracker,
    normalizeAccounts,
    webviewPartition,
    findAccountForWebview,
    install,
  });
});

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.GeekWebviewCrashFeedback.install(), { once: true });
  } else {
    window.GeekWebviewCrashFeedback.install();
  }
}
