'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const recoveryPath = path.join(__dirname, '../ui/whatsapp-translation-hook-recovery.js');
const bootstrapPath = path.join(__dirname, '../ui/version-label.js');
const source = fs.readFileSync(recoveryPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const recovery = require(recoveryPath);

function makePage() {
  const listeners = new Map();
  let intervalCount = 0;
  let clearCount = 0;
  const notices = [];
  const mod = {};
  const page = {
    require(name) {
      assert.equal(name, 'WAWebSendTextMsgChatAction');
      return mod;
    },
    AbortController,
    console: { error() {} },
    document: {
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
  return { page, mod, listeners, notices, getIntervalCount: () => intervalCount, getClearCount: () => clearCount };
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
  const native1Calls = [];
  const native1 = async function (_chat, text) { native1Calls.push(text); return 'native-1'; };
  const appWrapper = async function () { return 'existing-wrapper'; };
  first.mod.sendTextMsgToChat = appWrapper;
  first.mod.__geekOriginalSendText = native1;
  first.page.__geekWhatsAppWrappedSend = appWrapper;

  assert.equal(recovery.installPageRecovery(first.page, 1), 'READY');
  assert.equal(first.mod.sendTextMsgToChat, appWrapper, 'a healthy existing app wrapper must not be wrapped again');
  assert.equal(first.getIntervalCount(), 1, 'one lifecycle probe interval should be installed');
  const listenerCount = first.listeners.size;
  assert.equal(recovery.installPageRecovery(first.page, 1), 'READY');
  assert.equal(first.getIntervalCount(), 1, 'reinstall must not duplicate the lifecycle interval');
  assert.equal(first.listeners.size, listenerCount, 'reinstall must not duplicate capture listeners');

  const native2Calls = [];
  const native2 = async function (_chat, text) { native2Calls.push(text); return 'native-2'; };
  first.mod.sendTextMsgToChat = native2;

  const composer = { closest(selector) { return selector.includes('contenteditable') ? this : null; } };
  first.listeners.get('keydown')({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, target: composer });
  const healed = first.mod.sendTextMsgToChat;
  assert.notEqual(healed, native2, 'window-capture recovery must rebind a drifted live send function before document guard');
  assert.equal(first.mod.__geekOriginalSendText, native2, 'the current WhatsApp generation must become the authoritative original');
  assert.equal(first.page.__geekWhatsAppWrappedSend, healed);
  assert.equal(healed.__geekTranslationRecoveryOriginal, native2);

  const remembered = [];
  first.page.__geekRememberOutgoing = (translated, original) => remembered.push([translated, original]);
  const chat = { id: { _serialized: '123@c.us' } };
  assert.equal(await healed.call({ receiver: true }, chat, 'hello'), 'native-2');
  assert.deepEqual(native2Calls, ['translated:hello'], 'recovered send must call the new live original with translated text');
  assert.deepEqual(remembered, [['translated:hello', 'hello']], 'outgoing original mapping must survive recovery');

  first.page.__geekTranslationRequest = null;
  await assert.rejects(
    healed(chat, 'must-not-leak'),
    /翻译尚未就绪/,
    'requested outgoing translation must remain fail closed when the bridge is unavailable'
  );
  assert.deepEqual(native2Calls, ['translated:hello'], 'fail-closed recovery must never call native send with raw source');
  assert.match(first.notices.at(-1) || '', /翻译失败，原文未发送/);

  first.page.__geekGetTranslationSetting = () => ({ enabled: false, autoSend: false });
  assert.equal(await healed(chat, 'raw-allowed'), 'native-2');
  assert.deepEqual(native2Calls, ['translated:hello', 'raw-allowed'], 'normal sending must stay untouched when outgoing translation is disabled');

  // A second WhatsApp internal generation must be recoverable without nesting the
  // previous recovery wrapper or restoring native1.
  const native3Calls = [];
  const native3 = async function (_chat, text) { native3Calls.push(text); return 'native-3'; };
  first.page.__geekGetTranslationSetting = () => ({ enabled: true, autoSend: true, includeZh: true, source: 'auto', target: 'it', provider: 'auto', route: 'default' });
  first.page.__geekTranslationRequest = async ({ text }) => ({ text: `again:${text}` });
  first.mod.sendTextMsgToChat = native3;
  assert.equal(first.page.__geekWhatsAppSendRecovery.ensureHook(), true);
  assert.equal(first.mod.__geekOriginalSendText, native3);
  assert.equal(await first.mod.sendTextMsgToChat(chat, 'next'), 'native-3');
  assert.deepEqual(native3Calls, ['again:next']);

  const missing = makePage();
  missing.mod.sendTextMsgToChat = null;
  assert.equal(recovery.installPageRecovery(missing.page, 1), 'WAITING');
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

  assert.match(source, /page\.addEventListener\?\.\('keydown'/, 'recovery must run at window capture before the existing document guard');
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
