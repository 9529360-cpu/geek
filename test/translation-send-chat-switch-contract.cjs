'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { installWebviewIpc } = require('../src/webview-ipc.cjs');

const rootDir = path.resolve(__dirname, '..');
const adapterSource = fs.readFileSync(path.join(rootDir, 'ui', 'translation-adapters.js'), 'utf8');
const webviewIpcSource = fs.readFileSync(path.join(rootDir, 'src', 'webview-ipc.cjs'), 'utf8');
const appSource = fs.readFileSync(path.join(rootDir, 'ui', 'app.js'), 'utf8');
const NATIVE_INPUT_ENVELOPE_PREFIX = '\u001eGEEK_NATIVE_INPUT_V1\u001e';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve));
}

function timer(fn, ms) {
  if (Number(ms) <= 150) Promise.resolve().then(fn);
  return 1;
}

function fakeElement(tagName = 'DIV') {
  return {
    tagName,
    dataset: {},
    style: {},
    isConnected: true,
    classList: { contains: () => false },
    remove() { this.isConnected = false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches() { return false; },
    addEventListener() {},
  };
}

function createTelegramHarness(translationPromise) {
  const listeners = new Map();
  const notices = [];
  const root = fakeElement('DIV');
  const sendButton = fakeElement('BUTTON');
  let sendClicks = 0;
  sendButton.click = () => { sendClicks += 1; };
  const editor = fakeElement('DIV');
  editor.innerText = 'hello';
  editor.textContent = 'hello';
  editor.attributes = new Map([['contenteditable', 'true']]);
  editor.closest = selector => selector.includes('#editable-message-text') ? editor : null;
  editor.setAttribute = (name, value) => editor.attributes.set(name, String(value));
  editor.focus = () => {};
  editor.contains = node => node === editor;

  const document = {
    body: root,
    documentElement: { getAttribute: () => '1' },
    activeElement: editor,
    getAttribute: () => null,
    querySelector(selector) {
      if (selector === '#MiddleColumn') return root;
      if (selector === '#Main') return null;
      if (selector.includes('#editable-message-text')) return editor;
      if (selector.includes('button.Button.send.main-button') || selector.includes('button[aria-label="Send"]')) return sendButton;
      return null;
    },
    querySelectorAll() { return []; },
    createElement() { return fakeElement('DIV'); },
    createRange() { return { selectNodeContents() {} }; },
    getElementById() { return null; },
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  root.appendChild = node => { notices.push(node); return node; };
  root.querySelectorAll = () => [];

  const location = { href: 'https://web.telegram.org/a/', hash: '#chat-a' };
  const context = {
    console: { log() {}, error() {} },
    AbortController,
    Element: function Element() {},
    KeyboardEvent: function KeyboardEvent(type, init) { return { type, ...init }; },
    MutationObserver: class { observe() {} disconnect() {} },
    Map,
    Promise,
    Object,
    Array,
    String,
    RegExp,
    Date,
    Math,
    setTimeout: timer,
    clearTimeout() {},
    document,
    location,
  };
  context.window = context;
  context.window.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  context.window.postMessage = message => {
    const payload = message?.payload;
    if (payload?.type !== 'native-input-request') return;
    context.onNativeInputRequest?.(payload);
  };
  context.window.__geekTranslationRequest = () => translationPromise;
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: 'translation-adapters.js' });
  context.window.GeekTranslationAdapters.telegram({
    accountId: 'acc-tg', bridgeToken: 'a'.repeat(32),
    global: { send: true, sendFrom: 'auto', sendTo: 'it', displayTranslation: false }, chats: {},
  });

  const keydown = listeners.get('keydown');
  assert.equal(typeof keydown, 'function');
  const makeEvent = () => ({
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, isTrusted: true,
    target: editor,
    preventDefault() {}, stopImmediatePropagation() {},
  });
  return { context, location, editor, sendButton, notices, makeEvent, keydown, sendClicks: () => sendClicks };
}

