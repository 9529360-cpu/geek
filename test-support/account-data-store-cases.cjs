'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
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

function record(key, value, deleted = false) {
  return JSON.stringify({
    key,
    deleted,
    at: 1,
    value: cryptoOptions().encrypt(value),
  }) + '\n';
}

async function runAccountDataStoreCases() {
  const partition = 'persist:webview-page-test';

  {
    const dir = tempDir('geek-account-basic');
    const store = createStore(dir);
    assert.deepEqual(store.allowedKeys, ACCOUNT_DATA_KEYS);
    await assert.rejects(store.set(partition, 'notAllowed', 'x'), { code: 'ACCOUNT_DATA_KEY_NOT_ALLOWED' });
    await assert.rejects(
      store.set(partition, 'savedMessages', 'x'.repeat(2 * 1024 * 1024 + 1)),
      { code: 'ACCOUNT_DATA_VALUE_TOO_LARGE' },
    );
    await store.set(partition, 'savedMessages', 'secret message');
    await store.set(partition, '__schema', '1');
    assert.deepEqual(await store.getAll(partition), { savedMessages: 'secret message', __schema: '1' });
    const disk = fs.readFileSync(store.fileFor(partition), 'utf8');
    assert.doesNotMatch(disk, /secret message/, 'plaintext must not reach disk');
    await store.remove(partition, 'savedMessages');
    assert.deepEqual(await store.getAll(partition), { __schema: '1' });
  }

  {
    const dir = tempDir('geek-account-compact');
    const store = createStore(dir, { limits: { compactRecordCount: 3, compactFileBytes: 1024 * 1024 } });
    await store.set(partition, 'savedMessages', 'one');
    await store.set(partition, 'savedMessages', 'two');
    await store.set(partition, 'savedMessages', 'three');
    const lines = fs.readFileSync(store.fileFor(partition), 'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length, 1, 'repeated keys must compact to one live record');
    assert.equal((await store.getAll(partition)).savedMessages, 'three');
  }

  {
    const dir = tempDir('geek-account-tail');
    const store = createStore(dir);
    const file = store.fileFor(partition);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, record('savedMessages', 'good') + '{"key":"savedMessages","value":', 'utf8');
    assert.deepEqual(await store.getAll(partition), { savedMessages: 'good' });
    const repaired = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert.equal(repaired.length, 1, 'corrupt final record must be compacted away');
  }


  {
    const dir = tempDir('geek-account-tail-rename-fail');
    const normalStore = createStore(dir);
    const file = normalStore.fileFor(partition);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, record('savedMessages', 'good') + '{"key":"savedMessages","value":', 'utf8');
    const originalSize = fs.statSync(file).size;
    const faultFs = {
      ...fsp,
      async rename(source, target) {
        if (String(source).endsWith('.compact.tmp')) {
          throw Object.assign(new Error('rename blocked'), { code: 'EPERM' });
        }
        return fsp.rename(source, target);
      },
    };
    const store = createStore(dir, { fs: faultFs });
    assert.equal((await store.getAll(partition)).savedMessages, 'good');
    await assert.rejects(
      store.set(partition, 'savedMessages', 'must-not-append'),
      { code: 'ACCOUNT_DATA_REPAIR_REQUIRED' },
    );
    assert.equal(fs.statSync(file).size, originalSize, 'unrepaired corrupt tail must block later append');
  }

  {
    const dir = tempDir('geek-account-middle');
    const store = createStore(dir);
    const file = store.fileFor(partition);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, record('savedMessages', 'one') + '{bad}\n' + record('savedMessages', 'two'), 'utf8');
    await assert.rejects(store.getAll(partition), { code: 'ACCOUNT_DATA_LOG_CORRUPT' });
  }

  {
    const dir = tempDir('geek-account-append-fail');
    let failNextAppend = false;
    const faultFs = {
      ...fsp,
      async open(file, flags, ...rest) {
        const handle = await fsp.open(file, flags, ...rest);
        if (flags !== 'a' || !failNextAppend) return handle;
        failNextAppend = false;
        return {
          writeFile: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
          sync: (...args) => handle.sync(...args),
          close: (...args) => handle.close(...args),
        };
      },
    };
    const store = createStore(dir, { fs: faultFs });
    await store.set(partition, 'savedMessages', 'before');
    failNextAppend = true;
    await assert.rejects(store.set(partition, 'savedMessages', 'after'), /disk full/);
    assert.equal((await store.getAll(partition)).savedMessages, 'before', 'failed append must not mutate cache');
    assert.equal((await createStore(dir).getAll(partition)).savedMessages, 'before', 'disk and memory must agree');
  }

  {
    const dir = tempDir('geek-account-rename-fail');
    let failRename = true;
    let compactionErrors = 0;
    const faultFs = {
      ...fsp,
      async rename(source, target) {
        if (failRename && String(source).endsWith('.compact.tmp')) {
          failRename = false;
          throw Object.assign(new Error('rename blocked'), { code: 'EPERM' });
        }
        return fsp.rename(source, target);
      },
    };
    const store = createStore(dir, {
      fs: faultFs,
      limits: { compactRecordCount: 2, compactFileBytes: 1024 * 1024 },
      onCompactionError() { compactionErrors += 1; },
    });
    await store.set(partition, 'savedMessages', 'one');
    await store.set(partition, 'savedMessages', 'two');
    assert.equal(compactionErrors, 1, 'rename failure must be reported');
    assert.equal(fs.existsSync(store.tempFileFor(partition)), false, 'failed temp must be cleaned when possible');
    assert.equal((await createStore(dir).getAll(partition)).savedMessages, 'two', 'original append log must remain authoritative');
    assert.equal((await store.getAll(partition)).savedMessages, 'two');
    assert.equal(fs.readFileSync(store.fileFor(partition), 'utf8').trim().split(/\r?\n/).length, 1, 'later access must retry compaction');
    await store.set(partition, 'savedMessages', 'three');
    assert.equal(fs.readFileSync(store.fileFor(partition), 'utf8').trim().split(/\r?\n/).length, 1, 'new threshold crossing must compact again');
  }

  {
    const dir = tempDir('geek-account-orphan');
    const store = createStore(dir);
    const target = store.fileFor(partition);
    const temporary = store.tempFileFor(partition);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, record('savedMessages', 'recovered'), 'utf8');
    assert.equal((await store.getAll(partition)).savedMessages, 'recovered');
    assert.equal(fs.existsSync(target), true, 'valid orphan temp must be promoted when target is absent');
    assert.equal(fs.existsSync(temporary), false);
  }

  {
    const dir = tempDir('geek-account-orphan-authoritative');
    const store = createStore(dir);
    const target = store.fileFor(partition);
    const temporary = store.tempFileFor(partition);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, record('savedMessages', 'target'), 'utf8');
    fs.writeFileSync(temporary, record('savedMessages', 'stale-temp'), 'utf8');
    assert.equal((await store.getAll(partition)).savedMessages, 'target');
    assert.equal(fs.existsSync(temporary), false, 'target must win over stale temp');
  }

  {
    const dir = tempDir('geek-account-delete');
    let releaseWrite;
    let writeStarted;
    const started = new Promise((resolve) => { writeStarted = resolve; });
    const release = new Promise((resolve) => { releaseWrite = resolve; });
    const slowFs = {
      ...fsp,
      async open(file, flags, ...rest) {
        const handle = await fsp.open(file, flags, ...rest);
        if (flags !== 'a') return handle;
        return {
          async writeFile(...args) {
            writeStarted();
            await release;
            return handle.writeFile(...args);
          },
          sync: (...args) => handle.sync(...args),
          close: (...args) => handle.close(...args),
        };
      },
    };
    const store = createStore(dir, { fs: slowFs });
    const pendingSet = store.set(partition, 'savedMessages', 'queued');
    await started;
    let deleteFinished = false;
    const deleting = store.beginDelete(partition).then(() => { deleteFinished = true; });
    await new Promise((resolve) => setImmediate(resolve));
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
    const originalHandle = ipcMain.handle;
    const sender = { id: 17 };
    const window = {
      webContents: { id: 17, getURL: () => 'file:///app/ui/index.html' },
      isDestroyed: () => false,
    };
    const BrowserWindow = { fromWebContents: (candidate) => candidate === sender ? window : null };

    installAccountDataBoundary({
      ipcMain,
      BrowserWindow,
      uiEntryPath: '/app/ui/index.html',
      fs: fsp,
      createReadStream: fs.createReadStream,
      getUserDataDir: () => dir,
      ...cryptoOptions(),
    });

    let oldAccountDataCalls = 0;
    for (const channel of ['account-data:get-all', 'account-data:set', 'account-data:remove']) {
      ipcMain.handle(channel, async () => { oldAccountDataCalls += 1; return 'OLD'; });
    }
    let removeCalls = 0;
    ipcMain.handle('accounts:remove', async (_event, id) => {
      removeCalls += 1;
      const state = JSON.parse(await fsp.readFile(path.join(dir, 'accounts.json'), 'utf8'));
      state.accounts = state.accounts.filter((item) => item.id !== id);
      await fsp.writeFile(path.join(dir, 'accounts.json'), JSON.stringify(state), 'utf8');
      return 'REMOVED';
    });

    assert.equal(ipcMain.handle, originalHandle, 'all expected registrations must restore ipcMain.handle');
    const event = { sender };
    await handlers.get('account-data:set')(event, accountId, 'savedMessages', 'hello');
    assert.deepEqual(await handlers.get('account-data:get-all')(event, accountId), { savedMessages: 'hello' });
    await handlers.get('account-data:remove')(event, accountId, 'savedMessages');
    assert.deepEqual(await handlers.get('account-data:get-all')(event, accountId), {});
    assert.equal(oldAccountDataCalls, 0, 'legacy in-main account-data listeners must stay inactive');
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
