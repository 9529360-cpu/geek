'use strict';

const assert = require('node:assert/strict');
const {
  TRANSLATION_REMOTE_LIMIT,
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
  for (let attempt = 0; attempt < 400; attempt += 1) {
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
  const releaseRemote = deferred();
  const accounts = new Map([
    ['account-a', { partition: 'persist:deadline-account-a' }],
    ['account-b', { partition: 'persist:deadline-account-b' }],
  ]);
  const fetchBodies = [];

  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: {
      readFile: async () => '',
      appendFile: async () => {},
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-queue-deadline',
    accountState: {
      findById(accountId) { return accounts.get(accountId) || null; },
    },
    createGatewayPool: () => ({
      endpoints: ['https://translate.example.test'],
      healthCheckAll: async () => ({ 'https://translate.example.test': true }),
      pick: () => ({ endpoint: 'https://translate.example.test', route: 'primary' }),
      reportFailure() {},
      reportSuccess() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId(accountId) {
      if (!accounts.has(accountId)) throw new Error('unknown account');
    },
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => 'translation-token',
    }),
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body || '{}');
      fetchBodies.push(body);
      await releaseRemote.promise;
      return successResponse(`translated:${body.text}`);
    },
    randomUUID: (() => {
      let sequence = 0;
      return () => `queue-deadline-${++sequence}`;
    })(),
  });

  runtime.install();
  const rawTranslate = handlers.get('translation:translate');
  const event = mainFrameIpcEvent({ id: 1 });
  const translate = async payload => unwrapTranslationIpcResponse(await rawTranslate(event, payload));

  try {
    assert.equal(TRANSLATION_REMOTE_LIMIT, 20, 'contract assumes the current bounded remote pool size');

    // Fill every remote slot with explicit interactive work so the next request
    // must remain queued. Background intentionally cannot consume all 20 slots.
    const active = Array.from({ length: TRANSLATION_REMOTE_LIMIT }, (_, index) => translate({
      accountId: 'account-a',
      text: `occupy-slot-${index}`,
      target: 'it',
      intent: 'outgoing-send',
      skipQuota: true,
      refresh: true,
      deadlineAt: Date.now() + 5000,
    }));

    await waitFor(() => fetchBodies.length === TRANSLATION_REMOTE_LIMIT, 'all remote slots to become active');

    const queued = translate({
      accountId: 'account-b',
      text: 'must-expire-in-queue',
      target: 'it',
      intent: 'outgoing-send',
      skipQuota: true,
      refresh: true,
      deadlineAt: Date.now() + 120,
    });

    await assert.rejects(
      queued,
      error => error?.code === 'TRANSLATION_DEADLINE_EXCEEDED' && error?.category === 'deadline',
      'queue wait must consume the original caller deadline',
    );
    assert.equal(
      fetchBodies.length,
      TRANSLATION_REMOTE_LIMIT,
      'an expired queued request must never start a gateway call',
    );

    releaseRemote.resolve();
    const settled = await Promise.all(active);
    assert.equal(settled.length, TRANSLATION_REMOTE_LIMIT);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(
      fetchBodies.length,
      TRANSLATION_REMOTE_LIMIT,
      'releasing capacity after expiry must not resurrect the removed request',
    );
    assert.equal(
      fetchBodies.some(body => body.text === 'must-expire-in-queue'),
      false,
      'expired account-B work must not cross the expensive gateway boundary',
    );

    console.log('TRANSLATION_RUNTIME_QUEUE_DEADLINE_CONTRACT_OK');
  } finally {
    releaseRemote.resolve();
    runtime.dispose();
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
