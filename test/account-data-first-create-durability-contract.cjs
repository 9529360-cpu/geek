'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAccountDataStore } = require('../src/account-data-store.cjs');

const PARTITION = 'persist:webview-page-first-durable';

function cryptoOptions() {
  return {
    encrypt(value) { return Buffer.from(`cipher:${value}`, 'utf8').toString('base64'); },
    decrypt(value) {
      const decoded = Buffer.from(value, 'base64').toString('utf8');
      if (!decoded.startsWith('cipher:')) throw new Error('bad cipher');
      return decoded.slice('cipher:'.length);
    },
    isEncryptionAvailable() { return true; },
  };
}

function createProbeFs({ targetFile, directory, recoveryTemp, failFirstAppendSync = false }) {
  const events = [];
  let shouldFailAppendSync = failFirstAppendSync;
  const resolvedTarget = path.resolve(targetFile);
  const resolvedDirectory = path.resolve(directory);
  const resolvedRecoveryTemp = recoveryTemp ? path.resolve(recoveryTemp) : '';

  return {
    events,
    adapter: {
      ...fsp,
      async open(file, flags, ...rest) {
        const resolved = path.resolve(String(file));
        if (resolved === resolvedDirectory && flags === 'r') {
          events.push('open-dir');
          return {
            async sync() { events.push('sync-dir'); },
            async close() { events.push('close-dir'); },
          };
        }

        const handle = await fsp.open(file, flags, ...rest);
        if (resolved !== resolvedTarget || flags !== 'a') return handle;
        events.push('open-append');
        return {
          async writeFile(...args) {
            events.push('write-append');
            return handle.writeFile(...args);
          },
          async sync() {
            events.push('sync-append');
            if (shouldFailAppendSync) {
              shouldFailAppendSync = false;
              const error = new Error('synthetic first append fsync failure');
              error.code = 'EIO';
              throw error;
            }
            return handle.sync();
          },
          async close() {
            events.push('close-append');
            return handle.close();
          },
        };
      },
      async rename(from, to) {
        if (
          resolvedRecoveryTemp
          && path.resolve(String(from)) === resolvedRecoveryTemp
          && path.resolve(String(to)) === resolvedTarget
        ) {
          events.push('rename-recovery');
        }
        return fsp.rename(from, to);
      },
    },
  };
}

function createStore(dir, adapter) {
  return createAccountDataStore({
    fs: adapter,
    createReadStream: fs.createReadStream,
    getUserDataDir: () => dir,
    ...cryptoOptions(),
  });
}

function encryptedRecord(key, value) {
  return JSON.stringify({
    key,
    deleted: false,
    at: 1,
    value: cryptoOptions().encrypt(value),
  }) + '\n';
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-account-first-durable-'));
  try {
    // Establishing a brand-new log path needs one directory durability fence after
    // the file record itself has been flushed and closed. Steady-state appends must
    // keep the cheaper existing file-fsync-only path.
    {
      const dir = path.join(root, 'first-create');
      const bootstrap = createAccountDataStore({
        fs: fsp,
        createReadStream: fs.createReadStream,
        getUserDataDir: () => dir,
        ...cryptoOptions(),
      });
      const target = bootstrap.fileFor(PARTITION);
      const directory = path.dirname(target);
      const probe = createProbeFs({ targetFile: target, directory });
      const store = createStore(dir, probe.adapter);

      await store.set(PARTITION, 'savedMessages', 'first');
      assert.deepEqual(probe.events, [
        'open-append',
        'write-append',
        'sync-append',
        'close-append',
        'open-dir',
        'sync-dir',
        'close-dir',
      ], 'first account-data append must durably establish the new directory entry');

      probe.events.length = 0;
      await store.set(PARTITION, 'savedMessages', 'second');
      assert.deepEqual(probe.events, [
        'open-append',
        'write-append',
        'sync-append',
        'close-append',
      ], 'later appends must not pay a parent-directory fsync on every record');
      assert.equal((await store.getAll(PARTITION)).savedMessages, 'second');
    }

    // A failed first append must not mark the file path established. A later retry
    // still has to perform the directory fence even if the failed open/write left
    // a physical inode behind.
    {
      const dir = path.join(root, 'retry-after-failed-first-sync');
      const bootstrap = createAccountDataStore({
        fs: fsp,
        createReadStream: fs.createReadStream,
        getUserDataDir: () => dir,
        ...cryptoOptions(),
      });
      const target = bootstrap.fileFor(PARTITION);
      const directory = path.dirname(target);
      const probe = createProbeFs({ targetFile: target, directory, failFirstAppendSync: true });
      const store = createStore(dir, probe.adapter);

      await assert.rejects(
        store.set(PARTITION, 'savedMessages', 'retry-value'),
        error => error?.code === 'EIO',
      );
      assert.deepEqual(probe.events, [
        'open-append',
        'write-append',
        'sync-append',
        'close-append',
      ], 'failed first file fsync must not run or record the directory durability fence');
      assert.deepEqual(await store.getAll(PARTITION), {}, 'failed first append must not mutate canonical cache');

      probe.events.length = 0;
      await store.set(PARTITION, 'savedMessages', 'retry-value');
      assert.deepEqual(probe.events, [
        'open-append',
        'write-append',
        'sync-append',
        'close-append',
        'open-dir',
        'sync-dir',
        'close-dir',
      ], 'successful retry must still establish the pathname durably');
      assert.equal((await createStore(dir, fsp).getAll(PARTITION)).savedMessages, 'retry-value');
    }

    // Recovery that promotes a valid compaction temp into a missing target also
    // establishes a new authoritative pathname and must fence the directory rename.
    {
      const dir = path.join(root, 'recovery-promotion');
      const bootstrap = createAccountDataStore({
        fs: fsp,
        createReadStream: fs.createReadStream,
        getUserDataDir: () => dir,
        ...cryptoOptions(),
      });
      const target = bootstrap.fileFor(PARTITION);
      const temporary = bootstrap.tempFileFor(PARTITION);
      const directory = path.dirname(target);
      await fsp.mkdir(directory, { recursive: true });
      await fsp.writeFile(temporary, encryptedRecord('savedMessages', 'recovered'), 'utf8');

      const probe = createProbeFs({ targetFile: target, directory, recoveryTemp: temporary });
      const store = createStore(dir, probe.adapter);
      assert.equal((await store.getAll(PARTITION)).savedMessages, 'recovered');
      assert.deepEqual(probe.events, [
        'rename-recovery',
        'open-dir',
        'sync-dir',
        'close-dir',
      ], 'orphan-temp promotion must durably publish the recovered target pathname');
      assert.equal(fs.existsSync(target), true);
      assert.equal(fs.existsSync(temporary), false);
    }

    console.log('ACCOUNT_DATA_FIRST_CREATE_DURABILITY_CONTRACT_OK');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
