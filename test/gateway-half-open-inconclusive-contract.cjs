'use strict';

const assert = require('node:assert/strict');
const {
  createGatewayPool,
  DEFAULT_RECOVERY_PROBE_MS,
} = require('../src/gateway-failover.cjs');
const {
  createTranslationRuntime,
  unwrapTranslationIpcResponse,
} = require('../src/translation-runtime.cjs');

const PRIMARY = 'https://primary.example.test';
const BACKUP = 'https://backup.example.test';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

// Pool-level lifecycle: an inconclusive request releases exactly the probe lease,
// preserves unhealthy state, and starts a fresh cooldown before another probe.
{
  let clock = 1;
  const pool = createGatewayPool({ endpoints: [PRIMARY, BACKUP], now: () => clock });
  pool.reportFailure(PRIMARY);
  clock += DEFAULT_RECOVERY_PROBE_MS;

  assert.equal(pool.pick('default').endpoint, PRIMARY, 'cooldown expiry must grant one primary probe');
  assert.equal(pool.pick('default').endpoint, BACKUP, 'concurrent traffic must not share the primary probe lease');
  assert.equal(pool.reportInconclusive(PRIMARY), true, 'inconclusive probe must release its lease');
  assert.equal(pool.reportInconclusive(PRIMARY), false, 'probe lease terminal outcome must be idempotent');
  assert.equal(pool.healthOf(PRIMARY), false, 'inconclusive outcome must not declare the endpoint healthy');
  assert.equal(pool.pick('default').endpoint, BACKUP, 'released probe must still respect a new cooldown');

  clock += DEFAULT_RECOVERY_PROBE_MS - 1;
  assert.equal(pool.pick('default').endpoint, BACKUP, 'primary must remain open until the full cooldown elapses');
  clock += 1;
  assert.equal(pool.pick('default').endpoint, PRIMARY, 'later eligible traffic must be able to probe primary again');
  pool.reportInconclusive(PRIMARY);
  assert.equal(pool.healthOf(PRIMARY), false, 'repeated request-specific outcomes must not mutate shared health to success');

  clock += DEFAULT_RECOVERY_PROBE_MS;
  assert.equal(pool.pick('default').endpoint, PRIMARY);
  pool.reportSuccess(PRIMARY);
  assert.equal(pool.healthOf(PRIMARY), true);
  assert.equal(pool.pick('default').endpoint, PRIMARY, 'a real successful probe must restore primary preference');
}

(async () => {
  const handlers = new Map();
  const calls = [];
  const quotaProbeStarted = deferred();
  const releaseQuotaProbe = deferred();
  let clock = 1000;
  let pool = null;
  let id = 0;

  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: {
      readFile: async () => '',
      appendFile: async () => {},
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-half-open-inconclusive',
    accountState: {
      findById: () => ({ partition: 'persist:half-open-inconclusive' }),
    },
    createGatewayPool: options => {
      pool = createGatewayPool({ ...options, now: () => clock, recoveryProbeMs: 20 });
      return pool;
    },
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId() {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => 'translation-token',
    }),
    env: { GEEK_TRANSLATION_GATEWAY_URL: `${PRIMARY},${BACKUP}` },
    now: () => clock,
    randomUUID: () => `half-open-request-${++id}`,
    fetchImpl: async (url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      calls.push({ url: String(url), text: body.text || '' });
      const isPrimary = String(url).startsWith(PRIMARY);

      if (body.text === 'seed-failure' && isPrimary) {
        return response(503, { error: 'upstream_unavailable' });
      }
      if (body.text === 'quota-probe' && isPrimary) {
        quotaProbeStarted.resolve();
        await releaseQuotaProbe.promise;
        return response(402, { error: 'quota_exhausted' });
      }
      if (body.text === 'rate-probe' && isPrimary) {
        return response(429, { error: 'rate_limited' });
      }
      return response(200, { text: `translated:${body.text}`, source: 'auto', target: 'it' });
    },
  });

  runtime.install();
  const rawTranslate = handlers.get('translation:translate');
  const translate = async text => unwrapTranslationIpcResponse(await rawTranslate({ sender: { id: 1 } }, {
    accountId: 'account-a',
    text,
    target: 'it',
    route: 'default',
    refresh: true,
    skipQuota: true,
  }));

  try {
    // Seed a real endpoint failure; default mode must fail over to backup.
    const seed = await translate('seed-failure');
    assert.equal(seed.text, 'translated:seed-failure');
    assert.deepEqual(calls.slice(0, 2).map(call => call.url), [
      `${PRIMARY}/v1/translate`,
      `${BACKUP}/v1/translate`,
    ]);
    assert.equal(pool.healthOf(PRIMARY), false);

    // Cooldown expires: one request owns the primary half-open lease. While it is
    // unresolved, a concurrent caller must keep using healthy backup capacity.
    clock += 20;
    const quotaProbe = translate('quota-probe');
    await quotaProbeStarted.promise;
    const concurrent = await translate('concurrent-during-probe');
    assert.equal(concurrent.text, 'translated:concurrent-during-probe');
    assert.equal(calls.at(-1).url, `${BACKUP}/v1/translate`);

    releaseQuotaProbe.resolve();
    await assert.rejects(
      quotaProbe,
      error => error?.category === 'quota' && error?.status === 402,
      'request-specific 402 must remain quota state, not endpoint failure',
    );
    assert.equal(pool.healthOf(PRIMARY), false, '402 must not recover or re-fail the primary endpoint');

    // The lease was released, but its conservative cooldown restarts at the
    // inconclusive terminal time, so immediate traffic remains on backup.
    const immediate = await translate('immediate-after-quota');
    assert.equal(immediate.text, 'translated:immediate-after-quota');
    assert.equal(calls.at(-1).url, `${BACKUP}/v1/translate`);
    clock += 19;
    await translate('before-cooldown');
    assert.equal(calls.at(-1).url, `${BACKUP}/v1/translate`);

    // A later 429 probe is also inconclusive. It must release the lease without
    // poisoning shared endpoint health or silently crossing routes inside the request.
    clock += 1;
    await assert.rejects(
      translate('rate-probe'),
      error => error?.category === 'rate-limit' && error?.status === 429,
    );
    assert.equal(calls.at(-1).url, `${PRIMARY}/v1/translate`);
    assert.equal(pool.healthOf(PRIMARY), false);
    await translate('immediate-after-rate');
    assert.equal(calls.at(-1).url, `${BACKUP}/v1/translate`);

    // After the next full cooldown, a valid response can finally close the circuit.
    clock += 20;
    const recovered = await translate('recovered-primary');
    assert.equal(recovered.text, 'translated:recovered-primary');
    assert.equal(calls.at(-1).url, `${PRIMARY}/v1/translate`);
    assert.equal(pool.healthOf(PRIMARY), true);
    await translate('primary-stays-preferred');
    assert.equal(calls.at(-1).url, `${PRIMARY}/v1/translate`);

    console.log('GATEWAY_HALF_OPEN_INCONCLUSIVE_CONTRACT_OK');
  } finally {
    releaseQuotaProbe.resolve();
    runtime.dispose();
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
