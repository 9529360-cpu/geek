'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'ui', 'app.js');
const adaptersPath = path.join(root, 'ui', 'translation-adapters.js');
const contractPath = path.join(root, 'test', 'translation-send-chat-switch-contract.cjs');
const workflowPath = path.join(root, '.github', 'workflows', 'tmp-apply-line-native-commit.yml');
const selfPath = __filename;

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}

let app = fs.readFileSync(appPath, 'utf8');
const lineIpcBefore = `  async function handleLineTranslationIpc(wv, event) {
    if (event?.channel !== 'send2Host') return;
    const message = event.args?.[0];
    if (!message || message.type !== 'geek-translation-request') return;
    const requestId = String(message.id || '');
    const suppliedToken = String(message.token || '');
    const authorization = authorizeWebviewBridge(wv, requestId, suppliedToken);`;
const lineIpcAfter = `  async function handleLineTranslationIpc(wv, event) {
    if (event?.channel !== 'send2Host') return;
    const message = event.args?.[0];
    if (!message || typeof message !== 'object') return;
    const requestId = String(message.id || '');
    const suppliedToken = String(message.token || '');
    if (message.type === 'geek-native-input-request') {
      await processNativeInputRequest(wv, requestId, suppliedToken);
      return;
    }
    if (message.type !== 'geek-translation-request') return;
    const authorization = authorizeWebviewBridge(wv, requestId, suppliedToken);`;
app = replaceOnce(app, lineIpcBefore, lineIpcAfter, 'LINE host IPC routing');
fs.writeFileSync(appPath, app);

let adapters = fs.readFileSync(adaptersPath, 'utf8');
const lineTranslationTail = `      window.__geekTakeTranslationRequest = id => { const p = window.__geekTranslationPending.get(id); return p ? JSON.stringify(p.payload) : null; };
      window.__geekResolveTranslation = (id, result, error) => { const p = window.__geekTranslationPending.get(id); if (!p) return false; window.__geekTranslationPending.delete(id); if (error) p.reject(new Error(error)); else p.resolve(result); return true; };
    }
    const generation = window.__geekLineTranslationGeneration = (window.__geekLineTranslationGeneration || 0) + 1;`;
const lineTranslationWithNativeInput = `      window.__geekTakeTranslationRequest = id => { const p = window.__geekTranslationPending.get(id); return p ? JSON.stringify(p.payload) : null; };
      window.__geekResolveTranslation = (id, result, error) => { const p = window.__geekTranslationPending.get(id); if (!p) return false; window.__geekTranslationPending.delete(id); if (error) p.reject(new Error(error)); else p.resolve(result); return true; };
    }
    const nativeInputEnvelopePrefix = '\\u001eGEEK_NATIVE_INPUT_V1\\u001e';
    const encodeNativeInputRequest = (text, expectedChatId) => nativeInputEnvelopePrefix + JSON.stringify({
      token: String(window.__geekTranslationBridgeToken || ''),
      expectedChatId: String(expectedChatId || ''),
      text: String(text ?? ''),
    });
    window.__geekNativeInputPending = window.__geekNativeInputPending || new Map();
    window.__geekTakeNativeInputRequest = id => {
      const p = window.__geekNativeInputPending.get(id);
      return p ? JSON.stringify({ accountId: config.accountId, bridgeToken: window.__geekTranslationBridgeToken, text: p.wireText || '' }) : null;
    };
    window.__geekResolveNativeInput = (id, ok, error) => {
      const p = window.__geekNativeInputPending.get(id);
      if (!p) return false;
      window.__geekNativeInputPending.delete(id);
      if (ok) p.resolve(true); else p.reject(new Error(error || '原生输入失败'));
      return true;
    };
    const nativeInsertText = (text, expectedChatId = '') => {
      const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
      const expected = String(expectedChatId || '');
      const wireText = encodeNativeInputRequest(text, expected);
      return new Promise((resolve, reject) => {
        window.__geekNativeInputPending.set(id, { resolve, reject, wireText, expectedChatId: expected });
        if (window.$electron?.send2Host) window.$electron.send2Host({ type: 'geek-native-input-request', id, token: window.__geekTranslationBridgeToken });
        else console.log('__GEEK_NATIVE_INPUT_REQUEST__:' + id + ':' + window.__geekTranslationBridgeToken);
        setTimeout(() => {
          const p = window.__geekNativeInputPending.get(id);
          if (p) {
            window.__geekNativeInputPending.delete(id);
            p.reject(new Error('原生输入请求超时'));
          }
        }, 10000);
      });
    };
    const generation = window.__geekLineTranslationGeneration = (window.__geekLineTranslationGeneration || 0) + 1;`;
adapters = replaceOnce(adapters, lineTranslationTail, lineTranslationWithNativeInput, 'LINE native input request owner');

const composerHelpersBefore = `    const liveComposerHost = () => document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
    const composerHost = event => {`;
const composerHelpersAfter = `    const liveComposerHost = () => document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
    const sendButton = () => document.querySelector('button[aria-label="Send"],button[aria-label="发送"],button[type="submit"],[class*="chatroomEditor-module__editor_area__"] button[data-action="send"]');
    const composerHost = event => {`;
