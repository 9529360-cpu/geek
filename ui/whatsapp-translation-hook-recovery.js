(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.GeekWhatsAppTranslationHookRecovery = api;
    if (root.document) api.installShell(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RECOVERY_VERSION = 1;

  function isWhatsAppType(type) {
    return type === 'whatsapp' || type === 'whatsapp-pure';
  }

  function accountForPartition(accounts, partition) {
    const owner = String(partition || '');
    if (!owner) return null;
    return (Array.isArray(accounts) ? accounts : []).find(account =>
      isWhatsAppType(account?.type) && String(account?.partition || '') === owner
    ) || null;
  }

  // Runs inside the WhatsApp WebView page. Keep this function self-contained so
  // the host can inject it with executeJavaScript without sharing renderer state.
  function installPageRecovery(page, version = RECOVERY_VERSION) {
    if (!page) return 'NO_PAGE';

    const currentState = page.__geekWhatsAppSendRecovery;
    if (currentState?.version === version && typeof currentState.ensureHook === 'function') {
      return currentState.ensureHook() ? 'READY' : 'WAITING';
    }

    try { currentState?.controller?.abort?.(); } catch {}
    try {
      if (currentState?.timer != null && typeof page.clearInterval === 'function') page.clearInterval(currentState.timer);
    } catch {}

    const notify = function (message) {
      try {
        const doc = page.document;
        if (!doc?.createElement || !doc?.body) return;
        doc.getElementById?.('geek-translation-send-error')?.remove?.();
        const notice = doc.createElement('div');
        notice.id = 'geek-translation-send-error';
        notice.textContent = message;
        Object.assign(notice.style || {}, {
          position: 'fixed', left: '50%', bottom: '82px', transform: 'translateX(-50%)',
          zIndex: '999999', padding: '8px 12px', borderRadius: '7px', background: '#b42318',
          color: '#fff', fontSize: '12px', boxShadow: '0 8px 24px rgba(0,0,0,.35)'
        });
        doc.body.appendChild(notice);
        page.setTimeout?.(() => notice.remove?.(), 3200);
      } catch {}
    };

    const translationApplies = function (chatId, text) {
      const setting = page.__geekGetTranslationSetting?.(chatId);
      if (!setting?.enabled || !setting?.autoSend || typeof text !== 'string' || !text.trim()) return null;
      if (setting.includeZh === false && /[\u3400-\u9fff]/.test(text)) return null;
      return setting;
    };

    const buildWrapper = function (original) {
      const wrapped = function (chat, ...args) {
        const receiver = this;
        const run = async () => {
          try {
            const chatId = chat?.id?._serialized;
            const text = args[0];
            const setting = chatId ? translationApplies(chatId, text) : null;
            if (setting) {
              const translate = page.__geekTranslationRequest;
              if (typeof translate !== 'function') throw new Error('翻译尚未就绪');
              const result = await translate({
                text,
                source: setting.source || 'auto',
                target: setting.target,
                provider: setting.provider,
                route: setting.route,
                chatId,
              });
              if (!result?.text) throw new Error('翻译失败');
              page.__geekRememberOutgoing?.(result.text, text);
              args[0] = result.text;
            }
            return original.call(receiver, chat, ...args);
          } catch (error) {
            page.console?.error?.('[geek-translation-recovery]', error);
            notify('翻译失败，原文未发送');
            throw error;
          }
        };
        const queue = page.__geekSendQueue || Promise.resolve();
        const next = queue.then(run, run);
        page.__geekSendQueue = next.catch(() => {});
        return next;
      };
      try {
        Object.defineProperty(wrapped, '__geekTranslationRecoveryWrapper', { value: true });
        Object.defineProperty(wrapped, '__geekTranslationRecoveryOriginal', { value: original });
      } catch {}
      return wrapped;
    };

    const ensureHook = function () {
      if (typeof page.__geekGetTranslationSetting !== 'function') return false;
      let mod;
      try { mod = page.require?.('WAWebSendTextMsgChatAction'); } catch { return false; }
      const live = mod?.sendTextMsgToChat;
      if (typeof live !== 'function') return false;

      if (live === page.__geekWhatsAppWrappedSend) return true;
      if (live.__geekTranslationRecoveryWrapper === true) {
        page.__geekWhatsAppWrappedSend = live;
        if (typeof live.__geekTranslationRecoveryOriginal === 'function') {
          mod.__geekOriginalSendText = live.__geekTranslationRecoveryOriginal;
        }
        return true;
      }

      // WhatsApp can replace the live send implementation without reloading the
      // WebView. The current live function is therefore the new native authority.
      // Refresh __geekOriginalSendText too, otherwise a later app settings sync
      // would restore a stale pre-update function before wrapping it again.
      const original = live;
      const wrapped = buildWrapper(original);
      mod.__geekOriginalSendText = original;
      page.__geekWhatsAppWrappedSend = wrapped;
      mod.sendTextMsgToChat = wrapped;
      return mod.sendTextMsgToChat === wrapped;
    };

    const Abort = page.AbortController || globalThis.AbortController;
    const controller = typeof Abort === 'function' ? new Abort() : null;
    const signalOptions = controller ? { capture: true, signal: controller.signal } : { capture: true };
    const composerTarget = target => !!target?.closest?.('[contenteditable="true"], [data-testid="conversation-compose-box-input"]');
    const sendButtonTarget = target => !!target?.closest?.('button[aria-label="Send"],button[aria-label="发送"],[data-testid="compose-btn-send"],button:has([data-icon="send"])');

    // Window capture runs before app.js's document-capture raw-send guard. If
    // WhatsApp swapped the module, this repairs it in the same user gesture so
    // the existing fail-closed guard sees a healthy wrapper instead of creating
    // a permanent blocked state.
    page.addEventListener?.('keydown', event => {
      if (event?.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing && composerTarget(event.target)) ensureHook();
    }, signalOptions);
    page.addEventListener?.('click', event => {
      if (sendButtonTarget(event?.target)) ensureHook();
    }, signalOptions);
    page.addEventListener?.('input', event => {
      if (composerTarget(event?.target)) ensureHook();
    }, signalOptions);

    const timer = typeof page.setInterval === 'function' ? page.setInterval(ensureHook, 3000) : null;
    const state = Object.freeze({ version, controller, timer, ensureHook });
    page.__geekWhatsAppSendRecovery = state;
    return ensureHook() ? 'READY' : 'WAITING';
  }

  function installShell(host = root) {
    if (!host?.document || host.__geekWhatsAppTranslationHookRecoveryShellInstalled) return false;
    host.__geekWhatsAppTranslationHookRecoveryShellInstalled = true;
    const observed = new WeakSet();

    async function inject(webview) {
      if (!webview || typeof webview.executeJavaScript !== 'function') return false;
      const partition = String(webview.partition || webview.getAttribute?.('partition') || '');
      if (!partition) return false;
      let listed;
      try { listed = await host.api?.accounts?.list?.(); } catch { return false; }
      const accounts = listed?.accounts || listed || [];
      if (!accountForPartition(accounts, partition)) return false;
      try {
        const result = await webview.executeJavaScript(`(${installPageRecovery.toString()})(window, ${RECOVERY_VERSION})`);
        return result === 'READY' || result === 'WAITING';
      } catch {
        return false;
      }
    }

    function observe(webview) {
      if (!webview || observed.has(webview)) return;
      observed.add(webview);
      webview.addEventListener?.('dom-ready', () => { void inject(webview); });
      // A newly inserted <webview> can throw from getURL()/other guest methods
      // until it is attached and dom-ready. Queue a safe best-effort injection
      // instead; inject() already catches executeJavaScript rejection and the
      // dom-ready listener remains the authoritative retry.
      queueMicrotask(() => { void inject(webview); });
    }

    function scan() {
      host.document.querySelectorAll?.('webview').forEach(observe);
    }

    const start = () => {
      scan();
      const Observer = host.MutationObserver;
      if (typeof Observer !== 'function') return;
      const observer = new Observer(scan);
      observer.observe(host.document.documentElement || host.document.body, { childList: true, subtree: true });
      host.__geekWhatsAppTranslationHookRecoveryObserver = observer;
    };

    if (host.document.readyState === 'loading') host.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    return true;
  }

  return Object.freeze({
    RECOVERY_VERSION,
    isWhatsAppType,
    accountForPartition,
    installPageRecovery,
    installShell,
  });
});
