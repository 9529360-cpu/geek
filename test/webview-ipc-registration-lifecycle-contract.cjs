'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOwnershipRegistry } = require('../src/webview-ownership.cjs');
const { installWebviewIpc } = require('../src/webview-ipc.cjs');

const PARTITION = 'persist:webview-page-a';
const TOKEN_A = '0123456789abcdef0123456789abcdef';
const TOKEN_B = 'fedcba9876543210fedcba9876543210';

function createGuest(id, sender, session) {
  const guest = new EventEmitter();
  return Object.assign(guest, {
    id,
    hostWebContents: sender,
    session,
    getURL: () => 'https://web.telegram.org/a/',
    isDestroyed: () => false,
    executeJavaScript: async () => true,
    insertText: async () => {},
  });
}

(async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const sender = { id: 41 };
  const session = { partition: PARTITION };
  const guests = new Map();
  const realOwnership = createOwnershipRegistry();
  let removeCalls = 0;
  const webviewOwnership = {
    register: value => realOwnership.register(value),
    authorize: value => realOwnership.authorize(value),
    remove(value) { removeCalls += 1; return realOwnership.remove(value); },
  };
  const owner = installWebviewIpc({
    ipcMain,
    assertTrustedSender: event => assert.equal(event.sender, sender),
    accountState: {
      resolvePartition: accountId => accountId === 'acc-a' ? PARTITION : '',
      findById: accountId => accountId === 'acc-a' ? { id: 'acc-a', type: 'telegram', partition: PARTITION } : null,
    },
    webviewOwnership,
    getWebContentsById: id => guests.get(Number(id)),
    getSessionForPartition: partition => partition === PARTITION ? session : null,
  });

  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  const guest = createGuest(7, sender, session);
  guests.set(7, guest);

  for (let index = 0; index < 20; index += 1) {
    const token = index === 19 ? TOKEN_B : TOKEN_A;
    assert.equal(await invoke('webview:register', 'acc-a', 7, token), true);
  }
  assert.equal(guest.listenerCount('destroyed'), 1, 'repeated registration must bind exactly one destroyed cleanup');
  assert.equal(realOwnership.authorize({ guestId: 7, accountId: 'acc-a', partition: PARTITION, token: TOKEN_A, senderId: sender.id }), false, 're-registration must still replace the bridge token');
  assert.equal(realOwnership.authorize({ guestId: 7, accountId: 'acc-a', partition: PARTITION, token: TOKEN_B, senderId: sender.id }), true, 'latest bridge token must remain authoritative');

  guest.emit('destroyed');
  assert.equal(removeCalls, 1, 'one live guest must remove ownership exactly once on destruction');
  assert.equal(realOwnership.authorize({ guestId: 7, accountId: 'acc-a', partition: PARTITION, token: TOKEN_B, senderId: sender.id }), false, 'destroyed guest ownership must be invalidated');

  const replacement = createGuest(7, sender, session);
  guests.set(7, replacement);
  assert.equal(await invoke('webview:register', 'acc-a', 7, TOKEN_A), true);
  assert.equal(replacement.listenerCount('destroyed'), 1, 'replacement guest must receive its own lifecycle cleanup');
  assert.equal(realOwnership.authorize({ guestId: 7, accountId: 'acc-a', partition: PARTITION, token: TOKEN_A, senderId: sender.id }), true, 'replacement guest must establish fresh ownership');
  replacement.emit('destroyed');
  assert.equal(removeCalls, 2, 'replacement destruction must remove only its own current ownership once');

  owner.dispose();
  console.log('WEBVIEW_IPC_REGISTRATION_LIFECYCLE_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
