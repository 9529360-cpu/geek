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
  editor.classList = { contains: name => name === 'input-message-input' };
  editor.matches = selector => selector.includes('.input-message-input');
  editor.closest = selector => selector.includes('.input-message-input') ? editor : null;
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
      if (selector.includes('button[aria-label="Send"]') || selector.includes('button[type="submit"]')) return sendButton;
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
  context.window.$electron = {
    send2Host(message) {
      if (message?.type === 'geek-native-input-request') context.onNativeInputRequest?.(message);
    },
  };
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

async function verifyTelegramSwitchBeforeTranslationCommit() {
  const translation = deferred();
  const h = createTelegramHarness(translation.promise);
  let nativeRequests = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  h.keydown(h.makeEvent());
  assert.equal(h.context.window.__geekTelegramSendLock, true);
  assert.equal(h.editor.attributes.get('contenteditable'), 'true', 'Web K controlled composer must remain contenteditable while translation is pending');
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

async function verifyTelegramWebKNativeFillAndButtonSubmit() {
  const h = createTelegramHarness(Promise.resolve({ text: 'ciao' }));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = payload => {
    nativeRequests += 1;
    const raw = h.context.window.__geekTakeNativeInputRequest(payload.id);
    const request = JSON.parse(raw);
    assert.equal(request.text.startsWith(NATIVE_INPUT_ENVELOPE_PREFIX), true);
    const envelope = JSON.parse(request.text.slice(NATIVE_INPUT_ENVELOPE_PREFIX.length));
    assert.equal(envelope.expectedChatId, 'chat-a');
    assert.equal(envelope.text, 'ciao');
    h.editor.innerText = 'ciao';
    h.editor.textContent = 'ciao';
    h.context.window.__geekResolveNativeInput(payload.id, true, null);
  };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 1, 'Telegram Web K translated send must use one request-scoped native fill');
  assert.equal(h.sendClicks(), 1, 'Telegram Web K translated send must commit through the live send button');
  assert.equal(h.editor.attributes.get('contenteditable'), 'true', 'Web K composer must remain editable after commit');
  assert.equal(h.context.window.__geekTelegramNativeInputCommit, false, 'native-input commit bypass must always be released');
  assert.equal(h.context.window.__geekTelegramSendLock, false);
}
async function verifyLineProgrammaticClickBypassesTranslation() {
  const h = createLineHarness(Promise.resolve({ text: 'ciao' }));
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
  assert.equal(h.translationRequests(), 0, 'programmatic LINE submit must bypass outgoing translation interception');
  assert.equal(prevented, 0, 'programmatic LINE submit must not be prevented by the translation owner');
  assert.equal(stopped, 0, 'programmatic LINE submit must not stop propagation in the translation owner');
  assert.equal(h.context.window.__geekLineSendLock, false, 'programmatic LINE submit must not acquire the translation send lock');
}

async function verifyLineSwitchBeforeTranslationCommit() {
  const translation = deferred();
  const h = createLineHarness(translation.promise);
  let nativeRequests = 0;
  h.context.onNativeInputRequest = () => { nativeRequests += 1; };
  h.keydown(h.makeEvent());
  assert.equal(h.context.window.__geekLineSendLock, true);
  h.location.hash = '#/chats/chat-b';
  translation.resolve({ text: 'ciao' });
  await flush();
  assert.equal(nativeRequests, 0, 'LINE chat switch before translation resolution must prevent native composer mutation');
  assert.equal(h.sendClicks(), 0, 'LINE chat switch before translation resolution must prevent send');
  assert.equal(h.context.window.__geekLineSendLock, false);
  assert.match(h.notices.at(-1)?.textContent || '', /聊天已切换/);
}

async function verifyLineSwitchAfterNativeFillBeforeSubmit() {
  const h = createLineHarness(Promise.resolve({ text: 'ciao' }));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = message => {
    nativeRequests += 1;
    const raw = h.context.window.__geekTakeNativeInputRequest(message.id);
    const request = JSON.parse(raw);
    assert.equal(request.text.startsWith(NATIVE_INPUT_ENVELOPE_PREFIX), true, 'LINE native fill must use a request-scoped lease envelope');
    const envelope = JSON.parse(request.text.slice(NATIVE_INPUT_ENVELOPE_PREFIX.length));
    assert.equal(envelope.expectedChatId, 'chat-a');
    assert.equal(envelope.text, 'ciao');
    assert.equal(envelope.token, 'b'.repeat(32));
    h.textarea.value = 'ciao';
    h.host.value = ['ciao'];
    h.location.hash = '#/chats/chat-b';
    h.context.window.__geekResolveNativeInput(message.id, true, null);
  };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 1, 'control must reach the LINE native-fill race window');
  assert.equal(h.sendClicks(), 0, 'LINE chat switch after native fill must still prevent final submit');
  assert.equal(h.syntheticKeyDispatches(), 0, 'LINE translated send must not synthesize a keyboard event');
  assert.equal(h.context.window.__geekLineSendLock, false);
  assert.match(h.notices.at(-1)?.textContent || '', /聊天已切换/);
}

async function verifyLineNativeFillAndButtonSubmit() {
  const h = createLineHarness(Promise.resolve({ text: 'ciao' }));
  let nativeRequests = 0;
  h.context.onNativeInputRequest = message => {
    nativeRequests += 1;
    const request = JSON.parse(h.context.window.__geekTakeNativeInputRequest(message.id));
    const envelope = JSON.parse(request.text.slice(NATIVE_INPUT_ENVELOPE_PREFIX.length));
    assert.equal(envelope.expectedChatId, 'chat-a');
    assert.equal(envelope.text, 'ciao');
    h.textarea.value = 'ciao';
    h.host.value = ['ciao'];
    h.context.window.__geekResolveNativeInput(message.id, true, null);
  };
  h.keydown(h.makeEvent());
  await flush();
  assert.equal(nativeRequests, 1, 'LINE translated send must use one native input request');
  assert.equal(h.sendClicks(), 1, 'LINE Enter send must commit through the live send button after verified native fill');
  assert.equal(h.syntheticKeyDispatches(), 0, 'LINE translated send must never depend on an untrusted synthetic Enter');
  assert.equal(h.context.window.__geekLineSendLock, false);
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
  assert.match(adapterSource, /GEEK_NATIVE_INPUT_V1/, 'platform native input requests must carry a versioned request-scoped chat lease');
  assert.match(adapterSource, /geek-native-input-request/, 'LINE must route translated composer fill through the host native-input owner');
  assert.doesNotMatch(adapterSource, /document\.execCommand\('selectAll',[\s\S]{0,160}host\.insertValue\(\[result\.text\]\)/, 'LINE translated send must not mutate the custom editor through execCommand + insertValue');
  assert.match(appSource, /message\.type === 'geek-native-input-request'[\s\S]{0,180}processNativeInputRequest/, 'LINE send2Host ingress must delegate native fill to the existing host owner');
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
  await verifyTelegramWebKNativeFillAndButtonSubmit();
  await verifyLineProgrammaticClickBypassesTranslation();
  await verifyLineSwitchBeforeTranslationCommit();
  await verifyLineSwitchAfterNativeFillBeforeSubmit();
  await verifyLineNativeFillAndButtonSubmit();
  await verifyNativeInputOwnerUsesRequestScopedLease();

  console.log('TRANSLATION_SEND_CHAT_SWITCH_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});