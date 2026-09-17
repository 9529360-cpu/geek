(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.GeekWhatsAppDirectComposerController = api;
    if (root.document) api.installShell(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const CONTROLLER_VERSION = 8;
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
    return restored ? '翻译失败（未分类），原文已恢复，请重试' : '翻译失败（未分类），原文未发送';
  }

  function installPageController(page, version = CONTROLLER_VERSION, parseFailure = parseTranslationFailure, failureNotice = translationFailureNotice) {
    if (!page) return 'NO_PAGE';
    try { page.__geekWhatsAppSendRecovery?.controller?.abort?.(); } catch {}
    try {
      const timer = page.__geekWhatsAppSendRecovery?.timer;
      if (timer != null && typeof page.clearInterval === 'function') page.clearInterval(timer);
    } catch {}
    try { page.__geekWhatsAppPublicComposerFallback?.controller?.abort?.(); } catch {}
    try { page.__geekWhatsAppGuardAbort?.abort?.(); } catch {}

    const current = page.__geekWhatsAppDirectComposerController;
    if (current?.version === version && typeof current.handleNativeSend === 'function') return 'READY';
    try { current?.controller?.abort?.(); } catch {}

    const diagnostics = { phase: 'ready', handled: 0, translated: 0, sent: 0, passthrough: 0, lastError: '', lastCode: '', lastCategory: '', lastStatus: 0, lastAt: Date.now() };
    let nativeQueue = Promise.resolve();

    const setPhase = (phase, error) => {
      diagnostics.phase = phase;
      diagnostics.lastError = error ? String(error?.message || error).slice(0, 160) : '';
      diagnostics.lastCode = error ? String(error?.code || '').slice(0, 100) : '';
      diagnostics.lastCategory = error ? String(error?.category || '').slice(0, 64) : '';
      diagnostics.lastStatus = error && Number.isInteger(error.status) ? error.status : 0;
      diagnostics.lastAt = Date.now();
    };

    const notify = message => {
      try {
        const doc = page.document;
        if (!doc?.createElement || !doc?.body) return;
        doc.getElementById?.('geek-translation-send-error')?.remove?.();
        const notice = doc.createElement('div');
        notice.id = 'geek-translation-send-error';
        notice.textContent = message;
        Object.assign(notice.style || {}, { position: 'fixed', left: '50%', bottom: '82px', transform: 'translateX(-50%)', zIndex: '999999', padding: '8px 12px', borderRadius: '7px', background: '#b42318', color: '#fff', fontSize: '12px', boxShadow: '0 8px 24px rgba(0,0,0,.35)' });
        doc.body.appendChild(notice);
        page.setTimeout?.(() => notice.remove?.(), 3600);
      } catch {}
    };

    const pickRuntime = requirements => {
      try { const picked = page.__geekPickWpp?.(requirements); if (picked) return picked; } catch {}
      const paths = Array.isArray(requirements) ? requirements : [requirements];
      const resolvePath = (candidate, path) => String(path || '').split('.').filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], candidate);
      return [page.WPP, page.WAPLUS_WPP]
        .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index)
        .find(candidate => paths.every(path => resolvePath(candidate, path) != null)) || null;
    };

    const getActiveChat = () => {
      try {
        const runtime = pickRuntime(['chat.getActiveChat']);
        return runtime?.chat?.getActiveChat?.() || page.W?.chat?.getActive?.() || null;
      } catch {
        return null;
      }
    };

    const idString = value => {
      try { return String(value?._serialized || value?.id?._serialized || value?.toString?.() || value || ''); }
      catch { return ''; }
    };
    const chatIdOf = chat => idString(chat?.id || chat);

    const isDirectChat = (chat, chatId) => {
      const id = String(chatId || '');
      if (!id) return false;
      if (chat?.isGroup === true || chat?.isNewsletter === true || chat?.isBroadcast === true) return false;
      try { if (typeof chat?.id?.isGroup === 'function' && chat.id.isGroup()) return false; } catch {}
      return !/@g\.us$/i.test(id) && !/@broadcast$/i.test(id) && !/@newsletter$/i.test(id);
    };

    const isGroupChat = (chat, chatId) => {
      const id = String(chatId || '');
      if (!id || chat?.isNewsletter === true || chat?.isBroadcast === true) return false;
      if (chat?.isGroup === true || /@g\.us$/i.test(id)) return true;
      try { return typeof chat?.id?.isGroup === 'function' && chat.id.isGroup(); }
      catch { return false; }
    };

    const pnIdentity = value => {
      const raw = idString(value).trim().toLowerCase();
      const match = raw.match(/^([+0-9]+)@(?:c\.us|s\.whatsapp\.net)$/i);
      const digits = match ? match[1].replace(/\D/g, '') : '';
      return digits ? `pn:${digits}` : '';
    };

    const canonicalDirectIdentity = async value => {
      const raw = idString(value).trim();
      if (!raw) return null;
      const directPn = pnIdentity(raw);
      if (directPn) return directPn;
      if (/@lid$/i.test(raw)) {
        try {
          const runtime = pickRuntime(['contact.getPnLidEntry']);
          const pair = await runtime?.contact?.getPnLidEntry?.(raw);
          const phoneNumber = pair?.phoneNumber || pair?.pn;
          return pnIdentity(phoneNumber) || null;
        } catch {
          return null;
        }
      }
      return `raw:${raw.toLowerCase()}`;
    };

    const sameDirectIdentity = async (left, right) => {
      const a = idString(left).trim();
      const b = idString(right).trim();
      if (!a || !b) return null;
      if (a === b) return true;
      const canonicalA = await canonicalDirectIdentity(a);
      const canonicalB = await canonicalDirectIdentity(b);
      if (!canonicalA || !canonicalB) return null;
      return canonicalA === canonicalB;
    };

    const hasOwn = (value, key) => !!value && Object.prototype.hasOwnProperty.call(value, key);

    const resolveTranslationSetting = async (chat, text) => {
      const nativeId = chatIdOf(chat);
      const direct = isDirectChat(chat, nativeId);
      const group = isGroupChat(chat, nativeId);
      if ((!direct && !group) || typeof text !== 'string' || !text.trim()) {
        return { mode: 'passthrough', chatId: nativeId, setting: null };
      }

      const config = page.__geekTranslationConfig;
      const getter = page.__geekGetTranslationSetting;
      if (!config || typeof getter !== 'function') {
        return { mode: 'blocked', chatId: nativeId, setting: null, reason: 'config-unavailable' };
      }

      const activeId = chatIdOf(getActiveChat());
      const chats = config.chats || {};
      let settingId = nativeId || activeId;

      if (direct && activeId && hasOwn(chats, activeId)) {
        if (activeId === nativeId) {
          settingId = activeId;
        } else {
          const same = await sameDirectIdentity(activeId, nativeId);
          if (same === true) settingId = activeId;
          else if (same === null) return { mode: 'blocked', chatId: nativeId, setting: null, reason: 'identity-unresolved' };
          else if (nativeId && hasOwn(chats, nativeId)) settingId = nativeId;
        }
      } else if (nativeId && hasOwn(chats, nativeId)) {
        settingId = nativeId;
      }

      const setting = getter(settingId);
      if (!setting?.enabled || !setting?.autoSend) {
        return { mode: 'passthrough', chatId: settingId || nativeId, setting };
      }
      if (setting.includeZh === false && /[\u3400-\u9fff]/.test(text)) {
        return { mode: 'passthrough', chatId: settingId || nativeId, setting };
      }
      return { mode: 'translate', chatId: settingId || nativeId, setting };
    };

    const handleNativeSend = function (chat, rawArgs, original, thisArg) {
      const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
      if (typeof original !== 'function') return Promise.reject(new TypeError('WhatsApp原生发送函数不可用'));

      const nativeId = chatIdOf(chat);
      const text = args[0];
      const direct = isDirectChat(chat, nativeId);
      const group = isGroupChat(chat, nativeId);
      if (typeof text !== 'string' || (!direct && !group)) {
        diagnostics.passthrough += 1;
        return original.call(thisArg, chat, ...args);
      }

      const run = async () => {
        diagnostics.handled += 1;
        const resolved = await resolveTranslationSetting(chat, text);
        if (resolved.mode === 'passthrough') {
          diagnostics.passthrough += 1;
          setPhase('passthrough');
          return original.call(thisArg, chat, ...args);
        }
        if (resolved.mode === 'blocked') {
          const identityBlocked = resolved.reason === 'identity-unresolved';
          const error = Object.assign(new Error(identityBlocked ? '无法确认当前 WhatsApp 聊天身份' : '翻译配置尚未就绪'), {
            __geekStage: 'translation',
            code: identityBlocked ? 'TRANSLATION_CHAT_IDENTITY_UNRESOLVED' : 'TRANSLATION_BRIDGE_UNAVAILABLE',
            category: 'bridge',
            retryable: true,
          });
          setPhase('translation-error', error);
          notify(identityBlocked ? '无法确认当前聊天的翻译设置，原文未发送' : '翻译尚未就绪，原文未发送');
          throw error;
        }

        const translate = page.__geekTranslationRequest;
        if (typeof translate !== 'function') {
          const error = Object.assign(new Error('翻译尚未就绪'), {
            __geekStage: 'translation',
            code: 'TRANSLATION_BRIDGE_UNAVAILABLE',
            category: 'bridge',
            retryable: true,
          });
          setPhase('translation-error', error);
          notify(typeof failureNotice === 'function' ? failureNotice(error) : '翻译尚未就绪，原文未发送');
          throw error;
        }

        let stage = 'translation';
        let failure = null;
        try {
          setPhase('translating');
          const translated = await translate({
            text,
            intent: 'outgoing-send',
            source: resolved.setting.source || 'auto',
            target: resolved.setting.target,
            provider: resolved.setting.provider,
            route: resolved.setting.route,
            chatId: resolved.chatId,
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

          const activeAfter = chatIdOf(getActiveChat());
          const stillSame = group ? activeAfter === nativeId : await sameDirectIdentity(activeAfter, nativeId);
          if (stillSame !== true) {
            throw Object.assign(new Error('聊天已切换，翻译发送已取消'), { __geekStage: 'translation' });
          }

          page.__geekRememberOutgoing?.(translated.text, text);
          args[0] = translated.text;
          diagnostics.translated += 1;
          stage = 'send';
          setPhase('sending');
          const sent = await original.call(thisArg, chat, ...args);
          diagnostics.sent += 1;
          setPhase('sent');
          return sent;
        } catch (error) {
          const failedStage = error?.__geekStage || stage;
          if (failedStage === 'translation') {
            failure = typeof parseFailure === 'function' ? parseFailure(error) : error;
            setPhase('translation-error', failure);
            notify(/聊天已切换/.test(String(failure?.message || failure || ''))
              ? '聊天已切换，原文未发送'
              : (typeof failureNotice === 'function' ? failureNotice(failure, false) : '翻译失败（未分类），原文未发送'));
          } else {
            failure = error;
            setPhase('send-error', error);
            notify('WhatsApp发送失败：' + String(error?.message || error || '未知错误').slice(0, 120));
          }
          page.console?.error?.('[geek-whatsapp-translation-send]', String(failure?.message || failure || '').slice(0, 240));
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
    page.__geekWhatsAppDirectComposerController = Object.freeze({ version, controller, diagnostics, handleNativeSend, resolveTranslationSetting, sameDirectIdentity });
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

  return Object.freeze({ CONTROLLER_VERSION, TRANSLATION_ERROR_ENVELOPE_PREFIX, isWhatsAppType, accountForPartition, parseTranslationFailure, translationFailureNotice, installPageController, installShell });
});