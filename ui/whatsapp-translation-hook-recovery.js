(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.GeekWhatsAppTranslationHookRecovery = api;
    if (root.document) api.installShell(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RECOVERY_VERSION = 8;
  const COMPOSER_INTENT_TTL_MS = 2000;
  const TRANSLATION_FAILURE_MARK = '__geekTranslationLayerFailure';
  const TRANSLATION_ERROR_ENVELOPE_PREFIX = '__GEEK_TRANSLATION_ERROR_V1__:';

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

  function parseTranslationFailure(error) {
    const prefix = '__GEEK_TRANSLATION_ERROR_V1__:';
    const tagged = error && (typeof error === 'object' || typeof error === 'function')
      ? error
      : new Error(String(error || '翻译失败'));
    const rawMessage = String(tagged?.message || '');
    if (!rawMessage.startsWith(prefix)) return tagged;
    let detail;
    try { detail = JSON.parse(rawMessage.slice(prefix.length)); }
    catch { return tagged; }
    if (!detail || typeof detail !== 'object') return tagged;
    try { tagged.message = String(detail.message || '翻译请求失败').slice(0, 300); } catch {}
    try { tagged.code = String(detail.code || 'TRANSLATION_FAILED').slice(0, 100); } catch {}
    try { tagged.category = String(detail.category || 'gateway').slice(0, 64); } catch {}
    try { tagged.retryable = detail.retryable === true; } catch {}
    if (Number.isInteger(detail.status)) {
      try { tagged.status = detail.status; } catch {}
    }
    return tagged;
  }

  function translationFailureNotice(error, restored = false) {
    const source = error && typeof error === 'object' ? error : {};
    const code = String(source.code || '');
    const category = String(source.category || '');
    const status = Number(source.status) || 0;
    const tail = restored ? '原文已恢复，请处理后重试' : '原文未发送';

    if (code === 'QUOTA_EXHAUSTED' || category === 'quota' || status === 402) {
      return `翻译额度已用完，请到个人中心开通；${tail}`;
    }
    if (code === 'SUBSCRIPTION_LOGIN_REQUIRED' || code === 'TRANSLATION_AUTH_REQUIRED') {
      return `翻译需要重新登录，请到个人中心登录；${tail}`;
    }
    if (code === 'SUBSCRIPTION_SESSION_CHANGED' || category === 'auth' || status === 401 || status === 403) {
      return `翻译授权状态已变化，请重新登录后重试；${tail}`;
    }
    if (code === 'TRANSLATION_DEADLINE_EXCEEDED' || category === 'deadline' || status === 504) {
      return `翻译服务响应超时，请稍后重试；${tail}`;
    }
    if (code === 'TRANSLATION_QUALITY_REJECTED' || category === 'quality') {
      return `译文未通过质量校验，请修改原文后重试；${tail}`;
    }
    if (code === 'BRIDGE_BUSY' || code === 'TRANSLATION_BUSY' || category === 'capacity' || status === 429) {
      return `翻译请求繁忙，请稍后重试；${tail}`;
    }
    if (category === 'gateway' || category === 'rate-limit' || status >= 500) {
      return `翻译服务暂时不可用，请稍后重试；${tail}`;
    }
    return restored ? '翻译失败，原文已恢复，请重试' : '翻译失败，原文未发送';
  }

  // Runs inside the WhatsApp WebView page. Keep this function self-contained so
  // the host can inject it with executeJavaScript without sharing renderer state.
  function installPageRecovery(
    page,
    version = RECOVERY_VERSION,
    parseFailure = parseTranslationFailure,
    failureNotice = translationFailureNotice,
  ) {
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
    let composerSendPending = false;
    const composerAttempts = new Map();

    let legacyRequire = null;
    let aliasedRequire = null;
    let mappedSendModuleId = null;

    const currentLegacyRequire = function () {
      const current = page.require;
      let original = current;
      if (current === page.__geekWhatsAppSendModuleAlias && typeof page.__geekWhatsAppSendModuleAliasOriginal === 'function') {
        original = page.__geekWhatsAppSendModuleAliasOriginal;
      } else if (typeof current?.__geekWhatsAppSendModuleAliasOriginal === 'function') {
        // Migration path for recovery v4, which stored the original on the alias.
        original = current.__geekWhatsAppSendModuleAliasOriginal;
      }
      if (typeof original === 'function') legacyRequire = original;
      return legacyRequire;
    };

    currentLegacyRequire();

    const resolveMappedSendModule = function () {
      try {
        const wpp = page.WPP;
        const loader = wpp?.loader;
        const moduleRequire = loader?.moduleRequire;
        const moduleIdMap = wpp?.whatsapp?._moduleIdMap;
        if (typeof moduleRequire !== 'function' || typeof moduleIdMap?.get !== 'function') return null;
        const exportedSend = wpp?.whatsapp?.functions?.sendTextMsgToChat;
        if (typeof exportedSend === 'function') {
          const liveModuleId = moduleIdMap.get(exportedSend) || null;
          if (liveModuleId) mappedSendModuleId = liveModuleId;
        }
        if (!mappedSendModuleId) return null;
        const mod = moduleRequire.call(loader, mappedSendModuleId);
        if (typeof mod?.sendTextMsgToChat === 'function') return mod;
        mappedSendModuleId = null;
      } catch {
        mappedSendModuleId = null;
      }
      return null;
    };

    const resolveLegacySendModule = function () {
      const requireFn = currentLegacyRequire();
      if (typeof requireFn !== 'function') return null;
      try {
        const mod = requireFn.call(page, 'WAWebSendTextMsgChatAction');
        return typeof mod?.sendTextMsgToChat === 'function' ? mod : null;
      } catch {
        return null;
      }
    };

    const resolveSendModule = function () {
      return resolveMappedSendModule() || resolveLegacySendModule();
    };

    const installLegacySendModuleAlias = function () {
      if (page.require === aliasedRequire && aliasedRequire) return true;
      if (page.require === page.__geekWhatsAppSendModuleAlias && page.__geekWhatsAppSendModuleAliasVersion === version) {
        aliasedRequire = page.require;
        currentLegacyRequire();
        return true;
      }

      const baseRequire = currentLegacyRequire();
      if (typeof baseRequire !== 'function') return false;
      const ProxyCtor = page.Proxy || (typeof Proxy === 'function' ? Proxy : null);
      if (typeof ProxyCtor !== 'function') return false;
      const nextAlias = new ProxyCtor(baseRequire, {
        apply(target, thisArg, args) {
          if (args?.[0] === 'WAWebSendTextMsgChatAction') {
            const mapped = resolveMappedSendModule();
            if (mapped) return mapped;
          }
          return target.apply(thisArg, args);
        },
      });
      try {
        page.__geekWhatsAppSendModuleAliasOriginal = baseRequire;
        page.__geekWhatsAppSendModuleAlias = nextAlias;
        page.__geekWhatsAppSendModuleAliasVersion = version;
        page.require = nextAlias;
        aliasedRequire = nextAlias;
        return page.require === nextAlias;
      } catch {
        return false;
      }
    };

    installLegacySendModuleAlias();
    page.__geekResolveWhatsAppSendModule = resolveSendModule;

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
      const normalized = typeof parseFailure === 'function' ? parseFailure(error) : error;
      const tagged = normalized && (typeof normalized === 'object' || typeof normalized === 'function')
        ? normalized
        : new Error(String(normalized || '翻译失败'));
      if (tagged?.[TRANSLATION_FAILURE_MARK] === true) return tagged;
      try { Object.defineProperty(tagged, TRANSLATION_FAILURE_MARK, { value: true }); }
      catch { try { tagged[TRANSLATION_FAILURE_MARK] = true; } catch {} }
      return tagged;
    };

    const isTranslationFailure = function (error) {
      return error?.[TRANSLATION_FAILURE_MARK] === true;
    };

    const findComposerAttempt = function (payload) {
      const body = payload && typeof payload === 'object' ? payload : {};
      const chatId = String(body.chatId || '');
      const text = cleanText(body.text);
      if (!chatId || !text) return null;
      for (const attempt of composerAttempts.values()) {
        if (attempt.chatId === chatId && cleanText(attempt.text) === text) return attempt;
      }
      return null;
    };

    const ensureTranslationRequestMarker = function () {
      const live = page.__geekTranslationRequest;
      if (typeof live !== 'function') return false;
      if (live.__geekTranslationFailureTagged === true) return true;
      const taggedRequest = function (...args) {
        const attempt = findComposerAttempt(args[0]);
        let result;
        try { result = live.apply(this, args); }
        catch (error) { throw markTranslationFailure(error); }
        return Promise.resolve(result)
          .then(value => {
            if (!attempt) return value;
            if (!value?.text) throw markTranslationFailure(new Error('翻译失败'));
            if (activeChatId() !== attempt.chatId) {
              throw markTranslationFailure(new Error('聊天已切换，翻译发送已取消'));
            }
            return value;
          })
          .catch(error => { throw markTranslationFailure(error); });
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
      if (composerSendPending) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        notify('翻译处理中，请稍候');
        return { applies: true, blocked: true };
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

    const buildFailureBoundary = function (delegate, nativePassThrough = null) {
      const bounded = function (chat, ...args) {
        const chatId = String(chat?.id?._serialized || '');
        const text = args[0];
        const intent = takeComposerIntent(chatId, text);

        // app.js may still own the translated path for this generation. Preserve
        // that owner, but when translation does not apply, route around its legacy
        // serialized queue straight to the native WhatsApp authority.
        if (!intent && typeof nativePassThrough === 'function' && !translationApplies(chatId, text)) {
          return nativePassThrough.call(this, chat, ...args);
        }

        const snapshot = intent ? captureComposeSnapshot(chat, text) : null;
        const attempt = intent ? Object.freeze({ ...intent, snapshot, chat }) : null;
        if (attempt) {
          composerSendPending = true;
          composerAttempts.set(attempt.sequence, attempt);
        }
        const cleanup = function () {
          if (!attempt) return;
          composerAttempts.delete(attempt.sequence);
          composerSendPending = composerAttempts.size > 0;
        };
        const handleFailure = error => {
          if (!attempt || !isTranslationFailure(error)) throw error;
          const restored = restoreComposeSnapshot(chat, snapshot, text);
          notify(typeof failureNotice === 'function'
            ? failureNotice(error, restored)
            : (restored ? '翻译失败，原文已恢复，请重试' : '翻译失败，原文未发送'));
          return undefined;
        };
        let result;
        try { result = delegate.call(this, chat, ...args); }
        catch (error) {
          try { return handleFailure(error); }
          finally { cleanup(); }
        }
        if (!attempt || !result || typeof result.then !== 'function') {
          cleanup();
          return result;
        }
        return Promise.resolve(result).then(
          value => { cleanup(); return value; },
          error => {
            try { return handleFailure(error); }
            finally { cleanup(); }
          }
        );
      };
      try {
        Object.defineProperty(bounded, '__geekTranslationFailureBoundary', { value: true });
        Object.defineProperty(bounded, '__geekTranslationFailureBoundaryVersion', { value: version });
        Object.defineProperty(bounded, '__geekTranslationFailureBoundaryDelegate', { value: delegate });
        Object.defineProperty(bounded, '__geekTranslationNativePassThrough', { value: nativePassThrough });
      } catch {}
      return bounded;
    };

    const buildWrapper = function (original) {
      const wrapped = function (chat, ...args) {
        const receiver = this;
        const chatId = chat?.id?._serialized;
        const text = args[0];
        const setting = chatId ? translationApplies(chatId, text) : null;

        // Translation is an optional transform, not the owner of unrelated native
        // WhatsApp sends. If the predicate does not apply, preserve the exact
        // native return/error domain and do not even touch Geek's serialized queue.
        if (!setting) return original.call(receiver, chat, ...args);

        const run = async () => {
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
              intent: 'outgoing-send',
            });
            if (!result?.text) throw new Error('翻译失败');
            page.__geekRememberOutgoing?.(result.text, text);
            args[0] = result.text;
          } catch (error) {
            const tagged = markTranslationFailure(error);
            page.console?.error?.('[geek-translation-recovery]', tagged);
            notify(typeof failureNotice === 'function' ? failureNotice(tagged, false) : '翻译失败，原文未发送');
            throw tagged;
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
      // WhatsApp may replace the global require function without reloading the
      // WebView. Repair the narrow compatibility alias before app.js's document
      // capture guard runs in the same user gesture.
      installLegacySendModuleAlias();
      const mod = resolveSendModule();
      const live = mod?.sendTextMsgToChat;
      if (typeof live !== 'function') return false;

      if (live.__geekTranslationFailureBoundary === true) {
        const delegate = live.__geekTranslationFailureBoundaryDelegate;
        if (delegate?.__geekTranslationRecoveryWrapper === true && typeof delegate.__geekTranslationRecoveryOriginal === 'function') {
          mod.__geekOriginalSendText = delegate.__geekTranslationRecoveryOriginal;
        }
        if (live.__geekTranslationFailureBoundaryVersion === version) {
          page.__geekWhatsAppWrappedSend = live;
          return true;
        }
        const storedNative = typeof live.__geekTranslationNativePassThrough === 'function'
          ? live.__geekTranslationNativePassThrough
          : (typeof mod.__geekOriginalSendText === 'function' ? mod.__geekOriginalSendText : null);
        const rebound = buildFailureBoundary(delegate, storedNative);
        page.__geekWhatsAppWrappedSend = rebound;
        mod.sendTextMsgToChat = rebound;
        return mod.sendTextMsgToChat === rebound;
      }

      if (live === page.__geekWhatsAppWrappedSend) {
        const storedNative = typeof mod.__geekOriginalSendText === 'function' ? mod.__geekOriginalSendText : null;
        const bounded = buildFailureBoundary(live, storedNative);
        page.__geekWhatsAppWrappedSend = bounded;
        mod.sendTextMsgToChat = bounded;
        return mod.sendTextMsgToChat === bounded;
      }

      if (live.__geekTranslationRecoveryWrapper === true) {
        const storedNative = typeof live.__geekTranslationRecoveryOriginal === 'function'
          ? live.__geekTranslationRecoveryOriginal
          : (typeof mod.__geekOriginalSendText === 'function' ? mod.__geekOriginalSendText : null);
        if (storedNative) mod.__geekOriginalSendText = storedNative;
        const bounded = buildFailureBoundary(live, storedNative);
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
      const bounded = buildFailureBoundary(wrapped, original);
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
    const state = Object.freeze({ version, controller, timer, ensureHook, resolveSendModule });
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
        const result = await webview.executeJavaScript(`(${installPageRecovery.toString()})(window, ${RECOVERY_VERSION}, (${parseTranslationFailure.toString()}), (${translationFailureNotice.toString()}))`);
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

    function start() {
      scan();
      const Observer = host.MutationObserver;
      if (typeof Observer !== 'function') return;
      const observer = new Observer(scan);
      observer.observe(host.document.documentElement || host.document.body, { childList: true, subtree: true });
      host.__geekWhatsAppTranslationHookRecoveryObserver = observer;
    }

    if (host.document.readyState === 'loading') host.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    return true;
  }

  return Object.freeze({
    RECOVERY_VERSION,
    COMPOSER_INTENT_TTL_MS,
    TRANSLATION_FAILURE_MARK,
    TRANSLATION_ERROR_ENVELOPE_PREFIX,
    isWhatsAppType,
    accountForPartition,
    parseTranslationFailure,
    translationFailureNotice,
    installPageRecovery,
    installShell,
  });
});