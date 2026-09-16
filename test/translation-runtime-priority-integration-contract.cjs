'use strict';

const assert = require('node:assert/strict');
const {
  createTranslationRuntime,
  unwrapTranslationIpcResponse,
} = require('../src/translation-runtime.cjs');
const { mainFrameIpcEvent } = require('./helpers/main-frame-ipc-event.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function successResponse(text) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ text, source: 'auto', target: 'it' }),
  };
}

(async () => {
  const handlers = new Map();
  const accounts = new Map([
    ['account-a', { partition: 'persist:priority-account-a' }],
    ['account-b', { partition: 'persist:priority-account-b' }],
  ]);
  const backgroundGate = deferred();
  const outgoingGate = deferred();
  const starts = [];

  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: { readFile: async () => '', appendFile: async () => {} },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-priority-integration',
    accountState: { findById(id) { return accounts.get(id) || null; } },
    createGatewayPool: () => ({
      endpoints: ['https://translate.example.test'],
      healthCheckAll: async () => ({ 'https://translate.example.test': true }),
      pick: () => ({ endpoint: 'https://translate.example.test', route: 'primary' }),
      reportFailure() {},
      reportSuccess() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId(id) { if (!accounts.has(id)) throw new Error('unknown account'); },
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => 'translation-token',
    }),
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body || '{}');
      starts.push(body.text);
      if (body.text === 'interactive-send') await outgoingGate.promise;
      else await backgroundGate.promise;
      return successResponse(`translated:${body.text}`);
    },
    randomUUID: (() => { let n = 0; return () => `priority-request-${++n}`; })(),
  });

  runtime.install();
  const rawTranslate = handlers.get('translation:translate');
  const event = mainFrameIpcEvent({ id: 1 });
  const translate = async payload => unwrapTranslationIpcResponse(await rawTranslate(event, payload));

  try {
    // Saturate the background class up to its permitted active capacity. Four
    // global slots must remain available for explicit outgoing work.
    const background = Array.from({ length: 24 }, (_, index) => translate({
      accountId: 'account-a',
      text: `background-${index}`,
      target: 'it',
      intent: 'message-display',
      refresh: true,
      deadlineAt: Date.now() + 5000,
    }));
    await waitFor(() => starts.length === 16, 'background class to reach its 16-slot ceiling');
    assert.equal(runtime.schedulerSnapshot().activeBackground, 16);
    assert.equal(runtime.schedulerSnapshot().activeOutgoing, 0);

    const outgoing = translate({
      accountId: 'account-b',
      text: 'interactive-send',
      target: 'it',
      intent: 'outgoing-send',
      refresh: true,
      deadlineAt: Date.now() + 5000,
    });
    await waitFor(() => starts.includes('interactive-send'), 'outgoing send to enter gateway without waiting for background release');
    assert.equal(starts.indexOf('interactive-send'), 16, 'outgoing must take reserved capacity ahead of queued background work');
    assert.equal(runtime.schedulerSnapshot().activeOutgoing, 1);

    outgoingGate.resolve();
    await outgoing;
    backgroundGate.resolve();
    await Promise.all(background);

    // An interactive request with the same text as an in-flight display request
    // must not join the background singleflight transaction.
    const sameTextGate = deferred();
    let sameTextCalls = 0;
    runtime.dispose();

    const handlers2 = new Map();
    const runtime2 = createTranslationRuntime({
      ipcMain: {
        handle(channel, handler) { handlers2.set(channel, handler); },
        removeHandler(channel) { handlers2.delete(channel); },
      },
      fs: { readFile: async () => '', appendFile: async () => {} },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(String(value)),
        decryptString: value => Buffer.from(value).toString(),
      },
      getUserDataDir: () => '/tmp/geek-translation-priority-singleflight',
      accountState: { findById(id) { return accounts.get(id) || null; } },
      createGatewayPool: () => ({
        endpoints: ['https://translate.example.test'],
        healthCheckAll: async () => ({ 'https://translate.example.test': true }),
        pick: () => ({ endpoint: 'https://translate.example.test', route: 'primary' }),
        reportFailure() {}, reportSuccess() {},
      }),
      assertSafeTranslationOutput: ({ output }) => output,
      assertTrustedSender() {},
      assertValidAccountId(id) { if (!accounts.has(id)) throw new Error('unknown account'); },
      getSubscriptionStore: () => ({
        getQuota: async () => ({ remaining_chars: null }),
        getTranslationToken: async () => 'translation-token',
      }),
      fetchImpl: async (_url, request) => {
        sameTextCalls += 1;
        const body = JSON.parse(request.body || '{}');
        await sameTextGate.promise;
        return successResponse(`translated:${body.text}:${sameTextCalls}`);
      },
      randomUUID: (() => { let n = 0; return () => `priority-singleflight-${++n}`; })(),
    });
    runtime2.install();
    const raw2 = handlers2.get('translation:translate');
    const event2 = mainFrameIpcEvent({ id: 2 });
    const translate2 = async payload => unwrapTranslationIpcResponse(await raw2(event2, payload));
    const display = translate2({ accountId: 'account-a', text: 'same-text', target: 'it', intent: 'message-display', refresh: true, deadlineAt: Date.now() + 5000 });
    await waitFor(() => sameTextCalls === 1, 'background same-text gateway request');
    const send = translate2({ accountId: 'account-a', text: 'same-text', target: 'it', intent: 'outgoing-send', refresh: true, deadlineAt: Date.now() + 5000 });
    await waitFor(() => sameTextCalls === 2, 'outgoing same-text independent gateway request');
    sameTextGate.resolve();
    await Promise.all([display, send]);
    runtime2.dispose();

    console.log('TRANSLATION_RUNTIME_PRIORITY_INTEGRATION_CONTRACT_OK');
  } finally {
    backgroundGate.resolve();
    outgoingGate.resolve();
    try { runtime.dispose(); } catch {}
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
