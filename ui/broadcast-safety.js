(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastSafety = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function normalizeChatId(value) {
    let text = String(value == null ? '' : value).trim();
    try { text = decodeURIComponent(text); } catch (_) {}
    text = text.replace(/^#/, '');
    const telegramParam = text.match(/(?:^|[?&])p=([^&]+)/);
    if (telegramParam) text = telegramParam[1];
    text = text.replace(/^\/im\/?/, '');
    return text.trim();
  }

  function sameChat(current, target) {
    const a = normalizeChatId(current);
    const b = normalizeChatId(target);
    return !!a && !!b && a === b;
  }

  function normalizeComposerText(value) {
    return String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\n[\t ]*\n+/g, '\n').trim();
  }

  function authorizeSend({ opened, currentChatId, targetChatId, composerResult, needsComposer, expectedComposerText, actualComposerText }) {
    if (opened !== true) return { ok: false, reason: 'OPEN_FAILED' };
    if (!sameChat(currentChatId, targetChatId)) return { ok: false, reason: 'WRONG_CHAT' };
    if (needsComposer && composerResult !== 'OK') {
      return { ok: false, reason: `COMPOSER_FAILED:${String(composerResult || 'EMPTY')}` };
    }
    if (needsComposer && expectedComposerText !== undefined && normalizeComposerText(expectedComposerText) !== normalizeComposerText(actualComposerText)) {
      return { ok: false, reason: 'COMPOSER_MISMATCH' };
    }
    return { ok: true, reason: '' };
  }

  function routeAccountRemoval({ event, owner, accountId }) {
    if (!event || typeof event.preventDefault !== 'function' || typeof event.stopImmediatePropagation !== 'function') {
      throw new TypeError('account removal event is required');
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    const id = String(accountId || '');
    if (!id) return { handled: true, ready: false, opened: false, reason: 'ACCOUNT_MISSING' };
    if (!owner || typeof owner.openDialog !== 'function') {
      return { handled: true, ready: false, opened: false, reason: 'OWNER_NOT_READY' };
    }
    return {
      handled: true,
      ready: true,
      opened: owner.openDialog(id) !== false,
      reason: '',
    };
  }

  return Object.freeze({ normalizeChatId, normalizeComposerText, sameChat, authorizeSend, routeAccountRemoval });
});

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let accountRemovalReadinessTimer = null;

  function showAccountRemovalReadinessStatus(message) {
    let status = document.getElementById('account-removal-readiness-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'account-removal-readiness-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      status.style.cssText = 'position:fixed;left:50%;bottom:24px;z-index:520;transform:translateX(-50%);max-width:min(420px,calc(100vw - 32px));padding:9px 12px;border:1px solid var(--border-standard);border-radius:9px;background:var(--bg-elevated);box-shadow:0 12px 36px rgba(0,0,0,.28);color:var(--text-secondary);font-size:12px;line-height:1.45;text-align:center;pointer-events:none';
      document.body.appendChild(status);
    }
    status.textContent = String(message || '');
    if (accountRemovalReadinessTimer) clearTimeout(accountRemovalReadinessTimer);
    accountRemovalReadinessTimer = setTimeout(() => {
      accountRemovalReadinessTimer = null;
      status.remove();
    }, 2600);
  }

  // Account deletion is destructive and has a single lifecycle owner. This capture
  // guard is installed synchronously from index.html before app.js. Until the
  // Broadcast dependency chain has loaded GeekBroadcastAccountRemoval, a delete
  // click is consumed and fails closed instead of falling through to app.js's
  // historical optimistic-delete path. Once ready, this guard delegates only to
  // the lifecycle owner's dialog; the later owner capture listener remains a
  // compatibility fallback but does not receive this already-consumed event.
  document.addEventListener('click', event => {
    const item = event.target?.closest?.('#ctx-menu .ctx-item[data-act="delete"]');
    if (!item) return;
    const menu = document.getElementById('ctx-menu');
    const accountId = String(menu?.dataset?.accountId || '');
    menu?.classList.add('hidden');
    const result = window.GeekBroadcastSafety.routeAccountRemoval({
      event,
      owner: window.GeekBroadcastAccountRemoval,
      accountId,
    });
    if (!result.ready) {
      showAccountRemovalReadinessStatus(
        result.reason === 'ACCOUNT_MISSING'
          ? '无法确认要删除的账号，请重新选择。'
          : '账号删除功能正在初始化，请稍后重试。',
      );
    }
  }, true);

  function showScheduleReadinessStatus(message) {
    const status = document.getElementById('broadcast-workbench-status') || document.getElementById('broadcast-meta');
    if (!status) return;
    status.dataset.state = 'error';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const text = status.querySelector?.('span');
    if (text) text.textContent = message;
    else status.textContent = message;
  }

  document.addEventListener('click', event => {
    const send = event.target?.closest?.('#broadcast-send');
    if (!send) return;
    const enabled = document.getElementById('broadcast-schedule-toggle')?.checked === true;
    if (!enabled) return;
    const raw = document.getElementById('broadcast-schedule-time')?.value || '';
    const scheduledAt = raw ? new Date(raw).getTime() : NaN;
    if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showScheduleReadinessStatus('请选择未来的发送时间，避免定时任务被误当成立即发送。');
      document.getElementById('broadcast-schedule-time')?.focus?.({ preventScroll: true });
      return;
    }

    const registry = window.GeekBroadcastScheduleRegistry;
    const persistenceReady = typeof registry?.schedulePersistenceReady === 'function'
      ? registry.schedulePersistenceReady()
      : !!window.GeekBroadcastSchedulePersistenceInstance?.awaitScheduledDurable;
    if (persistenceReady) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    showScheduleReadinessStatus('定时任务持久化尚未就绪，请稍后重试。');
  }, true);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  function loadScript(src, marker, done) {
    if (window[marker]) { done?.(); return; }
    const existing = document.querySelector(`script[data-geek-broadcast="${marker}"]`);
    if (existing) { existing.addEventListener('load', () => done?.(), { once: true }); return; }
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset.geekBroadcast = marker;
    if (done) script.addEventListener('load', done, { once: true });
    document.head.appendChild(script);
  }
  loadScript('./telegram-broadcast-route.js', 'GeekTelegramBroadcastRoute');
  loadScript('./broadcast-chat-readiness.js', 'GeekBroadcastChatReadiness');
  loadScript('./broadcast-job-manager.js', 'GeekBroadcastJobManager', () => {
    loadScript('./broadcast-file-lifecycle.js', 'GeekBroadcastFileLifecycle', () => {
      loadScript('./broadcast-schedule-registry.js', 'GeekBroadcastScheduleRegistry', () => {
        loadScript('./broadcast-executor.js', 'GeekBroadcastExecutor', () => {
          loadScript('./broadcast-delivery.js', 'GeekBroadcastDelivery', () => {
            loadScript('./broadcast-send-controller.js', 'GeekBroadcastSendController', () => {
              loadScript('./broadcast-runtime.js', 'GeekBroadcastRuntime', () => {
                loadScript('./broadcast-legacy-schedule-migration.js', 'GeekBroadcastLegacyScheduleMigration', () => {
                  loadScript('./broadcast-schedule-persistence.js', 'GeekBroadcastSchedulePersistence', () => {
                    loadScript('./broadcast-account-removal.js', 'GeekBroadcastAccountRemoval');
                    loadScript('./broadcast-account-indicator.js', 'GeekBroadcastAccountIndicator');
                    loadScript('./broadcast-job-controller.js', 'GeekBroadcastJobController', () => {
                      loadScript('./broadcast-workbench.js', 'GeekBroadcastWorkbench', () => {
                        loadScript('./broadcast-launch-check.js', 'GeekBroadcastLaunchCheck', () => {
                          loadScript('./broadcast-audience-ux.js', 'GeekBroadcastAudienceUx', () => {
                            loadScript('./broadcast-recipient-tags.js', 'GeekBroadcastRecipientTags', () => {
                              loadScript('./broadcast-product-closure.js', 'GeekBroadcastProductClosure', () => {
                                loadScript('./advanced-tools-workbench.js', 'GeekAdvancedToolsWorkbench');
                                loadScript('./broadcast-job-guard.js', 'GeekBroadcastJobGuard');
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}
