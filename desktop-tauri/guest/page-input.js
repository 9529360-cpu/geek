// Page input shared by Messenger, Instagram and Telegram A.
// Electron insertText / sendInputEvent is replaced here by the same
// execCommand('insertText') call master's Telegram A transport already uses,
// then the page send control. Telegram A still replaces the whole composer,
// so a synced cloud draft is cleared. That is the old production behavior.
'use strict';

const PAGE_SEND_LABEL = /(send|发送|傳送|invia|envoyer|senden|enviar|envoie|gönder|wyślij)/i;
const MESSENGER_THREAD = /^\/messages\/(?:(?:e2ee|marketplace|requests)\/)?t\/([^/?#]+)/i;
const INSTAGRAM_THREAD = /^\/direct\/t\/([^/?#]+)/i;

function pageNormalize(value) {
  return String(value || '').replace(/\u200b/g, '').replace(/\r\n?/g, '\n').replace(/\n[\t ]*\n+/g, '\n').trim();
}

function pageSegment(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ''));
}

function canonicalThread(pathname, pattern) {
  const value = String(pathname || '').replace(/\/$/, '');
  const match = value.match(pattern);
  if (!match || match[0] !== value || !pageSegment(match[1])) return '';
  return value;
}

function messengerConversationId(pathname = window.location?.pathname) {
  return canonicalThread(pathname, MESSENGER_THREAD);
}

function instagramConversationId(pathname = window.location?.pathname) {
  return canonicalThread(pathname, INSTAGRAM_THREAD);
}

function telegramAPeer(hash = window.location?.hash) {
  const peer = String(hash || '').replace(/^#/, '').split('?')[0];
  if (!/^-?[1-9]\d{0,18}$/.test(peer)) return '';
  try {
    const value = BigInt(peer);
    if (value === 0n || value < -9223372036854775808n || value > 9223372036854775807n) return '';
  } catch { return ''; }
  return `tg:${peer}`;
}

function pageConversationId(kind) {
  if (kind === 'messenger') return messengerConversationId();
  if (kind === 'instagram') return instagramConversationId();
  if (kind === 'telegram-a') return telegramAPeer();
  return '';
}

function pageOwned(kind) {
  const url = window.location;
  if (!url || url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname;
  if (kind === 'messenger') return ['www.facebook.com', 'facebook.com'].includes(host) && url.pathname.startsWith('/messages');
  if (kind === 'instagram') return ['www.instagram.com', 'instagram.com'].includes(host) && url.pathname.startsWith('/direct');
  if (kind === 'telegram-a') {
    return host === 'web.telegram.org' && ['/a', '/a/'].includes(url.pathname) && !url.search;
  }
  return false;
}

function pageVisible(node) {
  if (!node?.isConnected) return false;
  const rects = node.getClientRects?.();
  return !rects || rects.length > 0;
}

function pageEditors(kind) {
  const selector = kind === 'telegram-a'
    ? '#editable-message-text[contenteditable="true"], .form-control.ProseMirror, '
      + '.input-message-input[contenteditable="true"]:not(.input-field-input-fake)'
    : '[role="main"] [contenteditable="true"][role="textbox"]';
  return [...document.querySelectorAll(selector)].filter(pageVisible);
}

function pageText(editor) {
  return pageNormalize(editor?.innerText || editor?.textContent || '');
}

function pageReplaceText(editor, text) {
  if (!editor || typeof document.execCommand !== 'function') return 'failed';
  const before = pageText(editor);
  editor.focus();
  const selection = window.getSelection?.();
  if (!selection || typeof document.createRange !== 'function') return 'failed';
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
  try { document.execCommand('insertText', false, text); } catch { /* The result is the text check below. */ }
  if (pageText(editor) === pageNormalize(text)) return 'ok';
  return pageText(editor) === before ? 'failed' : 'changed';
}

function pageSendButton(kind, editor) {
  if (kind === 'telegram-a') {
    const selector = '#MiddleColumn button.Button.send.main-button, #Main button.Button.send.main-button, '
      + 'button[aria-label="发送消息"], button[aria-label="Send"], .btn-send, button[class*="send"], button[class*="Send"]';
    return [...document.querySelectorAll(selector)].find((node) => pageVisible(node) && !node.disabled) || null;
  }
  const region = editor?.closest?.('[role="region"], form, [role="main"]');
  if (!region) return null;
  return [...region.querySelectorAll('button, [role="button"]')].find((button) => {
    const label = String(button.getAttribute?.('aria-label') || '');
    return PAGE_SEND_LABEL.test(label) && pageVisible(button) && !button.matches?.(':disabled')
      && button.getAttribute?.('aria-disabled') !== 'true';
  }) || null;
}

function pageClick(node) {
  if (!node) return false;
  const view = window;
  const mouse = (type, buttons) => node.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view, button: 0, buttons,
  }));
  if (typeof PointerEvent === 'function') {
    const pointer = (type, buttons) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, view, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons,
    }));
    pointer('pointerdown', 1);
    mouse('mousedown', 1);
    pointer('pointerup', 0);
    mouse('mouseup', 0);
  } else {
    mouse('mousedown', 1);
    mouse('mouseup', 0);
  }
  if (typeof node.click === 'function') node.click();
  else mouse('click', 0);
  return true;
}

