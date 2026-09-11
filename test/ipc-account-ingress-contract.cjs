'use strict';

const assert = require('node:assert/strict');
const {
  ACCOUNT_IPC_CHANNELS,
  installAccountIpc,
  normalizeAccountAddPayload,
} = require('../src/account-ipc.cjs');

function createHarness() {
  const handlers = new Map();
  const removed = [];
  const calls = [];
  let senderChecks = 0;
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  const callback = (name) => async (_event, ...args) => {
    calls.push({ name, args });
    return { name, args };
  };
  const owner = installAccountIpc({
    ipcMain,
    assertTrustedSender(event) {
      senderChecks += 1;
      if (event?.trusted !== true) throw new Error('SENDER_REJECTED');
    },
    listAccounts: callback('list'),
    addAccount: callback('add'),
    removeAccount: callback('remove'),
    switchAccount: callback('switch'),
    updateAccount: callback('update'),
    moveAccount: callback('move'),
    moveAccountTo: callback('moveTo'),
  });
  return { handlers, removed, calls, owner, senderChecks: () => senderChecks };
}

const expectedChannels = Object.values(ACCOUNT_IPC_CHANNELS).sort();
const harness = createHarness();
assert.deepEqual([...harness.handlers.keys()].sort(), expectedChannels, 'Account IPC owner must directly register every Account channel');

const add = harness.handlers.get(ACCOUNT_IPC_CHANNELS.add);
const trusted = { trusted: true };
const validCases = [
  [undefined, {}],
  ['账号名称', { name: '账号名称' }],
  [{}, {}],
  [{ name: 'X' }, { name: 'X' }],
  [{ type: 'whatsapp' }, { type: 'whatsapp' }],
  [{ type: 'telegram-k' }, { type: 'telegram-k' }],
  [{ type: 'telegrm' }, { type: 'telegrm' }],
  [{ type: '' }, { type: '' }],
  [{ type: null }, { type: null }],
  [{ type: ' whatsapp' }, { type: ' whatsapp' }],
  [{ type: 'website', customUrl: 'https://example.com/' }, { type: 'website', customUrl: 'https://example.com/' }],
];
for (const [input, expected] of validCases) {
  const before = harness.calls.length;
  await add(trusted, input);
  assert.equal(harness.calls.length, before + 1);
  assert.equal(harness.calls.at(-1).name, 'add');
  assert.deepEqual(harness.calls.at(-1).args[0], expected, 'valid/compat payload must reach the authoritative mutation unchanged after ingress normalization');
}

for (const input of [null, [], 42, true, false, Symbol('bad'), () => {}]) {
  const before = harness.calls.length;
  await assert.rejects(
    () => add(trusted, input),
    (error) => error?.code === 'ACCOUNT_PAYLOAD_INVALID' && error?.message === 'ACCOUNT_PAYLOAD_INVALID',
    `malformed payload must fail closed: ${typeof input}`,
  );
  assert.equal(harness.calls.length, before, 'malformed payload must not reach account mutation callback');
}

for (const input of [null, [], 42, true, false]) {
  assert.throws(
    () => normalizeAccountAddPayload(input),
    (error) => error?.code === 'ACCOUNT_PAYLOAD_INVALID' && error?.message === 'ACCOUNT_PAYLOAD_INVALID',
  );
}
assert.deepEqual(normalizeAccountAddPayload(undefined), {});
assert.deepEqual(normalizeAccountAddPayload('legacy'), { name: 'legacy' });

const senderHarness = createHarness();
for (const [key, channel] of Object.entries(ACCOUNT_IPC_CHANNELS)) {
  const beforeCalls = senderHarness.calls.length;
  await assert.rejects(
    () => senderHarness.handlers.get(channel)({ trusted: false }, ...(key === 'add' ? [{ name: 'blocked' }] : [])),
    /SENDER_REJECTED/,
  );
  assert.equal(senderHarness.calls.length, beforeCalls, `${channel} must validate sender before callback/mutation`);
}
assert.equal(senderHarness.senderChecks(), expectedChannels.length, 'every Account IPC handler must cross the sender gate');

harness.owner.dispose();
assert.deepEqual(harness.removed.sort(), expectedChannels, 'dispose must remove every channel owned by Account IPC');
assert.equal(harness.handlers.size, 0, 'dispose must leave no Account IPC handlers behind');

console.log('IPC_ACCOUNT_INGRESS_CONTRACT_OK');
