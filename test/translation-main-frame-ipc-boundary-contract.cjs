'use strict';

const assert = require('node:assert/strict');
const { createTranslationRuntime } = require('../src/translation-runtime.cjs');

function mainEvent(id = 1) {
  const mainFrame = { routingId: `main-${id}` };
  const sender = { id, mainFrame };
  return { sender, senderFrame: mainFrame };
}

function childEvent(id = 1) {
  const event = mainEvent(id);
  return { ...event, senderFrame: { routingId: `child-${id}` } };
}

(async () => {
  const handlers = new Map();
  let trustedChecks = 0;
  let accountLookups = 0;
  let authorizationReads = 0;
  let fetches = 0;

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
      encryptString: value => Buffer.from(value),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-main-frame-contract',
    accountState: {
      findById() {
        accountLookups += 1;
        return { partition: 'persist:translation-main-frame' };
      },
    },
    createGatewayPool: () => ({
      endpoints: ['http://127.0.0.1:8787'],
      healthCheckAll: async () => ({ local: true }),
      pick: () => ({ endpoint: 'http://127.0.0.1:8787', route: 'primary' }),
      reportFailure() {},
      reportSuccess() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() { trustedChecks += 1; },
    assertValidAccountId() {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => '',
      getTranslationAuthorization: async () => {
        authorizationReads += 1;
        return { token: 'test', generation: 1 };
      },
      assertTranslationAuthorizationCurrent() {},
    }),
    fetchImpl: async () => {
      fetches += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: 'ok', source: 'auto', target: 'en' }),
      };
    },
    env: { GEEK_TRANSLATION_GATEWAY_URL: 'http://127.0.0.1:8787' },
    randomUUID: () => 'translation-main-frame-request',
  });

  runtime.install();
  const translate = handlers.get('translation:translate');
  const health = handlers.get('translation:health');
  assert.equal(typeof translate, 'function');
  assert.equal(typeof health, 'function');

  await assert.rejects(
    () => translate(childEvent(), { accountId: 'a', text: 'blocked', target: 'en' }),
    error => error?.code === 'MAIN_FRAME_IPC_SENDER_INVALID',
    'same-WebContents child frames must be rejected outside the translation application envelope',
  );
  assert.equal(trustedChecks, 0, 'frame identity must be checked before the trusted WebContents gate');
  assert.equal(accountLookups, 0, 'child-frame translation must fail before account lookup');
  assert.equal(authorizationReads, 0, 'child-frame translation must fail before authorization admission');
  assert.equal(fetches, 0, 'child-frame translation must fail before remote side effects');

  await assert.rejects(
    () => health(childEvent()),
    error => error?.code === 'MAIN_FRAME_IPC_SENDER_INVALID',
    'translation health must reject same-WebContents child frames',
  );
  assert.equal(trustedChecks, 0, 'child-frame health must fail before trusted sender validation');

  const healthResult = await health(mainEvent());
  assert.equal(healthResult?.ok, true, 'main-frame translation health must preserve the existing response');
  assert.ok(healthResult?.scheduler, 'main-frame health must still expose scheduler state');
  assert.equal(trustedChecks, 1, 'main-frame health must continue through the existing trusted sender gate');

  runtime.dispose();
  console.log('TRANSLATION_MAIN_FRAME_IPC_BOUNDARY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
