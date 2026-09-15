'use strict';

const assert = require('node:assert/strict');
const { createGatewayPool } = require('../src/gateway-failover.cjs');
const {
  classifyGatewayResponse,
  createTranslationRuntime,
  unwrapTranslationIpcResponse,
} = require('../src/translation-runtime.cjs');

const PRIMARY = 'https://primary.example.test';
const BACKUP = 'https://backup.example.test';

(async () => {
  const inProgress = classifyGatewayResponse(409, { error: 'request_in_progress' });
  assert.equal(inProgress.code, 'TRANSLATION_REQUEST_IN_PROGRESS', 'in-progress must have a dedicated runtime code');
  assert.equal(inProgress.category, 'reconcile', 'in-progress must not be collapsed into terminal conflict');
  assert.equal(inProgress.retryable, true, 'in-progress must remain recoverable inside the logical request deadline');
  assert.equal(inProgress.endpointFailure, false, 'in-progress is shared operation state, not endpoint health failure');

  const terminalConflict = classifyGatewayResponse(409, { error: 'request_conflict' });
  assert.equal(terminalConflict.category, 'conflict');
  assert.equal(terminalConflict.retryable, false, 'semantic request conflict must remain terminal');

  const handlers = new Map();
  const calls = [];
  let backupPolls = 0;
  const fetchImpl = async (url, options = {}) => {
    const endpoint = String(url).startsWith(PRIMARY) ? PRIMARY : BACKUP;
    calls.push({
      endpoint,
      requestId: String(options.headers?.['X-Request-ID'] || ''),
      payload: JSON.parse(String(options.body || '{}')),
    });

    if (endpoint === PRIMARY) {
      throw new Error('simulated_unknown_primary_transport_outcome');
    }

    backupPolls += 1;
    if (backupPolls === 1) {
      return new Response(JSON.stringify({ error: 'request_in_progress' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      text: 'ciao',
      source: 'en',
      target: 'it',
      engine: 'gemini',
      route: 'primary',
      replayed: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: {
      async readFile() { throw Object.assign(new Error('missing cache'), { code: 'ENOENT' }); },
      async appendFile() {},
      async mkdir() {},
      async rename() {},
      async writeFile() {},
      async rm() {},
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-runtime-in-progress-reconciliation',
    accountState: { findById: () => ({ partition: 'persist:in-progress-reconciliation' }) },
    createGatewayPool,
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId() {},
    getSubscriptionStore: () => ({
      async getQuota() { return { remaining_chars: null }; },
      async getTranslationToken() { return 'test-token'; },
    }),
    fetchImpl,
    env: { GEEK_TRANSLATION_GATEWAY_URL: `${PRIMARY},${BACKUP}` },
    randomUUID: () => '22222222-2222-4222-8222-222222222222',
  });
  runtime.install();

  const rawTranslate = handlers.get('translation:translate');
  const result = unwrapTranslationIpcResponse(await rawTranslate({ sender: { id: 7 } }, {
    accountId: 'account-a',
    text: 'hello',
    source: 'en',
    target: 'it',
    route: 'default',
    refresh: true,
    skipQuota: true,
    deadlineAt: Date.now() + 3000,
  }));

  assert.equal(result.text, 'ciao', 'desktop must poll a shared in-progress operation until its replay becomes available');
  assert.equal(calls.length, 3, 'one unknown primary outcome plus one in-progress poll must still reach a replay result');
  assert.deepEqual(calls.map(call => call.endpoint), [PRIMARY, BACKUP, BACKUP]);
  assert.deepEqual(
    calls.map(call => call.requestId),
    Array(3).fill('22222222-2222-4222-8222-222222222222'),
    'all reconciliation polls must preserve one logical operation identity'
  );
  assert.deepEqual(
    calls.map(call => call.payload.operationRoute),
    Array(3).fill('default'),
    'physical failover and reconciliation polling must not change operation semantics'
  );

  runtime.dispose();
  console.log('TRANSLATION_RUNTIME_IN_PROGRESS_RECONCILIATION_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
