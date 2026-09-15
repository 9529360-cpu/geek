'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/whatsapp-direct-composer-controller.js');
const bootstrapPath = path.join(__dirname, '../ui/version-label.js');
const controllerSource = fs.readFileSync(controllerPath, 'utf8');
const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
const controller = require(controllerPath);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeAbort() {
  return new AbortController();
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
  const clearedIntervals = [];
  const chat = options.chat || makeChat();
  let activeChat = chat;
  let editorText = options.editorText || 'hello';
  let translationCalls = 0;

  const editor = {
    isContentEditable: true,
    closest(selector) { return selector.includes('contenteditable') ? this : null; },
    get innerText() { return editorText; },
    get textContent() { return editorText; },
  };

  const recoveryAbort = makeAbort();
  const oldFallbackAbort = makeAbort();
  const guardAbort = makeAbort();
  const nativeSends = [];
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
    clearInterval(id) { clearedIntervals.push(id); },
    setTimeout() { return 1; },
    __geekWhatsAppSendRecovery: {
      controller: recoveryAbort,
      timer: 77,
      ensureHook() { return true; },
    },
    __geekWhatsAppPublicComposerFallback: {
      controller: oldFallbackAbort,
    },
    __geekWhatsAppGuardAbort: guardAbort,
    __geekWhatsAppWrappedSend() {},
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
    page, chat, editor, listeners, notices, sends, remembered, clearedIntervals, nativeSends,
    recoveryAbort, oldFallbackAbort, guardAbort,
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
  assert.equal(controller.CONTROLLER_VERSION, 4);
  assert.equal(controller.isWhatsAppType('whatsapp'), true);
  assert.equal(controller.isWhatsAppType('whatsapp-pure'), true);
  assert.equal(controller.isWhatsAppType('telegram'), false);

  {
    const env = makePage();
    env.chat.composeQuotedMsg = { id: { _serialized: 'quoted-1' } };
    assert.equal(controller.installPageController(env.page), 'READY');
    assert.equal(env.recoveryAbort.signal.aborted, true, 'legacy recovery listener must be retired');
    assert.equal(env.oldFallbackAbort.signal.aborted, true, 'legacy fallback listener must be retired');
    assert.equal(env.guardAbort.signal.aborted, true, 'legacy app.js raw-send guard must be retired');
    assert.deepEqual(env.clearedIntervals, [77], 'legacy recovery timer must be retired');
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 1, stopped: 1 });
    await env.page.__geekWhatsAppDirectComposerLastTask;
    assert.equal(env.getTranslationCalls(), 1);
    assert.deepEqual(env.sends, [[
      '123@c.us',
      'translated:hello',
      { quotedMsg: env.chat.composeQuotedMsg },
    ]]);
    assert.deepEqual(env.remembered, [['translated:hello', 'hello']]);
    assert.equal(env.chat.getTestContents().text, undefined);
    assert.equal(env.page.__geekWhatsAppDirectComposerController.diagnostics.phase, 'sent');
    assert.equal(env.page.__geekWhatsAppDirectComposerController.diagnostics.sent, 1);
  }

  {
    const env = makePage({ translationDisabled: true });
    controller.installPageController(env.page);
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 0, stopped: 0 });
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.sends.length, 0);
  }

  {
    const chat = makeChat('123@g.us');
    chat.isGroup = true;
    const env = makePage({ chat });
    controller.installPageController(env.page);
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 0, stopped: 0 });
    assert.equal(env.sends.length, 0);
  }

  {
    const env = makePage({ publicSend: false });
    controller.installPageController(env.page);
    const counters = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(counters, { prevented: 1, stopped: 1 });
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.sends.length, 0);
    assert.match(env.notices.at(-1) || '', /发送通道尚未就绪/);
  }

  {
    const env = makePage({ translationError: new Error('TRANSLATION_FAILED') });
    controller.installPageController(env.page);
    trustedEnter(env.listeners, env.editor);
    await env.page.__geekWhatsAppDirectComposerLastTask;
    assert.equal(env.sends.length, 0);
    assert.equal(env.chat.getTestContents().text, 'hello');
    assert.equal(env.chat.getTestContents().omittedURL, 'https://example.test');
    assert.equal(env.page.__geekWhatsAppDirectComposerController.diagnostics.phase, 'translation-error');
  }

  {
    const pending = deferred();
    const env = makePage({ translationDeferred: pending });
    controller.installPageController(env.page);
    trustedEnter(env.listeners, env.editor);
    const other = makeChat('999@c.us', 'other');
    env.setActiveChat(other);
    pending.resolve({ text: 'translated:hello' });
    await env.page.__geekWhatsAppDirectComposerLastTask;
    assert.equal(env.sends.length, 0);
    assert.equal(env.chat.getTestContents().text, 'hello');
    assert.equal(other.getTestContents().text, 'other');
  }

  {
    const pending = deferred();
    const env = makePage({ translationDeferred: pending });
    controller.installPageController(env.page);
    const first = trustedEnter(env.listeners, env.editor);
    const second = trustedEnter(env.listeners, env.editor);
    assert.deepEqual(first, { prevented: 1, stopped: 1 });
    assert.deepEqual(second, { prevented: 1, stopped: 1 });
    assert.equal(env.getTranslationCalls(), 1);
    pending.resolve({ text: 'translated:hello' });
    await env.page.__geekWhatsAppDirectComposerLastTask;
    assert.equal(env.sends.length, 1);
  }

  {
    const env = makePage({ sendError: new Error('transport uncertain') });
    controller.installPageController(env.page);
    trustedEnter(env.listeners, env.editor);
    await env.page.__geekWhatsAppDirectComposerLastTask;
    assert.equal(env.sends.length, 1);
    assert.equal(env.chat.getTestContents().text, undefined);
    assert.equal(env.page.__geekWhatsAppDirectComposerController.diagnostics.phase, 'send-error');
    assert.match(env.notices.at(-1) || '', /transport uncertain/);
  }

  {
    const env = makePage();
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    const nativeOriginal = async (chat, ...args) => { env.nativeSends.push([chat, ...args]); return { id: 'native-1' }; };
    const result = await owner.handleNativeSend(env.chat, ['hello', { preserve: true }], nativeOriginal, { native: true });
    assert.deepEqual(result, { id: 'native-1' });
    assert.equal(env.getTranslationCalls(), 1, 'native fallback must translate exactly once');
    assert.equal(env.nativeSends.length, 1);
    assert.equal(env.nativeSends[0][1], 'translated:hello', 'native fallback must never pass raw source when translation applies');
    assert.deepEqual(env.nativeSends[0][2], { preserve: true }, 'native fallback must preserve original native send options');
    assert.deepEqual(env.remembered, [['translated:hello', 'hello']]);
    assert.equal(owner.diagnostics.phase, 'sent');
  }

  {
    const env = makePage({ translationError: new Error('native translation failed') });
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    const nativeOriginal = async (chat, ...args) => { env.nativeSends.push([chat, ...args]); return { id: 'native-should-not-send' }; };
    await assert.rejects(
      owner.handleNativeSend(env.chat, ['hello'], nativeOriginal, null),
      /native translation failed/,
    );
    assert.equal(env.nativeSends.length, 0, 'native fallback must fail closed and never leak raw source');
    assert.match(env.notices.at(-1) || '', /未分类.*原文未发送/);
  }

  {
    const env = makePage({ translationDisabled: true });
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    const nativeOriginal = async (chat, ...args) => { env.nativeSends.push([chat, ...args]); return { id: 'native-pass' }; };
    await owner.handleNativeSend(env.chat, ['hello'], nativeOriginal, null);
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.nativeSends.length, 1);
    assert.equal(env.nativeSends[0][1], 'hello', 'translation-off native send must remain raw/native pass-through');
  }

  {
    const chat = makeChat('123@g.us');
    chat.isGroup = true;
    const env = makePage({ chat });
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    const nativeOriginal = async (nativeChat, ...args) => { env.nativeSends.push([nativeChat, ...args]); return { id: 'group-pass' }; };
    await owner.handleNativeSend(chat, ['group hello'], nativeOriginal, null);
    assert.equal(env.getTranslationCalls(), 0);
    assert.equal(env.nativeSends.length, 1, 'group native send must remain outside direct/private owner');
  }

  {
    const env = makePage();
    assert.equal(controller.installPageController(env.page), 'READY');
    const lateRecovery = makeAbort();
    env.page.__geekWhatsAppSendRecovery = { controller: lateRecovery, timer: 88 };
    assert.equal(controller.installPageController(env.page), 'READY');
    assert.equal(lateRecovery.signal.aborted, true);
    assert.deepEqual(env.clearedIntervals, [77, 88]);
  }

  assert.match(bootstrapSource, /whatsapp-direct-composer-controller\.js/, 'shell bootstrap must load the direct composer controller');
  assert.doesNotMatch(bootstrapSource, /whatsapp-composer-public-fallback\.js/, 'superseded fallback must leave the startup chain');
  assert.match(controllerSource, /chat\.sendTextMessage\(chatId, translated\.text, options\)/, 'trusted DOM path must keep public WPP text send');
  assert.match(controllerSource, /handleNativeSend[\s\S]*original\.call\(thisArg, chat, \.\.\.args\)/, 'native fallback must preserve the native send transport behind the same controller owner');
  assert.doesNotMatch(controllerSource, /WAWebSendTextMsgChatAction|sendTextMsgToChat/, 'controller policy must not hard-code Meta private module names');

  console.log('WHATSAPP_DIRECT_COMPOSER_CONTROLLER_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
