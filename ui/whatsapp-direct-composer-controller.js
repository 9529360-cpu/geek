(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.GeekWhatsAppDirectComposerController = api;
    if (root.document) api.installShell(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const CONTROLLER_VERSION = 4;
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
    if (category === 'bridge' || code.startsWith('TRANSLATION_BRIDGE_')) {
      return `翻译连接状态异常，请刷新当前账号后重试；${tail}`;
    }
    if (category === 'input' || status === 400 || status === 404 || status === 413 || status === 422) {
      if (code === 'TRANSLATION_TARGET_INVALID' || code === 'invalid_target') {
        return `翻译目标语言配置无效，请重新选择目标语言；${tail}`;
      }
      const safeCode = /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : 'TRANSLATION_INPUT';
      return `翻译请求参数无效（${safeCode}），请检查翻译设置；${tail}`;
    }
    if (category === 'account' || code === 'TRANSLATION_ACCOUNT_MISSING' || code === 'TRANSLATION_ACCOUNT_DELETED') {
      return `翻译账号状态异常，请刷新当前账号后重试；${tail}`;
    }
    if (category === 'conflict' || status === 409) {
      return `翻译请求状态冲突，请重试；${tail}`;
    }
    if (category === 'gateway' || category === 'rate-limit' || status >= 500) {
      return `翻译服务暂时不可用，请稍后重试；${tail}`;
    }
    const safeCode = /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : '';
    if (safeCode) return `翻译失败（${safeCode}）；${tail}`;
    return restored ? '翻译失败（未分类），原文已恢复，请重试' : '翻译失败（未分类），原文未发送';
  }

  function installPageController(
    page,
    version = CONTROLLER_VERSION,
    parseFailure = parseTranslationFailure,
    failureNotice = translationFailureNotice,
  ) {
    if (!page) return 'NO_PAGE';

    try { page.__geekWhatsAppSendRecovery?.controller?.abort?.(); } catch {}
    try {
      const timer = page.__geekWhatsAppSendRecovery?.timer;
      if (timer != null && typeof page.clearInterval === 'function') page.clearInterval(timer);
    } catch {}
    try { page.__geekWhatsAppPublicComposerFallback?.controller?.abort?.(); } catch {}
    try { page.__geekWhatsAppGuardAbort?.abort?.(); } catch {}

    const current = page.__geekWhatsAppDirectComposerController;
    if (current?.version === version && typeof current.handleGesture === 'function') return 'READY';
    try { current?.controller?.abort?.(); } catch {}

    const cleanText = value => String(value == null ? '' : value).replace(/\u200b/g, '').trim();
    const composerSelector = [
      '#main [data-testid="conversation-compose-box-input"]',
      '#main footer [contenteditable="true"]',
      '#main [contenteditable="true"][role="textbox"]',
      '#main [contenteditable="true"]',
      '[contenteditable="true"][data-tab="10"]',
    ].join(',');

    const diagnostics = {
      phase: 'ready',
      handled: 0,
      sent: 0,
      lastError: '',
      lastCode: '',
      lastCategory: '',
      lastStatus: 0,
      lastAt: Date.now(),
    };
    let pending = null;
    let nativeQueue = Promise.resolve();

    const setPhase = function (phase, error) {
      diagnostics.phase = phase;
      diagnostics.lastError = error ? String(error?.message || error).slice(0, 160) : '';
      diagnostics.lastCode = error ? String(error?.code || '').slice(0, 100) : '';
      diagnostics.lastCategory = error ? String(error?.category || '').slice(0, 64) : '';
      diagnostics.lastStatus = error && Number.isInteger(error.status) ? error.status : 0;
      diagnostics.lastAt = Date.now();
    };

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
        page.setTimeout?.(() => notice.remove?.(), 3600);
      } catch {}
    };

    const pickRuntime = function (requirements) {
      try {
        const picked = page.__geekPickWpp?.(requirements);
        if (picked) return picked;
      } catch {}
      const paths = Array.isArray(requirements) ? requirements : [requirements];
      const resolvePath = (candidate, path) => String(path || '')
        .split('.')
        .filter(Boolean)
        .reduce((value, key) => value == null ? undefined : value[key], candidate);
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

    const chatIdOf = function (chat) {
      try {
        return String(chat?.id?._serialized || chat?.id?.toString?.() || chat?.id || '');
      } catch {
        return '';
      }
    };

    const isDirectChat = function (chat, chatId) {
      const id = String(chatId || '');
      if (!id) return false;
      if (chat?.isGroup === true || chat?.isNewsletter === true || chat?.isBroadcast === true) return false;
      try { if (typeof chat?.id?.isGroup === 'function' && chat.id.isGroup()) return false; } catch {}
      return !/@g\.us$/i.test(id) && !/@broadcast$/i.test(id) && !/@newsletter$/i.test(id);
    };

    const translationSetting = function (chatId, text) {
      const setting = page.__geekGetTranslationSetting?.(chatId);
      if (!setting?.enabled || !setting?.autoSend || !text) return null;
      if (setting.includeZh === false && /[\u3400-\u9fff]/.test(text)) return null;
      return setting;
    };

    const composerFromTarget = function (target) {
      try {
        if (target?.isContentEditable === true) return target;
        return target?.closest?.('[contenteditable="true"], [data-testid="conversation-compose-box-input"]') || null;
      } catch {
        return null;
      }
    };

    const findComposer = function (event) {
      const fromTarget = composerFromTarget(event?.target);
      if (fromTarget) return fromTarget;
      try { return page.document?.querySelector?.(composerSelector) || null; }
      catch { return null; }
    };

    const composerText = function (event) {
      const editor = findComposer(event);
      return { editor, text: cleanText(editor?.innerText || editor?.textContent || '') };
    };

    const isSendButtonTarget = function (target) {
      try {
        if (target?.closest?.('button[aria-label="Send"],button[aria-label="发送"],[data-testid="compose-btn-send"]')) return true;
        return !!target?.closest?.('[data-icon="send"]')?.closest?.('button');
      } catch {
        return false;
      }
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

    const setCompose = function (chat, contents) {
      try {
        if (typeof chat?.setComposeContents !== 'function') return false;
        chat.setComposeContents(contents || {});
        return true;
      } catch {
        return false;
      }
    };

    const restoreCompose = function (chat, snapshot, text) {
      const next = snapshot && typeof snapshot === 'object' ? { ...snapshot } : {};
      if (!cleanText(next.text)) next.text = String(text || '');
      return setCompose(chat, next);
    };

    const block = function (event) {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
    };

    const handleGesture = function (event) {
      if (event?.isTrusted !== true) return false;

      const chat = getActiveChat();
      const chatId = chatIdOf(chat);
      if (!isDirectChat(chat, chatId)) return false;

      const composed = composerText(event);
      const text = composed.text;
      if (!text) return false;
      const setting = translationSetting(chatId, text);
      if (!setting) return false;

      block(event);
      diagnostics.handled += 1;

      if (pending) {
        setPhase('busy');
        notify('翻译处理中，请稍候');
        return true;
      }

      const translate = page.__geekTranslationRequest;
      if (typeof translate !== 'function') {
        setPhase('translation-unavailable');
        notify('翻译尚未就绪，原文未发送');
        return true;
      }

      const runtime = pickRuntime(['chat.sendTextMessage']);
      if (!runtime || typeof runtime?.chat?.sendTextMessage !== 'function') {
        setPhase('send-unavailable');
        notify('WhatsApp发送通道尚未就绪，原文未发送');
        return true;
      }

      const snapshot = captureComposeSnapshot(chat, text);
      const quotedMsg = chat?.composeQuotedMsg || null;
      const cleared = setCompose(chat, {});

      const task = (async () => {
        setPhase('translating');
        try {
          const translated = await translate({
            text,
            source: setting.source || 'auto',
            target: setting.target,
            provider: setting.provider,
            route: setting.route,
            chatId,
          });
          if (!translated?.text) {
            throw Object.assign(new Error('翻译返回为空'), {
              __geekStage: 'translation',
              code: 'TRANSLATION_EMPTY_RESULT',
              category: 'gateway',
              retryable: true,
              status: 502,
            });
          }

          const currentChat = getActiveChat();
          if (chatIdOf(currentChat) !== chatId) {
            throw Object.assign(new Error('聊天已切换，翻译发送已取消'), { __geekStage: 'translation' });
          }

          page.__geekRememberOutgoing?.(translated.text, text);
          setPhase('sending');
          const options = quotedMsg ? { quotedMsg } : undefined;
          const sent = await runtime.chat.sendTextMessage(chatId, translated.text, options);
          if (sent == null) throw Object.assign(new Error('WhatsApp未确认消息发送'), { __geekStage: 'send' });
          setCompose(chat, {});
          diagnostics.sent += 1;
          setPhase('sent');
          return sent;
        } catch (error) {
          const stage = error?.__geekStage || (diagnostics.phase === 'sending' ? 'send' : 'translation');
          if (stage === 'translation') {
            const normalized = typeof parseFailure === 'function' ? parseFailure(error) : error;
            const restored = cleared ? restoreCompose(chat, snapshot, text) : true;
            setPhase('translation-error', normalized);
            if (/聊天已切换/.test(String(normalized?.message || normalized))) {
              notify(restored ? '聊天已切换，原文已恢复，请重试' : '聊天已切换，原文未发送');
            } else {
              notify(typeof failureNotice === 'function'
                ? failureNotice(normalized, restored)
                : (restored ? '翻译失败，原文已恢复，请重试' : '翻译失败，原文未发送'));
            }
            page.console?.error?.('[geek-whatsapp-direct-composer]', String(normalized?.message || normalized || '').slice(0, 240));
          } else {
            setPhase('send-error', error);
            notify('WhatsApp发送失败：' + String(error?.message || error || '未知错误').slice(0, 120));
            page.console?.error?.('[geek-whatsapp-direct-composer]', String(error?.message || error || '').slice(0, 240));
          }
          return null;
        } finally {
          pending = null;
        }
      })();

      pending = task;
      page.__geekWhatsAppDirectComposerLastTask = task;
      return true;
    };

    // Native WhatsApp composer fallback. app.js may still own the low-level hook
    // for compatibility, but translated direct-send policy lives here only.
    // This path is used when a real WhatsApp gesture bypasses the DOM owner.
    const handleNativeSend = function (chat, rawArgs, original, thisArg) {
      const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
      if (typeof original !== 'function') {
        return Promise.reject(new TypeError('WhatsApp原生发送函数不可用'));
      }

      const chatId = chatIdOf(chat);
      const text = args[0];
      const setting = typeof text === 'string' && isDirectChat(chat, chatId)
        ? translationSetting(chatId, text)
        : null;
      if (!setting) return original.call(thisArg, chat, ...args);

      const run = async () => {
        let stage = 'translation';
        let failure = null;
        try {
          const translate = page.__geekTranslationRequest;
          if (typeof translate !== 'function') {
            throw Object.assign(new Error('翻译尚未就绪'), {
              __geekStage: 'translation',
              code: 'TRANSLATION_BRIDGE_UNAVAILABLE',
              category: 'bridge',
              retryable: true,
            });
          }

          setPhase('native-translating');
          const translated = await translate({
            text,
            source: setting.source || 'auto',
            target: setting.target,
            provider: setting.provider,
            route: setting.route,
            chatId,
          });
          if (!translated?.text) {
            throw Object.assign(new Error('翻译返回为空'), {
              __geekStage: 'translation',
              code: 'TRANSLATION_EMPTY_RESULT',
              category: 'gateway',
              retryable: true,
              status: 502,
            });
          }

          const activeId = chatIdOf(getActiveChat());
          if (activeId && activeId !== chatId) {
            throw Object.assign(new Error('聊天已切换，翻译发送已取消'), { __geekStage: 'translation' });
          }

          page.__geekRememberOutgoing?.(translated.text, text);
          args[0] = translated.text;
          stage = 'send';
          setPhase('native-sending');
          const sent = await original.call(thisArg, chat, ...args);
          diagnostics.sent += 1;
          setPhase('sent');
          return sent;
        } catch (error) {
          const failedStage = error?.__geekStage || stage;
          if (failedStage === 'translation') {
            failure = typeof parseFailure === 'function' ? parseFailure(error) : error;
            setPhase('translation-error', failure);
            if (/聊天已切换/.test(String(failure?.message || failure || ''))) {
              notify('聊天已切换，原文未发送');
            } else {
              notify(typeof failureNotice === 'function'
                ? failureNotice(failure, false)
                : '翻译失败（未分类），原文未发送');
            }
          } else {
            failure = error;
            setPhase('send-error', error);
            notify('WhatsApp发送失败：' + String(error?.message || error || '未知错误').slice(0, 120));
          }
          page.console?.error?.('[geek-whatsapp-direct-composer/native]', String(failure?.message || failure || '').slice(0, 240));
          throw failure;
        }
      };

      const next = nativeQueue.then(run, run);
      nativeQueue = next.catch(() => {});
      page.__geekWhatsAppDirectComposerLastTask = next;
      return next;
    };

    const Abort = page.AbortController || globalThis.AbortController;
    const controller = typeof Abort === 'function' ? new Abort() : null;
    const listenerOptions = controller ? { capture: true, signal: controller.signal } : { capture: true };

    page.addEventListener?.('keydown', event => {
      if (event?.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (!composerFromTarget(event?.target)) return;
      handleGesture(event);
    }, listenerOptions);
    page.addEventListener?.('click', event => {
      if (!isSendButtonTarget(event?.target)) return;
      handleGesture(event);
    }, listenerOptions);

    const state = Object.freeze({ version, controller, diagnostics, handleGesture, handleNativeSend });
    page.__geekWhatsAppDirectComposerController = state;
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
        const result = await webview.executeJavaScript(`(${installPageController.toString()})(window, ${CONTROLLER_VERSION}, ${parseTranslationFailure.toString()}, ${translationFailureNotice.toString()})`);
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
