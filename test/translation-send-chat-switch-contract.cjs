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
  editor.classList = { contains: name => name === 'input-message-input' };
  editor.matches = selector => selector.includes('.input-message-input');
  editor.closest = selector => selector.includes('.input-message-input') ? editor : null;
  editor.setAttribute = (name, value) => editor.attributes.set(name, String(value));
  editor.focus = () => {};
  editor.contains = node => node === editor;

  const document = {
    body: root,
    documentElement: { getAttribute: name => name === 'data-geek-bridge' ? '1' : null },
    activeElement: editor,
    getAttribute: () => null,
    querySelector(selector) {
      if (selector === '#MiddleColumn') return root;
      if (selector === '#Main') return null;
      if (selector.includes('.input-message-input')) return editor;
      if (selector.includes('.btn-send')) return sendButton;
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

  const location = { href: 'https://web.telegram.org/k/', hash: '#chat-a' };
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

function createLineHarness(translationPromise) {
  const listeners = new Map();
  const notices = [];
  const root = fakeElement('BODY');
  const textarea = fakeElement('TEXTAREA');
  textarea.value = 'hello';
  textarea.focus = () => {};
  textarea.select = () => {};
  let syntheticKeyDispatches = 0;
  textarea.dispatchEvent = () => { syntheticKeyDispatches += 1; return true; };
  const host = fakeElement('TEXTAREA-EX');
  host.value = ['hello'];
  host.shadowRoot = { querySelector: () => textarea };
  const sendButton = fakeElement('BUTTON');
  const editorArea = fakeElement('DIV');
  let sendClicks = 0;
  sendButton.click = () => { sendClicks += 1; };
  sendButton.closest = selector => {
    if (selector.includes('chatroomEditor-module__editor_area__')) return editorArea;
    if (selector.includes('button[')) return sendButton;
    return null;
  };

  const document = {
    body: root,
    documentElement: { getAttribute: () => null },
    activeElement: host,
    querySelector(selector) {
      if (selector.includes('textarea-ex')) return host;
      if (selector.includes('aria-label*="send" i') || selector.includes('button[type="submit"]')) return sendButton;
      return null;
    },
    querySelectorAll() { return []; },
    createElement() { return fakeElement('DIV'); },
    getElementById() { return null; },
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  root.appendChild = node => { notices.push(node); return node; };
  root.querySelectorAll = () => [];

  const location = { href: 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html#/chats/chat-a', hash: '#/chats/chat-a' };
  const context = {
    console: { log() {}, error() {} },
    AbortController,
    Element: function Element() {},
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
    MutationObserver: class { observe() {} disconnect() {} },
  };
  context.window = context;
  let translationRequests = 0;
  context.window.__geekTranslationRequest = () => { translationRequests += 1; return translationPromise; };
  context.window.$electron = { send2Host() {} };
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: 'translation-adapters.js' });
  context.window.GeekTranslationAdapters.line({
    accountId: 'acc-line', bridgeToken: 'b'.repeat(32),
    global: { send: true, sendFrom: 'auto', sendTo: 'it', displayTranslation: false }, chats: {},
  });

  const keydown = listeners.get('keydown');
  const click = listeners.get('click');
  assert.equal(typeof keydown, 'function');
  assert.equal(typeof click, 'function');
  const makeEvent = () => ({
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, isTrusted: true,
    target: textarea,
    composedPath: () => [textarea, host],
    preventDefault() {}, stopImmediatePropagation() {},
  });
  return {
    context, location, host, textarea, sendButton, notices, makeEvent, keydown, click,
    sendClicks: () => sendClicks, syntheticKeyDispatches: () => syntheticKeyDispatches,
    translationRequests: () => translationRequests,
  };
}

async function verifyTelegramRequiresSendIntentOwner() {
  const h = createTelegramHarness(Promise.resolve({ text: 'ciao' }));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 0, 'unowned Telegram result must never fall back to guest native input');
  assert.equal(h.sendClicks(), 0, 'unowned Telegram result must never fall back to a synthetic button click');
  assert.equal(h.editor.innerText, 'hello', 'Telegram guest must not mutate the composer without SendIntent ownership');
  assert.equal(h.context.window.__geekTelegramSendLock, false, 'owner rejection must release the Telegram send lock');
  assert.match(h.notices.at(-1)?.textContent || '', /未发送|发送/, 'owner rejection must remain visibly fail-closed');
}

async function verifyTelegramOwnerSuccessHasNoGuestCommit() {
  const h = createTelegramHarness(Promise.resolve({
    text: 'ciao',
    delivery: { owner: 'send-intent', state: 'sent' },
  }));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 0, 'SendIntent-owned success must not create a second guest native-input request');
  assert.equal(h.sendClicks(), 0, 'SendIntent-owned success must not create a second guest submit');
  assert.equal(h.editor.innerText, 'hello', 'guest must not rewrite the composer after owner-delivered success');
  assert.equal(h.editor.attributes.get('contenteditable'), 'true', 'guest must not take composer mutability ownership');
  assert.equal(h.context.window.__geekTelegramSendLock, false);
  assert.equal(h.notices.length, 0, 'owner-delivered success must not show a failure notice');
}

