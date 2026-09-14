(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.GeekWhatsAppTranslationHookRecovery = api;
    if (root.document) api.installShell(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RECOVERY_VERSION = 2;
  const COMPOSER_INTENT_TTL_MS = 2000;
  const TRANSLATION_FAILURE_MARK = '__geekTranslationLayerFailure';

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

    let composerIntent = null;
    let composerIntentSequence = 0;

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

    const cleanText = value => String(value == null ? '' : value).replace(/\u200b/g, '').trim();

    const activeComposerText = function () {
      try {
        const editor = page.document?.querySelector?.('#main footer [contenteditable="true"],#main [data-testid="conversation-compose-box-input"],[contenteditable="true"][data-tab="10"]');
        return cleanText(editor?.innerText || editor?.textContent || '');
      } catch {
        return '';
      }
    };

    const activeChatId = function () {
      try {
        return String(page.WPP?.chat?.getActiveChat?.()?.id?._serialized || page.W?.chat?.getActive?.()?.id?._serialized || '');
      } catch {
        return '';
      }
    };

    const translationApplies = function (chatId, text) {
      const setting = page.__geekGetTranslationSetting?.(chatId);
      if (!setting?.enabled || !setting?.autoSend || typeof text !== 'string' || !text.trim()) return null;
      if (setting.includeZh === false && /[\u3400-\u9fff]/.test(text)) return null;
      return setting;
    };

    const markTranslationFailure = function (error) {
      const tagged = error && (typeof error === 'object' || typeof error === 'function')
        ? error
        : new Error(String(error || '翻译失败'));
      try { Object.defineProperty(tagged, TRANSLATION_FAILURE_MARK, { value: true }); }
      catch { try { tagged[TRANSLATION_FAILURE_MARK] = true; } catch {} }
      return tagged;
    };

    const isTranslationFailure = function (error) {
      return !!error?.[TRANSLATION_FAILURE_MARK]
        || String(error?.message || error || '') === '翻译失败'
        || String(error?.message || error || '') === '翻译尚未就绪';
    };

    const ensureTranslationRequestMarker = function () {
      const live = page.__geekTranslationRequest;
      if (typeof live !== 'function') return false;
      if (live.__geekTranslationFailureTagged === true) return true;
      const taggedRequest = function (...args) {
        let result;
        try { result = live.apply(this, args); }
        catch (error) { throw markTranslationFailure(error); }
        return Promise.resolve(result).catch(error => { throw markTranslationFailure(error); });
      };
      try {
        Object.defineProperty(taggedRequest, '__geekTranslationFailureTagged', { value: true });
        Object.defineProperty(taggedRequest, '__geekTranslationFailureOriginal', { value: live });
      } catch {}
      page.__geekTranslationRequest = taggedRequest;
      return true;
    };

    const captureComposeSnapshot = function (chat, text) {
      let snapshot = null;
      try {
        const current = chat?.getComposeContents?.();
        if (current && typeof current === 'object') snapshot = { ...current };
      } catch {}
      if (!snapshot) snapshot = {};
      if (!cleanText(snapshot.text)) snapshot.text = String(text || '');
      if (!Number.isFinite(Number(snapshot.timestamp))) snapshot.timestamp = Math.floor(Date.now() / 1000);
      return snapshot;
    };

    const restoreComposeSnapshot = function (chat, snapshot, text) {
      try {
        if (typeof chat?.setComposeContents !== 'function') return false;
        const next = snapshot && typeof snapshot === 'object' ? { ...snapshot } : {};
        if (!cleanText(next.text)) next.text = String(text || '');
        chat.setComposeContents(next);
        return true;
      } catch {
        return false;
      }
    };

    const recordComposerIntent = function (event) {
      if (event?.isTrusted !== true) return { applies: false, blocked: false };
      const chatId = activeChatId();
      const text = activeComposerText();
      const setting = chatId ? translationApplies(chatId, text) : null;
      if (!setting) {
        composerIntent = null;
        return { applies: false, blocked: false };
      }
      ensureTranslationRequestMarker();
      if (typeof page.__geekTranslationRequest !== 'function') {
        composerIntent = null;
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        notify('翻译尚未就绪，已阻止原文发送');
        return { applies: true, blocked: true };
      }
      composerIntent = {
        sequence: ++composerIntentSequence,
        chatId,
        text,
        at: Date.now(),
      };
      return { applies: true, blocked: false };
    };

    const takeComposerIntent = function (chatId, text) {
      const intent = composerIntent;
      composerIntent = null;
      if (!intent) return null;
      if (Date.now() - intent.at > COMPOSER_INTENT_TTL_MS) return null;
      if (String(intent.chatId || '') !== String(chatId || '')) return null;
      if (cleanText(intent.text) !== cleanText(text)) return null;
      return intent;
    };

    const buildFailureBoundary = function (delegate) {
      const bounded = function (chat, ...args) {
        const chatId = String(chat?.id?._serialized || '');
        const text = args[0];
        const intent = takeComposerIntent(chatId, text);
        const snapshot = intent ? captureComposeSnapshot(chat, text) : null;
        const handleFailure = error => {
          if (!intent || !isTranslationFailure(error)) throw error;
          const restored = restoreComposeSnapshot(chat, snapshot, text);
          notify(restored ? '翻译失败，原文已恢复，请重试' : '翻译失败，原文未发送');
          return undefined;
        };
        let result;
        try { result = delegate.call(this, chat, ...args); }
        catch (error) { return handleFailure(error); }
        if (!intent || !result || typeof result.then !== 'function') return result;
        return Promise.resolve(result).catch(handleFailure);
      };
      try {
        Object.defineProperty(bounded, '__geekTranslationFailureBoundary', { value: true });
        Object.defineProperty(bounded, '__geekTranslationFailureBoundaryDelegate', { value: delegate });
      } catch {}
      return bounded;
    };

    const buildWrapper = function (original) {
      const wrapped = function (chat, ...args) {
        const receiver = this;
        const run = async () => {
          const chatId = chat?.id?._serialized;
          const text = args[0];
          const setting = chatId ? translationApplies(chatId, text) : null;
          if (setting) {
            try {
              ensureTranslationRequestMarker();
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
            } catch (error) {
              const tagged = markTranslationFailure(error);
              page.console?.error?.('[geek-translation-recovery]', tagged);
              notify('翻译失败，原文未发送');
              throw tagged;
            }
          }
          return original.call(receiver, chat, ...args);
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
      ensureTranslationRequestMarker();
      let mod;
      try { mod = page.require?.('WAWebSendTextMsgChatAction'); } catch { return false; }
      const live = mod?.sendTextMsgToChat;
      if (typeof live !== 'function') return false;

      if (live.__geekTranslationFailureBoundary === true) {
        page.__geekWhatsAppWrappedSend = live;
        const delegate = live.__geekTranslationFailureBoundaryDelegate;
        if (delegate?.__geekTranslationRecoveryWrapper === true && typeof delegate.__geekTranslationRecoveryOriginal === 'function') {
          mod.__geekOriginalSendText = delegate.__geekTranslationRecoveryOriginal;
        }
        return true;
      }

      if (live === page.__geekWhatsAppWrappedSend) {
        const bounded = buildFailureBoundary(live);
        page.__geekWhatsAppWrappedSend = bounded;
        mod.sendTextMsgToChat = bounded;
        return mod.sendTextMsgToChat === bounded;
      }

      if (live.__geekTranslationRecoveryWrapper === true) {
        if (typeof live.__geekTranslationRecoveryOriginal === 'function') {
          mod.__geekOriginalSendText = live.__geekTranslationRecoveryOriginal;
        }
        const bounded = buildFailureBoundary(live);
        page.__geekWhatsAppWrappedSend = bounded;
        mod.sendTextMsgToChat = bounded;
        return mod.sendTextMsgToChat === bounded;
      }

      // WhatsApp can replace the live send implementation without reloading the
      // WebView. The current live function is therefore the new native authority.
      // Refresh __geekOriginalSendText too, otherwise a later app settings sync
      // would restore a stale pre-update function before wrapping it again.
      const original = live;
      const wrapped = buildWrapper(original);
      const bounded = buildFailureBoundary(wrapped);
      mod.__geekOriginalSendText = original;
      page.__geekWhatsAppWrappedSend = bounded;
      mod.sendTextMsgToChat = bounded;
      return mod.sendTextMsgToChat === bounded;
    };

    const Abort = page.AbortController || globalThis.AbortController;
    const controller = typeof Abort === 'function' ? new Abort() : null;
    const signalOptions = controller ? { capture: true, signal: controller.signal } : { capture: true };
    const composerTarget = target => !!target?.closest?.('[contenteditable="true"], [data-testid="conversation-compose-box-input"]');
    const sendButtonTarget = target => !!target?.closest?.('button[aria-label="Send"],button[aria-label="发送"],[data-testid="compose-btn-send"],button:has([data-icon="send"])');

    // Window capture runs before app.js's document-capture raw-send guard. If
    // WhatsApp swapped the module, this repairs it in the same user gesture. It
    // also records only trusted composer sends so a translation rejection can be
    // isolated from WhatsApp's native send error domain without swallowing errors
    // from programmatic/internal sendTextMsgToChat callers.
    page.addEventListener?.('keydown', event => {
      if (event?.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing || !composerTarget(event.target)) return;
      ensureHook();
      recordComposerIntent(event);
    }, signalOptions);
    page.addEventListener?.('click', event => {
      if (!sendButtonTarget(event?.target)) return;
      ensureHook();
      recordComposerIntent(event);
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
    COMPOSER_INTENT_TTL_MS,
    TRANSLATION_FAILURE_MARK,
    isWhatsAppType,
    accountForPartition,
    installPageRecovery,
    installShell,
  });
});
