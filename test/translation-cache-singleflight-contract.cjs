'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  TRANSLATION_CACHE_VERSION,
  TRANSLATION_CACHE_TTL_MS,
  unwrapTranslationIpcResponse,
  createTranslationRuntime,
} = require('../src/translation-runtime.cjs');
const { mainFrameIpcEvent } = require('./helpers/main-frame-ipc-event.cjs');

const CACHE_NOW = Date.UTC(2026, 8, 24, 18, 0, 0);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function cacheKey(text, target = 'en') {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: TRANSLATION_CACHE_VERSION,
    text,
    source: 'auto',
    target,
    provider: 'auto',
    route: 'default',
  })).digest('hex');
}

function cacheRecord(text, translated, target = 'en', at = CACHE_NOW - 1000) {
  return JSON.stringify({
    version: TRANSLATION_CACHE_VERSION,
    key: cacheKey(text, target),
    at,
    value: Buffer.from(translated).toString('base64'),
  }) + '\n';
}

function createHarness({
  accounts,
  readFile,
  quotaResult = { remaining_chars: null },
  nowMs = CACHE_NOW,
  remoteGateway = false,
  gatewayRemainingChars = null,
  gatewayStatus = 200,
  gatewayError = 'quota_exhausted',
}) {
  const handlers = new Map();
  let fetchCount = 0;
  let quotaState = { ...quotaResult };
  const acceptedQuota = [];
  const acceptedQuotaOptions = [];
  let quotaInvalidations = 0;
  const authorizationController = new AbortController();
  const subscriptionStore = {
    getQuota: async () => quotaState,
    getTranslationToken: async () => 'translation-token',
    getTranslationAuthorization: async () => ({
      token: 'translation-token',
      generation: 1,
      signal: authorizationController.signal,
    }),
    assertTranslationAuthorizationCurrent: () => {},
    acceptAuthoritativeQuota: async (remainingChars, options = {}) => {
      quotaState = { ...quotaState, remaining_chars: remainingChars };
      acceptedQuota.push(remainingChars);
      acceptedQuotaOptions.push({ ...options });
      return quotaState;
    },
    invalidateQuotaAuthority: () => {
      quotaState = { ...quotaState, remaining_chars: null };
      quotaInvalidations += 1;
    },
  };
  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: {
      readFile,
      appendFile: async () => {},
      mkdir: async () => {},
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-cache-singleflight',
    accountState: {
      findById(accountId) { return accounts.get(accountId) || null; },
    },
    createGatewayPool: () => {
      const endpoint = remoteGateway ? 'https://translate.invalid' : 'http://127.0.0.1:8787';
      return {
        endpoints: [endpoint],
        healthCheckAll: async () => ({ local: !remoteGateway }),
        pick: () => ({ endpoint, route: 'primary' }),
        reportFailure() {},
        reportSuccess() {},
      };
    },
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender: () => {},
    assertValidAccountId: () => {},
    getSubscriptionStore: () => subscriptionStore,
    fetchImpl: async (_url, options) => {
      fetchCount += 1;
      const body = JSON.parse(options.body || '{}');
      return {
        ok: gatewayStatus >= 200 && gatewayStatus < 300,
        status: gatewayStatus,
        text: async () => JSON.stringify(gatewayStatus >= 200 && gatewayStatus < 300 ? {
          text: `remote:${body.text}`,
          source: 'auto',
          target: body.target,
          remaining_chars: gatewayRemainingChars,
        } : {
          error: gatewayError,
          message: 'synthetic gateway rejection',
        }),
      };
    },
    randomUUID: (() => { let id = 0; return () => `request-${++id}`; })(),
    now: () => nowMs,
  });
  runtime.install();
  const translateIpc = handlers.get('translation:translate');
  return {
    runtime,
    translate: async (event, payload) => unwrapTranslationIpcResponse(await translateIpc(event, payload)),
    fetchCount: () => fetchCount,
    quotaRemaining: () => quotaState.remaining_chars,
    acceptedQuota: () => [...acceptedQuota],
    acceptedQuotaOptions: () => acceptedQuotaOptions.map(item => ({ ...item })),
    quotaInvalidations: () => quotaInvalidations,
    event: mainFrameIpcEvent({ id: 1 }),
  };
}