async function verifyTelegramOwnerFailureHasNoGuestCommit() {
  const h = createTelegramHarness(Promise.resolve({
    text: 'ciao',
    delivery: { owner: 'send-intent', state: 'failed' },
  }));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 0, 'failed owner result must not fall back to guest native input');
  assert.equal(h.sendClicks(), 0, 'failed owner result must not fall back to a synthetic submit');
  assert.equal(h.editor.innerText, 'hello');
  assert.equal(h.context.window.__geekTelegramSendLock, false);
  assert.match(h.notices.at(-1)?.textContent || '', /未发送|发送/, 'failed owner result must remain visibly fail-closed');
}
async function verifyLineProgrammaticClickBypassesOwner() {
  const h = createLineHarness(Promise.resolve({ text: 'hello', delivery: { owner: 'send-intent', state: 'sent' } }));
  let prevented = 0;
  let stopped = 0;
  h.click({
    isTrusted: false,
    target: h.sendButton,
    composedPath: () => [h.sendButton],
    preventDefault() { prevented += 1; },
    stopImmediatePropagation() { stopped += 1; },
  });
  await flush();
  assert.equal(h.translationRequests(), 0, 'programmatic LINE submit must not manufacture a trusted SendIntent');
  assert.equal(prevented, 0);
  assert.equal(stopped, 0);
  assert.equal(h.context.window.__geekLineSendLock, false);
}

async function verifyLineOwnerSuccessHasNoGuestCommit() {
  const h = createLineHarness(Promise.resolve({
    text: 'hello',
    delivery: { owner: 'send-intent', state: 'sent' },
  }));
  let nativeRequests = 0;
  let prevented = 0;
  let stopped = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  const event = h.makeEvent();
  event.preventDefault = () => { prevented += 1; };
  event.stopImmediatePropagation = () => { stopped += 1; };
  h.keydown(event);
  await flush();
  assert.equal(h.translationRequests(), 1, 'one trusted LINE submit must create exactly one outgoing owner request');
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(nativeRequests, 0, 'owner-delivered success must not fall back to guest native fill');
  assert.equal(h.sendClicks(), 0, 'owner-delivered success must not create a second guest submit');
  assert.equal(h.textarea.value, 'hello');
  assert.deepEqual(Array.from(h.host.value), ['hello']);
  assert.equal(h.context.window.__geekLineSendLock, false);
  assert.equal(h.notices.length, 0);
}

async function verifyLineOwnerFailureHasNoGuestCommit() {
  const h = createLineHarness(Promise.resolve({
    text: 'hello',
    delivery: { owner: 'send-intent', state: 'failed' },
  }));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 0, 'failed LINE owner result must not fall back to guest native fill');
  assert.equal(h.sendClicks(), 0, 'failed LINE owner result must not fall back to a guest submit');
  assert.equal(h.textarea.value, 'hello');
  assert.equal(h.context.window.__geekLineSendLock, false);
  assert.match(h.notices.at(-1)?.textContent || '', /未发送|发送/);
}

async function verifyLineOwnerStaleContextFailsClosed() {
  const error = Object.assign(new Error('SEND_INTENT_STALE_CONTEXT'), { code: 'SEND_INTENT_STALE_CONTEXT' });
  const h = createLineHarness(Promise.reject(error));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 0);
  assert.equal(h.sendClicks(), 0);
  assert.equal(h.context.window.__geekLineSendLock, false);
  assert.match(h.notices.at(-1)?.textContent || '', /聊天已切换|发送已取消/);
}

async function verifyNativeInputOwnerUsesRequestScopedLease() {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const mainFrame = {};
  const sender = { id: 99, mainFrame };
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
  const invoke = (channel, ...args) => handlers.get(channel)({ sender, senderFrame: mainFrame }, ...args);
  const token = 'a'.repeat(32);
  assert.equal(await invoke('webview:register', 'acc-a', 7, token), true);
  await assert.rejects(
    invoke('webview:insert-text', 'acc-a', 7, 'ciao', token, 'chat-a'),
    /聊天已切换/,
  );
  assert.deepEqual(guest.inserted, [], 'stale explicit conversation binding must reject before insertText');
  assert.match(scripts.at(-1), /const expectedChatId = "chat-a"/);

  assert.equal(await invoke('webview:insert-text', 'acc-a', 7, 'broadcast-compatible raw text', token), true);
  assert.deepEqual(guest.inserted, ['broadcast-compatible raw text'], 'an explicit SendIntent mutation binding must not cross-couple a later raw/native-input user');
  assert.match(scripts.at(-1), /const expectedChatId = ""/);
  owner.dispose();
}

