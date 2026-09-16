'use strict';

const assert = require('node:assert/strict');
const { installConfigIpc } = require('../src/config-ipc.cjs');

function ipcEvent({ trusted = true, childFrame = false } = {}) {
  const mainFrame = {};
  return {
    trusted,
    sender: { id: 1, mainFrame },
    senderFrame: childFrame ? {} : mainFrame,
  };
}

function ipcHarness() {
  const handlers = new Map();
  const removed = [];
  return {
    handlers,
    removed,
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `duplicate ${channel}`);
        handlers.set(channel, handler);
      },
      removeHandler(channel) { handlers.delete(channel); removed.push(channel); },
    },
  };
}

async function successContract() {
  const ipc = ipcHarness();
  let state = { theme: 'system', host: '' };
  const calls = [];
  const owner = installConfigIpc({
    ipcMain: ipc.ipcMain,
    assertTrustedSender(event) { if (event?.trusted !== true) throw new Error('denied'); },
    store: {
      getSnapshot() { calls.push(['get']); return { ...state }; },
      async update(patch) { state = { ...state, ...(patch || {}) }; calls.push(['update', { ...state }]); return { ...state }; },
    },
    async onCommitted(snapshot) { calls.push(['effect', { ...snapshot }]); },
  });
  assert.deepEqual([...ipc.handlers.keys()].sort(), ['config:get', 'config:set']);
  await assert.rejects(ipc.handlers.get('config:get')(ipcEvent({ trusted: false })), /denied/);

  const beforeChildGet = calls.length;
  await assert.rejects(
    ipc.handlers.get('config:get')(ipcEvent({ childFrame: true })),
    error => error?.code === 'MAIN_FRAME_IPC_SENDER_INVALID',
  );
  assert.equal(calls.length, beforeChildGet, 'child-frame config:get must fail before reading Config State');

  const beforeChildSet = calls.length;
  await assert.rejects(
    ipc.handlers.get('config:set')(ipcEvent({ childFrame: true }), { theme: 'dark' }),
    error => error?.code === 'MAIN_FRAME_IPC_SENDER_INVALID',
  );
  assert.equal(calls.length, beforeChildSet, 'child-frame config:set must fail before durable mutation/effects');

  assert.deepEqual(await ipc.handlers.get('config:get')(ipcEvent()), state);
  const result = await ipc.handlers.get('config:set')(ipcEvent(), { theme: 'dark' });
  assert.equal(result.theme, 'dark');
  assert.deepEqual(calls.map(item => item[0]), ['get', 'update', 'effect'], 'effect must run only after durable owner update resolves');
  owner.dispose();
  owner.dispose();
  assert.equal(ipc.handlers.size, 0);
  assert.deepEqual(ipc.removed, ['config:get', 'config:set']);
}

async function failedCommitHasNoEffects() {
  const ipc = ipcHarness();
  let effects = 0;
  installConfigIpc({
    ipcMain: ipc.ipcMain,
    assertTrustedSender() {},
    store: {
      getSnapshot() { return { theme: 'system' }; },
      async update() {
        const error = new Error('synthetic durable failure');
        error.code = 'EIO';
        throw error;
      },
    },
    async onCommitted() { effects += 1; },
  });
  await assert.rejects(ipc.handlers.get('config:set')(ipcEvent(), { theme: 'dark' }), error => error?.code === 'EIO');
  assert.equal(effects, 0, 'failed durable mutation must not apply login/proxy/notify side effects');
}

async function main() {
  await successContract();
  await failedCommitHasNoEffects();
  console.log('CONFIG_IPC_CONTRACT_OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });