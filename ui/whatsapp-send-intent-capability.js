(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekWhatsAppSendIntentCapability = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const COMPOSER_SELECTOR = '#main footer [contenteditable="true"], #main [data-testid="conversation-compose-box-input"], #main [contenteditable="true"][data-tab="10"]';
  const MESSAGE_SELECTOR = '#main [data-testid^="conv-msg-"], #main div[role="row"] [data-pre-plain-text]';
  const norm = value => String(value || '').replace(/\n[\t ]*\n+/g, '\n').trim();
  function composerScript(body) {
    return '(() => { const editor=document.querySelector(' + JSON.stringify(COMPOSER_SELECTOR) + '); ' + body + ' })()';
  }
  async function getComposerText(wv) {
    return wv.executeJavaScript(composerScript("return editor?.innerText || editor?.textContent || '';"));
  }
  async function clearComposerText(wv) {
    return wv.executeJavaScript(composerScript("if(!editor)return false; editor.focus(); document.execCommand('selectAll',false,null); document.execCommand('delete',false,null); return !String(editor.innerText||editor.textContent||'').trim();"));
  }
  async function setComposerText({ account, wv, text, mutation, bridgeToken, sleep }) {
    const focused = await wv.executeJavaScript(composerScript("if(!editor)return false; editor.focus(); document.execCommand('selectAll',false,null); return true;"));
    if (!focused) return 'NO_EDITOR';
    await window.api.webviewInput.insertText(account.id, wv.getWebContentsId(), String(text), bridgeToken, String(mutation?.expectedConversationId || ''));
    await sleep(50);
    const actual = await getComposerText(wv);
    return norm(actual) === norm(text) ? 'OK' : 'EMPTY';
  }
  async function sendText({ account, wv, commit, bridgeToken, sleep }) {
    const expectedConversationId = String(commit?.expectedConversationId || '');
    const expectedComposerText = String(commit?.expectedComposerText || '');
    if (!expectedConversationId || !expectedComposerText) return 'COMMIT_NOT_READY';
    const expectedJson = JSON.stringify({ conversationId: expectedConversationId, composerText: expectedComposerText });
    const baseline = await wv.executeJavaScript("(() => { const expected=" + expectedJson + "; const norm=value=>String(value||'').replace(/\\n[\\t ]*\\n+/g,'\\n').trim(); const active=window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.(); const currentChat=String(active?.id?._serialized||''); if(currentChat!==expected.conversationId)return {status:'STALE_CONTEXT',count:0}; const editor=document.querySelector(" + JSON.stringify(COMPOSER_SELECTOR) + "); if(!editor||norm(editor.innerText||editor.textContent)!==norm(expected.composerText))return {status:'COMPOSER_MISMATCH',count:0}; return {status:'READY',count:document.querySelectorAll(" + JSON.stringify(MESSAGE_SELECTOR) + ").length}; })()");
    if (!baseline || baseline.status !== 'READY') return String(baseline?.status || 'COMMIT_NOT_READY');
    const submitted = await window.api.webviewInput.commitSubmit(account.id, wv.getWebContentsId(), expectedConversationId, expectedComposerText, bridgeToken);
    if (submitted !== 'SUBMITTED') return String(submitted || 'MAYBE');
    const expectedChatJson = JSON.stringify(expectedConversationId);
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const state = await wv.executeJavaScript("(() => { const expectedChat=" + expectedChatJson + "; const active=window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.(); const currentChat=String(active?.id?._serialized||''); if(currentChat!==expectedChat)return {status:'STALE_CONTEXT',count:0,empty:false}; const editor=document.querySelector(" + JSON.stringify(COMPOSER_SELECTOR) + "); const count=document.querySelectorAll(" + JSON.stringify(MESSAGE_SELECTOR) + ").length; return {status:'OK',count,empty:!String(editor?.innerText||editor?.textContent||'').trim()}; })()");
      if (state?.status === 'STALE_CONTEXT') return 'STALE_CONTEXT';
      if (state?.count > baseline.count && state?.empty === true) return 'SENT';
    }
    return 'MAYBE';
  }
  return Object.freeze({ COMPOSER_SELECTOR, getComposerText, clearComposerText, setComposerText, sendText });
});
