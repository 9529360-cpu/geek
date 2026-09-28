'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sources = [
  'ui/platform-transport-definitions.js',
  'ui/platform-host-adapters.js',
  'ui/messenger-platform-extension.js',
].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]);

const context = { window: {}, console };
context.globalThis = context.window;
vm.createContext(context);
for (const [file, source] of sources) vm.runInContext(source, context, { filename: file });

(async () => {
assert.equal(typeof context.window.GeekMessengerPlatformExtension, 'object');
assert.equal(context.window.GeekMessengerPlatformExtension.family, 'messenger');

const definitions = context.window.GeekPlatformTransportDefinitions.create();
assert.equal(definitions.hasFamily('messenger'), true, 'Messenger must contribute a transport before app composition');
const definition = definitions.definitionFor({ family: 'messenger' });
assert.equal(typeof definition?.getChats, 'string');
assert.equal(typeof definition?.switchChat, 'function');
assert.match(definition.getChats, /a\[href\*="\/messages\/"\]/);
assert.match(definition.switchChat('/messages/t/42'), /\/messages\//);

let currentText = '';
let currentChat = '/messages/t/42';
let pollCount = 0;
const scripts = [];
const webview = {
  getWebContentsId() { return 77; },
  async executeJavaScript(script) {
    scripts.push(String(script));
    const source = String(script);
    new vm.Script(source);
    if (source.includes("const expected='/messages/t/42'") && source.includes('anchor.click')) return true;
    if (source.includes("String(location.pathname||'').match")) {
      if (source.includes("return {status:'READY',count}")) return { status: 'READY', count: 2 };
      if (source.includes("return {status:'OK',count,empty}")) {
        pollCount += 1;
        return { status: 'OK', count: pollCount > 0 ? 3 : 2, empty: true };
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
const commitCalls = [];
const api = {
  webviewInput: {
    async insertText(accountId, guestId, text, token, chatId) {
      insertCalls.push({ accountId, guestId, text, token, chatId });
      currentText = String(text);
      return true;
    },
    async commitSubmit(accountId, guestId, chatId, composerText, token) {
      commitCalls.push({ accountId, guestId, chatId, composerText, token });
      currentText = '';
      return 'SUBMITTED';
    },
  },
};
const fakeWhatsApp = {
  getComposerText() {}, clearComposerText() {}, setComposerText() {}, sendText() {},
};
const hostRegistry = context.window.GeekPlatformHostAdapters.create({
  api,
  bridgeTokenFor: () => '0123456789abcdef0123456789abcdef',
  sleep: async () => {},
  sameChat: (a, b) => String(a) === String(b),
  telegramBroadcastRoute: () => null,
  whatsapp: fakeWhatsApp,
});
assert.equal(hostRegistry.hasFamily('messenger'), true, 'Messenger must contribute a host adapter before app composition');

const adapter = hostRegistry.build({
  account: { id: 'messenger-a', type: 'messenger' },
  webview,
  family: 'messenger',
  definition,
});
assert.equal(await adapter.getCurrentChat(), '/messages/t/42');
assert.equal(await adapter.openChat('/messages/t/42'), true);
assert.equal(await adapter.setComposerText('hello', { expectedConversationId: '/messages/t/42' }), 'OK');
assert.deepEqual(insertCalls, [{
  accountId: 'messenger-a',
  guestId: 77,
  text: 'hello',
  token: '0123456789abcdef0123456789abcdef',
  chatId: '/messages/t/42',
}]);
assert.equal(await adapter.getComposerText(), 'hello');
assert.equal(await adapter.sendText('', {
  expectedConversationId: '/messages/t/42',
  expectedComposerText: 'hello',
}), 'SENT');
assert.deepEqual(commitCalls, [{
  accountId: 'messenger-a',
  guestId: 77,
  chatId: '/messages/t/42',
  composerText: 'hello',
  token: '0123456789abcdef0123456789abcdef',
}]);

const source = fs.readFileSync(path.join(root, 'ui/messenger-platform-extension.js'), 'utf8');
assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|facebook\.com\/api|graphql/i, 'extension must not bypass the embedded Facebook UI with a private network sender');
assert.match(source, /GeekPlatformTransportDefinitions\.register\('messenger'/);
assert.match(source, /GeekPlatformHostAdapters\.register\(FAMILY/);
assert.match(source, /webviewInput\.insertText/);
assert.match(source, /webviewInput\.commitSubmit/);
assert.match(source, /return 'MAYBE'/);

console.log('MESSENGER_PLATFORM_EXTENSION_CONTRACT_OK');
})().catch(error => { console.error(error?.stack || error); process.exit(1); });
