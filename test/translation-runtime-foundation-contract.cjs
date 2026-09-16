'use strict';
const assert = require('node:assert/strict');
const {
  classifyGatewayResponse,
  normalizeTranslationDeadline,
  unwrapTranslationIpcResponse,
  createTranslationRuntime,
} = require('../src/translation-runtime.cjs');
const { mainFrameIpcEvent } = require('./helpers/main-frame-ipc-event.cjs');

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
    assertTrustedSender: overrides.assertTrustedSender || (() => {}),
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
  const rawTranslate = handlers.get('translation:translate');
  const event = mainFrameIpcEvent({ id: 1 });
  const translate = async (_event, payload) => unwrapTranslationIpcResponse(await rawTranslate(event, payload));
  return { runtime, rawTranslate, translate, event, tokenGate, tokenCalls: () => tokenCalls, fetchCalls: () => fetchCalls, reports };
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
    const unauthorized = new Error('UNTRUSTED_TRANSLATION_SENDER');
    const h = baseRuntime({ assertTrustedSender: () => { throw unauthorized; } });
    await assert.rejects(
      h.rawTranslate(mainFrameIpcEvent({ id: 99 }), { accountId: 'a', text: 'blocked', target: 'it', skipQuota: true }),
      error => error === unauthorized,
      'trusted-sender authorization must reject outside the application result envelope'
    );
    assert.equal(h.tokenCalls(), 0, 'untrusted renderer must not reach translation-token preflight');
    assert.equal(h.fetchCalls(), 0, 'untrusted renderer must not reach translation gateway');
    h.runtime.dispose();
  }
  {
    const h = baseRuntime();
    const payload = { accountId: 'a', text: 'hello', target: 'it', skipQuota: true };
    const a = h.translate(h.event, payload);
    const b = h.translate(h.event, payload);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.tokenCalls(), 1, 'legacy same-work request must coalesce before translation-token preflight');
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
    const common = { accountId: 'a', text: 'same work, distinct send intents', target: 'it', skipQuota: true };
    const a = h.translate(h.event, { ...common, requestId: 'send-intent-a' });
    const b = h.translate(h.event, { ...common, requestId: 'send-intent-b' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.tokenCalls(), 2, 'different explicit caller transaction ids must not silently share one runtime request');
    h.tokenGate.resolve('token');
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.requestId, 'send-intent-a');
    assert.equal(rb.requestId, 'send-intent-b');
    assert.equal(h.fetchCalls(), 2);
    h.runtime.dispose();
  }
  {
    const h = baseRuntime();
    const shared = { accountId: 'a', text: 'same transaction retry', target: 'it', skipQuota: true, requestId: 'send-intent-same' };
    const leader = h.translate(h.event, { ...shared, deadlineAt: Date.now() + 1000 });
    const follower = h.translate(h.event, { ...shared, deadlineAt: Date.now() + 30 });
    await assert.rejects(
      follower,
      error => error?.code === 'TRANSLATION_DEADLINE_EXCEEDED',
      'a coalesced follower must retain its own caller deadline instead of inheriting the leader budget'
    );
    h.tokenGate.resolve('token');
    const result = await leader;
    assert.equal(result.requestId, 'send-intent-same');
    assert.equal(h.tokenCalls(), 1);
    assert.equal(h.fetchCalls(), 1);
    h.runtime.dispose();
  }
  {
    const h = baseRuntime();
    const started = Date.now();
    await assert.rejects(
      h.translate(h.event, { accountId: 'a', text: 'slow', target: 'it', skipQuota: true, deadlineAt: Date.now() + 35 }),
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
    const wire = await h.rawTranslate(h.event, { accountId: 'a', text: 'bad', target: 'it', skipQuota: true });
    assert.deepEqual(
      wire,
      { ok: false, error: { code: 'invalid_route', message: 'invalid_route', category: 'input', retryable: false, status: 400 } },
      'main process must serialize typed translation failure instead of relying on Electron Error serialization'
    );
    assert.throws(
      () => unwrapTranslationIpcResponse(wire),
      error => error?.code === 'invalid_route' && error?.category === 'input' && error?.retryable === false && error?.status === 400
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
    const result = await h.translate(h.event, { accountId: 'a', text: 'retry', target: 'it', skipQuota: true });
    assert.equal(result.text, 'ciao');
    assert.equal(h.fetchCalls(), 2);
    assert.deepEqual(h.reports.failure, ['https://primary.test']);
    assert.deepEqual(h.reports.success, ['https://backup.test']);
    h.runtime.dispose();
  }
  console.log('TRANSLATION_RUNTIME_FOUNDATION_CONTRACT_OK');
})().catch(error => { console.error(error); process.exit(1); });
