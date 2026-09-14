'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const TIMEOUT_MS = 25;
const ACCOUNT_NO = `GK-${'b'.repeat(32)}`;
const TOKEN = 'bounded-session-token';
const CIPHERTEXT = 'bounded-session-ciphertext';

function abortError(message = 'aborted') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function hangUntilAbort(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

function cryptoImpl() {
  return {
    encrypt(value) {
      assert.equal(String(value), TOKEN);
      return CIPHERTEXT;
    },
    decrypt(value) {
      assert.equal(String(value), CIPHERTEXT);
      return TOKEN;
    },
  };
}

(async () => {
  const originalFetch = global.fetch;
  const dirs = [];
  try {
    // Interactive unauthenticated calls must have a hard deadline and must not be retried.
    const loginDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-timeout-login-'));
    dirs.push(loginDir);
    const loginStore = createSubscriptionStore({ userDataDir: loginDir, requestTimeoutMs: TIMEOUT_MS });
    loginStore._injectCrypto(cryptoImpl());
    let loginCalls = 0;
    global.fetch = async (input, options = {}) => {
      loginCalls += 1;
      const url = String(input instanceof Request ? input.url : input);
      assert.ok(url.endsWith('/api/login'));
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, undefined, 'login timeout path must remain unauthenticated');
      assert.deepEqual(JSON.parse(options.body), { email: 'timeout@example.invalid', password: '0123456789' });
      assert.ok(options.signal instanceof AbortSignal, 'subscription fetch must receive an AbortSignal');
      return hangUntilAbort(options.signal);
    };

    const startedAt = Date.now();
    await assert.rejects(
      loginStore.login('timeout@example.invalid', '0123456789'),
      error => error?.code === 'SUBSCRIPTION_REQUEST_TIMEOUT'
        && error?.cause?.name === 'AbortError',
      'hung login must terminate with a stable local timeout error'
    );
    assert.equal(loginCalls, 1, 'non-idempotent login must not be retried automatically');
    assert.ok(Date.now() - startedAt < 1000, 'injected timeout must bound the hung login promptly');

    // Authenticated offline-tolerant callers should reach their existing fallback behavior.
    const authDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-timeout-auth-'));
    dirs.push(authDir);
    await fsp.writeFile(path.join(authDir, 'subscription.json'), JSON.stringify({
      token: `enc:${CIPHERTEXT}`,
      email: 'member@example.invalid',
      user_id: 42,
      account_no: ACCOUNT_NO,
      account_ref: ACCOUNT_NO,
      remaining_chars: 9,
      quota_cache: {
        remaining_chars: 9,
        email: 'member@example.invalid',
        account_no: ACCOUNT_NO,
        account_ref: ACCOUNT_NO,
      },
    }, null, 2), { encoding: 'utf8', mode: 0o600 });
    const authStore = createSubscriptionStore({ userDataDir: authDir, requestTimeoutMs: TIMEOUT_MS });
    authStore._injectCrypto(cryptoImpl());

    let refreshCalls = 0;
    global.fetch = async (input, options = {}) => {
      refreshCalls += 1;
      const url = String(input instanceof Request ? input.url : input);
      assert.ok(url.endsWith('/api/status'));
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
      return hangUntilAbort(options.signal);
    };
    const refreshed = await authStore.refresh();
    assert.equal(refreshCalls, 1);
    assert.equal(refreshed.loggedIn, true, 'refresh timeout must preserve the local authenticated session');
    assert.equal(refreshed.remaining_chars, 9);
    assert.equal(refreshed.networkError, true, 'refresh timeout must flow through the existing offline fallback');

    let quotaCalls = 0;
    global.fetch = async (input, options = {}) => {
      quotaCalls += 1;
      const url = String(input instanceof Request ? input.url : input);
      assert.ok(url.endsWith('/api/quota'));
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
      return hangUntilAbort(options.signal);
    };
    const quota = await authStore.getQuota(true);
    assert.equal(quotaCalls, 1);
    assert.equal(quota.remaining_chars, 9, 'quota timeout must return the existing cached quota');
    assert.equal(quota.account_no, ACCOUNT_NO);

    // The deadline must cover response body consumption too, not only time-to-headers.
    let bodySignal = null;
    global.fetch = async (input, options = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      assert.ok(url.endsWith('/api/orders'));
      bodySignal = options.signal;
      return {
        ok: true,
        status: 200,
        json: () => hangUntilAbort(options.signal),
      };
    };
    await assert.rejects(
      authStore.myOrders(),
      error => error?.code === 'SUBSCRIPTION_REQUEST_TIMEOUT',
      'timeout must remain active while reading the response body'
    );
    assert.equal(bodySignal?.aborted, true);

    // Success preserves request semantics and clears its timer instead of aborting later.
    let successSignal = null;
    let successCalls = 0;
    global.fetch = async (input, options = {}) => {
      successCalls += 1;
      const url = String(input instanceof Request ? input.url : input);
      assert.ok(url.endsWith('/api/orders'));
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
      assert.deepEqual(JSON.parse(options.body), { plan: 'pro' });
      successSignal = options.signal;
      return { ok: true, status: 200, json: async () => ({ ok: true, order_id: 99 }) };
    };
    const order = await authStore.createOrder('pro');
    assert.equal(successCalls, 1, 'successful POST must remain single-attempt');
    assert.equal(order.order_id, 99);
    assert.equal(successSignal?.aborted, false);
    await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS * 3));
    assert.equal(successSignal?.aborted, false, 'successful request timer must be cleared after completion');
  } finally {
    global.fetch = originalFetch;
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_REQUEST_TIMEOUT_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
