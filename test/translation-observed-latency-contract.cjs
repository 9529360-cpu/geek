'use strict';

const assert = require('node:assert/strict');
const { createGatewayPool } = require('../src/gateway-failover.cjs');
const { createTranslationRuntime, unwrapTranslationIpcResponse } = require('../src/translation-runtime.cjs');
const { mainFrameIpcEvent } = require('./helpers/main-frame-ipc-event.cjs');

const PRIMARY = 'https://primary-latency.example.test';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

(async () => {
  const pool = createGatewayPool({ endpoints: [PRIMARY] });
  assert.equal(pool.translationLatencyOf(PRIMARY), null);
  pool.reportSuccess(PRIMARY, { translationLatencyMs: 1234.4 });
  assert.equal(pool.translationLatencyOf(PRIMARY), 1234);
  assert.equal(pool.latencyOf(PRIMARY), null);

  let clock = 1000;
  const handlers = new Map();
  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: { readFile: async () => '', appendFile: async () => {} },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-observed-latency',
    accountState: { findById: () => ({ partition: 'persist:observed-latency' }) },
    createGatewayPool,
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId() {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => 'translation-token',
    }),
    env: { GEEK_TRANSLATION_GATEWAY_URL: PRIMARY },
    now: () => clock,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith('/health')) {
        clock += 25;
        return response(200, { ok: true });
      }
      const body = JSON.parse(options.body || '{}');
      clock += 875;
      return response(200, {
        text: 'ciao',
        source: body.source,
        target: body.target,
        engine: 'gemini',
      });
    },
    randomUUID: () => 'observed-latency-request-1',
  });
  runtime.install();

  const event = mainFrameIpcEvent({ id: 1 });
  const translate = payload => handlers.get('translation:translate')(event, payload).then(unwrapTranslationIpcResponse);
  const result = await translate({
    accountId: 'account-a',
    text: '你好',
    source: 'zh',
    target: 'it',
    route: 'default',
    refresh: true,
    skipQuota: true,
  });

  assert.equal(result.engine, 'gemini');
  assert.equal(result.translationLatencyMs, 875);

  const health = await handlers.get('translation:health')(event);
  assert.equal(health.routes.primary.latencyMs, 25);
  assert.equal(health.routes.primary.translationLatencyMs, 875);
  assert.ok(!JSON.stringify(health).includes(PRIMARY));

  runtime.dispose();
  console.log('TRANSLATION_OBSERVED_LATENCY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
