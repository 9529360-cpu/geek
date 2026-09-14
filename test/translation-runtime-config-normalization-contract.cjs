'use strict';

const assert = require('node:assert/strict');
const {
  normalizeTranslationProviderRoute,
  createTranslationRuntime,
} = require('../src/translation-runtime.cjs');

assert.deepEqual(
  normalizeTranslationProviderRoute('remote', 'legacy-route'),
  { provider: 'auto', route: 'default' },
  'historical provider/route values must canonicalize at the main runtime boundary'
);
assert.deepEqual(
  normalizeTranslationProviderRoute('stale-provider', 'stale-route'),
  { provider: 'auto', route: 'default' },
  'unknown persisted values must not reach the strict Worker contract'
);
assert.deepEqual(
  normalizeTranslationProviderRoute('local', 'backup'),
  { provider: 'local', route: 'backup' },
  'supported provider/route values must remain unchanged'
);

function createHarness() {
  const handlers = new Map();
  const forwarded = [];
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
    getUserDataDir: () => '/tmp/geek-translation-config-contract',
    accountState: {
      findById(accountId) {
        return accountId ? { partition: `persist:${accountId}` } : null;
      },
    },
    createGatewayPool: () => ({
      endpoints: ['https://primary.example.test'],
      healthCheckAll: async () => ({ 'https://primary.example.test': true }),
      pick: () => ({ endpoint: 'https://primary.example.test', route: 'primary' }),
      reportFailure() {},
      reportSuccess() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId(accountId) {
      if (!accountId) throw new Error('missing account');
    },
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => 'translation-token',
    }),
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body || '{}');
      forwarded.push(payload);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: `translated:${payload.text}`, target: payload.target }),
      };
    },
    randomUUID: (() => {
      let index = 0;
      return () => `request-config-${++index}`;
    })(),
  });
  runtime.install();
  return {
    runtime,
    translate: handlers.get('translation:translate'),
    forwarded,
  };
}

(async () => {
  const h = createHarness();

  const legacyPayload = {
    accountId: 'wa-upgraded-account',
    chatId: '393331234567@c.us',
    text: '您好，最近怎么样？',
    source: 'auto',
    target: 'it',
    provider: 'remote',
    route: 'legacy-route',
    skipQuota: true,
    refresh: true,
  };
  const legacyResult = await h.translate({}, legacyPayload);
  assert.equal(legacyResult.text, 'translated:您好，最近怎么样？');
  assert.equal(h.forwarded[0].provider, 'auto', 'legacy WhatsApp provider must be contained before the Worker');
  assert.equal(h.forwarded[0].route, 'default', 'legacy WhatsApp route must be contained before the Worker');
  assert.equal(h.forwarded[0].text, legacyPayload.text);
  assert.equal(h.forwarded[0].target, legacyPayload.target);

  const validPayload = {
    accountId: 'wa-current-account',
    chatId: '393339999999@c.us',
    text: 'ciao',
    source: 'auto',
    target: 'zh',
    provider: 'local',
    route: 'backup',
    skipQuota: true,
    refresh: true,
  };
  await h.translate({}, validPayload);
  assert.equal(h.forwarded[1].provider, 'local');
  assert.equal(h.forwarded[1].route, 'backup');

  h.runtime.dispose();
  console.log('TRANSLATION_RUNTIME_CONFIG_NORMALIZATION_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
