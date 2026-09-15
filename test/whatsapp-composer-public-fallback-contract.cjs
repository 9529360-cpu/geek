'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fallbackPath = path.join(__dirname, '../ui/whatsapp-composer-public-fallback.js');
const bootstrapPath = path.join(__dirname, '../ui/version-label.js');
const fallbackSource = fs.readFileSync(fallbackPath, 'utf8');
const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
const fallback = require(fallbackPath);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeChat(id = '123@c.us', text = 'hello') {
  let contents = { text, timestamp: 123, omittedURL: 'https://example.test' };
  return {
    id: { _serialized: id },
    composeQuotedMsg: null,
    getComposeContents() { return { ...contents }; },
    setComposeContents(next) { contents = { ...(next || {}) }; },
    getTestContents() { return { ...contents }; },
  };
}

function makePage(options = {}) {
  const listeners = new Map();
  const notices = [];
  const sends = [];
  const remembered = [];
  const chat = options.chat || makeChat();
  let activeChat = chat;
  let editorText = options.editorText || 'hello';
  let translationCalls = 0;

  const editor = {
    closest(selector) { return selector.includes('contenteditable') ? this : null; },
    get innerText() { return editorText; },
    get textContent() { return editorText; },
  };

  const page = {
    AbortController,
    console: { error() {} },
    WPP: {
      chat: {
        getActiveChat() { return activeChat; },
        ...(options.publicSend === false ? {} : {
          async sendTextMessage(...args) {
            sends.push(args);
            if (options.sendError) throw options.sendError;
            return options.sendResult === undefined ? { id: 'sent-1' } : options.sendResult;
          },
        }),
      },
    },
    document: {
      querySelector() { return editor; },
      getElementById() { return null; },
      createElement() {
        return { style: {}, remove() {}, textContent: '', id: '' };
      },
      body: { appendChild(node) { notices.push(node.textContent); } },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    setTimeout() { return 1; },
    __geekWhatsAppSendRecovery: {
      ensureHook() { return options.nativeRecoveryReady === true; },
    },
    __geekGetTranslationSetting() {
      return options.translationDisabled
        ? { enabled: false, autoSend: false }
        : { enabled: true, autoSend: true, includeZh: true, source: 'auto', target: 'it', provider: 'auto', route: 'default' };
    },
    __geekTranslationRequest: async payload => {
      translationCalls += 1;
      if (options.translationDeferred) return options.translationDeferred.promise;
      if (options.translationError) throw options.translationError;
      return { text: `translated:${payload.text}` };
    },
    __geekRememberOutgoing(translated, original) { remembered.push([translated, original]); },
    __geekPickWpp(requirements) {
      const needs = Array.isArray(requirements) ? requirements : [requirements];
      if (needs.includes('chat.sendTextMessage') && options.publicSend === false) return null;
      return page.WPP;
    },
  };

  return {
    page,
    chat,
    editor,
    listeners,
    notices,
    sends,
    remembered,
    setActiveChat(next) { activeChat = next; },
    setEditorText(next) { editorText = next; },
    getTranslationCalls() { return translationCalls; },
  };
}

function trustedEnter(listeners, target) {
  const counters = { prevented: 0, stopped: 0 };
  const event = {
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, isTrusted: true, target,
    preventDefault() { counters.prevented += 1; },
    stopImmediatePropagation() { counters.stopped += 1; },
  };
  listeners.get('keydown')(event);
  return counters;
}

(async () => {
  assert.equal(fallback.isWhatsAppType('whatsapp'), true);
  assert.equal(fallback.isWhatsAppType('whatsapp-pure'), true);
  assert.equal(fallback.isWhatsAppType('telegram'), false);
  assert.equal(
    fallback.accountForPartition([
      { id: 'tg', type: 'telegram', partition: 'persist:a' },
      { id: 'wa', type: 'whatsapp', partition: 'persist:b' },
    ], 'persist:b')?.id,
    'wa',
  );

  // The existing private/native composer recovery remains authoritative when it
  // can bind the live Meta send module. The degraded public path must stay idle.
  {
    const env = makePage({ nativeRecoveryReady: true });
    assert.equal(fallback.installPageFallback(env.page), 'READY');
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 0, stopped: 0 });
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.sends.length, 0);
  }

  // Reproduce the live regression boundary: private composer owner is missing,
  // but the public WPP send surface used by broadcast is healthy. One trusted
  // composer gesture must translate once and send once through the public API.
  {
    const env = makePage({ nativeRecoveryReady: false });
    env.chat.composeQuotedMsg = { id: { _serialized: 'quoted-1' } };
    assert.equal(fallback.installPageFallback(env.page), 'READY');
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 1, stopped: 1 }, 'degraded owner must stop the broken native gesture');
    await env.page.__geekWhatsAppPublicComposerFallbackLastTask;
    assert.equal(env.getTranslationCalls(), 1, 'composer fallback must translate exactly once');
    assert.deepEqual(env.sends, [[
      '123@c.us',
      'translated:hello',
      { quotedMsg: env.chat.composeQuotedMsg },
    ]], 'public WPP path must receive only the translated text and preserve reply context');
    assert.deepEqual(env.remembered, [['translated:hello', 'hello']]);
    assert.equal(env.chat.getTestContents().text, undefined, 'successful fallback send must leave the native compose draft cleared');
  }

  // Translation-disabled chats remain pure native pass-through. The fallback is
  // not a general replacement for WhatsApp's composer authority.
  {
    const env = makePage({ nativeRecoveryReady: false, translationDisabled: true });
    fallback.installPageFallback(env.page);
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 0, stopped: 0 });
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.sends.length, 0);
  }

  // If neither the private owner nor the public WPP text capability is ready,
  // fail closed before WhatsApp can leak the untranslated source.
  {
    const env = makePage({ nativeRecoveryReady: false, publicSend: false });
    fallback.installPageFallback(env.page);
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 1, stopped: 1 });
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.sends.length, 0);
    assert.match(env.notices.at(-1) || '', /发送通道尚未就绪/);
  }

  // Translation failures are known-unsent Geek failures: restore the exact source
  // draft and never invoke the public WhatsApp send owner.
  {
    const env = makePage({ nativeRecoveryReady: false, translationError: new Error('TRANSLATION_FAILED') });
    fallback.installPageFallback(env.page);
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 1, stopped: 1 });
    await env.page.__geekWhatsAppPublicComposerFallbackLastTask;
    assert.equal(env.sends.length, 0);
    assert.equal(env.chat.getTestContents().text, 'hello');
    assert.equal(env.chat.getTestContents().omittedURL, 'https://example.test');
    assert.match(env.notices.at(-1) || '', /原文已恢复/);
  }

  // Chat-switch during an asynchronous translation is also known-unsent. Restore
  // only the original chat draft and never send into the newly active chat.
  {
    const pending = deferred();
    const env = makePage({ nativeRecoveryReady: false, translationDeferred: pending });
    fallback.installPageFallback(env.page);
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 1, stopped: 1 });
    const other = makeChat('999@c.us', 'other');
    env.setActiveChat(other);
    pending.resolve({ text: 'translated:hello' });
    await env.page.__geekWhatsAppPublicComposerFallbackLastTask;
    assert.equal(env.sends.length, 0);
    assert.equal(env.chat.getTestContents().text, 'hello');
    assert.equal(other.getTestContents().text, 'other');
    assert.match(env.notices.at(-1) || '', /聊天已切换/);
  }

  // While a fallback translation is in flight, a repeated trusted gesture must
  // be consumed without starting another translation or duplicate send.
  {
    const pending = deferred();
    const env = makePage({ nativeRecoveryReady: false, translationDeferred: pending });
    fallback.installPageFallback(env.page);
    const first = trustedEnter(env.listeners, env.editor);
    const second = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(first, { prevented: 1, stopped: 1 });
    assert.deepEqual(second, { prevented: 1, stopped: 1 });
    assert.equal(env.getTranslationCalls(), 1);
    assert.match(env.notices.at(-1) || '', /翻译处理中/);
    pending.resolve({ text: 'translated:hello' });
    await env.page.__geekWhatsAppPublicComposerFallbackLastTask;
    assert.equal(env.sends.length, 1);
  }

  assert.match(bootstrapSource, /whatsapp-composer-public-fallback\.js/, 'shell bootstrap must load the degraded composer owner');
  assert.match(fallbackSource, /__geekWhatsAppSendRecovery\?\.ensureHook/, 'public path must yield to the existing native recovery owner');
  assert.match(fallbackSource, /__geekPickWpp\?\.\(requirements\)/, 'fallback must use the shared capability selector when available');
  assert.match(fallbackSource, /chat\.sendTextMessage\(chatId, translated\.text, options\)/, 'fallback must use the public WPP text send surface');
  assert.doesNotMatch(fallbackSource, /WAWebSendTextMsgChatAction/, 'degraded public path must not reintroduce the fragile private module name');

  console.log('WhatsApp composer public fallback contract passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
