'use strict';

const assert = require('node:assert/strict');
const {
  translationPriority,
  createTranslationRuntime,
} = require('../src/translation-runtime.cjs');
const {
  PRIORITY_INTERACTIVE,
  PRIORITY_BACKGROUND,
} = require('../src/translation-scheduler.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function response(text) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ text, target: 'it' }) };
}

function createHarness(fetchImpl) {
  const handlers = new Map();
  const partitions = new Map([
    ['a', 'persist:a'],
    ['b', 'persist:b'],
    ['c', 'persist:c'],
    ['d', 'persist:d'],
  ]);
  const runtime = createTranslationRuntime({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) },
    fs: { readFile: async () => '', appendFile: async () => {} },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString() },
    getUserDataDir: () => '/tmp/geek-qos-contract',
    accountState: { findById: accountId => partitions.has(accountId) ? { partition: partitions.get(accountId) } : null },
    createGatewayPool: () => ({
      endpoints: ['https://gateway.test'],
      healthCheckAll: async () => ({ 'https://gateway.test': true }),
      pick: () => ({ endpoint: 'https://gateway.test', route: 'primary' }),
      reportFailure() {},
      reportSuccess() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId(accountId) { if (!partitions.has(accountId)) throw new Error('bad account'); },
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => 'token',
    }),
    fetchImpl,
    randomUUID: (() => { let value = 0; return () => `request-${++value}`; })(),
  });
  runtime.install();
  return { runtime, translate: handlers.get('translation:translate') };
}

(async () => {
  assert.equal(translationPriority({}), PRIORITY_INTERACTIVE, 'legacy unclassified callers must keep interactive behavior during migration');
  assert.equal(translationPriority({ intent: 'interactive-send' }), PRIORITY_INTERACTIVE);
  assert.equal(translationPriority({ intent: 'background' }), PRIORITY_BACKGROUND);
  assert.equal(translationPriority({ intent: 'message-display' }), PRIORITY_BACKGROUND);
  assert.equal(translationPriority({ intent: 'history' }), PRIORITY_BACKGROUND);

  {
    const backgroundGate = deferred();
    const started = [];
    const harness = createHarness(async (_url, options) => {
      const body = JSON.parse(options.body);
      started.push(body.text);
      if (body.text.startsWith('bg-')) await backgroundGate.promise;
      return response(`translated:${body.text}`);
    });

    const background = [];
    for (const accountId of ['a', 'b', 'c', 'd']) {
      for (let index = 0; index < 4; index += 1) {
        background.push(harness.translate({}, {
          accountId,
          text: `bg-${accountId}-${index}`,
          target: 'it',
          skipQuota: true,
          intent: 'background',
        }));
      }
    }
    await waitFor(() => started.filter(text => text.startsWith('bg-')).length === 16, '16 reserved background slots');

    const interactive = harness.translate({}, {
      accountId: 'a',
      text: 'interactive-send',
      target: 'it',
      skipQuota: true,
      intent: 'interactive-send',
    });
    await waitFor(() => started.includes('interactive-send'), 'interactive translation to start while background is saturated');
    const interactiveResult = await interactive;
    assert.equal(interactiveResult.text, 'translated:interactive-send');

    backgroundGate.resolve();
    await Promise.all(background);
    harness.runtime.dispose();
  }

  {
    const backgroundGate = deferred();
    const started = [];
    const harness = createHarness(async (_url, options) => {
      const body = JSON.parse(options.body);
      started.push(body.text + ':' + started.length);
      if (started.length === 1) await backgroundGate.promise;
      return response(`translated:${body.text}`);
    });

    const background = harness.translate({}, {
      accountId: 'a',
      text: 'same-text',
      target: 'it',
      skipQuota: true,
      intent: 'background',
    });
    await waitFor(() => started.length === 1, 'background same-text request');

    const interactive = harness.translate({}, {
      accountId: 'a',
      text: 'same-text',
      target: 'it',
      skipQuota: true,
      intent: 'interactive-send',
    });
    await waitFor(() => started.length === 2, 'interactive same-text request');
    assert.equal((await interactive).text, 'translated:same-text', 'interactive send must not inherit a background in-flight promise');

    backgroundGate.resolve();
    await background;
    harness.runtime.dispose();
  }

  console.log('TRANSLATION_RUNTIME_QOS_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
