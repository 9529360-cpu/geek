'use strict';

const assert = require('node:assert/strict');
const {
  classifyGatewayResponse,
  createTranslationRuntime,
  unwrapTranslationIpcResponse,
} = require('../src/translation-runtime.cjs');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body || {}),
  };
}

function createHarness(fetchBehavior) {
  const handlers = new Map();
  const failures = [];
  const successes = [];
  const picks = [];
  let primaryHealthy = true;
  let backupHealthy = true;
  let requestSequence = 0;

  const pool = {
    endpoints: ['https://primary.example.test', 'https://backup.example.test'],
    pick() {
      let endpoint;
      if (primaryHealthy) endpoint = this.endpoints[0];
      else if (backupHealthy) endpoint = this.endpoints[1];
      else endpoint = this.endpoints[0];
      const route = endpoint === this.endpoints[0] ? 'primary' : 'backup';
      picks.push({ endpoint, route });
      return { endpoint, route };
    },
    reportFailure(endpoint) {
      failures.push(endpoint);
      if (endpoint === this.endpoints[0]) primaryHealthy = false;
      if (endpoint === this.endpoints[1]) backupHealthy = false;
    },
    reportSuccess(endpoint) {
      successes.push(endpoint);
      if (endpoint === this.endpoints[0]) primaryHealthy = true;
      if (endpoint === this.endpoints[1]) backupHealthy = true;
    },
    healthCheckAll: async () => ({
      [this?.endpoints?.[0] || 'https://primary.example.test']: primaryHealthy,
      [this?.endpoints?.[1] || 'https://backup.example.test']: backupHealthy,
    }),
  };

  const accounts = new Map([
    ['account-a', { partition: 'persist:account-a' }],
    ['account-b', { partition: 'persist:account-b' }],
  ]);

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
    getUserDataDir: () => '/tmp/geek-translation-gateway-health-isolation',
    accountState: {
      findById(accountId) { return accounts.get(accountId) || null; },
    },
    createGatewayPool: () => pool,
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId(accountId) {
      if (!accountId) throw new Error('missing account');
    },
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => 'translation-token',
    }),
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body || '{}');
      return fetchBehavior({ url, options, payload });
    },
    randomUUID: () => `health-isolation-${++requestSequence}`,
  });
  runtime.install();

  const translateIpc = handlers.get('translation:translate');
  return {
    runtime,
    pool,
    failures,
    successes,
    picks,
    event: { sender: { id: 1 } },
    translate: async (event, payload) => unwrapTranslationIpcResponse(await translateIpc(event, payload)),
  };
}

(async () => {
  const taxonomy = [
    [400, 'input', false, false],
    [401, 'auth', false, false],
    [403, 'auth', false, false],
    [402, 'quota', false, false],
    [409, 'conflict', false, false],
    [413, 'input', false, false],
    [429, 'rate-limit', true, false],
    [408, 'gateway', true, true],
    [500, 'gateway', true, true],
    [503, 'gateway', true, true],
  ];
  for (const [status, category, retryable, endpointFailure] of taxonomy) {
    const error = classifyGatewayResponse(status, { error: `status_${status}`, message: `HTTP ${status}` });
    assert.equal(error.category, category, `${status} category`);
    assert.equal(error.retryable, retryable, `${status} retryability`);
    assert.equal(error.endpointFailure, endpointFailure, `${status} endpoint-health impact`);
  }

  // Request/user failures from account A must terminate that exact request without
  // poisoning the process-global endpoint pool used later by account B.
  for (const status of [400, 401, 402, 409, 413, 429]) {
    let calls = 0;
    const h = createHarness(({ payload }) => {
      calls += 1;
      if (payload.text === `a-${status}`) {
        return response(status, { error: `synthetic_${status}`, message: `synthetic ${status}` });
      }
      return response(200, { text: `translated:${payload.text}`, source: 'auto', target: payload.target });
    });

    try {
      await assert.rejects(
        h.translate(h.event, { accountId: 'account-a', text: `a-${status}`, target: 'it', skipQuota: true }),
        error => error?.status === status,
        `account A ${status} must terminate as a typed request failure`,
      );
      assert.equal(calls, 1, `${status} must not be replayed to a backup endpoint`);
      assert.deepEqual(h.failures, [], `${status} must not mutate shared endpoint health`);
      assert.equal(h.picks[0].endpoint, 'https://primary.example.test');

      const resultB = await h.translate(h.event, {
        accountId: 'account-b',
        text: `b-after-${status}`,
        target: 'it',
        skipQuota: true,
      });
      assert.equal(resultB.text, `translated:b-after-${status}`);
      assert.equal(h.picks[1].endpoint, 'https://primary.example.test', `account B must still use primary after account A ${status}`);
    } finally {
      h.runtime.dispose();
    }
  }

  // A genuine endpoint failure is different: failover is appropriate and the
  // shared pool should remember the failed primary for the next account.
  {
    let primaryAttempts = 0;
    const h = createHarness(({ url, payload }) => {
      if (url.startsWith('https://primary.example.test')) {
        primaryAttempts += 1;
        return response(503, { error: 'upstream_unavailable', message: 'synthetic outage' });
      }
      return response(200, { text: `translated:${payload.text}`, source: 'auto', target: payload.target });
    });

    try {
      const resultA = await h.translate(h.event, {
        accountId: 'account-a',
        text: 'a-real-outage',
        target: 'it',
        skipQuota: true,
      });
      assert.equal(resultA.text, 'translated:a-real-outage');
      assert.equal(primaryAttempts, 1, 'primary outage should be attempted once before failover');
      assert.deepEqual(h.failures, ['https://primary.example.test']);
      assert.equal(h.picks[0].endpoint, 'https://primary.example.test');
      assert.equal(h.picks[1].endpoint, 'https://backup.example.test');

      const resultB = await h.translate(h.event, {
        accountId: 'account-b',
        text: 'b-after-outage',
        target: 'it',
        skipQuota: true,
      });
      assert.equal(resultB.text, 'translated:b-after-outage');
      assert.equal(h.picks[2].endpoint, 'https://backup.example.test', 'real primary outage should affect shared route selection');
    } finally {
      h.runtime.dispose();
    }
  }

  console.log('TRANSLATION_GATEWAY_HEALTH_ISOLATION_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
