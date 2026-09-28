'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'platform-host-adapters.js'), 'utf8').replace(/\r\n?/g, '\n');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'platform-host-adapters.js' });

assert.equal(typeof context.window.GeekPlatformHostAdapters?.create, 'function');
assert.equal(typeof context.window.GeekPlatformHostAdapters?.register, 'function');
assert.deepEqual(
  Object.keys(context.window.GeekPlatformHostAdapters.currentChatScripts).sort(),
  ['line', 'telegram', 'whatsapp'],
);

(async () => {
const preloadFactory = ({ webview, transport }) => ({
  async getCurrentChat() { return 'preload-1'; },
  async getComposerText() { return 'preload-text'; },
  async clearComposerText() { return true; },
  async setComposerText(text) { return webview.executeJavaScript(transport.setMessage(text)); },
  async sendText(text) { return webview.executeJavaScript(transport.send(text)); },
});
context.window.GeekPlatformHostAdapters.register('preload-chat', preloadFactory);
assert.throws(() => context.window.GeekPlatformHostAdapters.register('whatsapp', preloadFactory), /already registered/);
const inputCalls = [];
const whatsappCalls = [];
const api = {
  webviewInput: {
    async insertText(...args) { inputCalls.push(['insert', ...args]); return true; },
    async commitSubmit(...args) { inputCalls.push(['commit', ...args]); return 'SUBMITTED'; },
  },
};
const registry = context.window.GeekPlatformHostAdapters.create({
  api,
  bridgeTokenFor: () => 'bridge-token',
  sleep: async () => {},
  sameChat: (a, b) => String(a) === String(b),
  telegramBroadcastRoute: () => ({ async openVirtualizedTarget() { return 'virtualized'; } }),
  whatsapp: {
    async getComposerText() { whatsappCalls.push('get'); return 'wa-text'; },
    async clearComposerText() { whatsappCalls.push('clear'); return true; },
    async setComposerText(args) { whatsappCalls.push(['set', args.mutation.expectedConversationId]); return 'OK'; },
    async sendText(args) { whatsappCalls.push(['send', args.commit.expectedConversationId]); return 'SENT'; },
  },
});

assert.deepEqual(Array.from(registry.families()).sort(), ['line', 'preload-chat', 'telegram', 'whatsapp']);
assert.equal(registry.hasFamily('telegram'), true);
assert.equal(registry.hasFamily('future-chat'), false);

function makeWebview() {
  const calls = [];
  let currentChat = 'wa-chat';
  return {
    calls,
    getWebContentsId() { return 71; },
    setCurrentChat(value) { currentChat = value; },
    async executeJavaScript(script) {
      calls.push(script);
      if (script === 'GET_CHATS') return '[{"id":"wa-chat"}]';
      if (String(script).startsWith('SWITCH:')) {
        currentChat = String(script).slice('SWITCH:'.length);
        return true;
      }
      if (script === 'SET:hello') return 'SET_OK';
      if (script === 'SEND:hello') return 'SEND_OK';
      if (String(script).includes('getActiveChat')) return currentChat;
      return true;
    },
  };
}
const transport = {
  getChats: 'GET_CHATS',
  switchChat: id => 'SWITCH:' + id,
  setMessage: text => 'SET:' + text,
  send: text => 'SEND:' + text,
};
const webview = makeWebview();
const wa = registry.build({
  account: { id: 'wa-1' },
  webview,
  family: 'whatsapp',
  definition: transport,
});
assert.equal(wa.family, 'whatsapp');
assert.equal(JSON.stringify(await wa.listChats()), JSON.stringify([{ id: 'wa-chat' }]));
assert.equal(await wa.getCurrentChat(), 'wa-chat');
assert.equal(await wa.openChat('wa-next'), true);
assert.equal(await wa.getCurrentChat(), 'wa-next');
assert.equal(await wa.getComposerText(), 'wa-text');
assert.equal(await wa.clearComposerText(), true);
assert.equal(await wa.setComposerText('hello'), 'SET_OK', 'broadcast composer fallback must remain transport-owned');
assert.equal(await wa.sendText('hello'), 'SEND_OK', 'broadcast send fallback must remain transport-owned');
assert.equal(
  await wa.setComposerText('hello', { expectedConversationId: 'wa-next' }),
  'OK',
  'interactive composer mutation must use the WhatsApp SendIntent capability',
);
assert.equal(
  await wa.sendText('', { expectedConversationId: 'wa-next', expectedComposerText: 'hello' }),
  'SENT',
  'interactive commit must use the WhatsApp SendIntent capability',
);
assert.deepEqual(whatsappCalls, ['get', 'clear', ['set', 'wa-next'], ['send', 'wa-next']]);

const preload = registry.build({
  account: { id: 'preload-1' },
  webview: makeWebview(),
  family: 'preload-chat',
  definition: transport,
});
assert.equal(await preload.getCurrentChat(), 'preload-1');
assert.equal(await preload.setComposerText('hello'), 'SET_OK');
registry.register('future-chat', ({ webview: futureWebview, transport: futureTransport }) => ({
  async getCurrentChat() { return 'future-1'; },
  async getComposerText() { return 'future-text'; },
  async clearComposerText() { return true; },
  async setComposerText(text) { return futureWebview.executeJavaScript(futureTransport.setMessage(text)); },
  async sendText(text) { return futureWebview.executeJavaScript(futureTransport.send(text)); },
}));
assert.equal(registry.hasFamily('future-chat'), true);
const future = registry.build({
  account: { id: 'future-1' },
  webview: makeWebview(),
  family: 'future-chat',
  definition: transport,
});
assert.equal(await future.getCurrentChat(), 'future-1');
assert.equal(await future.setComposerText('hello'), 'SET_OK');
assert.equal(await future.sendText('hello'), 'SEND_OK');
assert.throws(() => registry.register('future-chat', () => ({})), /already registered/);
assert.throws(
  () => registry.build({ account: { id: 'x' }, webview: makeWebview(), family: 'missing', definition: transport }),
  /unavailable/,
);

assert.match(source, /factories\.set\('telegram'/);
assert.match(source, /factories\.set\('line'/);
assert.match(source, /factories\.set\('whatsapp'/);
assert.match(source, /extensionFactories/);
assert.match(source, /register:\s*registerExtension/);
assert.match(source, /webviewInput\.commitSubmit/);
assert.match(source, /data-mid.*aria-current="true"/);
assert.doesNotMatch(source, /sendInputEvent\(/, 'renderer platform adapters must not bypass the main-process native-input owner');

console.log('PLATFORM_HOST_ADAPTERS_CONTRACT_OK');
})().catch(error => { console.error(error?.stack || error); process.exit(1); });