'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { DEFAULT_LIMITS } = require('../src/translation-cache-store.cjs');
const {
  TRANSLATION_CACHE_VERSION,
  createTranslationRuntime,
  unwrapTranslationIpcResponse,
} = require('../src/translation-runtime.cjs');
const { mainFrameIpcEvent } = require('./helpers/main-frame-ipc-event.cjs');

function cacheKey(text, target = 'it') {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: TRANSLATION_CACHE_VERSION,
    text,
    source: 'auto',
    target,
    provider: 'auto',
    route: 'default',
  })).digest('hex');
}

function record(key, text, at) {
  return JSON.stringify({
    version: TRANSLATION_CACHE_VERSION,
    key,
    at,
    value: Buffer.from(String(text)).toString('base64'),
  }) + '\n';
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-runtime-bounded-cache-'));
  const partition = 'persist:runtime-bounded-cache';
  const dir = path.join(root, 'Partitions', 'runtime-bounded-cache');
  const file = path.join(dir, 'geek-translation-cache.jsonl');
  await fsp.mkdir(dir, { recursive: true });

  const sourceText = 'hello bounded cache';
  const translatedText = 'ciao cache limitato';
  const lines = [];
  for (let index = 0; index < 1100; index += 1) {
    lines.push(record(`padding-${index}`, `padding-${index}-${'x'.repeat(900)}`, index));
  }
  lines.push(record(cacheKey(sourceText), translatedText, 999999));
  await fsp.writeFile(file, lines.join(''), 'utf8');
  const legacyBytes = (await fsp.stat(file)).size;
  assert.ok(legacyBytes > DEFAULT_LIMITS.coldLoadBytes, 'fixture must exceed the production cold-load budget');

  let cacheReadFileCalls = 0;
  let maxBoundedRead = 0;
  let fetchCalls = 0;
  const measuredFs = {
    ...fsp,
    async readFile(target, ...args) {
      if (String(target) === file) cacheReadFileCalls += 1;
      return fsp.readFile(target, ...args);
    },
    async open(target, flags, mode) {
      const handle = await fsp.open(target, flags, mode);
      if (String(target) !== file || flags !== 'r') return handle;
      return {
        async read(buffer, offset, length, position) {
          maxBoundedRead = Math.max(maxBoundedRead, length);
          return handle.read(buffer, offset, length, position);
        },
        close: (...args) => handle.close(...args),
      };
    },
  };

  const handlers = new Map();
  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: measuredFs,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => root,
    accountState: {
      findById(accountId) {
        return accountId === 'account-a' ? { partition } : null;
      },
    },
    createGatewayPool: () => ({
      endpoints: ['http://127.0.0.1:8787'],
      healthCheckAll: async () => ({ local: true }),
      pick: () => ({ endpoint: 'http://127.0.0.1:8787', route: 'primary' }),
      reportFailure() {},
      reportSuccess() {},
      reportInconclusive() {},
    }),
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId(accountId) {
      if (!accountId) throw new Error('missing account');
    },
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => '',
    }),
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: 'unexpected-remote', source: 'auto', target: 'it' }),
      };
    },
    randomUUID: () => 'runtime-bounded-cache-request',
  });

  try {
    runtime.install();
    const translateIpc = handlers.get('translation:translate');
    assert.equal(typeof translateIpc, 'function');
    const event = mainFrameIpcEvent({ id: 1 });
    const result = unwrapTranslationIpcResponse(await translateIpc(event, {
      accountId: 'account-a',
      text: sourceText,
      target: 'it',
      skipQuota: true,
    }));

    assert.equal(result.cached, true, 'a valid record in the bounded tail must remain a cache hit');
    assert.equal(result.text, translatedText);
    assert.equal(fetchCalls, 0, 'bounded cold recovery must not force a remote translation when the tail contains the key');
    assert.equal(cacheReadFileCalls, 0, 'oversized legacy cache must not use full-file readFile in the Runtime path');
    assert.ok(
      maxBoundedRead <= DEFAULT_LIMITS.coldLoadBytes + 1,
      `Runtime cold cache read must stay within the production budget (+ boundary byte), observed ${maxBoundedRead}`,
    );
  } finally {
    runtime.deleteAccount(partition);
    runtime.dispose();
    await fsp.rm(root, { recursive: true, force: true });
  }

  console.log('TRANSLATION_CACHE_RUNTIME_BOUNDED_LOAD_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