adapters = replaceOnce(adapters, composerHelpersBefore, composerHelpersAfter, 'LINE send button capability');

const lineCommitBefore = `        assertSendContext();
        const textarea = host.shadowRoot?.querySelector('textarea'); if (!textarea || typeof host.insertValue !== 'function') throw new Error('LINE输入组件不可用');
        textarea.focus(); document.execCommand('selectAll', false, null); host.insertValue([result.text]);
        await new Promise(resolve => setTimeout(resolve, 100));
        assertSendContext();
        const after = (Array.isArray(host.value) ? host.value : [host.value]).filter(value => typeof value === 'string').join('').trim();
        if (after !== result.text.trim()) throw new Error('LINE编辑器回填校验失败');
        if (!setting.includeZh && window.GeekTranslationCore?.isChinese(after)) throw new Error('译文仍包含中文，已阻止发送');
        assertSendContext();
        if (button && button.isConnected !== false) button.click();
        else textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));`;
const lineCommitAfter = `        assertSendContext();
        const textarea = host.shadowRoot?.querySelector('textarea'); if (!textarea) throw new Error('LINE输入组件不可用');
        textarea.focus(); textarea.select();
        await nativeInsertText(result.text, cid);
        await new Promise(resolve => setTimeout(resolve, 100));
        assertSendContext();
        const after = String(textarea.value || '').trim();
        if (after !== result.text.trim()) throw new Error('LINE编辑器回填校验失败');
        if (!setting.includeZh && window.GeekTranslationCore?.isChinese(after)) throw new Error('译文仍包含中文，已阻止发送');
        assertSendContext();
        const submitButton = (button && button.isConnected !== false) ? button : sendButton();
        if (!submitButton) throw new Error('LINE发送按钮不可用');
        submitButton.click();`;
adapters = replaceOnce(adapters, lineCommitBefore, lineCommitAfter, 'LINE translated composer commit');
fs.writeFileSync(adaptersPath, adapters);

let contract = fs.readFileSync(contractPath, 'utf8');
const harnessStart = contract.indexOf('function createLineHarness(');
const harnessEnd = contract.indexOf('\n\nasync function verifyTelegramSwitchBeforeTranslationCommit()', harnessStart);
if (harnessStart < 0 || harnessEnd < 0) throw new Error('LINE harness boundaries not found');
const newHarness = `function createLineHarness(translationPromise) {
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
  let sendClicks = 0;
  sendButton.click = () => { sendClicks += 1; };

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
  context.window.__geekTranslationRequest = () => translationPromise;
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
  assert.equal(typeof keydown, 'function');
  const makeEvent = () => ({
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, isTrusted: true,
    target: textarea,
    composedPath: () => [textarea, host],
    preventDefault() {}, stopImmediatePropagation() {},
  });
  return {
    context, location, host, textarea, sendButton, notices, makeEvent, keydown,
    sendClicks: () => sendClicks, syntheticKeyDispatches: () => syntheticKeyDispatches,
  };
}`;
contract = contract.slice(0, harnessStart) + newHarness + contract.slice(harnessEnd);

const lineTestsStart = contract.indexOf('async function verifyLineSwitchBeforeTranslationCommit()');
const lineTestsEnd = contract.indexOf('\n\nasync function verifyNativeInputOwnerUsesRequestScopedLease()', lineTestsStart);
if (lineTestsStart < 0 || lineTestsEnd < 0) throw new Error('LINE test boundaries not found');
const newLineTests = `async function verifyLineSwitchBeforeTranslationCommit() {
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
}`;
contract = contract.slice(0, lineTestsStart) + newLineTests + contract.slice(lineTestsEnd);

contract = replaceOnce(
  contract,
  `  assert.match(adapterSource, /GEEK_NATIVE_INPUT_V1/, 'Telegram native input request must carry a versioned request-scoped chat lease');`,
  `  assert.match(adapterSource, /GEEK_NATIVE_INPUT_V1/, 'platform native input requests must carry a versioned request-scoped chat lease');\n  assert.match(adapterSource, /geek-native-input-request/, 'LINE must route translated composer fill through the host native-input owner');\n  assert.doesNotMatch(adapterSource, /document\\.execCommand\\('selectAll',[\\s\\S]{0,160}host\\.insertValue\\(\\[result\\.text\\]\\)/, 'LINE translated send must not mutate the custom editor through execCommand + insertValue');\n  assert.match(appSource, /message\\.type === 'geek-native-input-request'[\\s\\S]{0,180}processNativeInputRequest/, 'LINE send2Host ingress must delegate native fill to the existing host owner');`,
  'LINE native commit source assertions',
);
contract = replaceOnce(
  contract,
  `  await verifyLineSwitchBeforeTranslationCommit();\n  await verifyLineSwitchAfterFillBeforeSubmit();`,
  `  await verifyLineSwitchBeforeTranslationCommit();\n  await verifyLineSwitchAfterNativeFillBeforeSubmit();\n  await verifyLineNativeFillAndButtonSubmit();`,
  'LINE runtime contract invocation',
);
fs.writeFileSync(contractPath, contract);

for (const temporaryPath of [workflowPath, selfPath]) {
  try { fs.unlinkSync(temporaryPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log('APPLY_LINE_NATIVE_COMMIT_OK');
