(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekSemanticSendIntentController = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function installPageController(page, version = 1, options = {}) {
    const platform = String(options.platform || '').trim();
    const controllerKey = String(options.controllerKey || '').trim();
    const composerSelector = String(options.composerSelector || '').trim();
    const threadPathRe = new RegExp(String(options.threadPathSource || '(?!)'), 'i');
    const sendLabelRe = new RegExp(String(options.sendLabelSource || '(?!)'), 'i');
    const displayName = String(options.displayName || platform || '消息');
    const noticeId = String(options.noticeId || ('geek-' + platform + '-send-error'));
    const nativeCommitMarker = 'data-geek-native-submit-commit';
    if (!page?.document || !platform || !controllerKey || !composerSelector) return 'NO_DOCUMENT';

    const previous = page[controllerKey];
    if (Number(previous?.version || 0) === Number(version || 0) && previous?.active === true) return 'READY';
    try { previous?.controller?.abort?.(); } catch {}

    const Abort = page.AbortController || globalThis.AbortController;
    const controller = typeof Abort === 'function' ? new Abort() : null;
    const signal = controller?.signal;
    let sendLock = false;
    let baselineControls = null;
    let baselineEditor = null;
    const composerText = editor => String(editor?.innerText || editor?.textContent || '').replace(/\u200b/g, '').trim();
    const currentConversationId = () => {
      try {
        const match = String(page.location?.pathname || '').match(threadPathRe);
        return match ? match[0].replace(/\/$/, '') : '';
      } catch { return ''; }
    };
    const eventElement = event => {
      const target = event?.target;
      return target && target.nodeType === 1 && typeof target.closest === 'function' ? target : null;
    };
    const signature = button => String(button?.getAttribute?.('aria-label') || '') + '\n' + String(button?.innerHTML || '');
    const composerRegion = editor => editor?.closest?.('[role="region"], form') || null;
    const snapshotControls = editor => {
      const region = composerRegion(editor);
      if (!region || composerText(editor)) return;
      baselineEditor = editor;
      baselineControls = new Map();
      region.querySelectorAll?.('button,[role="button"]').forEach(button => baselineControls.set(button, signature(button)));
    };
    const visible = element => {
      try {
        const rect = element.getBoundingClientRect();
        const style = page.getComputedStyle?.(element);
        return rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
      } catch { return true; }
    };
    const isSendControl = (target, editor) => {
      const button = target?.closest?.('button,[role="button"]');
      const region = composerRegion(editor);
      if (!button || !region || !region.contains(button) || !visible(button)
        || button.matches?.(':disabled') || button.getAttribute?.('aria-disabled') === 'true') return false;
      const label = String(button.getAttribute?.('aria-label') || '');
      if (sendLabelRe.test(label)) return true;
      if (baselineEditor !== editor || !(baselineControls instanceof Map)) return false;
      const changed = [];
      region.querySelectorAll?.('button,[role="button"]').forEach(candidate => {
        if (!visible(candidate) || candidate.matches?.(':disabled') || candidate.getAttribute?.('aria-disabled') === 'true') return;
        if (!baselineControls.has(candidate) || baselineControls.get(candidate) !== signature(candidate)) changed.push(candidate);
      });
      return changed.length === 1 && changed[0] === button;
    };
    const notify = message => {
      try {
        page.document.getElementById(noticeId)?.remove();
        const notice = page.document.createElement('div');
        notice.id = noticeId;
        notice.textContent = String(message || (displayName + ' 发送未完成，请重试'));
        Object.assign(notice.style, {
          position:'fixed', left:'50%', bottom:'82px', transform:'translateX(-50%)',
          zIndex:'999999', padding:'8px 12px', borderRadius:'7px', background:'#b42318',
          color:'#fff', fontSize:'12px', boxShadow:'0 8px 24px rgba(0,0,0,.35)'
        });
        page.document.body?.appendChild(notice);
        page.setTimeout?.(() => notice.remove(), 3200);
      } catch {}
    };
    const block = event => {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
    };
    const submitThroughOwner = async (event, editor) => {
      if (page.document.documentElement?.getAttribute?.(nativeCommitMarker) === '1') return false;
      if (event?.isTrusted !== true || !editor) return false;
      const text = composerText(editor);
      const chatId = currentConversationId();
      if (!text || !chatId) return false;
      block(event);
      if (sendLock) return true;
      sendLock = true;
      try {
        if (typeof page.__geekTranslationRequest !== 'function') throw new Error('SEND_INTENT_OWNER_UNAVAILABLE');
        const result = await page.__geekTranslationRequest({ text, chatId, intent: 'outgoing-send' });
        if (!result?.text) throw new Error('SEND_INTENT_RESULT_EMPTY');
        if (result?.delivery?.owner !== 'send-intent') throw new Error('SEND_INTENT_OWNER_REQUIRED');
        if (result.delivery.state !== 'sent') throw new Error('SEND_INTENT_SEND_FAILED');
        return true;
      } catch (error) {
        page.console?.error?.('[geek-' + platform + '-send-intent]', String(error?.message || error || '').slice(0, 240));
        notify(displayName + ' 发送未完成，原文仍保留，请重试');
        if (editor.isConnected !== false) editor.focus?.();
        return false;
      } finally {
        sendLock = false;
      }
    };
    page.document.addEventListener('focusin', event => {
      if (event?.isTrusted !== true) return;
      const editor = eventElement(event)?.closest(composerSelector);
      if (editor && !composerText(editor)) snapshotControls(editor);
    }, { capture: true, ...(signal ? { signal } : {}) });

    page.document.addEventListener('beforeinput', event => {
      if (page.document.documentElement?.getAttribute?.(nativeCommitMarker) === '1' || event?.isTrusted !== true) return;
      const editor = eventElement(event)?.closest(composerSelector);
      if (editor && !composerText(editor)) snapshotControls(editor);
    }, { capture: true, ...(signal ? { signal } : {}) });

    page.document.addEventListener('input', event => {
      if (event?.isTrusted !== true) return;
      const editor = eventElement(event)?.closest(composerSelector);
      if (editor && !composerText(editor)) snapshotControls(editor);
    }, { capture: true, ...(signal ? { signal } : {}) });

    page.document.addEventListener('keydown', event => {
      if (page.document.documentElement?.getAttribute?.(nativeCommitMarker) === '1') return;
      if (event?.isTrusted !== true || event.key !== 'Enter' || event.shiftKey || event.ctrlKey
        || event.altKey || event.metaKey || event.isComposing || event.repeat) return;
      const editor = eventElement(event)?.closest(composerSelector);
      if (!editor) return;
      void submitThroughOwner(event, editor);
    }, { capture: true, ...(signal ? { signal } : {}) });
    page.document.addEventListener('click', event => {
      if (page.document.documentElement?.getAttribute?.(nativeCommitMarker) === '1' || event?.isTrusted !== true) return;
      const editor = page.document.querySelector(composerSelector);
      if (!editor || !isSendControl(eventElement(event), editor)) return;
      void submitThroughOwner(event, editor);
    }, { capture: true, ...(signal ? { signal } : {}) });

    page[controllerKey] = Object.freeze({
      version,
      active: true,
      controller,
      submitThroughOwner,
      currentConversationId,
    });
    return 'READY';
  }

  function create(config = {}) {
    const normalized = Object.freeze({
      platform: String(config.platform || '').trim(),
      accountType: String(config.accountType || config.platform || '').trim(),
      displayName: String(config.displayName || config.platform || '').trim(),
      controllerKey: String(config.controllerKey || '').trim(),
      shellFlagKey: String(config.shellFlagKey || '').trim(),
      observerKey: String(config.observerKey || '').trim(),
      composerSelector: String(config.composerSelector || '').trim(),
      threadPathSource: String(config.threadPathSource || '').trim(),
      sendLabelSource: String(config.sendLabelSource || '').trim(),
      noticeId: String(config.noticeId || '').trim(),
      version: Number(config.version || 1),
    });
    if (!normalized.platform || !normalized.accountType || !normalized.controllerKey
      || !normalized.shellFlagKey || !normalized.composerSelector || !normalized.threadPathSource) {
      throw new TypeError('semantic send-intent controller config is incomplete');
    }

    const pageOptions = Object.freeze({
      platform: normalized.platform,
      displayName: normalized.displayName,
      controllerKey: normalized.controllerKey,
      composerSelector: normalized.composerSelector,
      threadPathSource: normalized.threadPathSource,
      sendLabelSource: normalized.sendLabelSource,
      noticeId: normalized.noticeId,
    });
    const threadPathRe = new RegExp(normalized.threadPathSource, 'i');
    const sendLabelRe = new RegExp(normalized.sendLabelSource || '(?!)', 'i');
    const isType = type => String(type || '') === normalized.accountType;
    const accountForPartition = (accounts, partition) => (
      (Array.isArray(accounts) ? accounts : []).find(account =>
        isType(account?.type) && String(account?.partition || '') === String(partition || '')
      ) || null
    );

    function installShell(host = root) {
      if (!host?.document || host[normalized.shellFlagKey]) return false;
      host[normalized.shellFlagKey] = true;
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
          const expression = '(' + installPageController.toString() + ')(window,'
            + JSON.stringify(normalized.version) + ',' + JSON.stringify(pageOptions) + ')';
          return await webview.executeJavaScript(expression) === 'READY';
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
        if (normalized.observerKey) host[normalized.observerKey] = observer;
      }
      if (host.document.readyState === 'loading') host.document.addEventListener('DOMContentLoaded', start, { once: true });
      else start();
      return true;
    }

    return Object.freeze({
      CONTROLLER_VERSION: normalized.version,
      COMPOSER_SELECTOR: normalized.composerSelector,
      THREAD_PATH_RE: threadPathRe,
      SEND_LABEL_RE: sendLabelRe,
      isType,
      accountForPartition,
      installPageController(page = root, version = normalized.version, overrides = {}) {
        return installPageController(page, version, { ...pageOptions, ...overrides });
      },
      installShell,
    });
  }

  return Object.freeze({ create, installPageController });
});
