/* Facebook Messenger platform contribution. Loaded before app.js and registered through the generic platform seams. */
(() => {
  'use strict';

  const FAMILY = 'messenger';
  const COMPOSER = '[role="main"] [contenteditable="true"][role="textbox"]';
  const THREAD_RE_SOURCE = '^/messages/(?:(?:e2ee|marketplace|requests)/)?t/([^/?#]+)';

  const currentConversationScript = `(() => {
    const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_RE_SOURCE)}, 'i'));
    return match ? match[0].replace(/\\/$/,'') : null;
  })()`;

  const definition = Object.freeze({
    getChats: `(() => {
      const canonical=value=>{
        try{
          const url=new URL(String(value||''),location.href);
          const match=String(url.pathname||'').match(new RegExp(${JSON.stringify(THREAD_RE_SOURCE)}, 'i'));
          return match ? match[0].replace(/\\/$/,'') : '';
        }catch{return ''}
      };
      const out=[],seen=new Set();
      document.querySelectorAll('a[href*="/messages/"]').forEach(anchor=>{
        const id=canonical(anchor.getAttribute('href')||anchor.href);
        if(!id||seen.has(id))return;
        const name=String(anchor.innerText||anchor.textContent||'').replace(/\\s+/g,' ').trim();
        if(!name)return;
        seen.add(id);
        out.push({id,name:name.slice(0,240),type:'联系人'});
      });
      return JSON.stringify(out);
    })()`,
    switchChat: id => `(() => {
      const expected=${JSON.stringify(String(id || ''))};
      const canonical=value=>{
        try{
          const url=new URL(String(value||''),location.href);
          const match=String(url.pathname||'').match(new RegExp(${JSON.stringify(THREAD_RE_SOURCE)}, 'i'));
          return match ? match[0].replace(/\\/$/,'') : '';
        }catch{return ''}
      };
      const anchor=[...document.querySelectorAll('a[href*="/messages/"]')].find(node=>canonical(node.getAttribute('href')||node.href)===expected);
      if(!anchor)return false;
      anchor.click();
      return true;
    })()`,
    setMessage: () => `'MESSENGER_HOST_INPUT_REQUIRED'`,
    send: `'MESSENGER_HOST_COMMIT_REQUIRED'`,
  });

  function factory({ account, webview, services }) {
    const { api, bridgeTokenFor, sleep } = services;

    const readConversation = async () => {
      const value = await webview.executeJavaScript(currentConversationScript);
      return value ? String(value) : null;
    };
    const readComposer = async () => webview.executeJavaScript(
      `String(document.querySelector(${JSON.stringify(COMPOSER)})?.innerText || document.querySelector(${JSON.stringify(COMPOSER)})?.textContent || '').replace(/\\u200b/g,'')`
    );

    return {
      getCurrentChat: readConversation,
      getComposerText: readComposer,
      async clearComposerText() {
        return webview.executeJavaScript(`(() => {
          const editor=document.querySelector(${JSON.stringify(COMPOSER)});
          if(!editor)return false;
          editor.focus();
          const range=document.createRange(); range.selectNodeContents(editor);
          const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.execCommand('delete',false,null);
          return !String(editor.innerText||editor.textContent||'').replace(/\\u200b/g,'').trim();
        })()`);
      },
      async setComposerText(text, mutation = {}) {
        const expectedConversationId = String(mutation.expectedConversationId || await readConversation() || '');
        if (!expectedConversationId) return 'STALE_CONTEXT';
        const focused = await webview.executeJavaScript(`(() => {
          const editor=document.querySelector(${JSON.stringify(COMPOSER)});
          if(!editor)return false;
          editor.focus();
          const range=document.createRange(); range.selectNodeContents(editor);
          const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
          return document.activeElement===editor || editor.contains(document.activeElement);
        })()`);
        if (!focused) return 'NO_EDITOR';
        await api.webviewInput.insertText(
          account.id,
          webview.getWebContentsId(),
          String(text),
          bridgeTokenFor(webview),
          expectedConversationId,
        );
        await sleep(60);
        const actual = await readComposer();
        return String(actual || '').trim() === String(text).trim() ? 'OK' : 'EMPTY';
      },
      async sendText(_text = '', commit = {}) {
        const conversationId = String(commit.expectedConversationId || await readConversation() || '');
        const composerText = String(commit.expectedComposerText || await readComposer() || '');
        if (!conversationId) return 'STALE_CONTEXT';
        if (!composerText.trim()) return 'COMPOSER_MISMATCH';
        const expected = { conversationId, composerText };
        const baseline = await webview.executeJavaScript(`(() => {
          const expected=${JSON.stringify(expected)};
          const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_RE_SOURCE)}, 'i'));
          const current=match ? match[0].replace(/\\/$/,'') : '';
          const norm=value=>String(value||'').replace(/\\u200b/g,'').replace(/\\n[\\t ]*\\n+/g,'\\n').trim();
          if(current!==expected.conversationId)return {status:'STALE_CONTEXT',count:0};
          const editor=document.querySelector(${JSON.stringify(COMPOSER)});
          if(!editor||norm(editor.innerText||editor.textContent)!==norm(expected.composerText))return {status:'COMPOSER_MISMATCH',count:0};
          const log=document.querySelector('[role="main"] [role="log"]');
          const count=Math.max(document.querySelectorAll('[role="main"] [role="row"]').length,Number(log?.children?.length||0));
          return {status:'READY',count};
        })()`);
        if (!baseline || baseline.status !== 'READY') return String(baseline?.status || 'COMMIT_NOT_READY');

        const submitted = await api.webviewInput.commitSubmit(
          account.id,
          webview.getWebContentsId(),
          conversationId,
          composerText,
          bridgeTokenFor(webview),
        );
        if (submitted !== 'SUBMITTED') return String(submitted || 'MAYBE');

        for (let attempt = 0; attempt < 60; attempt += 1) {
          await sleep(250);
          const state = await webview.executeJavaScript(`(() => {
            const expected=${JSON.stringify(conversationId)};
            const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_RE_SOURCE)}, 'i'));
            const current=match ? match[0].replace(/\\/$/,'') : '';
            if(current!==expected)return {status:'STALE_CONTEXT',count:0,empty:false};
            const editor=document.querySelector(${JSON.stringify(COMPOSER)});
            const log=document.querySelector('[role="main"] [role="log"]');
            const count=Math.max(document.querySelectorAll('[role="main"] [role="row"]').length,Number(log?.children?.length||0));
            const empty=!String(editor?.innerText||editor?.textContent||'').replace(/\\u200b/g,'').trim();
            return {status:'OK',count,empty};
          })()`);
          if (state?.status === 'STALE_CONTEXT') return 'STALE_CONTEXT';
          if (state?.empty === true && state?.count > Number(baseline.count || 0)) return 'SENT';
        }
        return 'MAYBE';
      },
    };
  }

  window.GeekPlatformTransportDefinitions.register('messenger', definition, { family: FAMILY });
  window.GeekPlatformHostAdapters.register(FAMILY, factory);
  window.GeekMessengerPlatformExtension = Object.freeze({ family: FAMILY, composerSelector: COMPOSER });
})();
