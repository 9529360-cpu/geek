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

(function () {
  assert.match(runtimeSource, /normalizeTranslationIntent\(body\.intent\)/, 'runtime owner must normalize the explicit wire intent');
  assert.match(runtimeSource, /intent === TRANSLATION_INTENTS\.OUTGOING_SEND \? false : body\.coalesce/, 'outgoing work must not coalesce behind background work');
  assert.match(queueSource, /value === TRANSLATION_INTENTS\.OUTGOING_SEND[\s\S]*TRANSLATION_INTENTS\.MESSAGE_DISPLAY/, 'unknown intent must fail toward background priority');
  assert.doesNotMatch(runtimeSource, /activeElement|document\.|querySelector|target language/i, 'main-process priority must not infer user intent from UI/DOM state');
  assert.doesNotMatch(rehydrateSource, /pendingOutgoingIntent|recordOutgoingIntent|activeComposerText|isComposerTarget|isSendButtonTarget|OUTGOING_INTENT_TTL_MS/, 'WhatsApp rehydrate must not infer outgoing priority from DOM gestures or composer text');

  const captured = [];
  const timers = [];
  const rows = [];
  const main = { querySelectorAll() { return rows; } };
  const window = {
    WPP: { chat: { getActiveChat: () => ({ id: { _serialized: 'chat-a' } }) } },
    __geekTranslateVisibleMessage: async () => true,
    __geekGetTranslationSetting: () => ({ displayTranslation: true, translationMode: 'auto' }),
    __geekRefreshTranslationView() {},
    __geekTranslationRequest: async payload => { captured.push(payload); return { text: 'ok' }; },
  };
  const document = {
    title: 'WhatsApp',
    documentElement: {},
    querySelector(selector) { return selector === '#main' ? main : null; },
  };
  class FakeMutationObserver { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} }
  const context = vm.createContext({
    window,
    document,
    location: { hostname: 'web.whatsapp.com' },
    MutationObserver: FakeMutationObserver,
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
      assert.equal(captured.at(-1).intent, 'message-display', 'missing intent must be explicitly downgraded to background priority');
      return window.__geekTranslationRequest({ text: 'hello customer', chatId: 'chat-a', intent: 'outgoing-send' });
    })
    .then(() => {
      assert.equal(captured.at(-1).intent, 'outgoing-send', 'already-explicit outgoing intent must be preserved through the WhatsApp transport');
      return window.__geekTranslationRequest({ text: 'unknown class', chatId: 'chat-a', intent: 'unexpected' });
    })
    .then(() => {
      assert.equal(captured.at(-1).intent, 'message-display', 'unknown intent must fail toward background priority');
      console.log('TRANSLATION_INTENT_CONTRACT_OK');
    });
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
