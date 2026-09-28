'use strict';
const WHATSAPP_TYPES = new Set(['whatsapp', 'whatsapp-pure']);
const WHATSAPP_URL = /^https:\/\/web\.whatsapp\.com\//;
const COMPOSER_SELECTOR = '#main footer [contenteditable="true"], #main [data-testid="conversation-compose-box-input"], #main [contenteditable="true"][data-tab="10"]';
function isWhatsAppType(type) { return WHATSAPP_TYPES.has(String(type || '')); }
function isWhatsAppUrl(url) { return WHATSAPP_URL.test(String(url || '')); }
function focusedComposerScript(expectedChatId = '') {
  const expected = JSON.stringify(String(expectedChatId || ''));
  return "(() => { const expectedChatId=" + expected + "; const active=window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.(); const currentChatId=String(active?.id?._serialized||''); if(expectedChatId&&currentChatId!==expectedChatId)return 'CHAT_CHANGED'; const editor=document.querySelector(" + JSON.stringify(COMPOSER_SELECTOR) + "); return !!currentChatId&&!!editor&&(document.activeElement===editor||editor.contains(document.activeElement)); })()";
}
function commitGuardScript(expectedChatId = '', expectedComposerText = '') {
  const expected = JSON.stringify({ conversationId: String(expectedChatId || ''), composerText: String(expectedComposerText || '') });
  return "(() => { const expected=" + expected + "; const norm=value=>String(value||'').replace(/\\n[\\t ]*\\n+/g,'\\n').trim(); const active=window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.(); const currentChat=String(active?.id?._serialized||''); if(!expected.conversationId||currentChat!==expected.conversationId)return 'STALE_CONTEXT'; const editor=document.querySelector(" + JSON.stringify(COMPOSER_SELECTOR) + "); if(!editor||norm(editor.innerText||editor.textContent)!==norm(expected.composerText))return 'COMPOSER_MISMATCH'; document.documentElement?.setAttribute('data-geek-native-submit-commit','1'); editor.focus(); if(!(document.activeElement===editor||editor.contains(document.activeElement))){document.documentElement?.removeAttribute('data-geek-native-submit-commit'); return 'COMPOSER_NOT_FOCUSED';} return 'READY'; })()";
}
module.exports = { WHATSAPP_TYPES, WHATSAPP_URL, COMPOSER_SELECTOR, isWhatsAppType, isWhatsAppUrl, focusedComposerScript, commitGuardScript };
