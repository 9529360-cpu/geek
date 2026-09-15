'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const rehydrateSource = fs.readFileSync(path.join(root, 'ui', 'translation-whatsapp-rehydrate.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(root, 'src', 'translation-runtime.cjs'), 'utf8');
const queueSource = fs.readFileSync(path.join(root, 'src', 'translation-smart-queue.cjs'), 'utf8');

function loadInstallerSource() {
  const context = vm.createContext({
    window: {},
    document: { readyState: 'loading', addEventListener() {}, querySelectorAll() { return []; }, documentElement: {} },
    MutationObserver: class { observe() {} disconnect() {} },
  });
  vm.runInContext(rehydrateSource, context, { filename: 'translation-whatsapp-rehydrate.js' });
  return context.window.GeekWhatsAppTranslationRehydrate.guestInstallerSource();
}

function makeTarget(matches) {
  return {
    closest(selector) { return matches.some(value => selector.includes(value)) ? this : null; },
  };
}

(function () {
  assert.match(runtimeSource, /normalizeTranslationIntent\(body\.intent\)/, 'runtime owner must normalize the explicit wire intent');
  assert.match(runtimeSource, /intent === TRANSLATION_INTENTS\.OUTGOING_SEND \? false : body\.coalesce/, 'outgoing work must not coalesce behind background work');
  assert.match(queueSource, /value === TRANSLATION_INTENTS\.OUTGOING_SEND[\s\S]*TRANSLATION_INTENTS\.MESSAGE_DISPLAY/, 'unknown intent must fail toward background priority');
  assert.doesNotMatch(runtimeSource, /activeElement|document\.|querySelector|target language/i, 'main-process priority must not infer user intent from UI/DOM state');

  const listeners = new Map();
  const captured = [];
  const timers = [];
  const rows = [];
  const composer = { innerText: 'hello customer' };
  const main = { querySelectorAll() { return rows; } };
  let chatId = 'chat-a';
  const window = {
    WPP: { chat: { getActiveChat: () => ({ id: { _serialized: chatId } }) } },
    __geekTranslateVisibleMessage: async () => true,
    __geekGetTranslationSetting: () => ({ displayTranslation: true, translationMode: 'auto' }),
    __geekRefreshTranslationView() {},
    __geekTranslationRequest: async payload => { captured.push(payload); return { text: 'ok' }; },
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const document = {
    title: 'WhatsApp',
    documentElement: {},
    querySelector(selector) {
      if (selector === '#main') return main;
      if (selector.includes('contenteditable')) return composer;
      return null;
    },
  };
  class FakeMutationObserver { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} }
  class FakeAbortController { constructor() { this.signal = {}; } abort() {} }
  window.AbortController = FakeAbortController;
  const context = vm.createContext({
    window,
    document,
    location: { hostname: 'web.whatsapp.com' },
    MutationObserver: FakeMutationObserver,
    AbortController: FakeAbortController,
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
    Promise,
    Object,
    Math,
    String,
    Array,
  });
  vm.runInContext(loadInstallerSource(), context, { filename: 'translation-intent-guest.js' });
  while (timers.length) timers.shift()();

  assert.equal(window.__geekTranslationRequest.__geekTranslationIntentTransport, true, 'WhatsApp bridge transport must be intent-tagged before requests leave the guest');

  return window.__geekTranslationRequest({ text: 'visible message', chatId: 'chat-a' })
    .then(() => {
      assert.equal(captured.at(-1).intent, 'message-display', 'ordinary visible/background work must carry low-priority intent explicitly');

      listeners.get('keydown')({
        key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, isTrusted: true,
        target: makeTarget(['contenteditable']),
      });
      return window.__geekTranslationRequest({ text: 'hello customer', chatId: 'chat-a' });
    })
    .then(() => {
      assert.equal(captured.at(-1).intent, 'outgoing-send', 'trusted composer send must carry outgoing intent explicitly through the page-host request');
      return window.__geekTranslationRequest({ text: 'hello customer', chatId: 'chat-a' });
    })
    .then(() => {
      assert.equal(captured.at(-1).intent, 'message-display', 'outgoing intent must be one-shot and must not promote later display work');
      chatId = 'chat-b';
      composer.innerText = 'next chat';
      listeners.get('click')({ isTrusted: true, target: makeTarget(['aria-label="Send"']) });
      return window.__geekTranslationRequest({ text: 'next chat', chatId: 'chat-b', intent: 'outgoing-send' });
    })
    .then(() => {
      assert.equal(captured.at(-1).intent, 'outgoing-send', 'already-explicit outgoing intent must be preserved');
      console.log('TRANSLATION_INTENT_CONTRACT_OK');
    });
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