function createLineHarness(translationPromise, onInsert) {
  const listeners = new Map();
  const notices = [];
  const root = fakeElement('BODY');
  const textarea = fakeElement('TEXTAREA');
  textarea.focus = () => {};
  let enterDispatches = 0;
  textarea.dispatchEvent = () => { enterDispatches += 1; return true; };
  const host = fakeElement('TEXTAREA-EX');
  host.value = ['hello'];
  host.shadowRoot = { querySelector: () => textarea };
  let insertCalls = 0;
  host.insertValue = values => {
    insertCalls += 1;
    host.value = Array.isArray(values) ? [...values] : values;
    onInsert?.();
  };

  const document = {
    body: root,
    documentElement: { getAttribute: () => '1' },
    activeElement: host,
    getAttribute: () => null,
    querySelector(selector) {
      if (selector.includes('textarea-ex')) return host;
      return null;
    },
    querySelectorAll() { return []; },
    createElement() { return fakeElement('DIV'); },
    getElementById() { return null; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    execCommand() { return true; },
  };
  root.appendChild = node => { notices.push(node); return node; };
  root.querySelectorAll = () => [];

  const location = { href: 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html#/chats/chat-a', hash: '#/chats/chat-a' };
  const context = {
    console: { log() {}, error() {} },
    AbortController,
    Element: function Element() {},
    KeyboardEvent: function KeyboardEvent(type, init) { return { type, ...init }; },
    MutationObserver: class { observe() {} disconnect() {} },
    Map,
    Promise,
    Object,
    Array,
    String,
    RegExp,
    Date,
    Math,
    setTimeout: timer,
    clearTimeout() {},
    document,
    location,
  };
  context.window = context;
  context.window.__geekTranslationRequest = () => translationPromise;
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: 'translation-adapters.js' });
  context.window.GeekTranslationAdapters.line({
    accountId: 'acc-line', bridgeToken: 'b'.repeat(32),
    global: { send: true, sendFrom: 'auto', sendTo: 'it', displayTranslation: false }, chats: {},
  });

  const keydown = listeners.get('keydown');
  assert.equal(typeof keydown, 'function');
  const makeEvent = () => ({
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, isTrusted: true,
    target: textarea,
    composedPath: () => [textarea, host],
    preventDefault() {}, stopImmediatePropagation() {},
  });
  return {
    context, location, host, textarea, notices, makeEvent, keydown,
    insertCalls: () => insertCalls, enterDispatches: () => enterDispatches,
  };
}

async function verifyTelegramSwitchBeforeTranslationCommit() {
  const translation = deferred();
  const h = createTelegramHarness(translation.promise);
  let nativeRequests = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  h.keydown(h.makeEvent());
  assert.equal(h.context.window.__geekTelegramSendLock, true);
  h.location.hash = '#chat-b';
  translation.resolve({ text: 'ciao' });
  await flush();
  assert.equal(nativeRequests, 0, 'chat switch before translation resolution must prevent native composer mutation');
  assert.equal(h.sendClicks(), 0, 'chat switch before translation resolution must prevent send');
  assert.equal(h.context.window.__geekTelegramSendLock, false, 'cancellation must release Telegram send lock');
  assert.match(h.notices.at(-1)?.textContent || '', /聊天已切换/);
}

async function verifyTelegramSwitchDuringNativeFill() {
  const h = createTelegramHarness(Promise.resolve({ text: 'ciao' }));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = payload => {
    nativeRequests += 1;
    const raw = h.context.window.__geekTakeNativeInputRequest(payload.id);
    const request = JSON.parse(raw);
    assert.equal(request.text.startsWith(NATIVE_INPUT_ENVELOPE_PREFIX), true, 'Telegram native fill must use a request-scoped lease envelope');
    const envelope = JSON.parse(request.text.slice(NATIVE_INPUT_ENVELOPE_PREFIX.length));
    assert.equal(envelope.expectedChatId, 'chat-a');
    assert.equal(envelope.text, 'ciao');
    assert.equal(envelope.token, 'a'.repeat(32));
    h.editor.innerText = 'ciao';
    h.editor.textContent = 'ciao';
    h.location.hash = '#chat-b';
    h.context.window.__geekResolveNativeInput(payload.id, true, null);
  };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 1, 'control must reach the native fill race window');
  assert.equal(h.sendClicks(), 0, 'chat switch during native fill must prevent final synthetic send');
  assert.equal(h.context.window.__geekTelegramSendLock, false);
  assert.match(h.notices.at(-1)?.textContent || '', /聊天已切换/);
}

async function verifyLineSwitchBeforeTranslationCommit() {
  const translation = deferred();
  const h = createLineHarness(translation.promise);
  h.keydown(h.makeEvent());
  assert.equal(h.context.window.__geekLineSendLock, true);
  h.location.hash = '#/chats/chat-b';
  translation.resolve({ text: 'ciao' });
  await flush();
  assert.equal(h.insertCalls(), 0, 'LINE chat switch before translation resolution must prevent composer mutation');
  assert.equal(h.enterDispatches(), 0, 'LINE chat switch before translation resolution must prevent send');
  assert.equal(h.context.window.__geekLineSendLock, false);
  assert.match(h.notices.at(-1)?.textContent || '', /聊天已切换/);
}

