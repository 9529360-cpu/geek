'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { createTranslationRuntime, unwrapTranslationIpcResponse } = require('../src/translation-runtime.cjs');

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

async function resolvesBeforeNextTurn(promise, message) {
  const outcome = await Promise.race([
    promise.then(
      value => ({ type: 'resolved', value }),
      error => ({ type: 'rejected', error }),
    ),
    new Promise(resolve => setImmediate(() => resolve({ type: 'next-turn' }))),
  ]);
  assert.notEqual(outcome.type, 'next-turn', message);
  if (outcome.type === 'rejected') throw outcome.error;
  return outcome.value;
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
  const firstAppendStarted = deferred();
  const releaseFirstAppend = deferred();
  const firstAppendFinished = deferred();
  const liveAppendFinished = deferred();
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
        return fsp.mkdir(...args);
      },
      async appendFile(...args) {
        appendCalls += 1;
        if (appendCalls === 1) {
          firstAppendStarted.resolve();
          await releaseFirstAppend.promise;
          try {
            return await fsp.appendFile(...args);
          } finally {
            firstAppendFinished.resolve();
          }
        }
        try {
          return await fsp.appendFile(...args);
        } finally {
          liveAppendFinished.resolve();
        }
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
      return successResponse(`${body.text}-ok`);
    },
    randomUUID: (() => { let id = 0; return () => `request-${++id}`; })(),
  });

  try {
    runtime.install();
    const translateIpc = handlers.get('translation:translate');
    assert.equal(typeof translateIpc, 'function');
    const translate = async (event, payload) => unwrapTranslationIpcResponse(await translateIpc(event, payload));
    const event = { sender: { id: 1 } };

    const pendingA1 = translate(event, {
      accountId: 'account-a',
      text: 'A-work-1',
      target: 'it',
      refresh: true,
      skipQuota: true,
    });

    await firstAppendStarted.promise;
    const resultA1 = await resolvesBeforeNextTurn(
      pendingA1,
      'a validated translation must return without waiting for an unresolved cache append',
    );
    assert.equal(resultA1.text, 'A-work-1-ok');
    assert.equal(appendCalls, 1, 'the first best-effort cache append should start exactly once');

    const cachedA1 = await translate(event, {
      accountId: 'account-a',
      text: 'A-work-1',
      target: 'it',
      skipQuota: true,
    });
    assert.equal(cachedA1.text, 'A-work-1-ok');
    assert.equal(cachedA1.cached, true, 'in-memory cache must be reusable before disk persistence completes');
    assert.equal(fetchCalls, 1, 'an immediate cache hit must not repeat the remote request');

    const pendingA2 = translate(event, {
      accountId: 'account-a',
      text: 'A-work-2',
      target: 'it',
      refresh: true,
      skipQuota: true,
    });
    const resultA2 = await resolvesBeforeNextTurn(
      pendingA2,
      'a second translation must not wait behind another cache append in the same account partition',
    );
    assert.equal(resultA2.text, 'A-work-2-ok');
    assert.equal(appendCalls, 1, 'the second append must stay queued behind the first partition write');

    runtime.deleteAccount(partitionA);
    await fsp.rm(dirA, { recursive: true, force: true });
    releaseFirstAppend.resolve();
    await firstAppendFinished.promise;
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(appendCalls, 1, 'a queued stale append must be skipped when account deletion wins before it executes');
    assert.equal(await pathExists(dirA), false, 'late best-effort cache I/O must not resurrect a deleted account partition');
    assert.equal(mkdirCalls, 0, 'translation cache persistence must never own or recreate account partition directories');

    const resultB = await translate(event, {
      accountId: 'account-b',
      text: 'B-work',
      target: 'it',
      refresh: true,
      skipQuota: true,
    });
    assert.equal(resultB.text, 'B-work-ok', 'an unrelated live account must keep translating normally');
    await liveAppendFinished.promise;
    assert.equal(await pathExists(dirB), true, 'live account partition must remain intact');
    assert.match(await fsp.readFile(cacheB, 'utf8'), /"version":"prompt-20260822-2:source-language-v1"/, 'live cache must persist under the explicit-source semantic revision');
    assert.equal(mkdirCalls, 0, 'live cache writes must also respect Session ownership of the partition directory');
    assert.equal(appendCalls, 2, 'the live account should perform its own independent cache append');
    assert.equal(fetchCalls, 3, 'the write-behind path must not duplicate remote requests');

    console.log('TRANSLATION_CACHE_PARTITION_LIFECYCLE_CONTRACT_OK');
  } finally {
    runtime.dispose();
    releaseFirstAppend.resolve();
    await fsp.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
