'use strict';

const assert = require('node:assert/strict');
const {
  TRANSLATION_CHANNELS,
  clearPartitionRuntimeState,
  createTranslationRuntime,
} = require('../src/translation-runtime.cjs');

function createRuntimeState() {
  return {
    caches: new Map([
      ['persist:webview-page-a', new Map([['a', { text: 'A' }]])],
      ['persist:webview-page-b', new Map([['b', { text: 'B' }]])],
    ]),
    cacheLoaded: new Set(['persist:webview-page-a', 'persist:webview-page-b']),
    deletedPartitions: new Set(),
    inflight: new Map([
      ['persist:webview-page-a:key-a', Promise.resolve('A')],
      ['persist:webview-page-b:key-b', Promise.resolve('B')],
    ]),
    cacheWrites: new Map([
      ['persist:webview-page-a', Promise.resolve()],
      ['persist:webview-page-b', Promise.resolve()],
    ]),
    latestRequest: new Map([
      ['persist:webview-page-a:key-a', 1],
      ['persist:webview-page-b:key-b', 2],
    ]),
  };
}

{
  const state = createRuntimeState();
  clearPartitionRuntimeState(state, 'persist:webview-page-a');
  assert.equal(state.deletedPartitions.has('persist:webview-page-a'), true);
  assert.equal(state.caches.has('persist:webview-page-a'), false);
  assert.equal(state.cacheLoaded.has('persist:webview-page-a'), false);
  assert.equal(state.cacheWrites.has('persist:webview-page-a'), false);
  assert.equal(state.inflight.has('persist:webview-page-a:key-a'), false);
  assert.equal(state.latestRequest.has('persist:webview-page-a:key-a'), false);

  assert.equal(state.deletedPartitions.has('persist:webview-page-b'), false, 'deleting account A must not mark account B deleted');
  assert.equal(state.caches.get('persist:webview-page-b').get('b').text, 'B', 'deleting account A must preserve account B cache');
  assert.equal(state.cacheLoaded.has('persist:webview-page-b'), true);
  assert.equal(state.cacheWrites.has('persist:webview-page-b'), true);
  assert.equal(state.inflight.has('persist:webview-page-b:key-b'), true);
  assert.equal(state.latestRequest.get('persist:webview-page-b:key-b'), 2);
}

{
  const handlers = new Map();
  const removed = [];
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `duplicate translation IPC registration: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  const unauthorized = new Error('UNTRUSTED');
  const runtime = createTranslationRuntime({
    ipcMain,
    fs: {
      readFile: async () => '',
      appendFile: async () => {},
      mkdir: async () => {},
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-test',
    accountState: { findById: () => ({ partition: 'persist:webview-page-a' }) },
    createGatewayPool: () => ({
      endpoints: ['http://127.0.0.1:8787'],
      healthCheckAll: async () => ({ local: true }),
      pick: () => ({ endpoint: 'http://127.0.0.1:8787', route: 'primary' }),
      reportFailure() {},
      reportSuccess() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender: () => { throw unauthorized; },
    assertValidAccountId: () => {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => '',
    }),
    fetchImpl: async () => { throw new Error('fetch must not run for untrusted sender'); },
    randomUUID: () => 'req-1',
  });

  assert.deepEqual([...TRANSLATION_CHANNELS], ['translation:translate', 'translation:health']);
  runtime.install();
  assert.deepEqual([...handlers.keys()].sort(), [...TRANSLATION_CHANNELS].sort());
  for (const channel of TRANSLATION_CHANNELS) {
    assert.throws(() => handlers.get(channel)({ sender: { id: 99 } }, {}), unauthorized, `${channel} must validate sender before doing work`);
  }
  runtime.dispose();
  assert.deepEqual(removed.sort(), [...TRANSLATION_CHANNELS].sort());
  assert.equal(handlers.size, 0);
}

console.log('TRANSLATION_RUNTIME_CONTRACT_OK');
