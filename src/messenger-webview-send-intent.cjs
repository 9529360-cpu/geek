'use strict';

const MESSENGER_TYPES = new Set(['messenger']);
const MESSENGER_HOSTS = new Set(['facebook.com', 'www.facebook.com']);
const COMPOSER_SELECTOR = '[role="main"] [contenteditable="true"][role="textbox"]';
const THREAD_PATH_PATTERN_SOURCE = '^/messages/(?:(?:e2ee|marketplace|requests)/)?t/([^/?#]+)';

function isMessengerType(type) {
  return MESSENGER_TYPES.has(String(type || ''));
}

function parseMessengerUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !MESSENGER_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

function isMessengerPageUrl(value) {
  return Boolean(parseMessengerUrl(value));
}

function canonicalConversationId(value) {
  const url = parseMessengerUrl(value);
  if (!url) return '';
  const match = url.pathname.match(new RegExp(THREAD_PATH_PATTERN_SOURCE, 'i'));
  return match ? match[0].replace(/\/$/, '') : '';
}

function isMessengerMessagesUrl(value) {
  const url = parseMessengerUrl(value);
  return Boolean(url && /^\/messages(?:\/|$)/i.test(url.pathname));
}

function guestConversationExpression() {
  return `(() => {
    const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_PATH_PATTERN_SOURCE)}, 'i'));
    return match ? match[0].replace(/\\/$/,'') : '';
  })()`;
}

function focusedComposerScript(expectedChatId = '') {
  const expected = JSON.stringify(String(expectedChatId || ''));
  return `(() => {
    const expectedChatId=${expected};
    const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_PATH_PATTERN_SOURCE)}, 'i'));
    const current=match ? match[0].replace(/\\/$/,'') : '';
    if(expectedChatId && current!==expectedChatId) return 'CHAT_CHANGED';
    const editor=document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
    return !!current && !!editor && (document.activeElement===editor || editor.contains(document.activeElement));
  })()`;
}

function commitGuardScript(expectedChatId = '', expectedComposerText = '') {
  const expected = JSON.stringify({
    conversationId: String(expectedChatId || ''),
    composerText: String(expectedComposerText || ''),
  });
  return `(() => {
    const expected=${expected};
    const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_PATH_PATTERN_SOURCE)}, 'i'));
    const current=match ? match[0].replace(/\\/$/,'') : '';
    const norm=value=>String(value||'').replace(/\\u200b/g,'').replace(/\\n[\\t ]*\\n+/g,'\\n').trim();
    if(!expected.conversationId || current!==expected.conversationId) return 'STALE_CONTEXT';
    const editor=document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
    if(!editor || norm(editor.innerText||editor.textContent)!==norm(expected.composerText)) return 'COMPOSER_MISMATCH';
    document.documentElement?.setAttribute('data-geek-native-submit-commit','1');
    editor.focus();
    if(!(document.activeElement===editor || editor.contains(document.activeElement))){
      document.documentElement?.removeAttribute('data-geek-native-submit-commit');
      return 'COMPOSER_NOT_FOCUSED';
    }
    return 'READY';
  })()`;
}

module.exports = {
  MESSENGER_TYPES,
  MESSENGER_HOSTS,
  COMPOSER_SELECTOR,
  THREAD_PATH_PATTERN_SOURCE,
  isMessengerType,
  isMessengerPageUrl,
  isMessengerMessagesUrl,
  canonicalConversationId,
  guestConversationExpression,
  focusedComposerScript,
  commitGuardScript,
};
