/* Telegram Web A翻译适配器：只负责消息DOM识别和译文挂载，API/缓存由宿主公共核心处理。 */
(() => {
  'use strict';
  function installTelegramTranslation(cfg) {
    const config = cfg || { chats: {}, global: {} };
    window.__geekTranslationConfig = config;
    if (!window.__geekTranslationRequest) {
      window.__geekTranslationPending = new Map();
      window.__geekTranslationRequest = function (payload) {
        return new Promise((resolve, reject) => {
          const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
          window.__geekTranslationPending.set(id, { payload, resolve, reject });
          console.log('__GEEK_TRANSLATION_REQUEST__:' + id);
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
    window.__geekNativeInputPending = window.__geekNativeInputPending || new Map();
    window.__geekTakeNativeInputRequest = id => {
      const p = window.__geekNativeInputPending.get(id);
      return p ? JSON.stringify({ accountId: config.accountId, text: p.text || '' }) : null;
    };
    window.__geekResolveNativeInput = (id, ok, error) => {
      const p = window.__geekNativeInputPending.get(id);
      if (!p) return false;
      window.__geekNativeInputPending.delete(id);
      if (ok) p.resolve(true); else p.reject(new Error(error || '原生输入失败'));
      return true;
    };
    const nativeInsertText = text => {
      const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
      return new Promise((resolve, reject) => {
        window.__geekNativeInputPending.set(id, { resolve, reject, text: String(text) });
        console.log('__GEEK_NATIVE_INPUT_REQUEST__:' + id);
        setTimeout(() => { const p = window.__geekNativeInputPending.get(id); if (p) { window.__geekNativeInputPending.delete(id); p.reject(new Error('原生输入请求超时')); } }, 10000);
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
    const process = async row => {
      if (!(row instanceof Element) || !row.classList.contains('Message')) return;
      if (row.dataset.geekTelegramTranslationState || row.querySelector('.geek-translation-result[data-geek-platform="telegram"]')) return;
      const id = messageId(row) || ('dom-' + Array.from(document.querySelectorAll('.Message')).indexOf(row));
      const cid = chatId(); if (!cid) return;
      const setting = settingFor(cid); if (!setting.displayTranslation) return;
      const textNode = messageTextNode(row);
      if (!textNode) {
        if (!row.dataset.geekTelegramTranslationRetry) {
          row.dataset.geekTelegramTranslationRetry = '1';
          setTimeout(() => { delete row.dataset.geekTelegramTranslationRetry; delete row.dataset.geekTelegramTranslationState; process(row); }, 500);
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
        row.dataset.geekTelegramTranslationState = 'loading'; box.textContent = '翻译中…';
        try {
          const result = await window.__geekTranslationRequest({ text, source: setting.messageFrom || 'auto', target: setting.messageTarget || 'zh', provider: setting.provider, route: setting.route, chatId: cid, messageId: id });
          if (current !== window.__geekTelegramTranslationGeneration || !settingFor(cid).displayTranslation) { box.remove(); delete row.dataset.geekTelegramTranslationState; return; }
          if (!result?.text) throw new Error('翻译失败');
          box.textContent = result.text; row.dataset.geekTelegramTranslationState = 'done';
        } catch (e) {
          if (current !== window.__geekTelegramTranslationGeneration) return;
          box.textContent = '翻译失败，点击重试'; box.style.color = '#ff8a8a'; box.style.cursor = 'pointer'; row.dataset.geekTelegramTranslationState = 'error';
          box.onclick = () => { delete row.dataset.geekTelegramTranslationState; box.remove(); process(row); };
        }
      };
      if (setting.translationMode === 'click') { box.textContent = '点击翻译'; box.style.cursor = 'pointer'; row.dataset.geekTelegramTranslationState = 'wait'; box.onclick = run; }
      else await run();
    };
    const root = document.querySelector('#MiddleColumn') || document.querySelector('#Main') || document.body;
    const sendEditor = () => document.querySelector('#editable-message-text.form-control.ProseMirror, #editable-message-text[contenteditable="true"]');
    window.__geekTelegramSendAbort?.abort();
    window.__geekTelegramSendAbort = new AbortController();
    window.__geekTelegramSendBound = true;
    window.__geekTelegramSendLock = false;
    const sendButton = () => document.querySelector('#MiddleColumn button.Button.send.main-button, #Main button.Button.send.main-button, button[aria-label="发送消息"], button[aria-label="Send"]');
    const translateAndSend = async (event, editor, button) => {
      const cid = chatId(); const setting = settingFor(cid);
      if (!cid || !setting?.enabled || setting.autoSend === false || !window.__geekTranslationRequest || window.__geekTelegramSendLock) return;
      const original = messageText(editor).replace(/\n$/, '').trim();
      if (!original || (setting.includeZh === false && window.GeekTranslationCore?.isChinese(original))) return;
      event?.preventDefault?.(); event?.stopImmediatePropagation?.();
      window.__geekTelegramSendLock = true;
      editor.setAttribute('contenteditable', 'false');
      try {
        const result = await window.__geekTranslationRequest({ text: original, source: setting.source || 'auto', target: setting.target || 'en', provider: setting.provider, route: setting.route, chatId: cid });
        if (!result?.text) throw new Error('翻译失败');
        editor.setAttribute('contenteditable', 'true'); editor.focus();
        const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range);
        await nativeInsertText(result.text);
        await new Promise(resolve => setTimeout(resolve, 30));
        const editorAfterFill = messageText(editor);
        const normalizeEditorText = value => String(value || '').replace(/\n[\t ]*\n+/g, '\n').trim();
        if (normalizeEditorText(editorAfterFill) !== normalizeEditorText(result.text)) throw new Error('Telegram编辑器回填校验失败');
        (button || sendButton())?.click();
      } catch (error) {
        console.error('[geek-telegram-translation-send]', error);
        editor.setAttribute('contenteditable', 'true'); editor.focus();
      } finally { window.__geekTelegramSendLock = false; }
    };
    document.addEventListener('keydown', event => {
      const editor = event.target?.closest?.('#editable-message-text.form-control.ProseMirror, #editable-message-text[contenteditable="true"]');
      if (!editor || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      translateAndSend(event, editor, sendButton());
    }, { capture: true, signal: window.__geekTelegramSendAbort.signal });
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('#MiddleColumn button.Button.send.main-button, #Main button.Button.send.main-button, button[aria-label="发送消息"], button[aria-label="Send"]');
      const editor = sendEditor();
      if (!button || !editor) return;
      translateAndSend(event, editor, button);
    }, { capture: true, signal: window.__geekTelegramSendAbort.signal });
    window.__geekTelegramComposer = sendEditor;
    window.__geekTelegramTranslationObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains('Message')) process(node);
        node.querySelectorAll?.('.Message').forEach(process);
      }
    });
    window.__geekTelegramTranslationObserver.observe(root, { childList: true, subtree: true });
    root.querySelectorAll?.('.Message').forEach(process);
    return 'TELEGRAM_TRANSLATION_READY';
  }
  function installLineTranslation(cfg) {
    const config = cfg || { chats: {}, global: {} };
    window.__geekTranslationConfig = config;
    if (!window.__geekTranslationRequest) {
      window.__geekTranslationPending = new Map();
      window.__geekTranslationRequest = payload => new Promise((resolve, reject) => {
        const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
        window.__geekTranslationPending.set(id, { payload, resolve, reject });
        if (window.$electron?.send2Host) window.$electron.send2Host({ type: 'geek-translation-request', id });
        else console.log('__GEEK_TRANSLATION_REQUEST__:' + id);
        setTimeout(() => { const p = window.__geekTranslationPending.get(id); if (p) { window.__geekTranslationPending.delete(id); p.reject(new Error('翻译请求超时')); } }, 35000);
      });
      window.__geekTakeTranslationRequest = id => { const p = window.__geekTranslationPending.get(id); return p ? JSON.stringify(p.payload) : null; };
      window.__geekResolveTranslation = (id, result, error) => { const p = window.__geekTranslationPending.get(id); if (!p) return false; window.__geekTranslationPending.delete(id); if (error) p.reject(new Error(error)); else p.resolve(result); return true; };
    }
    const generation = window.__geekLineTranslationGeneration = (window.__geekLineTranslationGeneration || 0) + 1;
    window.__geekLineTranslationObserver?.disconnect();
    document.querySelectorAll('.geek-translation-result[data-geek-platform="line"]').forEach(node => node.remove());
    document.querySelectorAll('[data-geek-line-translation-state]').forEach(node => delete node.dataset.geekLineTranslationState);
    const chatId = () => decodeURIComponent((String(location.hash || '').match(/\/chats\/([^/?]+)/) || [])[1] || '');
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
        try { const result = await window.__geekTranslationRequest({ text, source: setting.messageFrom || 'auto', target: setting.messageTarget || 'zh', provider: setting.provider, route: setting.route, chatId: cid }); if (generation !== window.__geekLineTranslationGeneration || !box.isConnected) return; if (!result?.text) throw new Error('翻译失败'); box.textContent = result.text; row.dataset.geekLineTranslationState = 'done'; }
        catch (error) { if (generation !== window.__geekLineTranslationGeneration || !box.isConnected) return; box.textContent = `翻译失败，点击重试`; box.title = String(error?.message || error); row.dataset.geekLineTranslationState = 'error'; }
      };
      box.addEventListener('click', run);
      if (setting.translationMode === 'auto') run(); else { box.textContent = '点击翻译'; row.dataset.geekLineTranslationState = 'click'; }
    };
    window.__geekLineSendAbort?.abort();
    window.__geekLineSendAbort = new AbortController();
    window.__geekLineSendLock = false;
    document.addEventListener('keydown', async event => {
      if (!event.isTrusted || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const path = event.composedPath?.() || [];
      const host = path.find(node => node?.tagName === 'TEXTAREA-EX') || document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
      if (!host || !path.some(node => node === host || node === host.shadowRoot?.querySelector('textarea'))) return;
      const cid = chatId(); const setting = settingFor(cid);
      if (!cid || !setting.enabled || !setting.autoSend || !window.__geekTranslationRequest || window.__geekLineSendLock) return;
      const values = Array.isArray(host.value) ? host.value : [host.value];
      const original = values.filter(value => typeof value === 'string').join('').trim();
      if (!original || /^[-+]?\d+(?:[.,]\d+)?$/.test(original)) return;
      event.preventDefault(); event.stopImmediatePropagation(); window.__geekLineSendLock = true;
      try {
        const result = await window.__geekTranslationRequest({ text: original, source: setting.sendFrom || 'auto', target: setting.target || setting.sendTo || 'en', provider: setting.provider, route: setting.route, chatId: cid });
        if (!result?.text) throw new Error('翻译失败');
        const textarea = host.shadowRoot?.querySelector('textarea'); if (!textarea || typeof host.insertValue !== 'function') throw new Error('LINE输入组件不可用');
        textarea.focus(); document.execCommand('selectAll', false, null); host.insertValue([result.text]);
        await new Promise(resolve => setTimeout(resolve, 100));
        const after = (Array.isArray(host.value) ? host.value : [host.value]).filter(value => typeof value === 'string').join('').trim();
        if (after !== result.text.trim()) throw new Error('LINE编辑器回填校验失败');
        if (!setting.includeZh && window.GeekTranslationCore?.isChinese(after)) throw new Error('译文仍包含中文，已阻止发送');
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
      } catch (error) { console.error('[geek-line-translation-send]', error); }
      finally { window.__geekLineSendLock = false; }
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
