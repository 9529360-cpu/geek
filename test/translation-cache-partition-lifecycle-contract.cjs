'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { createTranslationRuntime } = require('../src/translation-runtime.cjs');

function deferred() {
  let settled = false;
  let resolve;
  const promise = new Promise((done) => {
    resolve = (value) => {
      if (settled) return;
      settled = true;
      done(value);
    };
  });
  return { promise, resolve };
}

function successResponse(text) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ text, source: 'auto', target: 'it' }),
  };
}

async function pathExists(target) {
  try {
    await fsp.stat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-translation-partition-lifecycle-'));
  const partitionA = 'persist:webview-page-delete-race';
  const partitionB = 'persist:webview-page-live';
  const dirA = path.join(root, 'Partitions', 'webview-page-delete-race');
  const dirB = path.join(root, 'Partitions', 'webview-page-live');
  const cacheB = path.join(dirB, 'geek-translation-cache.jsonl');
  await fsp.mkdir(dirA, { recursive: true });
  await fsp.mkdir(dirB, { recursive: true });

  const handlers = new Map();
  const ioStarted = deferred();
  const releaseIo = deferred();
  let mkdirCalls = 0;
  let appendCalls = 0;
  let fetchCalls = 0;

  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: {
      readFile: async () => '',
      async mkdir(...args) {
        mkdirCalls += 1;
        ioStarted.resolve('mkdir');
        await releaseIo.promise;
        return fsp.mkdir(...args);
      },
      async appendFile(...args) {
        appendCalls += 1;
        ioStarted.resolve('append');
        await releaseIo.promise;
        return fsp.appendFile(...args);
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => root,
    accountState: {
      findById(accountId) {
        if (accountId === 'account-a') return { partition: partitionA };
        if (accountId === 'account-b') return { partition: partitionB };
        return null;
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
    assertTrustedSender: () => {},
    assertValidAccountId: () => {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => '',
    }),
    fetchImpl: async (_url, options) => {
      fetchCalls += 1;
      const body = JSON.parse(options.body || '{}');
      return successResponse(body.text === 'B-work' ? 'B-ok' : 'A-ok');
    },
    randomUUID: (() => { let id = 0; return () => `request-${++id}`; })(),
  });

  try {
    runtime.install();
    const translate = handlers.get('translation:translate');
    assert.equal(typeof translate, 'function');
    const event = { sender: { id: 1 } };

    const pendingA = translate(event, {
      accountId: 'account-a',
      text: 'A-work',
      target: 'it',
      refresh: true,
      skipQuota: true,
    });

    const firstIo = await ioStarted.promise;
    runtime.deleteAccount(partitionA);
    await fsp.rm(dirA, { recursive: true, force: true });
    releaseIo.resolve();

    await assert.rejects(
      pendingA,
      error => error?.code === 'TRANSLATION_ACCOUNT_DELETED',
      'a translation finishing cache I/O after account deletion must fail closed',
    );
    assert.equal(firstIo, 'append', 'Translation Runtime must append only inside an existing partition and must not create the partition directory');
    assert.equal(mkdirCalls, 0, 'translation cache persistence must never own/recreate the account partition directory');
    assert.equal(appendCalls, 1, 'the already-admitted cache append should be attempted exactly once');
    assert.equal(await pathExists(dirA), false, 'late translation cache I/O must not resurrect a deleted account partition');

    const resultB = await translate(event, {
      accountId: 'account-b',
      text: 'B-work',
      target: 'it',
      refresh: true,
      skipQuota: true,
    });
    assert.equal(resultB.text, 'B-ok', 'an unrelated live account must keep translating normally');
    assert.equal(await pathExists(dirB), true, 'live account partition must remain intact');
    assert.match(await fsp.readFile(cacheB, 'utf8'), /"version":"prompt-20260822-2"/, 'live account cache should still persist when its partition already exists');
    assert.equal(mkdirCalls, 0, 'live cache writes must also respect Session ownership of the partition directory');
    assert.equal(appendCalls, 2, 'live account should perform its own independent cache append');
    assert.equal(fetchCalls, 2, 'the deletion race must not start duplicate remote requests');

    console.log('TRANSLATION_CACHE_PARTITION_LIFECYCLE_CONTRACT_OK');
  } finally {
    runtime.dispose();
    releaseIo.resolve();
    await fsp.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
