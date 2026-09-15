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
  let nativeRecoveryCalls = 0;

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
      createElement() { return { style: {}, remove() {}, textContent: '', id: '' }; },
      body: { appendChild(node) { notices.push(node.textContent); } },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    setTimeout() { return 1; },
    __geekWhatsAppSendRecovery: {
      ensureHook() { nativeRecoveryCalls += 1; return options.nativeRecoveryReady === true; },
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
    getNativeRecoveryCalls() { return nativeRecoveryCalls; },
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

async function finish(env) {
  await env.page.__geekWhatsAppPublicComposerFallbackLastTask;
}

(async () => {
  assert.equal(fallback.FALLBACK_VERSION, 3);
  assert.equal(fallback.isWhatsAppType('whatsapp'), true);
  assert.equal(fallback.isWhatsAppType('whatsapp-pure'), true);
  assert.equal(fallback.isWhatsAppType('telegram'), false);
  assert.equal(fallback.accountForPartition([
    { id: 'tg', type: 'telegram', partition: 'persist:a' },
    { id: 'wa', type: 'whatsapp', partition: 'persist:b' },
  ], 'persist:b')?.id, 'wa');

  // Regression oracle for the real failure: the private module can still be
  // resolvable while current WhatsApp composer gestures no longer dispatch through
  // it. A translated direct-chat gesture must therefore use the public owner even
  // when the legacy recovery reports READY.
  {
    const env = makePage({ nativeRecoveryReady: true });
    env.chat.composeQuotedMsg = { id: { _serialized: 'quoted-1' } };
    assert.equal(fallback.installPageFallback(env.page), 'READY');
    assert.deepEqual(trustedEnter(env.listeners, env.editor), { prevented: 1, stopped: 1 });
    await finish(env);
    assert.equal(env.getNativeRecoveryCalls(), 0, 'public composer owner must not gate on private-module resolvability');
    assert.equal(env.getTranslationCalls(), 1);
    assert.deepEqual(env.sends, [[
      '123@c.us',
      'translated:hello',
      { quotedMsg: env.chat.composeQuotedMsg },
    ]]);
    assert.deepEqual(env.remembered, [['translated:hello', 'hello']]);
    assert.equal(env.chat.getTestContents().text, undefined);
    assert.equal(env.page.__geekWhatsAppPublicComposerFallbackDiagnostics.lastStage, 'sent');
  }

  // Translation-disabled direct chats remain native pass-through.
  {
    const env = makePage({ nativeRecoveryReady: true, translationDisabled: true });
    fallback.installPageFallback(env.page);
    assert.deepEqual(trustedEnter(env.listeners, env.editor), { prevented: 0, stopped: 0 });
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.sends.length, 0);
  }

  // Group/newsletter/broadcast ownership is deliberately untouched.
  {
    const env = makePage({ nativeRecoveryReady: false, chat: makeChat('123@g.us') });
    env.chat.isGroup = true;
    fallback.installPageFallback(env.page);
    assert.deepEqual(trustedEnter(env.listeners, env.editor), { prevented: 0, stopped: 0 });
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.sends.length, 0);
  }

  // Missing public transport fails closed before the untranslated source can leak.
  {
    const env = makePage({ publicSend: false });
    fallback.installPageFallback(env.page);
    assert.deepEqual(trustedEnter(env.listeners, env.editor), { prevented: 1, stopped: 1 });
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.sends.length, 0);
    assert.match(env.notices.at(-1) || '', /公开发送通道尚未就绪/);
    assert.equal(env.page.__geekWhatsAppPublicComposerFallbackDiagnostics.lastStage, 'public-send-unavailable');
  }

  // Translation failure is known-unsent: restore the source draft.
  {
    const env = makePage({ translationError: new Error('TRANSLATION_FAILED') });
    fallback.installPageFallback(env.page);
    trustedEnter(env.listeners, env.editor);
    await finish(env);
    assert.equal(env.sends.length, 0);
    assert.equal(env.chat.getTestContents().text, 'hello');
    assert.equal(env.chat.getTestContents().omittedURL, 'https://example.test');
    assert.equal(env.page.__geekWhatsAppPublicComposerFallbackDiagnostics.lastStage, 'translation-failed');
  }

  // Chat switch during translation is known-unsent and cannot retarget the send.
  {
    const pending = deferred();
    const env = makePage({ translationDeferred: pending });
    fallback.installPageFallback(env.page);
    trustedEnter(env.listeners, env.editor);
    const other = makeChat('999@c.us', 'other');
    env.setActiveChat(other);
    pending.resolve({ text: 'translated:hello' });
    await finish(env);
    assert.equal(env.sends.length, 0);
    assert.equal(env.chat.getTestContents().text, 'hello');
    assert.equal(other.getTestContents().text, 'other');
    assert.match(env.notices.at(-1) || '', /聊天已切换/);
  }

  // Repeated trusted gestures while translation is pending cannot duplicate send.
  {
    const pending = deferred();
    const env = makePage({ translationDeferred: pending });
    fallback.installPageFallback(env.page);
    assert.deepEqual(trustedEnter(env.listeners, env.editor), { prevented: 1, stopped: 1 });
    assert.deepEqual(trustedEnter(env.listeners, env.editor), { prevented: 1, stopped: 1 });
    assert.equal(env.getTranslationCalls(), 1);
    pending.resolve({ text: 'translated:hello' });
    await finish(env);
    assert.equal(env.sends.length, 1);
  }

  // Once the public transport is invoked, an unknown send outcome must not restore
  // the source and create a duplicate-send hazard on retry.
  {
    const env = makePage({ sendError: new Error('ACK_UNKNOWN') });
    fallback.installPageFallback(env.page);
    trustedEnter(env.listeners, env.editor);
    await finish(env);
    assert.equal(env.sends.length, 1);
    assert.equal(env.chat.getTestContents().text, undefined);
    assert.equal(env.page.__geekWhatsAppPublicComposerFallbackDiagnostics.lastStage, 'send-failed');
    assert.match(env.notices.at(-1) || '', /ACK_UNKNOWN/);
  }

  assert.match(bootstrapSource, /whatsapp-composer-public-fallback\.js/, 'shell bootstrap must load the public composer owner');
  assert.match(fallbackSource, /chat\.sendTextMessage\(chatId, translated\.text, options\)/, 'direct translated composer must use public WPP text send');
  assert.match(fallbackSource, /if \(!isDirectChat\(chat, chatId\)\) return false/, 'owner must stay direct-chat-only');
  assert.doesNotMatch(fallbackSource, /ensureHook\?\.\(\) === true\) return false/, 'private module readiness must not gate the public composer owner');
  assert.doesNotMatch(fallbackSource, /WAWebSendTextMsgChatAction/, 'public composer owner must not depend on the fragile private module name');

  console.log('WhatsApp composer public owner contract passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
