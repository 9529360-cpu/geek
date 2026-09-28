'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTranslationRuntime } = require('../src/translation-runtime.cjs');

const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
assert.match(mainSource, /isTrustedSubscriptionIpcEvent/, 'main process must reuse the existing subscription document boundary for read-only translation health');
assert.match(mainSource, /function assertTranslationHealthSender[\s\S]{0,260}isTrustedSender\(event\)[\s\S]{0,160}isTrustedSubscriptionIpcEvent\(event\)/, 'translation health sender gate must admit the main UI or trusted subscription main frame only');
assert.match(mainSource, /assertHealthSender:\s*assertTranslationHealthSender/, 'production Translation Runtime must receive the narrow health-only sender gate');

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
  let healthTrustedChecks = 0;
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
    assertHealthSender() { healthTrustedChecks += 1; },
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
  assert.equal(trustedChecks, 0, 'child-frame health must not touch the translate sender gate');
  assert.equal(healthTrustedChecks, 0, 'child-frame health must fail before the health sender gate');

  const healthResult = await health(mainEvent());
  assert.equal(healthResult?.ok, true, 'main-frame translation health must preserve the existing response');
  assert.ok(healthResult?.scheduler, 'main-frame health must still expose scheduler state');
  assert.equal(healthTrustedChecks, 1, 'main-frame health must use the dedicated read-only health sender gate');
  assert.equal(trustedChecks, 0, 'health must not broaden or reuse the translate sender gate');

  runtime.dispose();
  console.log('TRANSLATION_MAIN_FRAME_IPC_BOUNDARY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
