'use strict';

const assert = require('node:assert/strict');
const { createTranslationRuntime } = require('../src/translation-runtime.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function createHarness({ accounts, readFile, mkdir, appendFile }) {
  const handlers = new Map();
  let fetchCount = 0;
  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: {
      readFile,
      mkdir,
      appendFile,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-delete-drain',
    accountState: {
      findById(accountId) { return accounts.get(accountId) || null; },
    },
    createGatewayPool: () => ({
      endpoints: ['http://127.0.0.1:8787'],
      healthCheckAll: async () => ({ local: true }),
      pick: () => ({ endpoint: 'http://127.0.0.1:8787', route: 'primary' }),
      reportFailure() {},
      reportSuccess() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender: () => {},
    assertValidAccountId: () => {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => '',
    }),
    fetchImpl: async (_url, options) => {
      fetchCount += 1;
      const body = JSON.parse(options.body || '{}');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: `remote:${body.text}`, source: 'auto', target: body.target }),
      };
    },
    randomUUID: (() => { let id = 0; return () => `request-${++id}`; })(),
  });
  runtime.install();
  return {
    runtime,
    translate: handlers.get('translation:translate'),
    event: { sender: { id: 1 } },
    fetchCount: () => fetchCount,
  };
}

(async () => {
  {
    const partitionA = 'persist:webview-page-drain-a';
    const partitionB = 'persist:webview-page-drain-b';
    const accounts = new Map([
      ['account-a', { partition: partitionA }],
      ['account-b', { partition: partitionB }],
    ]);
    const appendGateA = deferred();
    const appendStarted = [];
    const harness = createHarness({
      accounts,
      readFile: async () => '',
      mkdir: async () => {},
      appendFile: async file => {
        const value = String(file);
        if (value.includes('webview-page-drain-a')) {
          appendStarted.push('A');
          await appendGateA.promise;
          return;
        }
        if (value.includes('webview-page-drain-b')) {
          appendStarted.push('B');
          return;
        }
        throw new Error(`unexpected cache file ${file}`);
      },
    });

    const translatingA = harness.translate(harness.event, {
      accountId: 'account-a', text: 'alpha', target: 'en', skipQuota: true, refresh: true,
    });
    await waitFor(() => appendStarted.includes('A'), 'account A cache append to enter filesystem I/O');

    let deletionResolved = false;
    const deletingA = harness.runtime.deleteAccount(partitionA).then(() => { deletionResolved = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deletionResolved, false, 'account deletion must wait for an already-started cache append');

    await assert.rejects(
      () => harness.translate(harness.event, {
        accountId: 'account-a', text: 'after-delete', target: 'en', skipQuota: true, refresh: true,
      }),
      error => error?.code === 'TRANSLATION_ACCOUNT_DELETED',
      'once deletion starts, no new translation/cache write may be admitted for that partition',
    );
    assert.equal(appendStarted.filter(owner => owner === 'A').length, 1, 'deleted partition must not start another cache append');

    const resultB = await harness.translate(harness.event, {
      accountId: 'account-b', text: 'beta', target: 'en', skipQuota: true, refresh: true,
    });
    assert.equal(resultB.text, 'remote:beta', 'another partition must remain independent while account A drains');
    assert.equal(appendStarted.includes('B'), true, 'account B cache append must not be globally serialized behind account A deletion');
    assert.equal(deletionResolved, false, 'account B progress must not resolve account A deletion barrier');

    appendGateA.resolve();
    await deletingA;
    assert.equal(deletionResolved, true, 'account deletion may resolve after the old cache append settles');
    await assert.rejects(
      translatingA,
      error => error?.code === 'TRANSLATION_ACCOUNT_DELETED',
      'translation whose cache append overlaps deletion must not report stale success afterward',
    );
    harness.runtime.dispose();
  }

  {
    const partition = 'persist:webview-page-drain-load';
    const accounts = new Map([['account-load', { partition }]]);
    const readGate = deferred();
    let readStarted = 0;
    const harness = createHarness({
      accounts,
      readFile: async () => {
        readStarted += 1;
        return readGate.promise;
      },
      mkdir: async () => {},
      appendFile: async () => {},
    });

    const translating = harness.translate(harness.event, {
      accountId: 'account-load', text: 'cold', target: 'en', skipQuota: true,
    });
    await waitFor(() => readStarted === 1, 'cold cache load to enter filesystem I/O');

    let deletionResolved = false;
    const deleting = harness.runtime.deleteAccount(partition).then(() => { deletionResolved = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deletionResolved, false, 'account deletion must also drain an already-started cache read');

    readGate.resolve('');
    await deleting;
    await assert.rejects(
      translating,
      error => error?.code === 'TRANSLATION_ACCOUNT_DELETED',
      'a drained cold cache load must retain deleted-account semantics',
    );
    assert.equal(harness.fetchCount(), 0, 'deleted account must not reach remote translation after its old cache read settles');
    harness.runtime.dispose();
  }

  console.log('TRANSLATION_CACHE_DELETE_DRAIN_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
