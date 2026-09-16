'use strict';

const assert = require('node:assert/strict');
const { createTranslationRuntime, unwrapTranslationIpcResponse } = require('../src/translation-runtime.cjs');
const { mainFrameIpcEvent } = require('./helpers/main-frame-ipc-event.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function responseFor(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ text: `translated:${body.text}`, source: 'auto', target: body.target }),
  };
}

function createHarness(options = {}) {
  const handlers = new Map();
  const accounts = options.accounts || new Map([['account-a', { partition: 'persist:account-a' }]]);
  const quotaGate = options.quotaGate || null;
  const tokenGate = options.tokenGate || null;
  const fetchGate = options.fetchGate || null;
  const fetchBehavior = options.fetchBehavior || null;
  const calls = {
    quota: 0,
    token: 0,
    uuid: 0,
    fetch: [],
  };

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
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-remote-singleflight',
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
      if (!accountId) throw new Error('missing account');
    },
    getSubscriptionStore: () => ({
      async getQuota() {
        calls.quota += 1;
        if (quotaGate) return quotaGate.promise;
        return { remaining_chars: null };
      },
      async getTranslationToken() {
        calls.token += 1;
        if (tokenGate) return tokenGate.promise;
        return 'translation-token';
      },
    }),
    fetchImpl: async (url, request) => {
      const body = JSON.parse(request.body || '{}');
      calls.fetch.push({ url, request, body });
      if (fetchGate) await fetchGate.promise;
      if (fetchBehavior) return fetchBehavior({ url, request, body, index: calls.fetch.length - 1 });
      return responseFor(body);
    },
    randomUUID: () => `singleflight-request-${++calls.uuid}`,
  });
  runtime.install();
  const translateIpc = handlers.get('translation:translate');
  return {
    runtime,
    translate: async (event, payload) => unwrapTranslationIpcResponse(await translateIpc(event, payload)),
    event: mainFrameIpcEvent({ id: 1 }),
    calls,
  };
}

(async () => {
  // The authoritative in-flight promise must be visible before quota/token/network
  // preflight can fan out. A cold burst of identical work therefore owns exactly
  // one quota check, token acquisition, request id and billable gateway call.
  {
    const quotaGate = deferred();
    const tokenGate = deferred();
    const fetchGate = deferred();
    const h = createHarness({ quotaGate, tokenGate, fetchGate });
    const payload = { accountId: 'account-a', text: 'same cold message', target: 'it' };
    const pending = Array.from({ length: 25 }, () => h.translate(h.event, payload));

    await waitFor(() => h.calls.quota > 0, 'leader quota preflight');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.quota, 1, '25 identical callers must share one quota preflight');
    assert.equal(h.calls.uuid, 1, 'request identity must be allocated once for the shared leader');

    quotaGate.resolve({ remaining_chars: 100000 });
    await waitFor(() => h.calls.token > 0, 'leader token preflight');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.token, 1, '25 identical callers must share one translation-token acquisition at runtime level');

    tokenGate.resolve('shared-translation-token');
    await waitFor(() => h.calls.fetch.length > 0, 'leader gateway call');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.fetch.length, 1, '25 identical callers must create one billable gateway request');
    const requestId = h.calls.fetch[0].request.headers['X-Request-ID'];
    assert.equal(requestId, 'singleflight-request-1');

    fetchGate.resolve();
    const results = await Promise.all(pending);
    assert.equal(new Set(results.map(result => result.requestId)).size, 1, 'followers must receive the leader request identity');
    assert.ok(results.every(result => result.requestId === requestId));
    assert.ok(results.every(result => result.text === 'translated:same cold message'));
    h.runtime.dispose();
  }

  // A failed leader must release the key. Followers share the same failure, while
  // a later legitimate retry receives a new request id and performs fresh work.
  {
    let failFirst = true;
    const h = createHarness({
      fetchBehavior: ({ body }) => {
        if (failFirst) {
          failFirst = false;
          throw new Error('synthetic gateway failure');
        }
        return responseFor(body);
      },
    });
    const payload = { accountId: 'account-a', text: 'retry after failure', target: 'it', skipQuota: true };
    const first = h.translate(h.event, payload);
    const follower = h.translate(h.event, payload);
    const failures = await Promise.allSettled([first, follower]);
    assert.ok(failures.every(result => result.status === 'rejected'), 'followers must share the failed leader outcome');
    assert.equal(h.calls.fetch.length, 1, 'shared failure must still perform one gateway attempt');
    assert.equal(h.calls.uuid, 1, 'shared failure must own one request id');

    const retry = await h.translate(h.event, payload);
    assert.equal(retry.text, 'translated:retry after failure');
    assert.equal(h.calls.fetch.length, 2, 'later retry must not remain pinned to failed singleflight state');
    assert.equal(h.calls.uuid, 2, 'later retry must receive a fresh request id');
    h.runtime.dispose();
  }

  // Same cache identity in two account partitions is intentionally independent.
  {
    const fetchGate = deferred();
    const accounts = new Map([
      ['account-a', { partition: 'persist:account-a' }],
      ['account-b', { partition: 'persist:account-b' }],
    ]);
    const h = createHarness({ accounts, fetchGate });
    const a = h.translate(h.event, { accountId: 'account-a', text: 'same text', target: 'it', skipQuota: true });
    const b = h.translate(h.event, { accountId: 'account-b', text: 'same text', target: 'it', skipQuota: true });
    await waitFor(() => h.calls.fetch.length === 2, 'two partition-owned gateway calls');
    assert.equal(h.calls.uuid, 2, 'different account partitions must own distinct request identities');
    assert.equal(new Set(h.calls.fetch.map(call => call.request.headers['X-Request-ID'])).size, 2);
    fetchGate.resolve();
    const [resultA, resultB] = await Promise.all([a, b]);
    assert.notEqual(resultA.requestId, resultB.requestId);
    h.runtime.dispose();
  }

  // Refresh is deliberately a new translation, not a follower of an existing
  // refresh. Keep that product semantic explicit so future refactors do not
  // accidentally turn manual refresh into cached/singleflight reuse.
  {
    const fetchGate = deferred();
    const h = createHarness({ fetchGate });
    const payload = { accountId: 'account-a', text: 'manual refresh', target: 'it', skipQuota: true, refresh: true };
    const first = h.translate(h.event, payload);
    const second = h.translate(h.event, payload);
    await waitFor(() => h.calls.fetch.length === 2, 'independent refresh gateway calls');
    assert.equal(h.calls.uuid, 2, 'concurrent refresh requests must keep independent request identities');
    fetchGate.resolve();
    const results = await Promise.all([first, second]);
    assert.equal(results.length, 2);
    assert.equal(new Set(results.map(result => result.requestId)).size, 2);
    h.runtime.dispose();
  }

  console.log('TRANSLATION_REMOTE_SINGLEFLIGHT_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
