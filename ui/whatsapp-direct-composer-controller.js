(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekWhatsAppDirectComposerController = api;
  if (root?.document && root?.api) api.installShell(root);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const CONTROLLER_VERSION = 9;
  const TRANSLATION_ERROR_ENVELOPE_PREFIX = '__GEEK_TRANSLATION_ERROR_V1__:';
  const COMPOSER_SELECTOR = '#main footer [contenteditable="true"], #main [data-testid="conversation-compose-box-input"], #main [contenteditable="true"][data-tab="10"]';
  const SEND_SELECTOR = 'button[aria-label="Send"], button[aria-label="发送"], [data-testid="compose-btn-send"]';

  function isWhatsAppType(type) {
    return type === 'whatsapp' || type === 'whatsapp-pure';
  }

  function accountForPartition(accounts, partition) {
    return (Array.isArray(accounts) ? accounts : []).find(account =>
      isWhatsAppType(account?.type) && String(account?.partition || '') === String(partition || '')
    ) || null;
  }

  function parseTranslationFailure(error) {
    const prefix = '__GEEK_TRANSLATION_ERROR_V1__:';
    const tagged = error && (typeof error === 'object' || typeof error === 'function')
      ? error
      : new Error(String(error || '翻译失败'));
    const rawMessage = String(tagged?.message || '');
    const markerIndex = rawMessage.indexOf(prefix);
    if (markerIndex < 0) {
      if (/翻译请求超时/.test(rawMessage)) {
        try { tagged.code = 'TRANSLATION_DEADLINE_EXCEEDED'; } catch {}
        try { tagged.category = 'deadline'; } catch {}
        try { tagged.retryable = true; } catch {}
        try { tagged.status = 504; } catch {}
      } else if (/翻译请求令牌不匹配/.test(rawMessage)) {
        try { tagged.code = 'TRANSLATION_BRIDGE_TOKEN_MISMATCH'; } catch {}
        try { tagged.category = 'bridge'; } catch {}
        try { tagged.retryable = true; } catch {}
      } else if (/翻译账号沙箱不存在/.test(rawMessage)) {
        try { tagged.code = 'TRANSLATION_BRIDGE_ACCOUNT_MISSING'; } catch {}
        try { tagged.category = 'bridge'; } catch {}
        try { tagged.retryable = true; } catch {}
      }
      return tagged;
    }
    let detail;
    try { detail = JSON.parse(rawMessage.slice(markerIndex + prefix.length)); }
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

    if (code === 'QUOTA_EXHAUSTED' || category === 'quota' || status === 402) return `翻译额度已用完，请到个人中心开通；${tail}`;
    if (code === 'SUBSCRIPTION_LOGIN_REQUIRED' || code === 'TRANSLATION_AUTH_REQUIRED') return `翻译需要重新登录，请到个人中心登录；${tail}`;
    if (code === 'SUBSCRIPTION_SESSION_CHANGED' || category === 'auth' || status === 401 || status === 403) return `翻译授权状态已变化，请重新登录后重试；${tail}`;
    if (code === 'TRANSLATION_DEADLINE_EXCEEDED' || category === 'deadline' || status === 504) return `翻译服务响应超时，请稍后重试；${tail}`;
    if (code === 'TRANSLATION_QUALITY_REJECTED' || category === 'quality') return `译文未通过质量校验，请修改原文后重试；${tail}`;
    if (code === 'BRIDGE_BUSY' || code === 'TRANSLATION_BUSY' || category === 'capacity' || status === 429) return `翻译请求繁忙，请稍后重试；${tail}`;
    if (category === 'bridge' || code.startsWith('TRANSLATION_BRIDGE_')) return `翻译连接状态异常，请刷新当前账号后重试；${tail}`;
    if (category === 'input' || status === 400 || status === 404 || status === 413 || status === 422) {
      if (code === 'TRANSLATION_TARGET_INVALID' || code === 'invalid_target') return `翻译目标语言配置无效，请重新选择目标语言；${tail}`;
      const safeCode = /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : 'TRANSLATION_INPUT';
      return `翻译请求参数无效（${safeCode}），请检查翻译设置；${tail}`;
    }
    if (category === 'account' || code === 'TRANSLATION_ACCOUNT_MISSING' || code === 'TRANSLATION_ACCOUNT_DELETED') return `翻译账号状态异常，请刷新当前账号后重试；${tail}`;
    if (category === 'conflict' || status === 409) return `翻译请求状态冲突，请重试；${tail}`;
    if (category === 'gateway' || category === 'rate-limit' || status >= 500) return `翻译服务暂时不可用，请稍后重试；${tail}`;
    const safeCode = /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : '';
    if (safeCode) return `翻译失败（${safeCode}）；${tail}`;
    return restored ? '翻译失败，原文已恢复，请重试' : '翻译失败，原文未发送';
  }

  function installPageController(page = root, version = CONTROLLER_VERSION, parseFailure = parseTranslationFailure, failureNotice = translationFailureNotice, composerSelector = COMPOSER_SELECTOR, sendSelector = SEND_SELECTOR) {
    if (!page?.document) return 'NO_DOCUMENT';
    try { page.__geekWhatsAppSendRecovery?.controller?.abort?.(); } catch {}
    try {
      const timer = page.__geekWhatsAppSendRecovery?.timer;
      if (timer != null && typeof page.clearInterval === 'function') page.clearInterval(timer);
    } catch {}
    try { page.__geekWhatsAppPublicComposerFallback?.controller?.abort?.(); } catch {}
    try { page.__geekWhatsAppGuardAbort?.abort?.(); } catch {}
    const previous = page.__geekWhatsAppDirectComposerController;
    if (Number(previous?.version || 0) === Number(version || 0) && previous?.active === true) return 'READY';
    try { previous?.controller?.abort?.(); } catch {}

    const Abort = page.AbortController || globalThis.AbortController;
    const controller = typeof Abort === 'function' ? new Abort() : null;
    const signal = controller?.signal;
    let sendLock = false;

    const composerText = editor => String(editor?.innerText || editor?.textContent || '').replace(/\u200b/g, '').trim();
    const currentChatId = () => {
      try {
        const active = page.WPP?.chat?.getActiveChat?.() || page.W?.chat?.getActive?.();
        return String(active?.id?._serialized || '');
      } catch { return ''; }
    };
    const eventElement = event => {
      const target = event?.target;
      return target && target.nodeType === 1 && typeof target.closest === 'function' ? target : null;
    };
    const notify = message => {
      try {
        page.document.getElementById('geek-translation-send-error')?.remove();
        const notice = page.document.createElement('div');
        notice.id = 'geek-translation-send-error';
        notice.textContent = message;
        Object.assign(notice.style, { position:'fixed', left:'50%', bottom:'82px', transform:'translateX(-50%)', zIndex:'999999', padding:'8px 12px', borderRadius:'7px', background:'#b42318', color:'#fff', fontSize:'12px', boxShadow:'0 8px 24px rgba(0,0,0,.35)' });
        page.document.body?.appendChild(notice);
        page.setTimeout?.(() => notice.remove(), 3200);
      } catch {}
    };
    const block = event => {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
    };
    const submitThroughOwner = async (event, editor) => {
      if (page.document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return false;
      if (event?.isTrusted !== true || !editor) return false;
      const text = composerText(editor);
      const chatId = currentChatId();
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
        if (String(result.text) !== text) page.__geekRememberOutgoing?.(String(result.text), text);
        return true;
      } catch (error) {
        const failure = parseFailure(error);
        page.console?.error?.('[geek-whatsapp-send-intent]', String(failure?.message || failure || '').slice(0, 240));
        notify(failureNotice(failure));
        if (editor.isConnected !== false) editor.focus?.();
        return false;
      } finally {
        sendLock = false;
      }
    };

    page.document.addEventListener('keydown', event => {
      if (page.document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return;
      if (event?.isTrusted !== true || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) return;
      const editor = eventElement(event)?.closest(composerSelector);
      if (!editor) return;
      void submitThroughOwner(event, editor);
    }, { capture: true, ...(signal ? { signal } : {}) });

    page.document.addEventListener('click', event => {
      if (page.document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return;
      if (event?.isTrusted !== true) return;
      const target = eventElement(event);
      const button = target?.closest(sendSelector) || (target?.closest?.('button')?.querySelector?.('[data-icon="send"]') ? target.closest('button') : null);
      if (!button) return;
      const editor = page.document.querySelector(composerSelector);
      if (!editor) return;
      void submitThroughOwner(event, editor);
    }, { capture: true, ...(signal ? { signal } : {}) });

    page.__geekWhatsAppDirectComposerController = Object.freeze({
      version,
      active: true,
      controller,
      submitThroughOwner,
    });
    return 'READY';
  }

  function installShell(host = root) {
    if (!host?.document || host.__geekWhatsAppDirectComposerControllerShellInstalled) return false;
    host.__geekWhatsAppDirectComposerControllerShellInstalled = true;
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
        const expression = '(' + installPageController.toString() + ')(window,' + JSON.stringify(CONTROLLER_VERSION) + ',' + parseTranslationFailure.toString() + ',' + translationFailureNotice.toString() + ',' + JSON.stringify(COMPOSER_SELECTOR) + ',' + JSON.stringify(SEND_SELECTOR) + ')';
        const result = await webview.executeJavaScript(expression);
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
      host.__geekWhatsAppDirectComposerControllerObserver = observer;
    }

    if (host.document.readyState === 'loading') host.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    return true;
  }

  return Object.freeze({
    CONTROLLER_VERSION,
    TRANSLATION_ERROR_ENVELOPE_PREFIX,
    isWhatsAppType,
    accountForPartition,
    parseTranslationFailure,
    translationFailureNotice,
    installPageController,
    installShell,
  });
});
