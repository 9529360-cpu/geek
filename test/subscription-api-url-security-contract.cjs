'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const {
  LOOPBACK_HOSTS,
  UNSAFE_API_URL_CODE,
  normalizeSubscriptionApiBase,
} = require('../src/subscription-api-url.cjs');
const { createSubscriptionStore, DEFAULT_API_URL } = require('../src/subscription.cjs');

function assertUnsafe(value) {
  assert.throws(
    () => normalizeSubscriptionApiBase(value),
    error => error?.code === UNSAFE_API_URL_CODE,
    `unsafe subscription API base must be rejected: ${value}`,
  );
}

async function withApiBase(value, operation) {
  const previous = process.env.GEEK_SUBSCRIPTION_API_URL;
  if (value == null) delete process.env.GEEK_SUBSCRIPTION_API_URL;
  else process.env.GEEK_SUBSCRIPTION_API_URL = value;
  try {
    return await operation();
  } finally {
    if (previous == null) delete process.env.GEEK_SUBSCRIPTION_API_URL;
    else process.env.GEEK_SUBSCRIPTION_API_URL = previous;
  }
}

(async () => {
  assert.deepEqual([...LOOPBACK_HOSTS].sort(), ['127.0.0.1', '[::1]', 'localhost']);
  assert.equal(normalizeSubscriptionApiBase(DEFAULT_API_URL), DEFAULT_API_URL, 'default production API must stay unchanged');
  assert.equal(normalizeSubscriptionApiBase('https://billing.example.test/'), 'https://billing.example.test');
  assert.equal(normalizeSubscriptionApiBase('https://billing.example.test/custom/'), 'https://billing.example.test/custom');
  assert.equal(normalizeSubscriptionApiBase('http://localhost:8788/'), 'http://localhost:8788');
  assert.equal(normalizeSubscriptionApiBase('http://127.0.0.1:8788/'), 'http://127.0.0.1:8788');
  assert.equal(normalizeSubscriptionApiBase('http://[::1]:8788/'), 'http://[::1]:8788');

  for (const value of [
    'http://billing.example.test',
    'http://localhost.example:8788',
    'http://127.0.0.1.example:8788',
    'https://user:password@billing.example.test',
    'http://user:password@localhost:8788',
    'https://billing.example.test/base?token=secret',
    'https://billing.example.test/base?',
    'https://billing.example.test/base#fragment',
    'https://billing.example.test/base#',
    'ftp://billing.example.test',
    'file:///tmp/subscription',
    'not a url',
    '',
  ]) assertUnsafe(value);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-url-policy-'));
  const originalFetch = global.fetch;
  let fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  try {
    // Login credentials must never reach fetch when a remote cleartext override
    // is inherited from the launcher/environment.
    await withApiBase('http://billing.example.test', async () => {
      const store = createSubscriptionStore({ userDataDir: path.join(root, 'login') });
      await assert.rejects(
        () => store.login('user@example.com', 'plaintext-password'),
        error => error?.code === UNSAFE_API_URL_CODE,
      );
      assert.equal(fetchCalls.length, 0, 'unsafe login base must fail before password reaches fetch');
    });

    // The same policy must protect authenticated Bearer requests, not only the
    // unauthenticated login path.
    const authenticatedDir = path.join(root, 'authenticated');
    await fs.mkdir(authenticatedDir, { recursive: true });
    await fs.writeFile(
      path.join(authenticatedDir, 'subscription.json'),
      JSON.stringify({ token: 'legacy-plaintext-token', email: 'user@example.com' }),
      'utf8',
    );
    await withApiBase('http://remote.example.test', async () => {
      const store = createSubscriptionStore({ userDataDir: authenticatedDir });
      await assert.rejects(
        () => store.myOrders(),
        error => error?.code === UNSAFE_API_URL_CODE,
      );
      assert.equal(fetchCalls.length, 0, 'unsafe authenticated base must fail before Bearer token reaches fetch');
    });

    // Supported HTTPS deployment overrides retain normal request semantics.
    fetchCalls = [];
    await withApiBase('https://billing.example.test/', async () => {
      const store = createSubscriptionStore({ userDataDir: path.join(root, 'https') });
      const result = await store.createOrder('starter');
      assert.equal(result.ok, true);
    });
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://billing.example.test/api/orders');
    assert.equal(fetchCalls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { plan: 'starter' });

    // Plain HTTP remains available for exact loopback development endpoints.
    fetchCalls = [];
    await withApiBase('http://127.0.0.1:8788/', async () => {
      const store = createSubscriptionStore({ userDataDir: path.join(root, 'loopback') });
      const result = await store.createOrder('starter');
      assert.equal(result.ok, true);
    });
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8788/api/orders');
  } finally {
    global.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_API_URL_SECURITY_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
