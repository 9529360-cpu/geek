'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOwnershipRegistry } = require('../src/webview-ownership.cjs');
const { WEBVIEW_IPC_CHANNELS, installWebviewIpc } = require('../src/webview-ipc.cjs');

const TOKEN_A = '0123456789abcdef0123456789abcdef';
const TOKEN_B = 'fedcba9876543210fedcba9876543210';
const PART_A = 'persist:webview-page-acc-a';
const PART_B = 'persist:webview-page-acc-b';
const TG_URL = 'https://web.telegram.org/a/';
const LINE_URL = 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html#/chats/abc';

function createIpcMain() {
  const handlers = new Map();
  const removed = [];
  return {
    handlers,
    removed,
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    },
    async invoke(channel, sender, ...args) {
      const handler = handlers.get(channel);
      assert.equal(typeof handler, 'function', `missing handler: ${channel}`);
      return handler({ sender }, ...args);
    },
  };
}

function createGuest({ id, host, session, url = TG_URL, focused = true, destroyed = false } = {}) {
  const emitter = new EventEmitter();
  let destroyedState = destroyed;
  const scripts = [];
  const inserted = [];
  return Object.assign(emitter, {
    id,
    hostWebContents: host,
    session,
    scripts,
    inserted,
    getURL: () => url,
    isDestroyed: () => destroyedState,
    setDestroyed(value) { destroyedState = value; },
    executeJavaScript: async (script) => {
      scripts.push(script);
      return typeof focused === 'function' ? focused() : focused;
    },
    insertText: async (value) => { inserted.push(value); },
  });
}

function createHarness(overrides = {}) {
  const ipcMain = createIpcMain();
  const trustedSender = { id: 101 };
  const untrustedSender = { id: 202 };
  const sessions = new Map([[PART_A, { partition: PART_A }], [PART_B, { partition: PART_B }]]);
  const accounts = new Map([
    ['acc-a', { id: 'acc-a', type: 'telegram', partition: PART_A }],
    ['acc-b', { id: 'acc-b', type: 'telegram-k', partition: PART_B }],
    ['line-a', { id: 'line-a', type: 'line', partition: 'persist:webview-page-line-a' }],
  ]);
  sessions.set('persist:webview-page-line-a', { partition: 'persist:webview-page-line-a' });
  const guests = new Map();
  const calls = [];
  const realOwnership = createOwnershipRegistry();
  const webviewOwnership = {
    register(value) { calls.push(['ownership.register', value.guestId]); return realOwnership.register(value); },
    authorize(value) { calls.push(['ownership.authorize', Number(value.guestId)]); return realOwnership.authorize(value); },
    remove(value) { calls.push(['ownership.remove', Number(value)]); return realOwnership.remove(value); },
    clear() { return realOwnership.clear(); },
  };
  const accountState = {
    resolvePartition(accountId) {
      calls.push(['account.resolve', accountId]);
      if (!/^[a-z0-9-]+$/.test(String(accountId || ''))) throw new Error('无效的账号 ID');
      const account = accounts.get(accountId);
      if (!account) throw new Error('账号沙箱不存在');
      return account.partition;
    },
    findById(accountId) {
      calls.push(['account.find', accountId]);
      return accounts.get(accountId);
    },
  };
  const assertTrustedSender = (event) => {
    calls.push(['sender.guard', event.sender.id]);
    if (event.sender !== trustedSender) throw new Error('拒绝来自未授权页面的 IPC 请求');
  };
  const getWebContentsById = (id) => {
    calls.push(['guest.lookup', id]);
    return guests.get(id);
  };
  const getSessionForPartition = (partition) => {
    calls.push(['session.lookup', partition]);
    return sessions.get(partition);
  };

  const deps = {
    ipcMain,
    assertTrustedSender,
    accountState,
    webviewOwnership,
    getWebContentsById,
    getSessionForPartition,
    ...overrides,
  };
  const owner = installWebviewIpc(deps);
  return { ipcMain, trustedSender, untrustedSender, sessions, accounts, guests, calls, webviewOwnership, realOwnership, accountState, owner };
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, pattern);
}

