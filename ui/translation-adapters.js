/* Telegram Web A翻译适配器：只负责消息DOM识别和译文挂载，API/缓存由宿主公共核心处理。 */
(() => {
  'use strict';
  function installTelegramTranslation(cfg) {
    const rawConfig = cfg || { chats: {}, global: {} };
    const bridgeToken = String(rawConfig.bridgeToken || '');
    const config = { accountId: rawConfig.accountId, chats: rawConfig.chats || {}, global: rawConfig.global || {} };
    window.__geekTranslationConfig = config;
    window.__geekTranslationBridgeToken = bridgeToken;
    if (!window.__geekTranslationRequest) {
      window.__geekTranslationPending = new Map();
      window.__geekTranslationRequest = function (payload) {
        return new Promise((resolve, reject) => {
          const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
          const body = payload && typeof payload === 'object' ? payload : {};
          const intent = body.intent === 'outgoing-send' ? 'outgoing-send' : 'message-display';
          const securedPayload = { ...body, intent, bridgeToken: window.__geekTranslationBridgeToken };
          window.__geekTranslationPending.set(id, { payload: securedPayload, resolve, reject });
          if (document.documentElement?.getAttribute?.('data-geek-bridge') === '1') {
            window.postMessage({ __geekBridge: true, payload: { type: 'translation-request', id, token: window.__geekTranslationBridgeToken } }, window.location.origin);
          } else {
            console.log('__GEEK_TRANSLATION_REQUEST__:' + id + ':' + window.__geekTranslationBridgeToken);
          }
          setTimeout(() => {
            const pending = window.__geekTranslationPending.get(id);
            if (pending) { window.__geekTranslationPending.delete(id); pending.reject(new Error('翻译请求超时')); }
          }, 35000);
        });
      };
      window.__geekTakeTranslationRequest = id => {
        const p = window.__geekTranslationPending.get(id);
        return p ? JSON.stringify(p.payload) : null;
      };
      window.__geekResolveTranslation = (id, result, error) => {
        const p = window.__geekTranslationPending.get(id);
        if (!p) return false;
        window.__geekTranslationPending.delete(id);
        if (error) p.reject(new Error(error)); else p.resolve(result);
        return true;
      };
    }
    const translationSendErrorMessage = error => {
      const prefix = '__GEEK_TRANSLATION_ERROR_V1__:';
      const raw = String(error?.message || error || '');
      if (!raw.startsWith(prefix)) return '翻译失败，原文未发送';
      let detail;
      try { detail = JSON.parse(raw.slice(prefix.length)); } catch { return '翻译失败，原文未发送'; }
      if (!detail || typeof detail !== 'object') return '翻译失败，原文未发送';
      const code = String(detail.code || '');
      const category = String(detail.category || '');
      const status = Number(detail.status) || 0;
      if (code === 'QUOTA_EXHAUSTED' || category === 'quota' || status === 402) return '翻译额度已用完，请到个人中心开通；原文未发送';
      if (code === 'SUBSCRIPTION_LOGIN_REQUIRED' || code === 'TRANSLATION_AUTH_REQUIRED') return '翻译需要重新登录，请到个人中心登录；原文未发送';
      if (code === 'SUBSCRIPTION_SESSION_CHANGED' || category === 'auth' || status === 401 || status === 403) return '翻译授权状态已变化，请重新登录后重试；原文未发送';
      if (code === 'TRANSLATION_DEADLINE_EXCEEDED' || category === 'deadline' || status === 504) return '翻译服务响应超时，请稍后重试；原文未发送';
      if (code === 'TRANSLATION_QUALITY_REJECTED' || category === 'quality') return '译文未通过质量校验，请修改原文后重试；原文未发送';
      if (code === 'BRIDGE_BUSY' || code === 'TRANSLATION_BUSY' || category === 'capacity' || status === 429) return '翻译请求繁忙，请稍后重试；原文未发送';
      if (category === 'gateway' || category === 'rate-limit' || status >= 500) return '翻译服务暂时不可用，请稍后重试；原文未发送';
      return '翻译失败，原文未发送';
    };
    const nativeInputEnvelopePrefix = '\u001eGEEK_NATIVE_INPUT_V1\u001e';
    const encodeNativeInputRequest = (text, expectedChatId) => nativeInputEnvelopePrefix + JSON.stringify({
      token: String(window.__geekTranslationBridgeToken || ''),
      expectedChatId: String(expectedChatId || ''),
      text: String(text ?? ''),
    });
    window.__geekNativeInputPending = window.__geekNativeInputPending || new Map();
    window.__geekTakeNativeInputRequest = id => {
      const p = window.__geekNativeInputPending.get(id);
      return p ? JSON.stringify({ accountId: config.accountId, bridgeToken: window.__geekTranslationBridgeToken, text: p.wireText || '' }) : null;
    };
    window.__geekResolveNativeInput = (id, ok, error) => {
      const p = window.__geekNativeInputPending.get(id);
      if (!p) return false;
      window.__geekNativeInputPending.delete(id);
      if (ok) p.resolve(true); else p.reject(new Error(error || '原生输入失败'));
      return true;
    };
    const nativeInsertText = (text, expectedChatId = '') => {
      const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
      const expected = String(expectedChatId || '');
      const wireText = encodeNativeInputRequest(text, expected);
      return new Promise((resolve, reject) => {
        window.__geekNativeInputPending.set(id, { resolve, reject, wireText, expectedChatId: expected });
        if (document.documentElement?.getAttribute?.('data-geek-bridge') === '1') {
          window.postMessage({ __geekBridge: true, payload: { type: 'native-input-request', id, token: window.__geekTranslationBridgeToken } }, window.location.origin);
        } else {
          console.log('__GEEK_NATIVE_INPUT_REQUEST__:' + id + ':' + window.__geekTranslationBridgeToken);
        }
        setTimeout(() => {
          const p = window.__geekNativeInputPending.get(id);
          if (p) {
            window.__geekNativeInputPending.delete(id);
            p.reject(new Error('原生输入请求超时'));
          }
        }, 10000);
      });
    };

    const generation = window.__geekTelegramTranslationGeneration = (window.__geekTelegramTranslationGeneration || 0) + 1;
    window.__geekTelegramTranslationObserver?.disconnect();
    document.querySelectorAll('.geek-translation-result[data-geek-platform="telegram"]').forEach(n => n.remove());
    document.querySelectorAll('[data-geek-telegram-translation-state]').forEach(n => delete n.dataset.geekTelegramTranslationState);

    const settingFor = chatId => {
      const g = window.__geekTranslationConfig.global || {};
      const base = {
        provider: g.source || 'auto', route: g.server || 'default',
        enabled: g.send === true, autoSend: g.send === true,
        displayTranslation: g.displayTranslation !== false,
        translationMode: g.translationMode || (g.message === false ? 'click' : 'auto'),
        messageFrom: g.messageFrom || 'auto', messageTarget: g.messageTo || 'zh',
        translateHistory: g.translateHistory === true || g.transOldHistory === true,
        fontSize: g.fontSize || '13', fontColor: g.fontColor || '#667eea', groupAuto: g.group === true
      };
      const local = window.__geekTranslationConfig.chats?.[chatId];
      return local ? { ...base, ...local } : base;
    };
    const chatId = () => {
      const hash = String(location.hash || '').replace(/^#/, '');
      if (hash) return hash.split('?')[0];
      const active = document.querySelector('#LeftColumn .Chat.active, #LeftColumn .Chat.selected, .Chat.active');
      const link = active?.querySelector('a[href]');
      return link ? String(link.getAttribute('href') || '').replace(/^#/, '') : '';
    };
    const messageTextNode = row => row.querySelector('.text-content, .message-text');
    const messageText = node => (node?.innerText || node?.textContent || '').replace(/\u200b/g, '').trim();
    const messageId = row => String(row.id || row.dataset.messageId || row.dataset.mid || row.getAttribute('data-mid') || '').trim();
    const outgoing = row => /out|outgoing|is-outgoing/i.test(String(row.className || '')) || !!row.querySelector('.MessageOutgoingStatus, [class*="outgoing"]');
    const process = async (row, isHistory = false) => {
      if (!(row instanceof Element) || !row.classList.contains('Message')) return;
      if (row.dataset.geekTelegramTranslationState || row.querySelector('.geek-translation-result[data-geek-platform="telegram"]')) return;
      const id = messageId(row) || ('dom-' + Array.from(document.querySelectorAll('.Message')).indexOf(row));
      const cid = chatId(); if (!cid) return;
      const setting = settingFor(cid); if (!setting.displayTranslation) return;
      const textNode = messageTextNode(row);
      if (!textNode) {
        if (!row.dataset.geekTelegramTranslationRetry) {
          row.dataset.geekTelegramTranslationRetry = '1';
          setTimeout(() => { delete row.dataset.geekTelegramTranslationRetry; delete row.dataset.geekTelegramTranslationState; process(row, isHistory); }, 500);
        }
        return;
      }
      const text = messageText(textNode); if (!text) return;
      row.dataset.geekTelegramTranslationState = 'queued';
      const box = document.createElement('div');
      box.className = 'geek-translation-result'; box.dataset.geekPlatform = 'telegram'; box.dataset.messageId = id;
      box.style.cssText = `padding-top:3px;color:${setting.fontColor};font-size:${setting.fontSize}px;line-height:1.35;white-space:pre-wrap;`;
      textNode.insertAdjacentElement('afterend', box);
      const run = async () => {
        const current = window.__geekTelegramTranslationGeneration;
        box.textContent = '';
        row.dataset.geekTelegramTranslationState = 'loading';
        try {
          const result = await window.__geekTranslationRequest({ text, source: setting.messageFrom || 'auto', target: setting.messageTarget || 'zh', provider: setting.provider, route: setting.route, chatId: cid, messageId: id, isHistory, translateHistory: setting.translateHistory || setting.translationMode === 'click', intent: 'message-display' });
          if (current !== window.__geekTelegramTranslationGeneration || !settingFor(cid).displayTranslation) { box.remove(); delete row.dataset.geekTelegramTranslationState; return; }
          if (result?.skipped) { box.remove(); delete row.dataset.geekTelegramTranslationState; return; }
          if (!result?.text) throw new Error('翻译失败');
          box.textContent = result.text; row.dataset.geekTelegramTranslationState = 'done';
        } catch (e) {
          if (current !== window.__geekTelegramTranslationGeneration) return;
          box.textContent = '翻译失败，点击重试'; box.style.color = '#ff8a8a'; box.style.cursor = 'pointer'; row.dataset.geekTelegramTranslationState = 'error';
          box.onclick = () => { delete row.dataset.geekTelegramTranslationState; box.remove(); process(row, isHistory); };
        }
      };
      if (setting.translationMode === 'click') { box.textContent = '点击翻译'; box.style.cursor = 'pointer'; row.dataset.geekTelegramTranslationState = 'wait'; box.onclick = run; }
      else await run();
    };
    const root = document.querySelector('#MiddleColumn') || document.querySelector('#Main') || document.body;
    const sendEditor = () => document.querySelector('#editable-message-text.form-control.ProseMirror, #editable-message-text[contenteditable="true"], .input-message-input[contenteditable="true"]:not(.input-field-input-fake)');
    const isWebKEditor = editor => !!editor?.matches?.('.input-message-input:not(.input-field-input-fake)');
    window.__geekTelegramSendAbort?.abort();
    window.__geekTelegramSendAbort = new AbortController();
    window.__geekTelegramSendBound = true;
    window.__geekTelegramSendLock = false;
    window.__geekTelegramNativeInputCommit = false;
    const sendButton = () => document.querySelector('#MiddleColumn button.Button.send.main-button, #Main button.Button.send.main-button, button[aria-label="发送消息"], button[aria-label="Send"], .btn-send');
    const notifySendBlocked = message => {
      document.getElementById('geek-translation-send-error')?.remove();
      const notice = document.createElement('div'); notice.id = 'geek-translation-send-error'; notice.textContent = message;
      Object.assign(notice.style, { position: 'fixed', left: '50%', bottom: '82px', transform: 'translateX(-50%)', zIndex: '999999', padding: '8px 12px', borderRadius: '7px', background: '#b42318', color: '#fff', fontSize: '12px', boxShadow: '0 8px 24px rgba(0,0,0,.35)' });
      document.body.appendChild(notice); setTimeout(() => notice.remove(), 3200);
    };
    const blockRepeatedUserSend = event => {
      if (!event?.isTrusted) return false;
      event.preventDefault(); event.stopImmediatePropagation();
      return true;
    };
    const translateAndSend = async (event, editor, button) => {
      // A synthetic click is how the verified translation is finally submitted.
      // Only swallow repeated trusted user input while that translation is pending.
      if (window.__geekTelegramSendLock) { blockRepeatedUserSend(event); return; }
      const cid = chatId(); const setting = settingFor(cid || '');
      if (!setting?.enabled || setting.autoSend === false) return;
      const original = messageText(editor).replace(/\n$/, '').trim();
      if (!original || (setting.includeZh === false && /[\u3400-\u9fff]/.test(original))) return;
      event?.preventDefault?.(); event?.stopImmediatePropagation?.();
      if (!cid || !window.__geekTranslationRequest) {
        notifySendBlocked('翻译尚未就绪，已阻止原文发送');
        editor.focus();
        return;
      }
      const assertSendContext = () => {
        if (chatId() !== cid) throw new Error('聊天已切换，翻译发送已取消');
        const liveEditor = sendEditor();
        if (liveEditor !== editor || editor.isConnected === false) throw new Error('消息输入框已变化，翻译发送已取消');
      };
      window.__geekTelegramSendLock = true;
      const keepWebKContenteditable = isWebKEditor(editor);
      if (!keepWebKContenteditable) editor.setAttribute('contenteditable', 'false');
      try {
        const result = await window.__geekTranslationRequest({ text: original, source: setting.source || 'auto', target: setting.target || 'en', provider: setting.provider, route: setting.route, chatId: cid, intent: 'outgoing-send' });
        if (!result?.text) throw new Error('翻译失败');
        assertSendContext();
        if (!keepWebKContenteditable) editor.setAttribute('contenteditable', 'true');
        editor.focus();
        const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range);
        window.__geekTelegramNativeInputCommit = true;
        try {
          await nativeInsertText(result.text, cid);
        } finally {
          window.__geekTelegramNativeInputCommit = false;
        }
        await new Promise(resolve => setTimeout(resolve, 30));
        assertSendContext();
        const editorAfterFill = messageText(editor);
        const normalizeEditorText = value => String(value || '').replace(/\n[\t ]*\n+/g, '\n').trim();
        if (normalizeEditorText(editorAfterFill) !== normalizeEditorText(result.text)) throw new Error('Telegram编辑器回填校验失败');
        assertSendContext();
        const submitButton = sendButton() || ((button && button.isConnected !== false) ? button : null);
        if (!submitButton) throw new Error('Telegram发送按钮不可用');
        submitButton.click();
      } catch (error) {
        console.error('[geek-telegram-translation-send]', error);
        const cancelled = /聊天已切换|输入框已变化/.test(String(error?.message || error));
        notifySendBlocked(cancelled ? '聊天已切换，翻译发送已取消' : translationSendErrorMessage(error));
        if (editor.isConnected !== false) {
          if (!keepWebKContenteditable) editor.setAttribute('contenteditable', 'true');
          if (sendEditor() === editor) editor.focus();
        }
      } finally { window.__geekTelegramNativeInputCommit = false; window.__geekTelegramSendLock = false; }
    };
    document.addEventListener('beforeinput', event => {
      if (!window.__geekTelegramSendLock || !event.isTrusted || window.__geekTelegramNativeInputCommit) return;
      const editor = event.target?.closest?.('#editable-message-text.form-control.ProseMirror, #editable-message-text[contenteditable="true"], .input-message-input[contenteditable="true"]:not(.input-field-input-fake)');
      if (!editor) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, signal: window.__geekTelegramSendAbort.signal });
    document.addEventListener('keydown', event => {
      const editor = event.target?.closest?.('#editable-message-text.form-control.ProseMirror, #editable-message-text[contenteditable="true"], .input-message-input[contenteditable="true"]:not(.input-field-input-fake)');
      if (!editor || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      translateAndSend(event, editor, sendButton());
    }, { capture: true, signal: window.__geekTelegramSendAbort.signal });
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('#MiddleColumn button.Button.send.main-button, #Main button.Button.send.main-button, button[aria-label="发送消息"], button[aria-label="Send"], .btn-send');
      const editor = sendEditor();
      if (!button || !editor) return;
      translateAndSend(event, editor, button);
    }, { capture: true, signal: window.__geekTelegramSendAbort.signal });
    window.__geekTelegramComposer = sendEditor;
    window.__geekTelegramTranslationObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains('Message')) process(node, false);
        node.querySelectorAll?.('.Message').forEach(item => process(item, false));
      }
    });
    window.__geekTelegramTranslationObserver.observe(root, { childList: true, subtree: true });
    root.querySelectorAll?.('.Message').forEach(item => process(item, true));
    return 'TELEGRAM_TRANSLATION_READY';
  }
  function installLineTranslation(cfg) {
    const rawConfig = cfg || { chats: {}, global: {} };
    const bridgeToken = String(rawConfig.bridgeToken || '');
    const config = { accountId: rawConfig.accountId, chats: rawConfig.chats || {}, global: rawConfig.global || {} };
    window.__geekTranslationConfig = config;
    window.__geekTranslationBridgeToken = bridgeToken;
    if (!window.__geekTranslationRequest) {
      window.__geekTranslationPending = new Map();
      window.__geekTranslationRequest = payload => new Promise((resolve, reject) => {
        const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
        const body = payload && typeof payload === 'object' ? payload : {};
        const intent = body.intent === 'outgoing-send' ? 'outgoing-send' : 'message-display';
        const securedPayload = { ...body, intent, bridgeToken: window.__geekTranslationBridgeToken };
        window.__geekTranslationPending.set(id, { payload: securedPayload, resolve, reject });
        if (window.$electron?.send2Host) window.$electron.send2Host({ type: 'geek-translation-request', id, token: window.__geekTranslationBridgeToken });
        else console.log('__GEEK_TRANSLATION_REQUEST__:' + id + ':' + window.__geekTranslationBridgeToken);
        setTimeout(() => { const p = window.__geekTranslationPending.get(id); if (p) { window.__geekTranslationPending.delete(id); p.reject(new Error('翻译请求超时')); } }, 35000);
      });
      window.__geekTakeTranslationRequest = id => { const p = window.__geekTranslationPending.get(id); return p ? JSON.stringify(p.payload) : null; };
      window.__geekResolveTranslation = (id, result, error) => { const p = window.__geekTranslationPending.get(id); if (!p) return false; window.__geekTranslationPending.delete(id); if (error) p.reject(new Error(error)); else p.resolve(result); return true; };
    }
    const translationSendErrorMessage = error => {
      const prefix = '__GEEK_TRANSLATION_ERROR_V1__:';
      const raw = String(error?.message || error || '');
      if (!raw.startsWith(prefix)) return '翻译失败，原文未发送';
      let detail;
      try { detail = JSON.parse(raw.slice(prefix.length)); } catch { return '翻译失败，原文未发送'; }
      if (!detail || typeof detail !== 'object') return '翻译失败，原文未发送';
      const code = String(detail.code || '');
      const category = String(detail.category || '');
      const status = Number(detail.status) || 0;
      if (code === 'QUOTA_EXHAUSTED' || category === 'quota' || status === 402) return '翻译额度已用完，请到个人中心开通；原文未发送';
      if (code === 'SUBSCRIPTION_LOGIN_REQUIRED' || code === 'TRANSLATION_AUTH_REQUIRED') return '翻译需要重新登录，请到个人中心登录；原文未发送';
      if (code === 'SUBSCRIPTION_SESSION_CHANGED' || category === 'auth' || status === 401 || status === 403) return '翻译授权状态已变化，请重新登录后重试；原文未发送';
      if (code === 'TRANSLATION_DEADLINE_EXCEEDED' || category === 'deadline' || status === 504) return '翻译服务响应超时，请稍后重试；原文未发送';
      if (code === 'TRANSLATION_QUALITY_REJECTED' || category === 'quality') return '译文未通过质量校验，请修改原文后重试；原文未发送';
      if (code === 'BRIDGE_BUSY' || code === 'TRANSLATION_BUSY' || category === 'capacity' || status === 429) return '翻译请求繁忙，请稍后重试；原文未发送';
      if (category === 'gateway' || category === 'rate-limit' || status >= 500) return '翻译服务暂时不可用，请稍后重试；原文未发送';
      return '翻译失败，原文未发送';
    };
    const nativeInputEnvelopePrefix = '\u001eGEEK_NATIVE_INPUT_V1\u001e';
    const encodeNativeInputRequest = (text, expectedChatId) => nativeInputEnvelopePrefix + JSON.stringify({
      token: String(window.__geekTranslationBridgeToken || ''),
      expectedChatId: String(expectedChatId || ''),
      text: String(text ?? ''),
    });
    window.__geekNativeInputPending = window.__geekNativeInputPending || new Map();
    window.__geekTakeNativeInputRequest = id => {
      const p = window.__geekNativeInputPending.get(id);
      return p ? JSON.stringify({ accountId: config.accountId, bridgeToken: window.__geekTranslationBridgeToken, text: p.wireText || '' }) : null;
    };
    window.__geekResolveNativeInput = (id, ok, error) => {
      const p = window.__geekNativeInputPending.get(id);
      if (!p) return false;
      window.__geekNativeInputPending.delete(id);
      if (ok) p.resolve(true); else p.reject(new Error(error || '原生输入失败'));
      return true;
    };
    const nativeInsertText = (text, expectedChatId = '') => {
      const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
      const expected = String(expectedChatId || '');
      const wireText = encodeNativeInputRequest(text, expected);
      return new Promise((resolve, reject) => {
        window.__geekNativeInputPending.set(id, { resolve, reject, wireText, expectedChatId: expected });
        if (window.$electron?.send2Host) window.$electron.send2Host({ type: 'geek-native-input-request', id, token: window.__geekTranslationBridgeToken });
        else console.log('__GEEK_NATIVE_INPUT_REQUEST__:' + id + ':' + window.__geekTranslationBridgeToken);
        setTimeout(() => {
          const p = window.__geekNativeInputPending.get(id);
          if (p) {
            window.__geekNativeInputPending.delete(id);
            p.reject(new Error('原生输入请求超时'));
          }
        }, 10000);
      });
    };
    const generation = window.__geekLineTranslationGeneration = (window.__geekLineTranslationGeneration || 0) + 1;
    window.__geekLineTranslationObserver?.disconnect();
    document.querySelectorAll('.geek-translation-result[data-geek-platform="line"]').forEach(node => node.remove());
    document.querySelectorAll('[data-geek-line-translation-state]').forEach(node => delete node.dataset.geekLineTranslationState);
    const chatId = () => {
      try {
        const pathname = String(location.hash || '').replace(/^#/, '').split('?')[0];
        const match = pathname.match(/^\/[^/]+\/([^/]+)\/?$/);
        return match ? decodeURIComponent(match[1]) : '';
      } catch { return ''; }
    };
    const settingFor = id => {
      const g = window.__geekTranslationConfig.global || {};
      const base = { provider: g.source || 'auto', route: g.server || 'default', enabled: g.send === true, autoSend: g.send === true, sendFrom: g.sendFrom || 'auto', sendTo: g.sendTo || 'en', includeZh: g.includeZh !== false, displayTranslation: g.displayTranslation !== false, translationMode: g.translationMode || (g.message === false ? 'click' : 'auto'), messageFrom: g.messageFrom || 'auto', messageTarget: g.messageTo || 'zh', fontSize: g.fontSize || '13', fontColor: g.fontColor || '#667eea' };
      return window.__geekTranslationConfig.chats?.[id] ? { ...base, ...window.__geekTranslationConfig.chats[id] } : base;
    };
    const textOf = row => (row.querySelector('[data-message-content][data-is-message-text="true"]')?.innerText || '').replace(/\u200b/g, '').trim();
    const process = async row => {
      if (!(row instanceof Element) || !row.matches('[class*="message-module__message__"][data-mid]') || row.dataset.geekLineTranslationState) return;
      const text = textOf(row); if (!text || /^[-+]?\d+(?:[.,]\d+)?$/.test(text)) return;
      const cid = chatId(); const setting = settingFor(cid); if (!cid || !setting.displayTranslation) return;
      row.dataset.geekLineTranslationState = 'queued';
      const content = row.querySelector('[class*="textMessageContent-module__content_wrap__"]') || row.querySelector('[class*="message-module__content_inner__"]');
      if (!content) { delete row.dataset.geekLineTranslationState; return; }
      const box = document.createElement('pre'); box.className = 'geek-translation-result'; box.dataset.geekPlatform = 'line';
      Object.assign(box.style, { margin: '4px 0 0', padding: '3px 7px', borderLeft: '2px solid #7c8cff', whiteSpace: 'pre-wrap', fontSize: `${setting.fontSize || 13}px`, lineHeight: '1.35', color: setting.fontColor || '#667eea', cursor: 'pointer' });
      content.appendChild(box);
      const run = async () => {
        box.textContent = '翻译中…'; row.dataset.geekLineTranslationState = 'loading';
        try { const result = await window.__geekTranslationRequest({ text, source: setting.messageFrom || 'auto', target: setting.messageTarget || 'zh', provider: setting.provider, route: setting.route, chatId: cid, intent: 'message-display' }); if (generation !== window.__geekLineTranslationGeneration || !box.isConnected) return; if (!result?.text) throw new Error('翻译失败'); box.textContent = result.text; row.dataset.geekLineTranslationState = 'done'; }
        catch (error) { if (generation !== window.__geekLineTranslationGeneration || !box.isConnected) return; box.textContent = `翻译失败，点击重试`; box.title = String(error?.message || error); row.dataset.geekLineTranslationState = 'error'; }
      };
      box.addEventListener('click', run);
      if (setting.translationMode === 'auto') run(); else { box.textContent = '点击翻译'; row.dataset.geekLineTranslationState = 'click'; }
    };
    window.__geekLineSendAbort?.abort();
    window.__geekLineSendAbort = new AbortController();
    window.__geekLineSendLock = false;
    const notifySendBlocked = message => {
      document.getElementById('geek-translation-send-error')?.remove();
      const notice = document.createElement('div'); notice.id = 'geek-translation-send-error'; notice.textContent = message;
      Object.assign(notice.style, { position: 'fixed', left: '50%', bottom: '72px', transform: 'translateX(-50%)', zIndex: '999999', padding: '8px 12px', borderRadius: '7px', background: '#b42318', color: '#fff', fontSize: '12px', boxShadow: '0 8px 24px rgba(0,0,0,.35)' });
      document.body.appendChild(notice); setTimeout(() => notice.remove(), 3200);
    };
    const blockRepeatedUserSend = event => {
      if (!event?.isTrusted) return false;
      event.preventDefault(); event.stopImmediatePropagation();
      return true;
    };
    const liveComposerHost = () => document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
    const sendButton = () => document.querySelector('button[aria-label="Send"],button[aria-label="发送"],button[type="submit"],[class*="chatroomEditor-module__editor_area__"] button[data-action="send"]');
    const composerHost = event => {
      const path = event.composedPath?.() || [];
      return path.find(node => node?.tagName === 'TEXTAREA-EX') || liveComposerHost();
    };
    const translateAndSend = async (event, host, button = null) => {
      // Keep the synthetic verified-text submit alive, but never let a second
      // trusted Enter/click fall through to LINE while translation is pending.
      if (window.__geekLineSendLock) { blockRepeatedUserSend(event); return; }
      if (!host) return;
      const cid = chatId(); const setting = settingFor(cid || '');
      if (!setting.enabled || !setting.autoSend) return;
      const values = Array.isArray(host.value) ? host.value : [host.value];
      const original = values.filter(value => typeof value === 'string').join('').trim();
      if (!original || /^[-+]?\d+(?:[.,]\d+)?$/.test(original)) return;
      event.preventDefault(); event.stopImmediatePropagation(); window.__geekLineSendLock = true;
      const assertSendContext = () => {
        if (chatId() !== cid) throw new Error('聊天已切换，翻译发送已取消');
        const liveHost = liveComposerHost();
        if (liveHost !== host || host.isConnected === false) throw new Error('消息输入框已变化，翻译发送已取消');
      };
      try {
        if (!cid || !window.__geekTranslationRequest) throw new Error('翻译尚未就绪');
        const result = await window.__geekTranslationRequest({ text: original, source: setting.sendFrom || 'auto', target: setting.target || setting.sendTo || 'en', provider: setting.provider, route: setting.route, chatId: cid, intent: 'outgoing-send' });
        if (!result?.text) throw new Error('翻译失败');
        assertSendContext();
        const textarea = host.shadowRoot?.querySelector('textarea'); if (!textarea) throw new Error('LINE输入组件不可用');
        textarea.focus(); textarea.select();
        await nativeInsertText(result.text, cid);
        await new Promise(resolve => setTimeout(resolve, 100));
        assertSendContext();
        const after = String(textarea.value || '').trim();
        if (after !== result.text.trim()) throw new Error('LINE编辑器回填校验失败');
        if (!setting.includeZh && window.GeekTranslationCore?.isChinese(after)) throw new Error('译文仍包含中文，已阻止发送');
        assertSendContext();
        const submitButton = (button && button.isConnected !== false) ? button : sendButton();
        if (!submitButton) throw new Error('LINE发送按钮不可用');
        submitButton.click();
      } catch (error) {
        console.error('[geek-line-translation-send]', error);
        const cancelled = /聊天已切换|输入框已变化/.test(String(error?.message || error));
        notifySendBlocked(cancelled ? '聊天已切换，翻译发送已取消' : translationSendErrorMessage(error));
      }
      finally { window.__geekLineSendLock = false; }
    };
    document.addEventListener('keydown', event => {
      if (!event.isTrusted || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const path = event.composedPath?.() || [];
      const host = composerHost(event);
      if (!host || !path.some(node => node === host || node === host.shadowRoot?.querySelector('textarea'))) return;
      translateAndSend(event, host);
    }, { capture: true, signal: window.__geekLineSendAbort.signal });
    document.addEventListener('click', event => {
      if (!event.isTrusted) return;
      const button = event.target?.closest?.('button[aria-label="Send"],button[aria-label="发送"],button[type="submit"],[class*="chatroomEditor-module__editor_area__"] button[data-action="send"]');
      if (!button || !button.closest?.('[class*="chatroomEditor-module__editor_area__"]')) return;
      translateAndSend(event, composerHost(event), button);
    }, { capture: true, signal: window.__geekLineSendAbort.signal });
    const scan = root => { if (root?.matches?.('[class*="message-module__message__"][data-mid]')) process(root); root?.querySelectorAll?.('[class*="message-module__message__"][data-mid]').forEach(process); };
    window.__geekLineTranslationObserver = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) scan(node); });
    window.__geekLineTranslationObserver.observe(document.body, { childList: true, subtree: true });
    scan(document);
    return 'LINE_TRANSLATION_READY';
  }
  window.GeekTranslationAdapters = window.GeekTranslationAdapters || {};
  window.GeekTranslationAdapters.telegram = installTelegramTranslation;
  window.GeekTranslationAdapters.line = installLineTranslation;
})();
