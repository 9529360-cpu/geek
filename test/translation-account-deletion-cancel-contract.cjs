'use strict';

const assert = require('node:assert/strict');
const { createTranslationRuntime, unwrapTranslationIpcResponse } = require('../src/translation-runtime.cjs');

function successResponse(text) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ text, source: 'auto', target: 'en' }),
  };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

(async () => {
  const handlers = new Map();
  const partitionA = 'persist:webview-page-a';
  const partitionB = 'persist:webview-page-b';
  let aFetches = 0;
  let aAborts = 0;
  let bFetches = 0;
  let gatewayFailures = 0;

  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
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
    getUserDataDir: () => '/tmp/geek-translation-delete-test',
    accountState: {
      findById(accountId) {
        if (accountId === 'account-a') return { partition: partitionA };
        if (accountId === 'account-b') return { partition: partitionB };
        return null;
      },
    },
    createGatewayPool: () => ({
      endpoints: ['http://127.0.0.1:8787'],
      healthCheckAll: async () => ({ local: true }),
      pick: () => ({ endpoint: 'http://127.0.0.1:8787', route: 'primary' }),
      reportFailure() { gatewayFailures += 1; },
      reportSuccess() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender: () => {},
    assertValidAccountId: () => {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => '',
    }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body || '{}');
      if (String(body.text || '').startsWith('A-')) {
        aFetches += 1;
        return new Promise((resolve, reject) => {
          const abort = () => {
            aAborts += 1;
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (options.signal.aborted) abort();
          else options.signal.addEventListener('abort', abort, { once: true });
        });
      }
      if (body.text === 'B-work') {
        bFetches += 1;
        return successResponse('B-ok');
      }
      throw new Error(`unexpected translation text: ${body.text}`);
    },
    randomUUID: (() => { let id = 0; return () => `request-${++id}`; })(),
  });

  runtime.install();
  const translateIpc = handlers.get('translation:translate');
  assert.equal(typeof translateIpc, 'function');
  const translate = async (event, payload) => unwrapTranslationIpcResponse(await translateIpc(event, payload));
  const event = { sender: { id: 1 } };

  const aRequests = Array.from({ length: 21 }, (_, index) => translate(event, {
    accountId: 'account-a',
    text: `A-${index}`,
    target: 'en',
    refresh: true,
    skipQuota: true,
  }));
  const bRequest = translate(event, {
    accountId: 'account-b',
    text: 'B-work',
    target: 'en',
    refresh: true,
    skipQuota: true,
  });

  await waitFor(() => aFetches === 20, '20 active A translations');
  assert.equal(bFetches, 0, 'B should still be queued while all 20 remote slots belong to A');

  runtime.deleteAccount(partitionA);

  const aResults = await Promise.allSettled(aRequests);
  const bResult = await bRequest;

  assert.equal(aFetches, 20, 'queued A work must be rejected before starting a 21st fetch');
  assert.equal(aAborts, 20, 'every active A fetch must receive an abort signal');
  assert.equal(gatewayFailures, 0, 'account deletion must not mark the gateway unhealthy');
  for (const result of aResults) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason?.code, 'TRANSLATION_ACCOUNT_DELETED');
    assert.match(String(result.reason?.message || result.reason), /翻译账号已删除/);
  }
  assert.equal(bFetches, 1, 'B must start after A cancellation releases remote capacity');
  assert.equal(bResult.text, 'B-ok', 'deleting A must not cancel or corrupt B work');

  await assert.rejects(
    () => translate(event, { accountId: 'account-a', text: 'A-after-delete', target: 'en', refresh: true, skipQuota: true }),
    error => error?.code === 'TRANSLATION_ACCOUNT_DELETED',
    'new A work must fail before reaching the remote queue after deletion',
  );
  assert.equal(aFetches, 20, 'deleted A must not start new remote fetches');

  runtime.dispose();
  console.log('TRANSLATION_ACCOUNT_DELETION_CANCEL_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