(async () => {
  {
    const partition = 'persist:webview-page-singleflight';
    const accounts = new Map([['account-a', { partition }]]);
    const disk = deferred();
    let readCount = 0;
    const harness = createHarness({
      accounts,
      readFile: async () => {
        readCount += 1;
        return disk.promise;
      },
    });
    const payload = { accountId: 'account-a', text: 'hello', target: 'en', skipQuota: true };
    const first = harness.translate(harness.event, payload);
    const second = harness.translate(harness.event, payload);

    await waitFor(() => readCount === 1, 'single cold cache read');
    assert.equal(readCount, 1, 'same-partition cold translations must share one cache load');
    assert.equal(harness.fetchCount(), 0, 'no remote request may start while the shared persisted cache load is unresolved');

    disk.resolve(cacheRecord('hello', 'cached:hello'));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.text, 'cached:hello');
    assert.equal(secondResult.text, 'cached:hello');
    assert.equal(firstResult.cached, true);
    assert.equal(secondResult.cached, true);
    assert.equal(harness.fetchCount(), 0, 'all same-partition followers must observe the populated cache before remote decisions');
    harness.runtime.dispose();
  }

  {
    const partitionA = 'persist:webview-page-parallel-a';
    const partitionB = 'persist:webview-page-parallel-b';
    const accounts = new Map([
      ['account-a', { partition: partitionA }],
      ['account-b', { partition: partitionB }],
    ]);
    const gates = new Map([
      ['webview-page-parallel-a', deferred()],
      ['webview-page-parallel-b', deferred()],
    ]);
    const started = [];
    const harness = createHarness({
      accounts,
      readFile: async file => {
        const owner = [...gates.keys()].find(name => String(file).includes(name));
        assert.ok(owner, `unexpected cache file ${file}`);
        started.push(owner);
        return gates.get(owner).promise;
      },
    });
    const first = harness.translate(harness.event, { accountId: 'account-a', text: 'A', target: 'en', skipQuota: true });
    const second = harness.translate(harness.event, { accountId: 'account-b', text: 'B', target: 'en', skipQuota: true });

    await waitFor(() => started.length === 2, 'parallel partition cache reads');
    assert.deepEqual(new Set(started), new Set(['webview-page-parallel-a', 'webview-page-parallel-b']), 'different partitions must not share or serialize cache initialization');
    gates.get('webview-page-parallel-a').resolve(cacheRecord('A', 'cached:A'));
    gates.get('webview-page-parallel-b').resolve(cacheRecord('B', 'cached:B'));
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.text, 'cached:A');
    assert.equal(b.text, 'cached:B');
    assert.equal(harness.fetchCount(), 0);
    harness.runtime.dispose();
  }

  {
    const partition = 'persist:webview-page-delete-during-load';
    const accounts = new Map([['account-a', { partition }]]);
    const disk = deferred();
    let readCount = 0;
    const harness = createHarness({
      accounts,
      readFile: async () => {
        readCount += 1;
        return disk.promise;
      },
    });
    const pending = harness.translate(harness.event, { accountId: 'account-a', text: 'deleted', target: 'en', skipQuota: true });
    await waitFor(() => readCount === 1, 'deletion race cache read');
    harness.runtime.deleteAccount(partition);
    disk.resolve(cacheRecord('deleted', 'must-not-return'));

    await assert.rejects(
      pending,
      error => error?.code === 'TRANSLATION_ACCOUNT_DELETED',
      'account deletion during a cache load must invalidate the pending caller instead of returning stale cached data',
    );
    assert.equal(harness.fetchCount(), 0, 'deleted partition must never fall through to remote translation after its cache load settles');
    await assert.rejects(
      () => harness.translate(harness.event, { accountId: 'account-a', text: 'deleted-again', target: 'en', skipQuota: true }),
      error => error?.code === 'TRANSLATION_ACCOUNT_DELETED',
      'deleted partition must stay invalid after the old disk load completes',
    );
    assert.equal(readCount, 1, 'stale cache load completion must not resurrect disk cache authority');
    harness.runtime.dispose();
  }

  {
    const accounts = new Map([['account-a', { partition: 'persist:webview-page-quota-zero-cache' }]]);
    const harness = createHarness({
      accounts,
      readFile: async () => cacheRecord('quota-zero', 'cached:quota-zero'),
      quotaResult: { remaining_chars: 0 },
    });
    await assert.rejects(
      () => harness.translate(harness.event, { accountId: 'account-a', text: 'quota-zero', target: 'en' }),
      error => error?.code === 'QUOTA_EXHAUSTED',
      'zero authorized quota must block a warm cache hit',
    );
    assert.equal(harness.fetchCount(), 0, 'zero quota must fail before cache or remote provider output is returned');
    harness.runtime.dispose();
  }

  {
    const accounts = new Map([['account-a', { partition: 'persist:webview-page-positive-cache' }]]);
    const harness = createHarness({
      accounts,
      readFile: async () => cacheRecord('positive-cache', 'cached:positive-cache'),
      quotaResult: { remaining_chars: 100 },
    });
    const result = await harness.translate(harness.event, { accountId: 'account-a', text: 'positive-cache', target: 'en' });
    assert.equal(result.cached, true, 'positive authorized quota may use a valid cache hit');
    assert.equal(result.text, 'cached:positive-cache');
    assert.equal(harness.fetchCount(), 0, 'valid cache hit must avoid another provider request');
    harness.runtime.dispose();
  }

  {
    const accounts = new Map([['account-a', { partition: 'persist:webview-page-stale-cache' }]]);
    const staleAt = CACHE_NOW - TRANSLATION_CACHE_TTL_MS - 1;
    const harness = createHarness({
      accounts,
      readFile: async () => cacheRecord('stale-cache', 'must-expire', 'en', staleAt),
      quotaResult: { remaining_chars: 100 },
    });
    const result = await harness.translate(harness.event, { accountId: 'account-a', text: 'stale-cache', target: 'en' });
    assert.equal(result.cached, false, 'cache older than the production TTL must not be served');
    assert.equal(result.text, 'remote:stale-cache');
    assert.equal(harness.fetchCount(), 1, 'expired cache must fall through to a fresh provider translation');
    harness.runtime.dispose();
  }

  {
    const accounts = new Map([['account-a', { partition: 'persist:webview-page-remote-quota-exhausted' }]]);
    const harness = createHarness({
      accounts,
      readFile: async () => {
        const error = new Error('missing cache');
        error.code = 'ENOENT';
        throw error;
      },
      quotaResult: { remaining_chars: 9 },
      remoteGateway: true,
      gatewayStatus: 402,
      gatewayError: 'quota_exhausted',
    });
    await assert.rejects(
      () => harness.translate(harness.event, { accountId: 'account-a', text: 'remote-quota-exhausted', target: 'en' }),
      error => error?.category === 'quota' && error?.status === 402,
      'authoritative remote quota exhaustion must remain the typed terminal error',
    );
    assert.deepEqual(harness.acceptedQuota(), [0], 'remote quota exhaustion must immediately reconcile local quota authority to zero');
    assert.equal(harness.acceptedQuotaOptions()[0]?.expectedSessionGeneration, 1, 'zero reconciliation must remain bound to the authorization session generation');
    assert.equal(harness.quotaRemaining(), 0);
    const fetchesAfter402 = harness.fetchCount();
    await assert.rejects(
      () => harness.translate(harness.event, { accountId: 'account-a', text: 'after-remote-zero', target: 'en' }),
      error => error?.code === 'QUOTA_EXHAUSTED',
      'subsequent work must fail fast from the reconciled zero authority',
    );
    assert.equal(harness.fetchCount(), fetchesAfter402, 'reconciled zero quota must prevent another gateway request');
    harness.runtime.dispose();
  }

  {
    const accounts = new Map([['account-a', { partition: 'persist:webview-page-nonquota-402' }]]);
    const harness = createHarness({
      accounts,
      readFile: async () => {
        const error = new Error('missing cache');
        error.code = 'ENOENT';
        throw error;
      },
      quotaResult: { remaining_chars: 9 },
      remoteGateway: true,
      gatewayStatus: 402,
      gatewayError: 'payment_required',
    });
    await assert.rejects(
      () => harness.translate(harness.event, { accountId: 'account-a', text: 'nonquota-402', target: 'en' }),
      error => error?.category === 'quota' && error?.status === 402,
      'other 402 responses keep the existing typed payment/quota rejection semantics',
    );
    assert.deepEqual(harness.acceptedQuota(), [], 'a non quota_exhausted 402 must not manufacture a zero-balance authority');
    assert.equal(harness.quotaRemaining(), 9);
    assert.equal(harness.fetchCount(), 1);
    harness.runtime.dispose();
  }

  {
    const accounts = new Map([['account-a', { partition: 'persist:webview-page-authoritative-zero' }]]);
    const harness = createHarness({
      accounts,
      readFile: async () => {
        const error = new Error('missing cache');
        error.code = 'ENOENT';
        throw error;
      },
      quotaResult: { remaining_chars: 9 },
      remoteGateway: true,
      gatewayRemainingChars: 0,
    });
    const first = await harness.translate(harness.event, { accountId: 'account-a', text: 'last-quota', target: 'en' });
    assert.equal(first.text, 'remote:last-quota');
    assert.equal(first.cached, false);
    assert.deepEqual(harness.acceptedQuota(), [0], 'post-commit gateway balance must become the current client quota authority');
    assert.equal(harness.quotaRemaining(), 0);
    await assert.rejects(
      () => harness.translate(harness.event, { accountId: 'account-a', text: 'last-quota', target: 'en' }),
      error => error?.code === 'QUOTA_EXHAUSTED',
      'the translation that consumes the final quota may return, but its new cache entry must not bypass zero balance afterwards',
    );
    assert.equal(harness.fetchCount(), 1, 'zero authoritative balance must block before a second provider request');
    harness.runtime.dispose();
  }

  {
    const accounts = new Map([['account-a', { partition: 'persist:webview-page-unknown-balance' }]]);
    const harness = createHarness({
      accounts,
      readFile: async () => {
        const error = new Error('missing cache');
        error.code = 'ENOENT';
        throw error;
      },
      quotaResult: { remaining_chars: 9 },
      remoteGateway: true,
      gatewayRemainingChars: null,
    });
    const first = await harness.translate(harness.event, { accountId: 'account-a', text: 'rolling-gateway', target: 'en' });
    assert.equal(first.cached, false);
    assert.equal(harness.quotaInvalidations(), 1, 'missing post-commit balance must invalidate current quota authority');
    const second = await harness.translate(harness.event, { accountId: 'account-a', text: 'rolling-gateway', target: 'en' });
    assert.equal(second.cached, false, 'unknown quota authority must not serve an otherwise valid warm cache hit');
    assert.equal(harness.fetchCount(), 2, 'unknown quota authority must fall through to the server gate');
    harness.runtime.dispose();
  }

  console.log('TRANSLATION_CACHE_SINGLEFLIGHT_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