async function verifyLineSwitchAfterFillBeforeSubmit() {
  let h;
  h = createLineHarness(Promise.resolve({ text: 'ciao' }), () => { h.location.hash = '#/chats/chat-b'; });
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(h.insertCalls(), 1, 'control must reach the LINE post-fill race window');
  assert.equal(h.enterDispatches(), 0, 'LINE chat switch after fill must still prevent final submit');
  assert.equal(h.context.window.__geekLineSendLock, false);
  assert.match(h.notices.at(-1)?.textContent || '', /聊天已切换/);
}

async function verifyNativeInputOwnerUsesRequestScopedLease() {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const sender = { id: 99 };
  const session = {};
  const scripts = [];
  const guest = Object.assign(new EventEmitter(), {
    id: 7,
    hostWebContents: sender,
    session,
    isDestroyed: () => false,
    getURL: () => 'https://web.telegram.org/a/',
    executeJavaScript: async script => {
      scripts.push(script);
      return script.includes('const expectedChatId = "chat-a"') ? 'CHAT_CHANGED' : true;
    },
    inserted: [],
    async insertText(value) { this.inserted.push(value); },
  });
  let registered = false;
  const owner = installWebviewIpc({
    ipcMain,
    assertTrustedSender: event => assert.equal(event.sender, sender),
    accountState: {
      resolvePartition: () => 'persist:tg-a',
      findById: () => ({ id: 'acc-a', type: 'telegram', partition: 'persist:tg-a' }),
    },
    webviewOwnership: {
      register() { registered = true; },
      authorize() { return registered; },
      remove() {},
    },
    getWebContentsById: id => id === 7 ? guest : null,
    getSessionForPartition: () => session,
  });
  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  const token = 'a'.repeat(32);
  assert.equal(await invoke('webview:register', 'acc-a', 7, token), true);
  const leasedText = NATIVE_INPUT_ENVELOPE_PREFIX + JSON.stringify({ token, expectedChatId: 'chat-a', text: 'ciao' });
  await assert.rejects(
    invoke('webview:insert-text', 'acc-a', 7, leasedText, token),
    /聊天已切换/,
  );
  assert.deepEqual(guest.inserted, [], 'stale request-scoped chat lease must reject before insertText');
  assert.match(scripts.at(-1), /const expectedChatId = "chat-a"/);

  assert.equal(await invoke('webview:insert-text', 'acc-a', 7, 'broadcast-compatible raw text', token), true);
  assert.deepEqual(guest.inserted, ['broadcast-compatible raw text'], 'a previous translated-send lease must not cross-couple a later raw/native-input user');
  assert.match(scripts.at(-1), /const expectedChatId = ""/);
  owner.dispose();
}

(async () => {
  assert.match(adapterSource, /GEEK_NATIVE_INPUT_V1/, 'Telegram native input request must carry a versioned request-scoped chat lease');
  assert.match(adapterSource, /expectedChatId/, 'Telegram native input request must capture expected chat identity');
  assert.doesNotMatch(adapterSource, /__geekNativeInputExpectedChatId/, 'chat lease must never live in shared page-global state');
  assert.match(adapterSource, /assertSendContext[\s\S]*chatId\(\) !== cid/, 'platform send adapters must guard active chat identity');
  assert.match(webviewIpcSource, /decodeNativeInputRequest/, 'native input owner must decode the request-scoped lease');
  assert.match(webviewIpcSource, /focusedComposerScript\(expectedChatId\)/, 'native input owner must bind final focus/chat validation to this request lease');
  assert.doesNotMatch(webviewIpcSource, /__geekNativeInputExpectedChatId/, 'main-process input validation must not depend on page-global lease state');
  assert.match(webviewIpcSource, /CHAT_CHANGED/, 'native input owner must expose a distinct stale-chat rejection');
  assert.match(appSource, /webviewInput\.insertText\(account\.id, wv\.getWebContentsId\(\), String\(text\.text \|\| ''\), suppliedToken\)/, 'host bridge must continue to pass the native-input wire value through unchanged');

  await verifyTelegramSwitchBeforeTranslationCommit();
  await verifyTelegramSwitchDuringNativeFill();
  await verifyLineSwitchBeforeTranslationCommit();
  await verifyLineSwitchAfterFillBeforeSubmit();
  await verifyNativeInputOwnerUsesRequestScopedLease();

  console.log('TRANSLATION_SEND_CHAT_SWITCH_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});