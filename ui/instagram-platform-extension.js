/* Instagram Direct platform contribution. Loaded before app.js and registered through generic platform seams. */
(() => {
  'use strict';

  const FAMILY = 'instagram';
  const COMPOSER = '[role="main"] [contenteditable="true"][role="textbox"]';
  const THREAD_RE_SOURCE = '^/direct/t/([^/?#]+)';
  const CONFIRMATION_SURFACE = '[role="main"]';

  const currentConversationScript = `(() => {
    const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_RE_SOURCE)}, 'i'));
    return match ? match[0].replace(/\\/$/,'') : null;
  })()`;

  const definition = Object.freeze({
    getChats: `(() => {
      const threadKeyFor=node=>{
        const fiberKey=Object.keys(node||{}).find(key=>key.startsWith('__reactFiber$'));
        let fiber=fiberKey ? node[fiberKey] : null;
        for(let depth=0;fiber&&depth<16;depth+=1,fiber=fiber.return){
          const value=fiber.memoizedProps?.threadKeyForSelection ?? fiber.pendingProps?.threadKeyForSelection;
          if(value!=null&&String(value).trim())return String(value).trim();
        }
        return '';
      };
      const nameFor=node=>String(node?.innerText||node?.textContent||'')
        .split(/\\n+/).map(value=>value.trim()).filter(Boolean)[0]||'Instagram 联系人';
      const out=[],seen=new Set();
      document.querySelectorAll('[role="button"]').forEach(button=>{
        const key=threadKeyFor(button);
        if(!key)return;
        const id='/direct/t/'+key;
        if(seen.has(id))return;
        seen.add(id);
        out.push({id,name:nameFor(button).slice(0,240),type:'联系人'});
      });
      return JSON.stringify(out);
    })()`,
    switchChat: id => `(() => {
      const expected=${JSON.stringify(String(id || ''))};
      const match=expected.match(new RegExp(${JSON.stringify(THREAD_RE_SOURCE)}, 'i'));
      const expectedKey=match?.[1]||'';
      if(!expectedKey)return false;
      const threadKeyFor=node=>{
        const fiberKey=Object.keys(node||{}).find(key=>key.startsWith('__reactFiber$'));
        let fiber=fiberKey ? node[fiberKey] : null;
        for(let depth=0;fiber&&depth<16;depth+=1,fiber=fiber.return){
          const value=fiber.memoizedProps?.threadKeyForSelection ?? fiber.pendingProps?.threadKeyForSelection;
          if(value!=null&&String(value).trim())return String(value).trim();
        }
        return '';
      };
      const button=[...document.querySelectorAll('[role="button"]')].find(node=>threadKeyFor(node)===expectedKey);
      if(!button)return false;
      button.click();
      return true;
    })()`,
    setMessage: () => `'INSTAGRAM_HOST_INPUT_REQUIRED'`,
    send: `'INSTAGRAM_HOST_COMMIT_REQUIRED'`,
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
        const conversationId = String(await readConversation() || '');
        if (!conversationId) return false;
        const result = await api.webviewInput.clearText(
          account.id,
          webview.getWebContentsId(),
          bridgeTokenFor(webview),
          conversationId,
        );
        return result === 'CLEARED';
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
          if(current!==expected.conversationId)return {status:'STALE_CONTEXT',count:0,textLength:0};
          const editor=document.querySelector(${JSON.stringify(COMPOSER)});
          if(!editor||norm(editor.innerText||editor.textContent)!==norm(expected.composerText))return {status:'COMPOSER_MISMATCH',count:0,textLength:0};
          const surface=document.querySelector(${JSON.stringify(CONFIRMATION_SURFACE)});
          const clone=surface?.cloneNode?.(true);
          clone?.querySelectorAll?.(${JSON.stringify(COMPOSER)})?.forEach?.(node=>node.remove());
          const canonical=value=>String(value||'').replace(/\\u200b/g,'').replace(/\\s+/g,' ').trim();
          const transcript=canonical(clone?.textContent||'');
          const needle=canonical(expected.composerText);
          let occurrences=0,offset=0;
          while(needle&&transcript.indexOf(needle,offset)!==-1){
            occurrences+=1; offset=transcript.indexOf(needle,offset)+Math.max(1,needle.length);
          }
          return {status:'READY',occurrences,textLength:transcript.length};
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
            const expectedChat=${JSON.stringify(conversationId)};
            const expectedText=${JSON.stringify(composerText)};
            const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_RE_SOURCE)}, 'i'));
            const current=match ? match[0].replace(/\\/$/,'') : '';
            if(current!==expectedChat)return {status:'STALE_CONTEXT',occurrences:0,textLength:0,empty:false};
            const editor=document.querySelector(${JSON.stringify(COMPOSER)});
            const surface=document.querySelector(${JSON.stringify(CONFIRMATION_SURFACE)});
            const clone=surface?.cloneNode?.(true);
            clone?.querySelectorAll?.(${JSON.stringify(COMPOSER)})?.forEach?.(node=>node.remove());
            const canonical=value=>String(value||'').replace(/\\u200b/g,'').replace(/\\s+/g,' ').trim();
            const transcript=canonical(clone?.textContent||'');
            const needle=canonical(expectedText);
            let occurrences=0,offset=0;
            while(needle&&transcript.indexOf(needle,offset)!==-1){
              occurrences+=1; offset=transcript.indexOf(needle,offset)+Math.max(1,needle.length);
            }
            const empty=!String(editor?.innerText||editor?.textContent||'').replace(/\\u200b/g,'').trim();
            return {status:'OK',occurrences,textLength:transcript.length,empty};
          })()`);
          if (state?.status === 'STALE_CONTEXT') return 'STALE_CONTEXT';
          const occurrenceAdvanced = Number(state?.occurrences || 0) > Number(baseline.occurrences || 0);
          const transcriptChanged = Number(state?.textLength || 0) !== Number(baseline.textLength || 0);
          if (state?.empty === true && occurrenceAdvanced && transcriptChanged) return 'SENT';
        }
        return 'MAYBE';
      },
    };
  }

  window.GeekPlatformTransportDefinitions.register('instagram', definition, { family: FAMILY });
  window.GeekPlatformHostAdapters.register(FAMILY, factory);
  window.GeekInstagramPlatformExtension = Object.freeze({
    family: FAMILY,
    composerSelector: COMPOSER,
    confirmationSurfaceSelector: CONFIRMATION_SURFACE,
  });
})();