(async () => {
  const telegramStart = adapterSource.indexOf('function installTelegramTranslation');
  const lineStart = adapterSource.indexOf('function installLineTranslation');
  assert.ok(telegramStart >= 0 && lineStart > telegramStart);
  const telegramSource = adapterSource.slice(telegramStart, lineStart);
  const lineSource = adapterSource.slice(lineStart);
  assert.doesNotMatch(telegramSource, /GEEK_NATIVE_INPUT_V1|nativeInsertText|__geekNativeInputPending|submitButton\.click\(\)/, 'Telegram must not retain the retired guest native-input/synthetic-submit path');
  assert.match(telegramSource, /SEND_INTENT_OWNER_REQUIRED/, 'Telegram must fail closed when SendIntent ownership is missing');
  assert.match(appSource, /webviewInput\.commitSubmit\([\s\S]{0,240}expected\.conversationId[\s\S]{0,180}expected\.composerText/, 'Telegram final commit must remain owned by the host WebView IPC boundary');
  assert.doesNotMatch(lineSource, /GEEK_NATIVE_INPUT_V1|nativeInsertText|__geekNativeInputPending|geek-native-input-request/, 'LINE guest must not retain the retired native-fill lease or bridge');
  assert.doesNotMatch(appSource, /processNativeInputRequest|NATIVE_INPUT_REQUEST_PREFIX|geek-native-input-request/, 'host renderer must not retain legacy guest native-input ingress');
  assert.doesNotMatch(lineSource, /document\.execCommand\('selectAll',[\s\S]{0,160}host\.insertValue\(\[result\.text\]\)/, 'LINE SendIntent path must not mutate the custom editor through execCommand + insertValue');
  assert.doesNotMatch(adapterSource, /__geekNativeInputExpectedChatId/, 'chat binding must never live in shared page-global state');
  assert.match(appSource, /conversationId !== guestChatId[\s\S]{0,180}normalize\(sourceSnapshot\) !== normalize\(guestText\)/, 'host SendIntent admission must reject stale LINE chat or composer snapshots');
  assert.match(appSource, /async setComposerText\(text, mutation = \{\}\)/, 'platform composer mutation must accept SendIntent context');
  assert.match(appSource, /webviewInput\.insertText\(account\.id, wv\.getWebContentsId\(\), String\(text\), bridgeTokenFor\(wv\), String\(mutation\.expectedConversationId \|\| ''\)\)/, 'composer mutation must forward the SendIntent conversation binding explicitly');
  assert.match(webviewIpcSource, /register\('webview:insert-text', async \(event, accountId, guestId, text, token, expectedChatId = ''\)/, 'main-process input owner must accept the explicit conversation binding');
  assert.match(webviewIpcSource, /focusedComposerScript\(chatId\)/, 'main-process input owner must validate the explicit conversation binding before mutation');
  assert.doesNotMatch(webviewIpcSource, /GEEK_NATIVE_INPUT_V1|decodeNativeInputRequest/, 'main-process input owner must not retain the retired lease envelope');
  assert.match(webviewIpcSource, /CHAT_CHANGED/, 'native input owner must expose a distinct stale-chat rejection');
  assert.match(appSource, /if \(family === 'line'\)[\s\S]*currentChat!==expected\.conversationId[\s\S]*COMPOSER_MISMATCH/, 'LINE final platform commit must revalidate exact chat and composer before native submit');
  assert.match(appSource, /if\(currentChat!==expectedChat\)return \{status:'STALE_CONTEXT'/, 'LINE post-commit observation must stop if the chat changes');

  await verifyTelegramRequiresSendIntentOwner();
  await verifyTelegramOwnerSuccessHasNoGuestCommit();
  await verifyTelegramOwnerFailureHasNoGuestCommit();
  await verifyLineProgrammaticClickBypassesOwner();
  await verifyLineOwnerSuccessHasNoGuestCommit();
  await verifyLineOwnerFailureHasNoGuestCommit();
  await verifyLineOwnerStaleContextFailsClosed();
  await verifyNativeInputOwnerUsesRequestScopedLease();

  console.log('TRANSLATION_SEND_CHAT_SWITCH_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});