function pagePressEnter(editor) {
  if (!editor) return false;
  const event = (type) => editor.dispatchEvent(new KeyboardEvent(type, {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
  }));
  event('keydown');
  event('keyup');
  return true;
}

function messengerCount() {
  const log = document.querySelector('[role="main"] [role="log"]');
  return Math.max(document.querySelectorAll('[role="main"] [role="row"]').length, Number(log?.children?.length || 0));
}

function instagramSurface(editor) {
  const surface = document.querySelector('[role="main"]');
  const clone = surface?.cloneNode?.(true);
  clone?.querySelectorAll?.('[contenteditable="true"]')?.forEach?.((node) => node.remove());
  return String(clone?.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

function instagramOccurrences(transcript, text) {
  const needle = String(text || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (transcript.indexOf(needle, offset) !== -1) {
    count += 1;
    offset = transcript.indexOf(needle, offset) + Math.max(1, needle.length);
  }
  return count;
}

function telegramMessageCount() {
  return document.querySelectorAll('.Message, .bubble:not(.service):not(.is-date)').length;
}

function pageSnapshot(kind, editor, text) {
  if (kind === 'instagram') {
    const transcript = instagramSurface(editor);
    return { count: instagramOccurrences(transcript, text), length: transcript.length, empty: !pageText(editor) };
  }
  if (kind === 'telegram-a') return { count: telegramMessageCount(), length: 0, empty: !pageText(editor) };
  return { count: messengerCount(), length: 0, empty: !pageText(editor) };
}

function pageConfirmed(kind, before, after) {
  if (!after?.empty || pageConversationId(kind) === '') return false;
  if (kind === 'instagram') return after.count > before.count && after.length !== before.length;
  return after.count > before.count;
}

function pageWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const pageQuietErrors = new WeakSet();

function pageFail(code, submitted = false) {
  const error = Object.assign(new Error(code), { code });
  if (!submitted) pageQuietErrors.add(error);
  throw error;
}

function createPageSendComposer(kind, changed) {
  let revision = 1;
  let previous = null;
  let suppressed = false;
  let disposed = false;
  let watched = null;
  let receiptSerial = 0;
  const limit = kind === 'telegram-a' ? 4096 : 10000;
  const utf16 = (value) => {
    let count = 0;
    for (const char of String(value || '')) count += char.codePointAt(0) > 0xffff ? 2 : 1;
    return count;
  };
  const issue = (code = 'SEND_INTENT_UNSUPPORTED') => Object.assign(new Error(code), { code });
  function advance(reason, trusted = false) {
    if (suppressed || disposed) return;
    if (revision < Number.MAX_SAFE_INTEGER) revision += 1;
    changed({ reason, trusted, revision });
  }
  function raw() {
    const editors = pageEditors(kind);
    const editor = editors.length === 1 ? editors[0] : null;
    return { editor, chatId: pageConversationId(kind), text: editor ? pageText(editor) : '' };
  }
  function synchronize(value) {
    if (previous && (previous.chatId !== value.chatId || previous.editor !== value.editor || previous.text !== value.text)) {
      advance('context');
    }
    previous = value;
    return { ...value, composerRevision: revision, context: Object.freeze({ kind: 'plain' }) };
  }
  function read() {
    const value = synchronize(raw());
    if (disposed || !pageOwned(kind) || !value.editor || !value.chatId || revision >= Number.MAX_SAFE_INTEGER) throw issue();
    if (!value.text || value.text.length > 10000 || utf16(value.text) > limit
      || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.text)) throw issue('SEND_INTENT_INVALID');
    return value;
  }
  function acceptable(record, text) {
    return [record.text, record.prepared, record.output].includes(text);
  }
  function matches(record, value) {
    return value.chatId === record.chatId && value.editor === record.editor
      && value.composerRevision === record.composerRevision && acceptable(record, value.text)
      && record.context?.kind === 'plain' && value.context?.kind === 'plain';
  }
  const observer = new MutationObserver(() => {
    if (!suppressed && watched && pageText(watched) !== previous?.text) advance('node');
  });
  function watch(editor) {
    if (watched === editor) return;
    observer.disconnect();
    watched = editor;
    if (editor) observer.observe(editor, { subtree: true, childList: true, characterData: true });
  }
  const input = (event) => {
    if (suppressed || event.isTrusted !== true || !event.target?.closest) return;
    const editor = pageEditors(kind).find((node) => node === event.target || node.contains(event.target));
    if (!editor) return;
    watch(editor);
    advance(event.type, true);
    if (event.type === 'input') previous = raw();
  };
  const onHash = () => advance('chat');
  document.addEventListener('beforeinput', input, true);
  document.addEventListener('input', input, true);
  window.addEventListener('hashchange', onHash);
  return {
    selector: kind === 'telegram-a' ? '.form-control.ProseMirror' : '[role="main"] [contenteditable="true"][role="textbox"]',
    read, matches,
    currentChat() { try { return synchronize(raw()).chatId || null; } catch { return null; } },
    rawText() { try { return raw().text; } catch { return ''; } },
    get revision() { return revision; },
    outputValid(output) { return typeof output === 'string' && output.length <= 10000 && utf16(output) <= limit; },
    notSubmitted: (error) => pageQuietErrors.has(error),
    submission(event) {
      const editor = pageEditors(kind)[0];
      if (!editor) return { matches: false, supported: false };
      watch(editor);
      if (event.type === 'keydown') {
        const inside = event.target === editor || editor.contains(event.target);
        return { matches: inside && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey
          && !event.metaKey && !event.isComposing && !event.repeat, supported: true };
      }
      if (event.type !== 'click') return { matches: false, supported: false };
      const button = pageSendButton(kind, editor);
      const hit = event.target?.closest?.('button, [role="button"]');
      return { matches: Boolean(button && hit && (hit === button || button.contains(hit))), supported: true };
    },
    clear(record) {
      const value = raw();
      return value.chatId === record.chatId && value.editor === record.editor && value.text === '';
    },
    async submit(record, text, valid) {
      if (!valid()) pageFail('SEND_INTENT_CHANGED');
      const value = read();
      if (!matches(record, value) || pageNormalize(text) !== text) pageFail('SEND_INTENT_CHANGED');
      const before = pageSnapshot(kind, value.editor, text);
      suppressed = true;
      try {
        const replaced = pageReplaceText(value.editor, text);
        previous = raw();
        if (replaced !== 'ok') pageFail(replaced === 'changed' ? 'SEND_INTENT_UNCERTAIN' : 'SEND_INTENT_UNSUPPORTED', replaced === 'changed');
        if (!valid() || pageConversationId(kind) !== record.chatId) pageFail('SEND_INTENT_CHANGED');
        const button = pageSendButton(kind, value.editor);
        if (button) pageClick(button);
        else pagePressEnter(value.editor);
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await pageWait(250);
          if (!valid() || pageConversationId(kind) !== record.chatId) pageFail('SEND_INTENT_UNCERTAIN', true);
          const after = pageSnapshot(kind, value.editor, text);
          if (pageConfirmed(kind, before, after)) {
            receiptSerial += 1;
            return { id: `page:${kind}:${receiptSerial}`, ack: 1 };
          }
        }
        pageFail('SEND_INTENT_UNCERTAIN', true);
      } finally { suppressed = false; }
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      document.removeEventListener('beforeinput', input, true);
      document.removeEventListener('input', input, true);
      window.removeEventListener('hashchange', onHash);
    },
  };
}
