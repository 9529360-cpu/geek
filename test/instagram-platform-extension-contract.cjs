'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sources = [
  'ui/platform-transport-definitions.js',
  'ui/platform-host-adapters.js',
  'ui/instagram-platform-extension.js',
].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]);

const context = { window: {}, console };
context.globalThis = context.window;
vm.createContext(context);
for (const [file, source] of sources) vm.runInContext(source, context, { filename: file });

(async () => {
  assert.equal(typeof context.window.GeekInstagramPlatformExtension, 'object');
  assert.equal(context.window.GeekInstagramPlatformExtension.family, 'instagram');
  assert.equal(context.window.GeekInstagramPlatformExtension.confirmationSurfaceSelector, '[role="main"]');

  const definitions = context.window.GeekPlatformTransportDefinitions.create();
  assert.equal(definitions.hasFamily('instagram'), true);
  const definition = definitions.definitionFor({ family: 'instagram' });
  assert.equal(typeof definition?.getChats, 'string');
  assert.equal(typeof definition?.switchChat, 'function');
  assert.match(definition.getChats, /threadKeyForSelection/);
  assert.match(definition.switchChat('/direct/t/42'), /threadKeyForSelection/);
  assert.match(definition.switchChat('/direct/t/42'), /button\.click\(\)/);

  {
    let clicked = false;
    const fiber = { memoizedProps: { threadKeyForSelection: '42' }, pendingProps: null, return: null };
    const button = {
      innerText: 'Live Test Contact\nLast message',
      textContent: 'Live Test Contact\nLast message',
      '__reactFiber$contract': fiber,
      click() { clicked = true; },
    };
    const document = { querySelectorAll(selector) { return selector === '[role="button"]' ? [button] : []; } };
    const chatsRaw = vm.runInNewContext(definition.getChats, { document, JSON, Object, String, Set });
    assert.deepEqual(JSON.parse(chatsRaw), [{ id: '/direct/t/42', name: 'Live Test Contact', type: '联系人' }]);
    assert.equal(vm.runInNewContext(definition.switchChat('/direct/t/42'), {
      document, JSON, Object, String, RegExp,
    }), true);
    assert.equal(clicked, true);
  }

  let currentText = '';
  let currentChat = '/direct/t/42';
  let pollCount = 0;
  const scripts = [];
  const webview = {
    getWebContentsId() { return 88; },
    async executeJavaScript(script) {
      scripts.push(String(script));
      const source = String(script);
      new vm.Script(source);
      if (source.includes('button.click')) return true;
      if (source.includes("String(location.pathname||'').match")) {
        if (source.includes("return {status:'READY',occurrences,textLength:transcript.length}")) {
          return { status: 'READY', occurrences: 0, textLength: 20 };
        }
        if (source.includes("return {status:'OK',occurrences,textLength:transcript.length,empty}")) {
          pollCount += 1;
          return { status: 'OK', occurrences: 1, textLength: 25, empty: true };
        }
        return currentChat;
      }
      if (source.startsWith('String(document.querySelector')) return currentText;
      if (source.includes('document.activeElement===editor')) return true;
      if (source.includes("document.execCommand('delete'")) { currentText = ''; return true; }
      return true;
    },
  };

  const insertCalls = [];
  const clearCalls = [];
  const commitCalls = [];
  const api = {
    webviewInput: {
      async insertText(accountId, guestId, text, token, chatId) {
        insertCalls.push({ accountId, guestId, text, token, chatId });
        currentText = String(text);
        return true;
      },
      async clearText(accountId, guestId, token, chatId) {
        clearCalls.push({ accountId, guestId, token, chatId });
        currentText = '';
        return 'CLEARED';
      },
      async commitSubmit(accountId, guestId, chatId, composerText, token) {
        commitCalls.push({ accountId, guestId, chatId, composerText, token });
        currentText = '';
        return 'SUBMITTED';
      },
    },
  };
  const hostRegistry = context.window.GeekPlatformHostAdapters.create({
    api,
    bridgeTokenFor: () => '0123456789abcdef0123456789abcdef',
    sleep: async () => {},
    sameChat: (a, b) => String(a) === String(b),
    telegramBroadcastRoute: () => null,
    whatsapp: { getComposerText() {}, clearComposerText() {}, setComposerText() {}, sendText() {} },
  });
  assert.equal(hostRegistry.hasFamily('instagram'), true);

  const adapter = hostRegistry.build({
    account: { id: 'instagram-a', type: 'instagram' },
    webview,
    family: 'instagram',
    definition,
  });
  assert.equal(await adapter.getCurrentChat(), '/direct/t/42');
  assert.equal(await adapter.openChat('/direct/t/42'), true);
  assert.equal(await adapter.setComposerText('hello', { expectedConversationId: '/direct/t/42' }), 'OK');
  assert.deepEqual(insertCalls, [{
    accountId: 'instagram-a',
    guestId: 88,
    text: 'hello',
    token: '0123456789abcdef0123456789abcdef',
    chatId: '/direct/t/42',
  }]);
  assert.equal(await adapter.getComposerText(), 'hello');
  assert.equal(await adapter.clearComposerText(), true);
  assert.deepEqual(clearCalls, [{
    accountId: 'instagram-a',
    guestId: 88,
    token: '0123456789abcdef0123456789abcdef',
    chatId: '/direct/t/42',
  }]);
  assert.equal(await adapter.getComposerText(), '');
  assert.equal(await adapter.setComposerText('hello', { expectedConversationId: '/direct/t/42' }), 'OK');
  assert.equal(await adapter.sendText('', {
    expectedConversationId: '/direct/t/42',
    expectedComposerText: 'hello',
  }), 'SENT');
  assert.deepEqual(commitCalls, [{
    accountId: 'instagram-a',
    guestId: 88,
    chatId: '/direct/t/42',
    composerText: 'hello',
    token: '0123456789abcdef0123456789abcdef',
  }]);

  const source = fs.readFileSync(path.join(root, 'ui/instagram-platform-extension.js'), 'utf8');
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|instagram\.com\/api|graphql/i);
  assert.match(source, /GeekPlatformTransportDefinitions\.register\('instagram'/);
  assert.match(source, /GeekPlatformHostAdapters\.register\(FAMILY/);
  assert.match(source, /webviewInput\.insertText/);
  assert.match(source, /webviewInput\.clearText/);
  assert.match(source, /webviewInput\.commitSubmit/);
  assert.doesNotMatch(source, /execCommand\('delete'/, 'Instagram controlled composer cleanup must stay in the native WebView IPC owner');
  assert.match(source, /threadKeyForSelection/);
  assert.match(source, /cloneNode\?\.\(true\)/);
  assert.match(source, /occurrenceAdvanced/);
  assert.doesNotMatch(source, /messages_table/, 'real Instagram send confirmation must not depend on the retired messages_table hook');
  assert.match(source, /return 'MAYBE'/);

  console.log('INSTAGRAM_PLATFORM_EXTENSION_CONTRACT_OK');
})().catch(error => { console.error(error?.stack || error); process.exit(1); });
