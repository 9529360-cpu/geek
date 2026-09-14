'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const recoveryPath = path.join(__dirname, '../ui/whatsapp-translation-hook-recovery.js');
const bootstrapPath = path.join(__dirname, '../ui/version-label.js');
const source = fs.readFileSync(recoveryPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const recovery = require(recoveryPath);

function makeChat(id, initialText = '') {
  let contents = { text: initialText, timestamp: 123, omittedURL: 'https://example.test' };
  const restores = [];
  return {
    id: { _serialized: id },
    getComposeContents() { return { ...contents }; },
    setComposeContents(next) { contents = { ...(next || {}) }; restores.push({ ...contents }); },
    setTestContents(next) { contents = { ...(next || {}) }; },
    getTestContents() { return { ...contents }; },
    restores,
  };
}

function makePage() {
  const listeners = new Map();
  let intervalCount = 0;
  let clearCount = 0;
  const notices = [];
  const mod = {};
  const editor = {
    closest(selector) { return selector.includes('contenteditable') ? this : null; },
    get innerText() { return page.__editorText || ''; },
    get textContent() { return page.__editorText || ''; },
  };
  const page = {
    __editorText: '',
    __activeChat: null,
    require(name) {
      assert.equal(name, 'WAWebSendTextMsgChatAction');
      return mod;
    },
    WPP: {
      chat: {
        getActiveChat() { return page.__activeChat; },
      },
    },
    AbortController,
    console: { error() {} },
    document: {
      querySelector(selector) {
        return /contenteditable|conversation-compose-box-input/.test(selector) ? editor : null;
      },
      getElementById() { return null; },
      createElement() {
        return { style: {}, remove() {}, set id(value) { this._id = value; }, get id() { return this._id; } };
      },
      body: { appendChild(node) { notices.push(node.textContent); } },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    setInterval(handler) { intervalCount += 1; page.intervalHandler = handler; return intervalCount; },
    clearInterval() { clearCount += 1; },
    setTimeout() { return 1; },
    __geekSendQueue: Promise.resolve(),
    __geekGetTranslationSetting() {
      return { enabled: true, autoSend: true, includeZh: true, source: 'auto', target: 'it', provider: 'auto', route: 'default' };
    },
    __geekTranslationRequest: async ({ text }) => ({ text: `translated:${text}` }),
  };
  return { page, mod, editor, listeners, notices, getIntervalCount: () => intervalCount, getClearCount: () => clearCount };
}

function trustedEnter(listeners, target, counters = {}) {
  const event = {
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, isTrusted: true, target,
    preventDefault() { counters.prevented = (counters.prevented || 0) + 1; },
    stopImmediatePropagation() { counters.stopped = (counters.stopped || 0) + 1; },
  };
  listeners.get('keydown')(event);
  return counters;
}

(async () => {
  assert.equal(recovery.isWhatsAppType('whatsapp'), true);
  assert.equal(recovery.isWhatsAppType('whatsapp-pure'), true);
  assert.equal(recovery.isWhatsAppType('telegram-z'), false);
  assert.equal(
    recovery.accountForPartition([
      { id: 'tg', type: 'telegram-z', partition: 'persist:a' },
      { id: 'wa', type: 'whatsapp', partition: 'persist:b' },
    ], 'persist:b')?.id,
    'wa',
    'shell ownership must resolve the exact WhatsApp account partition'
  );
  assert.equal(recovery.accountForPartition([{ id: 'tg', type: 'telegram-z', partition: 'persist:b' }], 'persist:b'), null);

  const first = makePage();
  const chat = makeChat('123@c.us', 'hello');
  first.page.__activeChat = chat;
  first.page.__editorText = 'hello';
  const native1Calls = [];
  const native1 = async function (_chat, text) { native1Calls.push(text); return 'native-1'; };
  const appWrapper = function (targetChat, ...args) {
    return (async () => {
      const setting = first.page.__geekGetTranslationSetting(targetChat?.id?._serialized);
      const text = args[0];
      if (setting?.enabled && setting?.autoSend && typeof first.page.__geekTranslationRequest === 'function') {
        const result = await first.page.__geekTranslationRequest({ text, target: setting.target });
        if (!result?.text) throw new Error('翻译失败');
        args[0] = result.text;
      }
      return native1.call(this, targetChat, ...args);
    })();
  };
  first.mod.sendTextMsgToChat = appWrapper;
  first.mod.__geekOriginalSendText = native1;
  first.page.__geekWhatsAppWrappedSend = appWrapper;

  assert.equal(recovery.installPageRecovery(first.page, recovery.RECOVERY_VERSION), 'READY');
  const firstBoundary = first.mod.sendTextMsgToChat;
  assert.notEqual(firstBoundary, appWrapper, 'the healthy app translation wrapper should gain one outer failure boundary');
  assert.equal(firstBoundary.__geekTranslationFailureBoundary, true);
  assert.equal(firstBoundary.__geekTranslationFailureBoundaryDelegate, appWrapper, 'the boundary must delegate to the existing app owner instead of duplicating translation');
  assert.equal(first.page.__geekWhatsAppWrappedSend, firstBoundary, 'the existing raw-send guard must recognize the bounded wrapper as healthy');
  assert.equal(first.getIntervalCount(), 1, 'one lifecycle probe interval should be installed');
  const listenerCount = first.listeners.size;
  assert.equal(recovery.installPageRecovery(first.page, recovery.RECOVERY_VERSION), 'READY');
  assert.equal(first.mod.sendTextMsgToChat, firstBoundary, 'reinstall must not nest another failure boundary');
  assert.equal(first.getIntervalCount(), 1, 'reinstall must not duplicate the lifecycle interval');
  assert.equal(first.listeners.size, listenerCount, 'reinstall must not duplicate capture listeners');

  // WhatsApp replaces its internal native owner. The same trusted Enter gesture
  // must heal the generation before app.js's document-capture safety guard runs.
  const native2Calls = [];
  const native2 = async function (_chat, text) { native2Calls.push(text); return 'native-2'; };
  first.mod.sendTextMsgToChat = native2;
  trustedEnter(first.listeners, first.editor);
  const healed = first.mod.sendTextMsgToChat;
  assert.notEqual(healed, native2, 'window-capture recovery must rebind a drifted live send function before document guard');
  assert.equal(healed.__geekTranslationFailureBoundary, true);
  assert.equal(healed.__geekTranslationFailureBoundaryDelegate.__geekTranslationRecoveryWrapper, true, 'drift recovery should keep translation in one inner wrapper and failure isolation in one outer boundary');
  assert.equal(first.mod.__geekOriginalSendText, native2, 'the current WhatsApp generation must become the authoritative original');
  assert.equal(first.page.__geekWhatsAppWrappedSend, healed);
  assert.equal(healed.__geekTranslationFailureBoundaryDelegate.__geekTranslationRecoveryOriginal, native2);

  const remembered = [];
  first.page.__geekRememberOutgoing = (translated, original) => remembered.push([translated, original]);
  assert.equal(await healed.call({ receiver: true }, chat, 'hello'), 'native-2');
  assert.deepEqual(native2Calls, ['translated:hello'], 'recovered send must call the new live original with translated text');
  assert.deepEqual(remembered, [['translated:hello', 'hello']], 'outgoing original mapping must survive recovery');

  // A trusted ordinary-composer translation rejection is Geek's error domain.
  // WhatsApp has already cleared compose state by the time the async request fails,
  // so restore the exact pre-submit draft and resolve the outer boundary without
  // ever calling the native send owner or creating a native failed-send state.
  first.page.__editorText = 'must-not-leak';
  chat.setTestContents({ text: 'must-not-leak', timestamp: 456, omittedURL: 'https://example.test/path' });
  let rejectTranslation;
  first.page.__geekTranslationRequest = () => new Promise((_resolve, reject) => { rejectTranslation = reject; });
  trustedEnter(first.listeners, first.editor);
  const failedComposerSend = first.mod.sendTextMsgToChat(chat, 'must-not-leak');
  chat.setTestContents({});
  const repeatedCounters = trustedEnter(first.listeners, first.editor, {});
  assert.equal(repeatedCounters.prevented, 1, 'a second trusted Enter while translation is pending must be blocked');
  assert.equal(repeatedCounters.stopped, 1, 'a second trusted Enter while translation is pending must not reach WhatsApp');
  assert.match(first.notices.at(-1) || '', /翻译处理中，请稍候/);
  await Promise.resolve();
  assert.equal(typeof rejectTranslation, 'function', 'queued recovery must enter the translation request before the test rejects it');
  rejectTranslation(new Error('QUOTA_EXHAUSTED'));
  assert.equal(await failedComposerSend, undefined, 'trusted composer translation failure must be consumed outside WhatsApp native send');
  assert.deepEqual(native2Calls, ['translated:hello'], 'translation failure must never call native send with raw source');
  assert.equal(chat.getTestContents().text, 'must-not-leak', 'translation failure must restore the source draft');
  assert.equal(chat.getTestContents().omittedURL, 'https://example.test/path', 'compose snapshot restoration should retain native draft metadata');
  assert.match(first.notices.at(-1) || '', /翻译失败，原文已恢复/);

  // If the user switches chats while translation is pending, the request may
  // finish successfully but must be converted into a fail-closed Geek outcome.
  // Restore the draft on the original chat model and never send into either chat.
  first.page.__editorText = 'switch-away';
  chat.setTestContents({ text: 'switch-away', timestamp: 600, omittedURL: 'https://example.test/switch' });
  let resolveSwitchedTranslation;
  first.page.__geekTranslationRequest = () => new Promise(resolve => { resolveSwitchedTranslation = resolve; });
  trustedEnter(first.listeners, first.editor);
  const switchedSend = first.mod.sendTextMsgToChat(chat, 'switch-away');
  chat.setTestContents({});
  await Promise.resolve();
  assert.equal(typeof resolveSwitchedTranslation, 'function', 'chat-switch test must reach the queued translation request');
  const otherChat = makeChat('999@c.us', 'other-draft');
  first.page.__activeChat = otherChat;
  resolveSwitchedTranslation({ text: 'translated:switch-away' });
  assert.equal(await switchedSend, undefined, 'chat switch during translation must be consumed as a Geek fail-closed outcome');
  assert.deepEqual(native2Calls, ['translated:hello'], 'chat switch during translation must never call the native send owner');
  assert.equal(chat.getTestContents().text, 'switch-away', 'chat switch must restore the source draft on the original chat model');
  assert.equal(otherChat.getTestContents().text, 'other-draft', 'chat switch recovery must not mutate the newly active chat draft');
  first.page.__activeChat = chat;

  // The same translation-layer error without a trusted composer gesture may be a
  // quick reply or other internal caller. Do not silently convert it to success.
  first.page.__geekTranslationRequest = async () => { throw new Error('AUTH_EXPIRED'); };
  first.page.__geekWhatsAppSendRecovery.ensureHook();
  await assert.rejects(
    first.mod.sendTextMsgToChat(chat, 'programmatic'),
    /AUTH_EXPIRED/,
    'programmatic translation failures must keep their rejection contract'
  );
  assert.deepEqual(native2Calls, ['translated:hello']);

  // If the bridge disappears after installation, block the trusted gesture before
  // the older app wrapper can skip translation and send raw text.
  first.page.__editorText = 'bridge-missing';
  chat.setTestContents({ text: 'bridge-missing', timestamp: 789 });
  first.page.__geekTranslationRequest = null;
  const missingBridgeCounters = trustedEnter(first.listeners, first.editor, {});
  assert.equal(missingBridgeCounters.prevented, 1, 'missing translation bridge must prevent the trusted native send gesture');
  assert.equal(missingBridgeCounters.stopped, 1, 'missing translation bridge must stop propagation before WhatsApp can send raw source');
  assert.match(first.notices.at(-1) || '', /翻译尚未就绪，已阻止原文发送/);

  // Translation-disabled chat stays a pure native pass-through.
  first.page.__geekGetTranslationSetting = () => ({ enabled: false, autoSend: false });
  first.page.__editorText = 'raw-allowed';
  first.page.__geekTranslationRequest = async ({ text }) => ({ text: `should-not-run:${text}` });
  trustedEnter(first.listeners, first.editor);
  assert.equal(await first.mod.sendTextMsgToChat(chat, 'raw-allowed'), 'native-2');
  assert.deepEqual(native2Calls, ['translated:hello', 'raw-allowed'], 'normal sending must stay untouched when outgoing translation is disabled');

  // A real native send rejection after successful translation is WhatsApp's error
  // domain, not a Geek translation failure. Preserve the rejection and do not
  // restore the source draft as if translation had failed.
  const nativeFailure = new Error('WA_NETWORK_FAILED');
  const native3Calls = [];
  const native3 = async function (_chat, text) { native3Calls.push(text); throw nativeFailure; };
  first.page.__geekGetTranslationSetting = () => ({ enabled: true, autoSend: true, includeZh: true, source: 'auto', target: 'it', provider: 'auto', route: 'default' });
  first.page.__geekTranslationRequest = async ({ text }) => ({ text: `again:${text}` });
  first.mod.sendTextMsgToChat = native3;
  assert.equal(first.page.__geekWhatsAppSendRecovery.ensureHook(), true);
  first.page.__editorText = 'native-failure';
  chat.setTestContents({ text: 'native-failure', timestamp: 900 });
  trustedEnter(first.listeners, first.editor);
  const nativeFailedSend = first.mod.sendTextMsgToChat(chat, 'native-failure');
  chat.setTestContents({});
  await assert.rejects(nativeFailedSend, error => error === nativeFailure, 'native WhatsApp send failures must remain native rejections');
  assert.deepEqual(native3Calls, ['again:native-failure']);
  assert.equal(chat.getTestContents().text, undefined, 'native transport failure must not be mislabeled and restored as a translation failure');

  const missing = makePage();
  missing.mod.sendTextMsgToChat = null;
  assert.equal(recovery.installPageRecovery(missing.page, recovery.RECOVERY_VERSION), 'WAITING');
  assert.equal(missing.page.__geekWhatsAppSendRecovery.ensureHook(), false, 'missing WhatsApp send module must stay not-ready instead of failing open');

  // A newly inserted guest is not safe for synchronous WebView methods until
  // Electron attaches it and emits dom-ready. The shell bootstrap must never probe
  // getURL() (or execute a non-WhatsApp guest) merely to detect readiness.
  let websiteGetUrlCalls = 0;
  let websiteExecuteCalls = 0;
  const unreadyWebsite = {
    partition: 'persist:website',
    getURL() {
      websiteGetUrlCalls += 1;
      throw new Error('WebView must be attached before getURL');
    },
    addEventListener() {},
    async executeJavaScript() {
      websiteExecuteCalls += 1;
      throw new Error('website guest must not receive WhatsApp recovery');
    },
  };
  const shellHost = {
    document: {
      readyState: 'complete',
      documentElement: {},
      querySelectorAll(selector) {
        assert.equal(selector, 'webview');
        return [unreadyWebsite];
      },
    },
    api: {
      accounts: {
        async list() {
          return { accounts: [{ id: 'website', type: 'website', partition: 'persist:website' }] };
        },
      },
    },
  };
  assert.doesNotThrow(() => recovery.installShell(shellHost), 'shell bootstrap must tolerate newly inserted unready WebViews');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(websiteGetUrlCalls, 0, 'shell recovery must not call getURL before dom-ready');
  assert.equal(websiteExecuteCalls, 0, 'non-WhatsApp partitions must never receive the page recovery script');

  assert.match(source, /event\?\.isTrusted !== true/, 'only trusted user gestures may create a composer failure-isolation intent');
  assert.match(source, /TRANSLATION_FAILURE_MARK/, 'translation failures must be explicitly tagged before crossing the send boundary');
  assert.match(source, /getComposeContents\?\.\(\)/, 'trusted composer send must snapshot the native WhatsApp draft synchronously');
  assert.match(source, /setComposeContents\(next\)/, 'translation failure must restore the native WhatsApp draft snapshot');
  assert.match(source, /__geekTranslationFailureBoundary/, 'the outer boundary must be identifiable so recovery stays idempotent');
  assert.match(source, /mod\.__geekOriginalSendText = original/, 'recovery must refresh the original for later app reinjection');
  assert.match(source, /String\(account\?\.partition \|\| ''\) === owner/, 'host recovery must use exact partition ownership');
  assert.doesNotMatch(source, /activeId|\.active\[data-id\]/, 'recovery ownership must never be inferred from active UI focus');
  assert.match(bootstrap, /ensureScript\('\.\/whatsapp-translation-hook-recovery\.js', 'data-geek-whatsapp-translation-hook-recovery'\)/,
    'lightweight shell bootstrap must load the recovery owner');

  console.log('whatsapp translation hook recovery contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});