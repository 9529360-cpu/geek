'use strict';

const INSTAGRAM_TYPES = new Set(['instagram']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const COMPOSER_SELECTOR = '[role="main"] [contenteditable="true"][role="textbox"]';
const THREAD_PATH_PATTERN_SOURCE = '^/direct/t/([^/?#]+)';

function isInstagramType(type) {
  return INSTAGRAM_TYPES.has(String(type || ''));
}

function parseInstagramUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

function isInstagramPageUrl(value) {
  return Boolean(parseInstagramUrl(value));
}

function canonicalConversationId(value) {
  const url = parseInstagramUrl(value);
  if (!url) return '';
  const match = url.pathname.match(new RegExp(THREAD_PATH_PATTERN_SOURCE, 'i'));
  return match ? match[0].replace(/\/$/, '') : '';
}

function isInstagramDirectUrl(value) {
  const url = parseInstagramUrl(value);
  return Boolean(url && /^\/direct(?:\/|$)/i.test(url.pathname));
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

function clearComposerGuardScript(expectedChatId = '') {
  const expected = JSON.stringify(String(expectedChatId || ''));
  return `(() => {
    const expectedChatId=${expected};
    const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_PATH_PATTERN_SOURCE)}, 'i'));
    const current=match ? match[0].replace(/\\/$/,'') : '';
    if(!expectedChatId || current!==expectedChatId) return 'CHAT_CHANGED';
    const editor=document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
    if(!editor) return 'NO_EDITOR';
    editor.focus();
    if(!(document.activeElement===editor || editor.contains(document.activeElement))) return 'COMPOSER_NOT_FOCUSED';
    const range=document.createRange();
    range.selectNodeContents(editor);
    const selection=getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return 'READY';
  })()`;
}

function composerEmptyScript(expectedChatId = '') {
  const expected = JSON.stringify(String(expectedChatId || ''));
  return `(() => {
    const expectedChatId=${expected};
    const match=String(location.pathname||'').match(new RegExp(${JSON.stringify(THREAD_PATH_PATTERN_SOURCE)}, 'i'));
    const current=match ? match[0].replace(/\\/$/,'') : '';
    if(!expectedChatId || current!==expectedChatId) return 'CHAT_CHANGED';
    const editor=document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
    if(!editor) return 'NO_EDITOR';
    const text=String(editor.innerText||editor.textContent||'').replace(/\\u200b/g,'').trim();
    return text ? 'NOT_EMPTY' : 'EMPTY';
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
  INSTAGRAM_TYPES,
  INSTAGRAM_HOSTS,
  COMPOSER_SELECTOR,
  THREAD_PATH_PATTERN_SOURCE,
  isInstagramType,
  isInstagramPageUrl,
  isInstagramDirectUrl,
  canonicalConversationId,
  guestConversationExpression,
  focusedComposerScript,
  clearComposerGuardScript,
  composerEmptyScript,
  commitGuardScript,
};