(async () => {
  {
    const h = createHarness();
    assert.deepEqual([...h.ipcMain.handlers.keys()], WEBVIEW_IPC_CHANNELS, 'owner must register exactly the two WebView invoke channels');
  }

  {
    const h = createHarness();
    const attackerGuest = createGuest({ id: 7, host: h.untrustedSender, session: h.sessions.get(PART_A) });
    h.guests.set(7, attackerGuest);
    const beforeRegister = h.calls.length;
    await rejects(h.ipcMain.invoke('webview:register', h.untrustedSender, 'acc-a', 7, TOKEN_A), /未授权/);
    assert.deepEqual(h.calls.slice(beforeRegister), [['sender.guard', h.untrustedSender.id]], 'untrusted register must stop at sender guard');
    const beforeInsert = h.calls.length;
    await rejects(h.ipcMain.invoke('webview:insert-text', h.untrustedSender, 'acc-a', 7, 'x', TOKEN_A), /未授权/);
    assert.deepEqual(h.calls.slice(beforeInsert), [['sender.guard', h.untrustedSender.id]], 'untrusted insert-text must stop at sender guard');
  }

  {
    const h = createHarness();
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 0, TOKEN_A), /WebView登记失败/);
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'bad id!', 7, TOKEN_A), /无效的账号 ID/);
  }

  {
    const h = createHarness();
    h.accounts.set('acc-a', { id: 'acc-a', type: 'telegram', partition: '' });
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A), /WebView登记失败/);
  }

  {
    const h = createHarness();
    h.accountState.resolvePartition = () => PART_A;
    h.accountState.findById = () => undefined;
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A), /WebView登记失败/);
  }

  {
    const h = createHarness();
    h.accountState.resolvePartition = () => PART_B;
    h.guests.set(7, createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_B) }));
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A), /WebView登记失败/);
  }

  {
    const h = createHarness();
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 404, TOKEN_A), /WebView登记失败/);
    const destroyed = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A), destroyed: true });
    h.guests.set(7, destroyed);
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A), /WebView登记失败/);
  }

  {
    const h = createHarness();
    const wrongHost = { id: 303 };
    h.guests.set(7, createGuest({ id: 7, host: wrongHost, session: h.sessions.get(PART_A) }));
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A), /WebView登记失败/);
    h.guests.set(7, createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_B) }));
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A), /WebView登记失败/);
  }

  {
    const h = createHarness();
    h.guests.set(7, createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A), url: LINE_URL }));
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A), /WebView登记失败/);
    const linePartition = h.accounts.get('line-a').partition;
    h.guests.set(8, createGuest({ id: 8, host: h.trustedSender, session: h.sessions.get(linePartition), url: LINE_URL }));
    assert.equal(await h.ipcMain.invoke('webview:register', h.trustedSender, 'line-a', 8, TOKEN_A), true);
  }

  {
    const h = createHarness();
    const guest = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A) });
    h.guests.set(7, guest);
    assert.equal(await h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A), true);
    assert.equal(h.realOwnership.authorize({ guestId: 7, accountId: 'acc-a', partition: PART_A, token: TOKEN_A, senderId: h.trustedSender.id }), true);
    await rejects(h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-b', 7, TOKEN_B), /WebView登记失败/);
    assert.equal(h.realOwnership.authorize({ guestId: 7, accountId: 'acc-a', partition: PART_A, token: TOKEN_A, senderId: h.trustedSender.id }), true, 'cross-account claim must not rebind existing owner');
  }

  {
    const h = createHarness();
    const guest = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A) });
    h.guests.set(7, guest);
    await h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A);
    guest.emit('destroyed');
    const replacement = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A) });
    h.guests.set(7, replacement);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 7, 'hello', TOKEN_A), /账号输入页面不可用/);
    assert.deepEqual(replacement.inserted, [], 'stale registration must not authorize replacement guest');
  }

  {
    const h = createHarness();
    const guest = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A) });
    h.guests.set(7, guest);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 7, 'before', TOKEN_A), /账号输入页面不可用/);
    assert.deepEqual(guest.inserted, [], 'insert before registration must have no side effect');
  }

  {
    const h = createHarness();
    const ownerGuest = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A) });
    const otherGuest = createGuest({ id: 8, host: h.trustedSender, session: h.sessions.get(PART_A) });
    h.guests.set(7, ownerGuest);
    h.guests.set(8, otherGuest);
    await h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 8, 'wrong guest', TOKEN_A), /账号输入页面不可用/);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 7, 'wrong token', TOKEN_B), /账号输入页面不可用/);
    assert.deepEqual(ownerGuest.inserted, []);
    assert.deepEqual(otherGuest.inserted, []);
  }

  {
    const h = createHarness();
    const guest = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A), focused: false });
    h.guests.set(7, guest);
    await h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 7, 'not focused', TOKEN_A), /输入框未获得焦点/);
    assert.deepEqual(guest.inserted, [], 'unfocused composer must not receive text');
    assert.equal(guest.scripts.length, 1);
    assert.match(guest.scripts[0], /#editable-message-text\.form-control\.ProseMirror/);
    assert.match(guest.scripts[0], /textarea-ex\[class\*=\"chatroomEditor-module__textarea__\"\]/);
  }

  {
    const h = createHarness();
    const guest = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A), focused: true });
    h.guests.set(7, guest);
    await h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A);
    assert.equal(await h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 7, 'hello world', TOKEN_A), true);
    assert.deepEqual(guest.inserted, ['hello world']);
    guest.setDestroyed(true);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 7, 'after destroy', TOKEN_A), /账号输入页面不可用/);
    assert.deepEqual(guest.inserted, ['hello world'], 'destroyed guest must not receive text');
  }

  {
    const h = createHarness();
    const guest = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A) });
    h.guests.set(7, guest);
    await h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-b', 7, 'cross account', TOKEN_A), /账号输入页面不可用/);
    assert.deepEqual(guest.inserted, [], 'cross-account insert must not produce side effect');
  }

  {
    const h = createHarness();
    const guest = createGuest({ id: 7, host: h.trustedSender, session: h.sessions.get(PART_A) });
    h.guests.set(7, guest);
    await h.ipcMain.invoke('webview:register', h.trustedSender, 'acc-a', 7, TOKEN_A);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 7, '', TOKEN_A), /输入文本不合法/);
    await rejects(h.ipcMain.invoke('webview:insert-text', h.trustedSender, 'acc-a', 7, 'x'.repeat(10001), TOKEN_A), /输入文本不合法/);
  }

  {
    const h = createHarness();
    h.ipcMain.handlers.set('foreign:keep', async () => true);
    h.owner.dispose();
    assert.equal(h.ipcMain.handlers.has('webview:register'), false);
    assert.equal(h.ipcMain.handlers.has('webview:insert-text'), false);
    assert.equal(h.ipcMain.handlers.has('foreign:keep'), true, 'foreign handler must survive WebView owner disposal');
    assert.deepEqual(h.ipcMain.removed, WEBVIEW_IPC_CHANNELS);
    h.owner.dispose();
    assert.deepEqual(h.ipcMain.removed, WEBVIEW_IPC_CHANNELS, 'double dispose must not remove handlers again');
  }

  {
    const h = createHarness();
    assert.throws(() => installWebviewIpc({
      ipcMain: h.ipcMain,
      assertTrustedSender: () => {},
      accountState: h.accountState,
      webviewOwnership: h.webviewOwnership,
      getWebContentsById: () => null,
      getSessionForPartition: () => null,
    }), /duplicate handler: webview:register/, 'duplicate owner must be caught by the IPC registration authority');
  }

  console.log('WEBVIEW_IPC_OWNER_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
