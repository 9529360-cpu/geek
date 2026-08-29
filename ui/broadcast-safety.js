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

  return Object.freeze({ normalizeChatId, normalizeComposerText, sameChat, authorizeSend });
});

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('click', event => {
    const send = event.target?.closest?.('#broadcast-send');
    if (!send) return;
    const enabled = document.getElementById('broadcast-schedule-toggle')?.checked === true;
    const raw = document.getElementById('broadcast-schedule-time')?.value || '';
    const scheduledAt = raw ? new Date(raw).getTime() : NaN;
    if (!enabled || !Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) return;

    const registry = window.GeekBroadcastScheduleRegistry;
    const persistenceReady = typeof registry?.schedulePersistenceReady === 'function'
      ? registry.schedulePersistenceReady()
      : !!window.GeekBroadcastSchedulePersistenceInstance?.awaitScheduledDurable;
    if (persistenceReady) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.alert?.('定时任务持久化尚未就绪，请稍后重试。');
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
  loadScript('./broadcast-job-manager.js', 'GeekBroadcastJobManager', () => {
    loadScript('./broadcast-file-lifecycle.js', 'GeekBroadcastFileLifecycle', () => {
      loadScript('./broadcast-schedule-registry.js', 'GeekBroadcastScheduleRegistry', () => {
        loadScript('./broadcast-executor.js', 'GeekBroadcastExecutor', () => {
          loadScript('./broadcast-delivery.js', 'GeekBroadcastDelivery', () => {
            loadScript('./broadcast-runtime.js', 'GeekBroadcastRuntime', () => {
              loadScript('./broadcast-legacy-schedule-migration.js', 'GeekBroadcastLegacyScheduleMigration', () => {
                loadScript('./broadcast-schedule-persistence.js', 'GeekBroadcastSchedulePersistence', () => {
                  loadScript('./broadcast-account-removal.js', 'GeekBroadcastAccountRemoval');
                  loadScript('./broadcast-account-indicator.js', 'GeekBroadcastAccountIndicator');
                  loadScript('./broadcast-job-controller.js', 'GeekBroadcastJobController', () => {
                    loadScript('./broadcast-workbench.js', 'GeekBroadcastWorkbench', () => {
                      loadScript('./broadcast-audience-ux.js', 'GeekBroadcastAudienceUx', () => {
                        loadScript('./broadcast-product-closure.js', 'GeekBroadcastProductClosure', () => {
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
}
