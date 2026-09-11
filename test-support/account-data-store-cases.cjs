'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  ACCOUNT_DATA_KEYS,
  createAccountDataStore,
} = require('../src/account-data-store.cjs');
const {
  createAccountPartitionResolver,
  installAccountDataBoundary,
} = require('../src/account-data-boundary.cjs');

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

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

function createStore(dir, extra = {}) {
  return createAccountDataStore({
    fs: extra.fs || fsp,
    createReadStream: extra.createReadStream || fs.createReadStream,
    getUserDataDir: () => dir,
    ...cryptoOptions(),
    ...extra,
  });
}

async function runAccountDataStoreCases() {
  const partition = 'persist:webview-page-account-1';

  {
    const dir = tempDir('geek-account-roundtrip');
    const store = createStore(dir);
    assert.deepEqual(await store.getAll(partition), {});
    assert.equal(await store.set(partition, 'savedMessages', { text: 'hello' }), true);
    assert.deepEqual(await store.getAll(partition), { savedMessages: { text: 'hello' } });
    assert.equal(await store.remove(partition, 'savedMessages'), true);
    assert.deepEqual(await store.getAll(partition), {});
  }

  {
    const dir = tempDir('geek-account-allowlist');
    const store = createStore(dir);
    await assert.rejects(store.set(partition, '__proto__', 'x'), { code: 'ACCOUNT_DATA_KEY_NOT_ALLOWED' });
    await assert.rejects(store.set(partition, 'unknownKey', 'x'), { code: 'ACCOUNT_DATA_KEY_NOT_ALLOWED' });
  }

  {
    const dir = tempDir('geek-account-size');
    const store = createStore(dir, { limits: { maxValueBytes: 8 } });
    await assert.rejects(store.set(partition, 'savedMessages', '0123456789'), { code: 'ACCOUNT_DATA_VALUE_TOO_LARGE' });
  }

  {
    const dir = tempDir('geek-account-corrupt');
    const store = createStore(dir);
    await store.set(partition, 'savedMessages', 'first');
    const file = path.join(dir, 'Partitions', 'webview-page-account-1', 'geek-account-data.jsonl');
    await fsp.appendFile(file, '{not-json}\n', 'utf8');
    await assert.rejects(store.getAll(partition), { code: 'ACCOUNT_DATA_LOG_CORRUPT' });
  }

  {
    const dir = tempDir('geek-account-tail');
    const store = createStore(dir);
    await store.set(partition, 'savedMessages', 'first');
    const file = path.join(dir, 'Partitions', 'webview-page-account-1', 'geek-account-data.jsonl');
    await fsp.appendFile(file, '{"partial":', 'utf8');
    const fresh = createStore(dir);
    assert.deepEqual(await fresh.getAll(partition), { savedMessages: 'first' });
  }

  {
    const dir = tempDir('geek-account-compaction');
    const store = createStore(dir, { limits: { compactRecordCount: 2, compactFileBytes: 1024 * 1024 } });
    await store.set(partition, 'savedMessages', 'one');
    await store.set(partition, 'savedMessages', 'two');
    assert.deepEqual(await store.getAll(partition), { savedMessages: 'two' });
    const file = path.join(dir, 'Partitions', 'webview-page-account-1', 'geek-account-data.jsonl');
    const lines = (await fsp.readFile(file, 'utf8')).trim().split(/\r?\n/);
    assert.ok(lines.length <= 2, 'compaction should bound the active log');
  }

  {
    const dir = tempDir('geek-account-delete');
    const store = createStore(dir);
    await store.set(partition, 'savedMessages', 'before-delete');
    await store.beginDelete(partition);
    await assert.rejects(store.set(partition, 'savedMessages', 'late'), { code: 'ACCOUNT_DATA_PARTITION_DELETING' });
    store.cancelDelete(partition);
    assert.equal(await store.set(partition, 'savedMessages', 'after-cancel'), true);
    await store.beginDelete(partition);
    store.finalizeDelete(partition);
    await assert.rejects(store.set(partition, 'savedMessages', 'after-finalize'), { code: 'ACCOUNT_DATA_PARTITION_DELETING' });
  }

  {
    const dir = tempDir('geek-account-delete-waits');
    let writeStarted;
    let releaseWrite;
    const started = new Promise(resolve => { writeStarted = resolve; });
    const release = new Promise(resolve => { releaseWrite = resolve; });
    const slowFs = {
      ...fsp,
      async open(...args) {
        const handle = await fsp.open(...args);
        return {
          ...handle,
          stat: (...values) => handle.stat(...values),
          read: (...values) => handle.read(...values),
          async writeFile(...values) {
            writeStarted();
            await release;
            return handle.writeFile(...values);
          },
          sync: (...values) => handle.sync(...values),
          close: (...values) => handle.close(...values),
        };
      },
    };
    const store = createStore(dir, { fs: slowFs });
    const pendingSet = store.set(partition, 'savedMessages', 'queued');
    await started;
    let deleteFinished = false;
    const deleting = store.beginDelete(partition).then(() => { deleteFinished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deleteFinished, false, 'delete must wait for active append');
    releaseWrite();
    await pendingSet;
    await deleting;
    await assert.rejects(store.set(partition, 'savedMessages', 'late'), { code: 'ACCOUNT_DATA_PARTITION_DELETING' });
  }

  {
    const dir = tempDir('geek-account-no-crypto');
    const store = createAccountDataStore({
      fs: fsp,
      createReadStream: fs.createReadStream,
      getUserDataDir: () => dir,
      encrypt() { throw new Error('must not run'); },
      decrypt() { throw new Error('must not run'); },
      isEncryptionAvailable() { return false; },
    });
    await assert.rejects(store.getAll(partition), { code: 'SECURE_STORAGE_UNAVAILABLE' });
    await assert.rejects(store.set(partition, 'savedMessages', 'x'), { code: 'SECURE_STORAGE_UNAVAILABLE' });
  }

  {
    const dir = tempDir('geek-account-boundary');
    const accountId = 'account-1';
    const accountPartition = `persist:webview-page-${accountId}`;
    fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ accounts: [{ id: accountId, partition: accountPartition }] }), 'utf8');

    const resolver = createAccountPartitionResolver({ fs: fsp, getUserDataDir: () => dir });
    assert.equal(await resolver(accountId), accountPartition);
    await assert.rejects(resolver('../escape'), { code: 'ACCOUNT_DATA_ACCOUNT_INVALID' });

    const handlers = new Map();
    const ipcMain = {
      handle(channel, listener) {
        assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
        handlers.set(channel, listener);
      },
    };
    const sender = { id: 17 };
    const uiEntryPath = path.join(__dirname, '../ui/index.html');
    const window = {
      webContents: { id: 17, getURL: () => pathToFileURL(uiEntryPath).href },
      isDestroyed: () => false,
    };
    const BrowserWindow = { fromWebContents: candidate => candidate === sender ? window : null };

    const boundary = installAccountDataBoundary({
      ipcMain,
      BrowserWindow,
      uiEntryPath,
      fs: fsp,
      createReadStream: fs.createReadStream,
      getUserDataDir: () => dir,
      ...cryptoOptions(),
    });

    let removeCalls = 0;
    ipcMain.handle('accounts:remove', (event, id) => boundary.runAccountRemoval(event, id, async () => {
      removeCalls += 1;
      const state = JSON.parse(await fsp.readFile(path.join(dir, 'accounts.json'), 'utf8'));
      state.accounts = state.accounts.filter(item => item.id !== id);
      await fsp.writeFile(path.join(dir, 'accounts.json'), JSON.stringify(state), 'utf8');
      return 'REMOVED';
    }));

    const event = { sender };
    await handlers.get('account-data:set')(event, accountId, 'savedMessages', 'hello');
    assert.deepEqual(await handlers.get('account-data:get-all')(event, accountId), { savedMessages: 'hello' });
    await handlers.get('account-data:remove')(event, accountId, 'savedMessages');
    assert.deepEqual(await handlers.get('account-data:get-all')(event, accountId), {});
    await assert.rejects(
      handlers.get('account-data:set')(event, accountId, 'unknownKey', 'x'),
      { code: 'ACCOUNT_DATA_KEY_NOT_ALLOWED' },
    );
    await assert.rejects(
      handlers.get('account-data:get-all')({ sender: { id: 999 } }, accountId),
      { code: 'ACCOUNT_DATA_SENDER_INVALID' },
    );

    await handlers.get('account-data:set')(event, accountId, 'savedMessages', 'before-delete');
    assert.equal(await handlers.get('accounts:remove')(event, accountId), 'REMOVED');
    assert.equal(removeCalls, 1);
    await assert.rejects(
      handlers.get('account-data:get-all')(event, accountId),
      { code: 'ACCOUNT_DATA_ACCOUNT_MISSING' },
    );
  }

  console.log('ACCOUNT_DATA_STORE_CASES_OK');
}

module.exports = { runAccountDataStoreCases };