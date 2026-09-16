'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installWebviewIpc } = require('../src/webview-ipc.cjs');

const PREFIX = '\u001eGEEK_NATIVE_INPUT_V1\u001e';
const TOKEN = 'a'.repeat(32);

function envelope(payload) {
  return PREFIX + JSON.stringify(payload);
}

(async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const mainFrame = {};
  const sender = { id: 91, mainFrame };
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

  assert.equal(await invoke('webview:register', 'acc-a', 7, TOKEN), true);

  await assert.rejects(
    invoke('webview:insert-text', 'acc-a', 7, envelope({ token: 'b'.repeat(32), expectedChatId: 'chat-a', text: 'ciao' }), TOKEN),
    /令牌不匹配/,
  );
  assert.deepEqual(guest.inserted, [], 'wrong-token lease envelope must fail closed before composer mutation');

  await assert.rejects(
    invoke('webview:insert-text', 'acc-a', 7, envelope({ token: TOKEN, expectedChatId: 'chat-a', text: { value: 'ciao' } }), TOKEN),
    /格式不合法/,
  );
  assert.deepEqual(guest.inserted, [], 'non-string lease payload must fail closed before composer mutation');

  await assert.rejects(
    invoke('webview:insert-text', 'acc-a', 7, envelope({ token: TOKEN, expectedChatId: 'chat-a', text: 'ciao' }), TOKEN),
    /聊天已切换/,
  );
  assert.deepEqual(guest.inserted, [], 'stale request-scoped lease must fail before insertText');
  assert.match(scripts.at(-1), /const expectedChatId = "chat-a"/);

  assert.equal(await invoke('webview:insert-text', 'acc-a', 7, 'plain native input', TOKEN), true);
  assert.deepEqual(guest.inserted, ['plain native input'], 'raw/native input must not inherit a prior translation lease');
  assert.match(scripts.at(-1), /const expectedChatId = ""/);

  owner.dispose();
  console.log('NATIVE_INPUT_CHAT_LEASE_ENVELOPE_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});