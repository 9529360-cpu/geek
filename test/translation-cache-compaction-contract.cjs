'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { createTranslationCacheStore } = require('../src/translation-cache-store.cjs');

const VERSION = 'prompt-test';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function identitySafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from(String(value)),
    decryptString: value => Buffer.from(value).toString(),
  };
}

function record(key, text, at) {
  return JSON.stringify({
    version: VERSION,
    key,
    at,
    value: Buffer.from(text).toString('base64'),
  }) + '\n';
}

function partitionDir(root, partition) {
  return path.join(root, 'Partitions', partition.replace(/^persist:/, ''));
}

function cacheFile(root, partition) {
  return path.join(partitionDir(root, partition), 'geek-translation-cache.jsonl');
}

async function exists(target) {
  try { await fsp.stat(target); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function limits(overrides = {}) {
  return {
    coldLoadBytes: 320,
    compactTriggerBytes: 320,
    compactedMaxBytes: 220,
    maxEntries: 3,
    appendsBeforeCompact: 2,
    ...overrides,
  };
}

function fsWithReadBudget(metrics) {
  return {
    ...fsp,
    async open(file, flags, mode) {
      const handle = await fsp.open(file, flags, mode);
      if (flags !== 'r') return handle;
      return {
        async read(buffer, offset, length, position) {
          metrics.maxRead = Math.max(metrics.maxRead, length);
          return handle.read(buffer, offset, length, position);
        },
        close: (...args) => handle.close(...args),
      };
    },
  };
}

async function parseFile(file) {
  const text = await fsp.readFile(file, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-cache-compaction-'));
  try {
    // Huge legacy logs must have bounded cold-load I/O and be compacted in the
    // same per-partition authority without blocking load completion.
    {
      const partition = 'persist:legacy-huge';
      const dir = partitionDir(root, partition);
      const file = cacheFile(root, partition);
      await fsp.mkdir(dir, { recursive: true });
      const lines = [];
      for (let index = 0; index < 40; index += 1) {
        lines.push(record(`key-${index % 8}`, `value-${index}-${'x'.repeat(24)}`, index));
      }
      lines.splice(35, 0, '{malformed-json}\n');
      await fsp.writeFile(file, lines.join(''), 'utf8');
      assert.ok((await fsp.stat(file)).size > 320);

      const metrics = { maxRead: 0 };
      const cache = new Map();
      const store = createTranslationCacheStore({
        fs: fsWithReadBudget(metrics),
        safeStorage: identitySafeStorage(),
        getUserDataDir: () => root,
        cacheVersion: VERSION,
        limits: limits(),
      });
      const loaded = await store.load(partition, cache);
      assert.equal(loaded.truncated, true, 'legacy oversized log must use bounded tail recovery');
      assert.ok(metrics.maxRead <= 321, `cold load read must stay bounded, observed ${metrics.maxRead}`);
      assert.ok(cache.size > 0, 'valid tail records should remain usable despite malformed lines');
      await store.whenIdle(partition);
      assert.ok((await fsp.stat(file)).size <= 220, 'background compaction must enforce the compacted byte budget');
      const compacted = await parseFile(file);
      assert.ok(compacted.length <= 3, 'compaction must enforce the entry retention bound');
      assert.equal(new Set(compacted.map(item => item.key)).size, compacted.length, 'compaction must keep only one latest physical record per logical key');

      const reloaded = new Map();
      const secondStore = createTranslationCacheStore({
        fs: fsp,
        safeStorage: identitySafeStorage(),
        getUserDataDir: () => root,
        cacheVersion: VERSION,
        limits: limits(),
      });
      await secondStore.load(partition, reloaded);
      for (const item of compacted) {
        assert.equal(reloaded.get(item.key)?.text, Buffer.from(item.value, 'base64').toString(), 'cache hit semantics must survive compaction/reload');
      }
    }

    // Repeated refreshes of one key are append-cheap but eventually compact to
    // one latest record. The newest queued append after a blocked compaction must
    // win once the single writer resumes.
    {
      const partition = 'persist:append-race';
      const dir = partitionDir(root, partition);
      const file = cacheFile(root, partition);
      await fsp.mkdir(dir, { recursive: true });
      const renameStarted = deferred();
      const releaseRename = deferred();
      let blockFirstRename = true;
      const wrappedFs = {
        ...fsp,
        async rename(from, to) {
          if (blockFirstRename && to === file) {
            blockFirstRename = false;
            renameStarted.resolve();
            await releaseRename.promise;
          }
          return fsp.rename(from, to);
        },
      };
      const cache = new Map([['same', { text: 'v1', at: 1 }]]);
      const store = createTranslationCacheStore({
        fs: wrappedFs,
        safeStorage: identitySafeStorage(),
        getUserDataDir: () => root,
        cacheVersion: VERSION,
        limits: limits({ appendsBeforeCompact: 1 }),
        randomUUID: (() => { let id = 0; return () => `race-${++id}`; })(),
      });
      const first = store.append(partition, 'same', cache.get('same'), cache);
      await renameStarted.promise;
      cache.set('same', { text: 'v2', at: 2 });
      const second = store.append(partition, 'same', cache.get('same'), cache);
      releaseRename.resolve();
      await Promise.all([first, second]);
      await store.whenIdle(partition);
      const records = await parseFile(file);
      assert.equal(records.length, 1, 'duplicate refresh records must compact to one physical latest record');
      assert.equal(Buffer.from(records[0].value, 'base64').toString(), 'v2', 'append queued behind compaction must remain the newest committed value');
    }

    // A replace failure is cache-warmth loss only: the authoritative old/append
    // log remains parseable and the temp artifact is cleaned up.
    {
      const partition = 'persist:rename-failure';
      const dir = partitionDir(root, partition);
      const file = cacheFile(root, partition);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(file, record('old', 'old-value', 1), 'utf8');
      const wrappedFs = {
        ...fsp,
        async rename() {
          const error = new Error('simulated replace failure');
          error.code = 'EIO';
          throw error;
        },
      };
      const cache = new Map([['old', { text: 'new-value', at: 2 }]]);
      const store = createTranslationCacheStore({
        fs: wrappedFs,
        safeStorage: identitySafeStorage(),
        getUserDataDir: () => root,
        cacheVersion: VERSION,
        limits: limits({ appendsBeforeCompact: 1 }),
        randomUUID: () => 'replace-failure',
      });
      assert.equal(await store.append(partition, 'old', cache.get('old'), cache), true, 'append success must not be converted into product failure by compaction');
      await store.whenIdle(partition);
      const disk = await fsp.readFile(file, 'utf8');
      assert.match(disk, /"key":"old"/, 'failed atomic replace must leave the old append log usable');
      assert.equal(await exists(`${file}.tmp-replace-failure`), false, 'failed compaction must clean its sibling temp file');
    }

    // Account deletion wins over running maintenance. Even if deletion races an
    // already-started rename, no code may recreate the removed partition.
    {
      const partition = 'persist:delete-race';
      const dir = partitionDir(root, partition);
      const file = cacheFile(root, partition);
      await fsp.mkdir(dir, { recursive: true });
      const renameStarted = deferred();
      const releaseRename = deferred();
      const wrappedFs = {
        ...fsp,
        async rename(from, to) {
          if (to === file) {
            renameStarted.resolve();
            await releaseRename.promise;
          }
          return fsp.rename(from, to);
        },
      };
      const cache = new Map([['key', { text: 'value', at: 1 }]]);
      const store = createTranslationCacheStore({
        fs: wrappedFs,
        safeStorage: identitySafeStorage(),
        getUserDataDir: () => root,
        cacheVersion: VERSION,
        limits: limits({ appendsBeforeCompact: 1 }),
        randomUUID: () => 'delete-race',
      });
      const pending = store.append(partition, 'key', cache.get('key'), cache);
      await renameStarted.promise;
      store.deletePartition(partition);
      await fsp.rm(dir, { recursive: true, force: true });
      releaseRename.resolve();
      await pending;
      await store.whenIdle(partition);
      assert.equal(await exists(dir), false, 'running maintenance must never resurrect a deleted account partition');
    }

    // Without safeStorage there is no disk read/write/maintenance downgrade.
    {
      let calls = 0;
      const forbiddenFs = new Proxy({}, {
        get() { return async () => { calls += 1; throw new Error('disk I/O forbidden'); }; },
      });
      const store = createTranslationCacheStore({
        fs: forbiddenFs,
        safeStorage: identitySafeStorage(false),
        getUserDataDir: () => root,
        cacheVersion: VERSION,
        limits: limits(),
      });
      const cache = new Map();
      await store.load('persist:no-encryption', cache);
      await store.append('persist:no-encryption', 'key', { text: 'value', at: 1 }, cache);
      assert.equal(calls, 0, 'safeStorage unavailable must remain memory-only');
    }

    // Partition A/B maintenance stays physically isolated.
    {
      const a = 'persist:isolation-a';
      const b = 'persist:isolation-b';
      await fsp.mkdir(partitionDir(root, a), { recursive: true });
      await fsp.mkdir(partitionDir(root, b), { recursive: true });
      const store = createTranslationCacheStore({
        fs: fsp,
        safeStorage: identitySafeStorage(),
        getUserDataDir: () => root,
        cacheVersion: VERSION,
        limits: limits({ appendsBeforeCompact: 1 }),
      });
      const cacheA = new Map([['same-key', { text: 'A', at: 1 }]]);
      const cacheB = new Map([['same-key', { text: 'B', at: 1 }]]);
      await Promise.all([
        store.append(a, 'same-key', cacheA.get('same-key'), cacheA),
        store.append(b, 'same-key', cacheB.get('same-key'), cacheB),
      ]);
      await Promise.all([store.whenIdle(a), store.whenIdle(b)]);
      const [recordA] = await parseFile(cacheFile(root, a));
      const [recordB] = await parseFile(cacheFile(root, b));
      assert.equal(Buffer.from(recordA.value, 'base64').toString(), 'A');
      assert.equal(Buffer.from(recordB.value, 'base64').toString(), 'B');
    }

    console.log('TRANSLATION_CACHE_COMPACTION_CONTRACT_OK');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
