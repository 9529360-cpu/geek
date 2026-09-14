'use strict';
const assert = require('node:assert/strict');
const {
  classifyGatewayResponse,
  normalizeTranslationDeadline,
  createTranslationRuntime,
} = require('../src/translation-runtime.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function baseRuntime(overrides = {}) {
  const handlers = new Map();
  const reports = { failure: [], success: [] };
  const tokenGate = overrides.tokenGate || deferred();
  let tokenCalls = 0;
  let fetchCalls = 0;
  const endpoints = overrides.endpoints || ['https://primary.test'];
  let pickIndex = 0;
  const runtime = createTranslationRuntime({
    ipcMain: { handle: (c,h) => handlers.set(c,h), removeHandler: c => handlers.delete(c) },
    fs: { readFile: async () => '', appendFile: async () => {} },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: v => Buffer.from(v), decryptString: v => Buffer.from(v).toString() },
    getUserDataDir: () => '/tmp/geek-wave1',
    accountState: { findById: () => ({ partition: 'persist:a' }) },
    createGatewayPool: () => ({
      endpoints,
      healthCheckAll: async () => Object.fromEntries(endpoints.map(x => [x, true])),
      pick: () => ({ endpoint: endpoints[Math.min(pickIndex++, endpoints.length - 1)], route: pickIndex === 1 ? 'primary' : 'backup' }),
      reportFailure: endpoint => reports.failure.push(endpoint),
      reportSuccess: endpoint => reports.success.push(endpoint),
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender: () => {},
    assertValidAccountId: () => {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => { tokenCalls += 1; return tokenGate.promise; },
    }),
    fetchImpl: async (...args) => {
      fetchCalls += 1;
      return overrides.fetchImpl ? overrides.fetchImpl(...args) : { ok: true, status: 200, text: async () => JSON.stringify({ text: 'ciao', target: 'it' }) };
    },
    randomUUID: (() => { let i = 0; return () => `request-${++i}`; })(),
  });
  runtime.install();
  return { runtime, translate: handlers.get('translation:translate'), tokenGate, tokenCalls: () => tokenCalls, fetchCalls: () => fetchCalls, reports };
}

(async () => {
  {
    const e = classifyGatewayResponse(429, { error: 'rate_limited' });
    assert.equal(e.category, 'rate-limit');
    assert.equal(e.endpointFailure, false);
    assert.equal(e.retryable, true);
    const e2 = classifyGatewayResponse(503, { error: 'upstream_unavailable' });
    assert.equal(e2.endpointFailure, true);
    assert.equal(e2.retryable, true);
  }
  {
    const now = 1000;
    assert.equal(normalizeTranslationDeadline(999999, now, 30000), 31000);
    assert.equal(normalizeTranslationDeadline(5000, now, 30000), 5000);
  }
  {
    const h = baseRuntime();
    const payload = { accountId: 'a', text: 'hello', target: 'it', skipQuota: true };
    const a = h.translate({}, payload);
    const b = h.translate({}, payload);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.tokenCalls(), 1, 'same request must coalesce before translation-token preflight');
    assert.equal(h.fetchCalls(), 0);
    h.tokenGate.resolve('token');
    const [ra, rb] = await Promise.all([a,b]);
    assert.equal(ra.text, 'ciao');
    assert.equal(rb.text, 'ciao');
    assert.equal(h.fetchCalls(), 1);
    assert.equal(ra.requestId, rb.requestId);
    h.runtime.dispose();
  }
  {
    const h = baseRuntime();
    const started = Date.now();
    await assert.rejects(
      h.translate({}, { accountId: 'a', text: 'slow', target: 'it', skipQuota: true, deadlineAt: Date.now() + 35 }),
      error => error?.code === 'TRANSLATION_DEADLINE_EXCEEDED' && error?.category === 'deadline'
    );
    assert.ok(Date.now() - started < 500, 'caller deadline must include auth/preflight wait');
    assert.equal(h.fetchCalls(), 0);
    h.runtime.dispose();
  }
  {
    const tokenGate = { promise: Promise.resolve('token') };
    const h = baseRuntime({
      tokenGate,
      endpoints: ['https://primary.test', 'https://backup.test'],
      fetchImpl: async url => {
        if (url.startsWith('https://primary.test')) return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_route' }) };
        return { ok: true, status: 200, text: async () => JSON.stringify({ text: 'should-not-run' }) };
      },
    });
    await assert.rejects(
      h.translate({}, { accountId: 'a', text: 'bad', target: 'it', skipQuota: true }),
      error => error?.code === 'invalid_route' && error?.category === 'input' && error?.endpointFailure === false
    );
    assert.equal(h.fetchCalls(), 1, 'request/business rejection must not fail over to another endpoint');
    assert.deepEqual(h.reports.failure, [], 'request/business rejection must not poison endpoint health');
    h.runtime.dispose();
  }
  {
    const tokenGate = { promise: Promise.resolve('token') };
    const h = baseRuntime({
      tokenGate,
      endpoints: ['https://primary.test', 'https://backup.test'],
      fetchImpl: async url => url.startsWith('https://primary.test')
        ? { ok: false, status: 503, text: async () => JSON.stringify({ error: 'upstream_unavailable' }) }
        : { ok: true, status: 200, text: async () => JSON.stringify({ text: 'ciao', target: 'it' }) },
    });
    const result = await h.translate({}, { accountId: 'a', text: 'retry', target: 'it', skipQuota: true });
    assert.equal(result.text, 'ciao');
    assert.equal(h.fetchCalls(), 2);
    assert.deepEqual(h.reports.failure, ['https://primary.test']);
    assert.deepEqual(h.reports.success, ['https://backup.test']);
    h.runtime.dispose();
  }
  console.log('TRANSLATION_RUNTIME_FOUNDATION_CONTRACT_OK');
})().catch(error => { console.error(error); process.exit(1); });
