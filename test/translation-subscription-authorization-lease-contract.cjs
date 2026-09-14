'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');
const { createTranslationRuntime, unwrapTranslationIpcResponse } = require('../src/translation-runtime.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function sessionChangedError() {
  const error = new Error('登录状态已变化，请重试');
  error.code = 'SUBSCRIPTION_SESSION_CHANGED';
  return error;
}

function successResponse(text) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ text, source: 'auto', target: 'en' }),
  };
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-translation-auth-lease-'));
  const originalFetch = global.fetch;

  try {
    // 1. The subscription authority must expose an opaque generation-bound authorization lease.
    {
      const dir = path.join(root, 'store');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'subscription.json'), JSON.stringify({
        token: 'enc:session-token-a',
        email: 'lease@example.invalid',
        user_id: 7,
        account_no: `GK-${'a'.repeat(32)}`,
      }), 'utf8');
      const store = createSubscriptionStore({ userDataDir: dir });
      store._injectCrypto({ encrypt: value => String(value), decrypt: value => String(value) });
      let tokenCalls = 0;
      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.endsWith('/api/translation-token')) throw new Error(`unexpected request: ${url}`);
        tokenCalls += 1;
        return jsonResponse({ token: 'short-lived-a', expires_at: Math.floor(Date.now() / 1000) + 300 });
      };

      const lease = await store.getTranslationAuthorization();
      assert.equal(lease.token, 'short-lived-a');
      assert.equal(Number.isSafeInteger(lease.generation), true);
      assert.equal(lease.signal instanceof AbortSignal, true);
      assert.equal(lease.signal.aborted, false);
      assert.equal(Object.isFrozen(lease), true, 'authorization lease must not be caller-mutable');
      store.assertTranslationAuthorizationCurrent(lease);
      assert.equal(tokenCalls, 1);

      await store.logout();
      assert.equal(lease.signal.aborted, true, 'durable logout must abort all work authorized by the old generation');
      assert.equal(lease.signal.reason?.code, 'SUBSCRIPTION_SESSION_CHANGED');
      assert.throws(
        () => store.assertTranslationAuthorizationCurrent(lease),
        error => error?.code === 'SUBSCRIPTION_SESSION_CHANGED',
        'old authorization lease must be invalid after logout even if its JWT has not expired',
      );
    }

    // 2. Runtime queue admission must bind to the subscription lease, eject queued work on
    //    invalidation, and abort active requests without poisoning gateway health.
    {
      const handlers = new Map();
      let generation = 1;
      let generationController = new AbortController();
      const leaseForCurrentGeneration = () => Object.freeze({
        token: `token-${generation}`,
        generation,
        signal: generationController.signal,
      });
      const subscription = {
        getQuota: async () => ({ remaining_chars: null }),
        getTranslationToken: async () => `token-${generation}`,
        getTranslationAuthorization: async () => leaseForCurrentGeneration(),
        assertTranslationAuthorizationCurrent(lease) {
          if (!lease || lease.generation !== generation || lease.signal?.aborted) throw sessionChangedError();
        },
        invalidate() {
          const old = generationController;
          generation += 1;
          generationController = new AbortController();
          old.abort(sessionChangedError());
        },
      };
      let fetches = 0;
      let aborts = 0;
      let gatewayFailures = 0;
      const runtime = createTranslationRuntime({
        ipcMain: {
          handle(channel, handler) { handlers.set(channel, handler); },
          removeHandler(channel) { handlers.delete(channel); },
        },
        fs: { readFile: async () => '', appendFile: async () => {}, mkdir: async () => {} },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: value => Buffer.from(value),
          decryptString: value => Buffer.from(value).toString(),
        },
        getUserDataDir: () => '/tmp/geek-translation-auth-lease-runtime',
        accountState: { findById: () => ({ partition: 'persist:lease-account' }) },
        createGatewayPool: () => ({
          endpoints: ['https://translate.example.invalid'],
          healthCheckAll: async () => ({ remote: true }),
          pick: () => ({ endpoint: 'https://translate.example.invalid', route: 'primary' }),
          reportFailure() { gatewayFailures += 1; },
          reportSuccess() {},
        }),
        assertSafeTranslationOutput: ({ output }) => output,
        assertTrustedSender: () => {},
        assertValidAccountId: () => {},
        getSubscriptionStore: () => subscription,
        fetchImpl: async (_url, options) => {
          fetches += 1;
          return new Promise((resolve, reject) => {
            const abort = () => {
              aborts += 1;
              reject(options.signal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' }));
            };
            if (options.signal.aborted) abort();
            else options.signal.addEventListener('abort', abort, { once: true });
          });
        },
        randomUUID: (() => { let id = 0; return () => `lease-request-${++id}`; })(),
      });
      runtime.install();
      const translateIpc = handlers.get('translation:translate');
      const translate = async payload => unwrapTranslationIpcResponse(await translateIpc({ sender: { id: 1 } }, payload));

      const requests = Array.from({ length: 21 }, (_, index) => translate({
        accountId: 'account-a',
        text: `lease-${index}`,
        target: 'en',
        refresh: true,
        skipQuota: true,
      }));
      await waitFor(() => fetches === 20, '20 active lease-bound translations');
      subscription.invalidate();
      const results = await Promise.allSettled(requests);

      assert.equal(fetches, 20, 'queued stale-session work must be removed before a 21st gateway fetch starts');
      assert.equal(aborts, 20, 'every active old-session gateway attempt must be aborted');
      assert.equal(gatewayFailures, 0, 'session invalidation is caller lifecycle, not gateway health evidence');
      for (const result of results) {
        assert.equal(result.status, 'rejected');
        assert.equal(result.reason?.code, 'SUBSCRIPTION_SESSION_CHANGED');
      }
      runtime.dispose();
    }

    // 3. A transport that ignores AbortSignal and returns late still cannot commit an old-session result.
    {
      const handlers = new Map();
      let generation = 10;
      let controller = new AbortController();
      const subscription = {
        getQuota: async () => ({ remaining_chars: null }),
        getTranslationToken: async () => 'token-late',
        getTranslationAuthorization: async () => Object.freeze({ token: 'token-late', generation, signal: controller.signal }),
        assertTranslationAuthorizationCurrent(lease) {
          if (!lease || lease.generation !== generation || lease.signal?.aborted) throw sessionChangedError();
        },
        invalidate() {
          const old = controller;
          generation += 1;
          controller = new AbortController();
          old.abort(sessionChangedError());
        },
      };
      const fetchStarted = deferred();
      const releaseFetch = deferred();
      let appends = 0;
      const runtime = createTranslationRuntime({
        ipcMain: {
          handle(channel, handler) { handlers.set(channel, handler); },
          removeHandler(channel) { handlers.delete(channel); },
        },
        fs: { readFile: async () => '', appendFile: async () => { appends += 1; }, mkdir: async () => {} },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: value => Buffer.from(value),
          decryptString: value => Buffer.from(value).toString(),
        },
        getUserDataDir: () => '/tmp/geek-translation-auth-lease-late',
        accountState: { findById: () => ({ partition: 'persist:lease-late' }) },
        createGatewayPool: () => ({
          endpoints: ['https://translate.example.invalid'],
          healthCheckAll: async () => ({ remote: true }),
          pick: () => ({ endpoint: 'https://translate.example.invalid', route: 'primary' }),
          reportFailure() {},
          reportSuccess() {},
        }),
        assertSafeTranslationOutput: ({ output }) => output,
        assertTrustedSender: () => {},
        assertValidAccountId: () => {},
        getSubscriptionStore: () => subscription,
        fetchImpl: async () => {
          fetchStarted.resolve();
          await releaseFetch.promise; // deliberately ignore AbortSignal
          return successResponse('late-old-session-result');
        },
        randomUUID: () => 'late-session-request',
      });
      runtime.install();
      const translateIpc = handlers.get('translation:translate');
      const pending = unwrapTranslationIpcResponse(await Promise.resolve({ ok: true, result: null })).constructor; // keep lint/runtime surface simple
      void pending;
      const request = (async () => unwrapTranslationIpcResponse(await translateIpc({ sender: { id: 1 } }, {
        accountId: 'account-a', text: 'late', target: 'en', refresh: true, skipQuota: true,
      })))();
      await fetchStarted.promise;
      subscription.invalidate();
      releaseFetch.resolve();
      await assert.rejects(request, error => error?.code === 'SUBSCRIPTION_SESSION_CHANGED');
      assert.equal(appends, 0, 'late old-session result must not reach cache persistence');
      runtime.dispose();
    }
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('TRANSLATION_SUBSCRIPTION_AUTHORIZATION_LEASE_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
