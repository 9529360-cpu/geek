'use strict';

const assert = require('node:assert/strict');
const recovery = require('../ui/whatsapp-translation-hook-recovery.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

(async () => {
  const mod = {};
  const chat = { id: { _serialized: '123@c.us' } };
  const translation = deferred();
  const rawPromise = Promise.resolve('raw-native-result');
  const nativeError = new Error('WA_NATIVE_FAILURE');
  const nativeCalls = [];
  let translationEnabled = true;
  let queueTail = Promise.resolve();
  let queueReads = 0;
  let queueWrites = 0;
  let translationCalls = 0;

  const native = function (_chat, text) {
    nativeCalls.push(text);
    if (text === 'raw-now') return rawPromise;
    if (text === 'raw-throws') throw nativeError;
    return Promise.resolve(`native:${text}`);
  };

  const page = {
    require(name) {
      assert.equal(name, 'WAWebSendTextMsgChatAction');
      return mod;
    },
    WPP: { chat: { getActiveChat: () => chat } },
    AbortController,
    console: { error() {} },
    document: {
      querySelector() { return null; },
      getElementById() { return null; },
      createElement() { return { style: {}, remove() {} }; },
      body: { appendChild() {} },
    },
    addEventListener() {},
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 1; },
    __geekGetTranslationSetting() {
      return translationEnabled
        ? { enabled: true, autoSend: true, includeZh: true, source: 'auto', target: 'it', provider: 'auto', route: 'default' }
        : { enabled: false, autoSend: false };
    },
    __geekTranslationRequest() {
      translationCalls += 1;
      return translation.promise;
    },
  };

  Object.defineProperty(page, '__geekSendQueue', {
    configurable: true,
    get() { queueReads += 1; return queueTail; },
    set(value) { queueWrites += 1; queueTail = value; },
  });

  // Reproduce the real steady-state owner from app.js: even a translation-disabled
  // send used to enter this legacy queue because the predicate lived inside run().
  const appWrapper = function (targetChat, ...args) {
    const receiver = this;
    const run = async () => {
      const setting = page.__geekGetTranslationSetting(targetChat?.id?._serialized);
      const text = args[0];
      if (setting?.enabled && setting?.autoSend) {
        const result = await page.__geekTranslationRequest({ text, target: setting.target });
        if (!result?.text) throw new Error('翻译失败');
        args[0] = result.text;
      }
      return native.call(receiver, targetChat, ...args);
    };
    const queue = page.__geekSendQueue || Promise.resolve();
    const next = queue.then(run, run);
    page.__geekSendQueue = next.catch(() => {});
    return next;
  };
  mod.__geekOriginalSendText = native;
  mod.sendTextMsgToChat = appWrapper;
  page.__geekWhatsAppWrappedSend = appWrapper;

  assert.ok(recovery.RECOVERY_VERSION >= 7, 'native pass-through boundary change must reinstall on already-open WebViews');
  assert.equal(recovery.installPageRecovery(page, recovery.RECOVERY_VERSION), 'READY');
  const bounded = mod.sendTextMsgToChat;
  assert.equal(bounded.__geekTranslationFailureBoundary, true);
  assert.equal(bounded.__geekTranslationFailureBoundaryDelegate, appWrapper,
    'translated sends must retain the existing app translation owner');
  assert.equal(bounded.__geekTranslationNativePassThrough, native,
    'failure boundary must retain the native authority for non-applicable sends');

  const first = bounded(chat, 'needs-translation');
  await Promise.resolve();
  assert.equal(translationCalls, 1, 'enabled send must enter the existing app translation transform');
  assert.deepEqual(nativeCalls, [], 'translated send must remain pending while translation is unresolved');
  assert.ok(queueReads > 0 && queueWrites > 0, 'translated send must still use the serialized translation queue');

  translationEnabled = false;
  queueReads = 0;
  queueWrites = 0;
  const second = bounded(chat, 'raw-now');

  assert.equal(second, rawPromise, 'disabled send must preserve the exact native return value/promise');
  assert.deepEqual(nativeCalls, ['raw-now'],
    'disabled send must invoke native owner immediately while an earlier translated send is still pending');
  assert.equal(queueReads, 0, 'disabled send must not read Geek translation queue');
  assert.equal(queueWrites, 0, 'disabled send must not mutate Geek translation queue');

  assert.throws(
    () => bounded(chat, 'raw-throws'),
    error => error === nativeError,
    'disabled send must preserve native synchronous error identity'
  );
  assert.equal(queueReads, 0, 'native error path must still bypass Geek queue');
  assert.equal(queueWrites, 0, 'native error path must not replace Geek queue tail');

  translation.resolve({ text: 'translated:needs-translation' });
  assert.equal(await first, 'native:translated:needs-translation');
  assert.deepEqual(nativeCalls, ['raw-now', 'raw-throws', 'translated:needs-translation']);

  console.log('WHATSAPP_TRANSLATION_NATIVE_PASS_THROUGH_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
