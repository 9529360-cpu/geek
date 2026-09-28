/* Platform-family host adapters. The app composes this registry; platform DOM/native mechanics stay here. */
(() => {
  'use strict';

  const TG_EDITOR = '#editable-message-text.form-control.ProseMirror, #editable-message-text[contenteditable="true"], .input-message-input[contenteditable="true"]:not(.input-field-input-fake)';
  const TG_EDITOR_READ = '#editable-message-text, .input-message-input[contenteditable="true"]:not(.input-field-input-fake)';
  const LINE_SELECTED = '[class*="chatlistItem-module__chatlist_item__"][data-mid][aria-current="true"]';
  const LINE_HOST = 'textarea-ex[class*="chatroomEditor-module__textarea__"]';

  const currentChatScripts = Object.freeze({
    whatsapp: `(() => { try { return window.WPP?.chat?.getActiveChat?.()?.id?._serialized || window.W?.chat?.getActive?.()?.id?._serialized || null; } catch { return null; } })()`,
    telegram: `(() => String(location.hash || '').replace(/^#/, '').split('?')[0] || null)()`,
    line: `(() => {
      try {
        const selected = document.querySelector('${LINE_SELECTED}');
        const selectedId = String(selected?.getAttribute('data-mid') || '');
        if (selectedId) return selectedId;
        const pathname = String(location.hash || '').replace(/^#/, '').split('?')[0];
        const match = pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/);
        return match ? decodeURIComponent(match[1]) : null;
      } catch { return null; }
    })()`,
  });

  const BUILTIN_FAMILIES = new Set(['telegram', 'line', 'whatsapp']);
  const extensionFactories = new Map();

  function normalizeFamily(value) {
    const family = String(value || '').trim();
    if (!family) throw new TypeError('platform host adapter family is required');
    return family;
  }

  function registerExtension(family, factory) {
    const key = normalizeFamily(family);
    if (typeof factory !== 'function') throw new TypeError('platform host adapter registration is invalid');
    if (BUILTIN_FAMILIES.has(key) || extensionFactories.has(key)) {
      throw new Error('platform host adapter already registered: ' + key);
    }
    extensionFactories.set(key, factory);
  }
  function create(options = {}) {
    const api = options.api;
    const bridgeTokenFor = options.bridgeTokenFor;
    const sleep = options.sleep;
    const sameChat = options.sameChat;
    const telegramBroadcastRoute = options.telegramBroadcastRoute;
    const whatsapp = options.whatsapp;

    if (!api?.webviewInput
      || typeof api.webviewInput.insertText !== 'function'
      || typeof api.webviewInput.commitSubmit !== 'function') {
      throw new TypeError('platform host adapters require WebView input capability');
    }
    if (typeof bridgeTokenFor !== 'function') throw new TypeError('platform host adapters require bridgeTokenFor');
    if (typeof sleep !== 'function') throw new TypeError('platform host adapters require sleep');
    if (typeof sameChat !== 'function') throw new TypeError('platform host adapters require sameChat');
    if (!whatsapp
      || typeof whatsapp.getComposerText !== 'function'
      || typeof whatsapp.clearComposerText !== 'function'
      || typeof whatsapp.setComposerText !== 'function'
      || typeof whatsapp.sendText !== 'function') {
      throw new TypeError('platform host adapters require WhatsApp capability');
    }
    const services = Object.freeze({ api, bridgeTokenFor, sleep, sameChat, telegramBroadcastRoute, whatsapp });

    const factories = new Map();

    async function executeTransportSet(webview, transport, text) {
      const script = typeof transport.setMessage === 'function' ? transport.setMessage(text) : transport.setMessage;
      return webview.executeJavaScript(script);
    }

    async function executeTransportSend(webview, transport, text) {
      const script = typeof transport.send === 'function' ? transport.send(text) : transport.send;
      return webview.executeJavaScript(script);
    }

    factories.set('telegram', ({ account, webview, transport }) => ({
      async getCurrentChat() {
        const id = await webview.executeJavaScript(currentChatScripts.telegram);
        return id ? String(id) : null;
      },
      async getComposerText() {
        return webview.executeJavaScript(`document.querySelector('${TG_EDITOR_READ}')?.innerText || ''`);
      },
      async clearComposerText() {
        return webview.executeJavaScript(`(() => { const editor=document.querySelector('${TG_EDITOR_READ}'); if(!editor)return false; editor.focus(); document.execCommand('selectAll',false,null); document.execCommand('delete',false,null); return !(editor.innerText||'').trim(); })()`);
      },
      async setComposerText(text, mutation = {}) {
        const focused = await webview.executeJavaScript(`(() => { const editor=document.querySelector('${TG_EDITOR}'); if(!editor)return false; window.__geekTelegramNativeInputCommit=true; editor.setAttribute('contenteditable','true'); editor.focus(); const selection=getSelection(),range=document.createRange(); range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range); return true; })()`);
        if (!focused) return 'NO_EDITOR';
        try {
          await api.webviewInput.insertText(
            account.id,
            webview.getWebContentsId(),
            String(text),
            bridgeTokenFor(webview),
            String(mutation.expectedConversationId || ''),
          );
          await sleep(50);
          const actual = await webview.executeJavaScript(`document.querySelector('${TG_EDITOR_READ}')?.innerText?.trim() || ''`);
          return actual === String(text).trim() ? 'OK' : 'EMPTY';
        } finally {
          try { await webview.executeJavaScript('window.__geekTelegramNativeInputCommit=false'); } catch {}
        }
      },
      async sendText(_text = '', commit = {}) {
        const expected = {
          conversationId: String(commit.expectedConversationId || ''),
          composerText: String(commit.expectedComposerText || ''),
        };
        const baseline = await webview.executeJavaScript(`(() => {
          const expected=${JSON.stringify(expected)};
          const chat=String(location.hash||'').replace(/^#/, '').split('?')[0];
          const norm=value=>String(value||'').replace(/\\n[\\t ]*\\n+/g,'\\n').trim();
          if(!expected.conversationId||chat!==expected.conversationId)return {status:'STALE_CONTEXT',count:0};
          const editor=document.querySelector('${TG_EDITOR}');
          if(!editor||norm(editor.innerText)!==norm(expected.composerText))return {status:'COMPOSER_MISMATCH',count:0};
          const count=document.querySelectorAll('.Message, .bubble:not(.service):not(.is-date)').length;
          return {status:'READY',count};
        })()`);
        if (!baseline || baseline.status !== 'READY') return String(baseline?.status || 'COMMIT_NOT_READY');
        const submitted = await api.webviewInput.commitSubmit(
          account.id,
          webview.getWebContentsId(),
          expected.conversationId,
          expected.composerText,
          bridgeTokenFor(webview),
        );
        if (submitted !== 'SUBMITTED') return String(submitted || 'MAYBE');
        for (let i = 0; i < 60; i++) {
          await sleep(250);
          const state = await webview.executeJavaScript(`(() => {
            const expectedChat=${JSON.stringify(expected.conversationId)};
            const chat=String(location.hash||'').replace(/^#/, '').split('?')[0];
            if(chat!==expectedChat)return {status:'STALE_CONTEXT',count:0,empty:false};
            const editor=document.querySelector('${TG_EDITOR}');
            const count=document.querySelectorAll('.Message, .bubble:not(.service):not(.is-date)').length;
            return {status:'OK',count,empty:!String(editor?.innerText||'').trim()};
          })()`);
          if (state?.status === 'STALE_CONTEXT') return 'STALE_CONTEXT';
          if (state?.count > baseline.count && state?.empty === true) return 'SENT';
        }
        return 'MAYBE';
      },
      async openFallback(adapter, chatId) {
        const route = typeof telegramBroadcastRoute === 'function' ? telegramBroadcastRoute() : null;
        if (typeof route?.openVirtualizedTarget !== 'function') return false;
        return route.openVirtualizedTarget(adapter, webview, chatId);
      },
    }));

    factories.set('line', ({ account, webview, transport }) => ({
      async getCurrentChat() {
        const id = await webview.executeJavaScript(currentChatScripts.line);
        return id ? String(id) : null;
      },
      async getComposerText() {
        return webview.executeJavaScript("document.querySelector('textarea-ex')?.shadowRoot?.querySelector('textarea')?.value || ''");
      },
      async clearComposerText() {
        return webview.executeJavaScript("(() => { const host=document.querySelector('textarea-ex'); const textarea=host?.shadowRoot?.querySelector('textarea'); if(!host||!textarea||typeof host.insertValue!=='function')return false; textarea.focus(); textarea.select(); host.insertValue([]); return !(textarea.value||'').trim(); })()");
      },
      async setComposerText(text, mutation = {}) {
        const focused = await webview.executeJavaScript("(() => { const textarea=document.querySelector('textarea-ex')?.shadowRoot?.querySelector('textarea'); if(!textarea)return false; textarea.focus(); textarea.select(); return true; })()");
        if (!focused) return 'NO_EDITOR';
        await api.webviewInput.insertText(
          account.id,
          webview.getWebContentsId(),
          String(text),
          bridgeTokenFor(webview),
          String(mutation.expectedConversationId || ''),
        );
        await sleep(50);
        const actual = await webview.executeJavaScript("document.querySelector('textarea-ex')?.shadowRoot?.querySelector('textarea')?.value?.trim() || ''");
        return actual === String(text).trim() ? 'OK' : 'EMPTY';
      },
      async sendText(text = '', commit = {}) {
        if (!(commit.expectedConversationId && commit.expectedComposerText)) {
          return executeTransportSend(webview, transport, text);
        }
        const expected = {
          conversationId: String(commit.expectedConversationId || ''),
          composerText: String(commit.expectedComposerText || ''),
        };
        const baseline = await webview.executeJavaScript(`(() => {
          const expected=${JSON.stringify(expected)};
          const norm=value=>String(value||'').replace(/\\n[\\t ]*\\n+/g,'\\n').trim();
          let currentChat=String(document.querySelector('${LINE_SELECTED}')?.getAttribute('data-mid')||'');
          if(!currentChat){
            try {
              const pathname=String(location.hash||'').replace(/^#/,'').split('?')[0];
              const match=pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/);
              currentChat=match?decodeURIComponent(match[1]):'';
            } catch {}
          }
          if(!expected.conversationId||currentChat!==expected.conversationId)return {status:'STALE_CONTEXT',count:0};
          const host=document.querySelector('${LINE_HOST}');
          const value=(Array.isArray(host?.value)?host.value:[host?.value]).filter(v=>typeof v==='string').join('');
          if(!host||norm(value)!==norm(expected.composerText))return {status:'COMPOSER_MISMATCH',count:0};
          return {status:'READY',count:document.querySelectorAll('[class*="message-module__message__"][data-mid]').length};
        })()`);
        if (!baseline || baseline.status !== 'READY') return String(baseline?.status || 'COMMIT_NOT_READY');
        const submitted = await api.webviewInput.commitSubmit(
          account.id,
          webview.getWebContentsId(),
          expected.conversationId,
          expected.composerText,
          bridgeTokenFor(webview),
        );
        if (submitted !== 'SUBMITTED') return String(submitted || 'MAYBE');
        for (let i = 0; i < 60; i++) {
          await sleep(250);
          const state = await webview.executeJavaScript(`(() => {
            const expectedChat=${JSON.stringify(expected.conversationId)};
            let currentChat=String(document.querySelector('${LINE_SELECTED}')?.getAttribute('data-mid')||'');
            if(!currentChat){
              try {
                const pathname=String(location.hash||'').replace(/^#/,'').split('?')[0];
                const match=pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/);
                currentChat=match?decodeURIComponent(match[1]):'';
              } catch {}
            }
            if(currentChat!==expectedChat)return {status:'STALE_CONTEXT',count:0,empty:false};
            const host=document.querySelector('${LINE_HOST}');
            const value=(Array.isArray(host?.value)?host.value:[host?.value]).filter(v=>typeof v==='string').join('').trim();
            const count=document.querySelectorAll('[class*="message-module__message__"][data-mid]').length;
            return {status:'OK',count,empty:!value};
          })()`);
          if (state?.status === 'STALE_CONTEXT') return 'STALE_CONTEXT';
          if (state?.count > baseline.count && state?.empty === true) return 'SENT';
        }
        return 'MAYBE';
      },
    }));

    factories.set('whatsapp', ({ account, webview, transport }) => ({
      async getCurrentChat() {
        const id = await webview.executeJavaScript(currentChatScripts.whatsapp);
        return id ? String(id) : null;
      },
      async getComposerText() {
        return whatsapp.getComposerText(webview);
      },
      async clearComposerText() {
        return whatsapp.clearComposerText(webview);
      },
      async setComposerText(text, mutation = {}) {
        if (mutation.expectedConversationId) {
          return whatsapp.setComposerText({
            account,
            wv: webview,
            text,
            mutation,
            bridgeToken: bridgeTokenFor(webview),
            sleep,
          });
        }
        return executeTransportSet(webview, transport, text);
      },
      async sendText(text = '', commit = {}) {
        if (commit.expectedConversationId && commit.expectedComposerText) {
          return whatsapp.sendText({
            account,
            wv: webview,
            commit,
            bridgeToken: bridgeTokenFor(webview),
            sleep,
          });
        }
        return executeTransportSend(webview, transport, text);
      },
    }));

    for (const [family, factory] of extensionFactories) factories.set(family, factory);

    function registerRuntime(family, factory) {
      const key = normalizeFamily(family);
      if (typeof factory !== 'function') throw new TypeError('platform host adapter registration is invalid');
      if (factories.has(key)) throw new Error('platform host adapter already registered: ' + key);
      factories.set(key, factory);
    }

    function build({ account, webview, family, definition: transport }) {
      if (!account || !webview || !transport) throw new TypeError('platform host adapter input is incomplete');
      const factory = factories.get(String(family || ''));
      if (!factory) throw new Error('platform host adapter unavailable: ' + family);
      const mechanics = factory({ account, webview, family, transport, services });
      let adapter = null;
      adapter = Object.freeze({
        family,
        accountId: account.id,
        transport,
        getCurrentChat: mechanics.getCurrentChat,
        async listChats() {
          const result = await webview.executeJavaScript(transport.getChats);
          const text = String(result || '[]');
          if (text.startsWith('ERR:')) throw new Error(text.slice(4));
          return JSON.parse(text);
        },
        async openChat(chatId) {
          const clicked = await webview.executeJavaScript(transport.switchChat(chatId));
          if (clicked === true) {
            for (let attempt = 0; attempt < 40; attempt++) {
              const current = await mechanics.getCurrentChat();
              if (sameChat(current, chatId)) return true;
              await sleep(250);
            }
          }
          if (typeof mechanics.openFallback === 'function') return mechanics.openFallback(adapter, chatId);
          return false;
        },
        getComposerText: mechanics.getComposerText,
        clearComposerText: mechanics.clearComposerText,
        setComposerText: mechanics.setComposerText,
        sendText: mechanics.sendText,
      });
      return adapter;
    }

    return Object.freeze({
      build,
      hasFamily: family => factories.has(String(family || '')),
      families: () => Object.freeze(Array.from(factories.keys())),
      register: registerRuntime,
    });
  }

  window.GeekPlatformHostAdapters = Object.freeze({
    create,
    register: registerExtension,
    currentChatScripts,
  });
})();
