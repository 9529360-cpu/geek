(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.GeekWhatsAppComposerPublicFallback = api;
    if (root.document) api.installShell(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const FALLBACK_VERSION = 1;

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

  // Runs inside the WhatsApp WebView. This is a degraded-path owner only: it
  // stays out of the way while the native send-module recovery is healthy, and
  // takes over a trusted translated composer gesture only when that private
  // owner cannot be resolved but the public WPP text API is available.
  function installPageFallback(page, version = FALLBACK_VERSION) {
    if (!page) return 'NO_PAGE';

    const current = page.__geekWhatsAppPublicComposerFallback;
    if (current?.version === version && typeof current.handleGesture === 'function') return 'READY';
    try { current?.controller?.abort?.(); } catch {}

    let composerSendPending = false;
    const cleanText = value => String(value == null ? '' : value).replace(/\u200b/g, '').trim();
    const composerSelector = '#main footer [contenteditable="true"],#main [data-testid="conversation-compose-box-input"],[contenteditable="true"][data-tab="10"]';
    const composerTarget = target => !!target?.closest?.('[contenteditable="true"], [data-testid="conversation-compose-box-input"]');
    const sendButtonTarget = target => !!target?.closest?.('button[aria-label="Send"],button[aria-label="发送"],[data-testid="compose-btn-send"],button:has([data-icon="send"])');

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

    const activeComposerText = function () {
      try {
        const editor = page.document?.querySelector?.(composerSelector);
        return cleanText(editor?.innerText || editor?.textContent || '');
      } catch {
        return '';
      }
    };

    const pickRuntime = function (requirements) {
      try {
        const picked = page.__geekPickWpp?.(requirements);
        if (picked) return picked;
      } catch {}
      const paths = Array.isArray(requirements) ? requirements : [requirements];
      const resolvePath = (root, path) => String(path || '')
        .split('.')
        .filter(Boolean)
        .reduce((value, key) => value == null ? undefined : value[key], root);
      return [page.WPP, page.WAPLUS_WPP]
        .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index)
        .find(candidate => paths.every(path => resolvePath(candidate, path) != null)) || null;
    };

    const getActiveChat = function () {
      try {
        const runtime = pickRuntime(['chat.getActiveChat']);
        return runtime?.chat?.getActiveChat?.() || page.W?.chat?.getActive?.() || null;
      } catch {
        return null;
      }
    };

    const translationSetting = function (chatId, text) {
      const setting = page.__geekGetTranslationSetting?.(chatId);
      if (!setting?.enabled || !setting?.autoSend || !text) return null;
      if (setting.includeZh === false && /[\u3400-\u9fff]/.test(text)) return null;
      return setting;
    };

    const captureComposeSnapshot = function (chat, text) {
      let snapshot = null;
      try {
        const currentContents = chat?.getComposeContents?.();
        if (currentContents && typeof currentContents === 'object') snapshot = { ...currentContents };
      } catch {}
      if (!snapshot) snapshot = {};
      if (!cleanText(snapshot.text)) snapshot.text = String(text || '');
      if (!Number.isFinite(Number(snapshot.timestamp))) snapshot.timestamp = Math.floor(Date.now() / 1000);
      return snapshot;
    };

    const clearCompose = function (chat) {
      try {
        if (typeof chat?.setComposeContents !== 'function') return false;
        chat.setComposeContents({});
        return true;
      } catch {
        return false;
      }
    };

    const restoreCompose = function (chat, snapshot, text) {
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

    const block = function (event) {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
    };

    const handleGesture = function (event) {
      if (event?.isTrusted !== true) return false;

      const text = activeComposerText();
      if (!text) return false;
      const chat = getActiveChat();
      const chatId = String(chat?.id?._serialized || chat?.id || '');
      const setting = chatId ? translationSetting(chatId, text) : null;
      if (!setting) return false;

      // Keep the existing native-module recovery authoritative whenever it can
      // bind the live send owner for this generation.
      try {
        if (page.__geekWhatsAppSendRecovery?.ensureHook?.() === true) return false;
      } catch {}

      block(event);
      if (composerSendPending) {
        notify('翻译处理中，请稍候');
        return true;
      }

      const translate = page.__geekTranslationRequest;
      if (typeof translate !== 'function') {
        notify('翻译尚未就绪，已阻止原文发送');
        return true;
      }

      const runtime = pickRuntime(['chat.sendTextMessage']);
      if (!runtime || typeof runtime?.chat?.sendTextMessage !== 'function') {
        notify('WhatsApp发送通道尚未就绪，已阻止原文发送');
        return true;
      }

      const snapshot = captureComposeSnapshot(chat, text);
      const quotedMsg = chat?.composeQuotedMsg || null;
      composerSendPending = true;
      clearCompose(chat);

      const task = (async () => {
        let stage = 'translation';
        try {
          const translated = await translate({
            text,
            source: setting.source || 'auto',
            target: setting.target,
            provider: setting.provider,
            route: setting.route,
            chatId,
          });
          if (!translated?.text) throw new Error('翻译失败');
          const currentChat = getActiveChat();
          const currentChatId = String(currentChat?.id?._serialized || currentChat?.id || '');
          if (currentChatId !== chatId) throw new Error('聊天已切换，翻译发送已取消');

          page.__geekRememberOutgoing?.(translated.text, text);
          stage = 'send';
          const options = quotedMsg ? { quotedMsg } : undefined;
          const sent = await runtime.chat.sendTextMessage(chatId, translated.text, options);
          if (sent == null) throw new Error('WhatsApp未确认消息发送');
          return sent;
        } catch (error) {
          const message = String(error?.message || error || '');
          if (stage === 'translation') {
            const restored = restoreCompose(chat, snapshot, text);
            if (/聊天已切换/.test(message)) {
              notify(restored ? '聊天已切换，原文已恢复，请重试' : '聊天已切换，翻译发送已取消');
            } else {
              notify(restored ? '翻译失败，原文已恢复，请重试' : '翻译失败，原文未发送');
            }
          } else {
            notify('WhatsApp发送失败，请检查当前会话后重试');
          }
          page.console?.error?.('[geek-whatsapp-composer-fallback]', message.slice(0, 240));
          return null;
        } finally {
          composerSendPending = false;
        }
      })();

      page.__geekWhatsAppPublicComposerFallbackLastTask = task;
      return true;
    };

    const Abort = page.AbortController || globalThis.AbortController;
    const controller = typeof Abort === 'function' ? new Abort() : null;
    const signalOptions = controller ? { capture: true, signal: controller.signal } : { capture: true };

    page.addEventListener?.('keydown', event => {
      if (event?.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing || !composerTarget(event.target)) return;
      handleGesture(event);
    }, signalOptions);
    page.addEventListener?.('click', event => {
      if (!sendButtonTarget(event?.target)) return;
      handleGesture(event);
    }, signalOptions);

    const state = Object.freeze({ version, controller, handleGesture });
    page.__geekWhatsAppPublicComposerFallback = state;
    return 'READY';
  }

  function installShell(host = root) {
    if (!host?.document || host.__geekWhatsAppComposerPublicFallbackShellInstalled) return false;
    host.__geekWhatsAppComposerPublicFallbackShellInstalled = true;
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
        const result = await webview.executeJavaScript(`(${installPageFallback.toString()})(window, ${FALLBACK_VERSION})`);
        return result === 'READY';
      } catch {
        return false;
      }
    }

    function observe(webview) {
      if (!webview || observed.has(webview)) return;
      observed.add(webview);
      webview.addEventListener?.('dom-ready', () => { void inject(webview); });
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
      host.__geekWhatsAppComposerPublicFallbackObserver = observer;
    }

    if (host.document.readyState === 'loading') host.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    return true;
  }

  return Object.freeze({
    FALLBACK_VERSION,
    isWhatsAppType,
    accountForPartition,
    installPageFallback,
    installShell,
  });
});
