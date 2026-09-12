'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAccountStateStore, ACCOUNT_PARTITION_PREFIX } = require('../src/account-state.cjs');

const TYPES = {
  whatsapp: { name: 'WhatsApp', short: 'WA', url: 'https://web.whatsapp.com/' },
  website: { name: 'Website', short: 'WEB' },
  'telegram-z': { name: 'TelegramZ', short: 'TGZ', url: 'https://web.telegram.org/a' },
};

function normalizeWebsiteUrl(value) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    const error = new Error('WEBSITE_URL_INVALID');
    error.code = 'WEBSITE_URL_INVALID';
    throw error;
  }
  return parsed.href;
}

function cryptoHarness() {
  let failEncrypt = false;
  let encryptionAvailable = true;
  return {
    failNextEncrypt() { failEncrypt = true; },
    setEncryptionAvailable(value) { encryptionAvailable = value === true; },
    isEncryptionAvailable: () => encryptionAvailable,
    encrypt(value) {
      if (failEncrypt) {
        failEncrypt = false;
        throw new Error('synthetic encrypt failure');
      }
      return Buffer.from(`cipher:${value}`, 'utf8').toString('base64');
    },
    decrypt(value) {
      const decoded = Buffer.from(value, 'base64').toString('utf8');
      if (!decoded.startsWith('cipher:')) throw new Error('bad cipher');
      return decoded.slice('cipher:'.length);
    },
  };
}

function fsHarness(realFs) {
  const failure = { write: false, rename: false, mkdir: false };
  let blockedWrite = null;
  let writeEntered = null;
  const adapter = {
    readFile: (...args) => realFs.readFile(...args),
    rm: (...args) => realFs.rm(...args),
    async mkdir(...args) {
      if (failure.mkdir) {
        failure.mkdir = false;
        throw Object.assign(new Error('synthetic mkdir failure'), { code: 'EACCES' });
      }
      return realFs.mkdir(...args);
    },
    async writeFile(...args) {
      if (failure.write) {
        failure.write = false;
        throw Object.assign(new Error('synthetic write failure'), { code: 'EIO' });
      }
      if (blockedWrite) {
        writeEntered?.();
        await blockedWrite;
        blockedWrite = null;
        writeEntered = null;
      }
      return realFs.writeFile(...args);
    },
    async rename(...args) {
      if (failure.rename) {
        failure.rename = false;
        throw Object.assign(new Error('synthetic rename failure'), { code: 'EACCES' });
      }
      return realFs.rename(...args);
    },
  };
  return {
    adapter,
    failNext(kind) { failure[kind] = true; },
    blockNextWrite() {
      let release;
      let enteredResolve;
      const entered = new Promise(resolve => { enteredResolve = resolve; });
      blockedWrite = new Promise(resolve => { release = resolve; });
      writeEntered = enteredResolve;
      return { entered, release };
    },
  };
}

function createStore({ dir, ids = [], clockStart = 0, crypto = cryptoHarness(), fsh = fsHarness(fs), onMigrationError = () => {} } = {}) {
  let idIndex = 0;
  let clock = clockStart;
  const store = createAccountStateStore({
    fs: fsh.adapter,
    filePath: path.join(dir, 'accounts.json'),
    resolveTypeConfig: type => TYPES[type] || null,
    normalizeWebsiteUrl,
    idFactory: () => ids[idIndex++] || `GEN_${idIndex}`,
    now: () => `2026-09-12T00:00:${String(clock++).padStart(2, '0')}.000Z`,
    isEncryptionAvailable: crypto.isEncryptionAvailable,
    encrypt: crypto.encrypt,
    decrypt: crypto.decrypt,
    onMigrationError,
  });
  return { store, crypto, fsh, file: path.join(dir, 'accounts.json') };
}

async function readDisk(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function withTemp(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-account-state-'));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

async function startupCompatibility() {
  await withTemp(async dir => {
    const h = createStore({ dir });
    assert.deepEqual(await h.store.load(), { activeAccountId: null, accounts: [] });
    assert.deepEqual(await readDisk(h.file), { activeAccountId: null, accounts: [] });
  });
  await withTemp(async dir => {
    const file = path.join(dir, 'accounts.json');
    await fs.writeFile(file, JSON.stringify({
      activeAccountId: 'B',
      accounts: [
        { id: 'A', type: 'website', name: '  Alpha   Site  ', partition: 'attacker-controlled', customUrl: 'https://a.example/', hpwd: 'legacy-plain', createdAt: 'old-a' },
        { id: 'B', type: 'telegram-z', name: 'Bee', fontSize: 20, fontColor: '#123456', protocal: 'socks5', createdAt: 'old-b' },
      ],
    }), 'utf8');
    const h = createStore({ dir });
    const state = await h.store.load();
    assert.equal(state.activeAccountId, 'B');
    assert.equal(state.accounts[0].name, 'Alpha Site');
    assert.equal(state.accounts[0].partition, `${ACCOUNT_PARTITION_PREFIX}A`);
    assert.equal(state.accounts[0].hpwd, 'legacy-plain');
    assert.equal(state.accounts[1].fontSize, 20);
    assert.equal(state.accounts[1].protocal, 'socks5');
    const disk = await fs.readFile(file, 'utf8');
    assert.ok(!disk.includes('legacy-plain'));
  });
  await withTemp(async dir => {
    const file = path.join(dir, 'accounts.json');
    await fs.writeFile(file, JSON.stringify([
      { id: 'LEG_A', name: 'A', type: 'unknown-old-type' },
      { id: 'LEG_B', name: 'B', active: true, type: 'whatsapp' },
      { id: 'LEG_B', name: 'duplicate' },
      { id: 'bad id', name: 'bad' },
      null,
    ]), 'utf8');
    const h = createStore({ dir });
    const state = await h.store.load();
    assert.equal(state.accounts.length, 2);
    assert.equal(state.accounts[0].type, 'whatsapp');
    assert.equal(state.activeAccountId, 'LEG_B');
  });
}

async function transitions() {
  await withTemp(async dir => {
    const h = createStore({ dir, ids: ['A', 'W', 'T'] });
    await h.store.load();
    const a = await h.store.add('  Primary   Account  ');
    assert.equal(a.account.type, 'whatsapp');
    assert.equal(a.account.name, 'Primary Account');
    assert.equal(a.account.partition, `${ACCOUNT_PARTITION_PREFIX}A`);
    assert.equal(a.snapshot.activeAccountId, 'A');
    const website = await h.store.add({ type: 'website', name: 'Site', customUrl: 'https://example.test/app' });
    assert.equal(website.account.customUrl, 'https://example.test/app');
    await assert.rejects(h.store.add({ type: 'nope' }), /ACCOUNT_TYPE_UNSUPPORTED/);
    await assert.rejects(h.store.add({ type: 'website', customUrl: 'http://bad.test/' }), /WEBSITE_URL_INVALID/);
    const tg = await h.store.add({ type: 'telegram-z', name: 'TG' });
    assert.equal(tg.account.type, 'telegram-z');
    await h.store.activate('A');
    await assert.rejects(h.store.activate('MISSING'), /账号不存在/);
    await assert.rejects(h.store.activate('bad id'), /无效的账号 ID/);
    const identityBefore = h.store.findById('W');
    await h.store.update('W', {
      name: ' Renamed  Site ', fontSize: 22, fontColor: '#ABCDEF', openProxy: true,
      protocal: 'socks5', host: '127.0.0.1', port: '1080', huser: 'u', hpwd: 'fake-password',
      id: 'EVIL', partition: 'persist:evil', type: 'whatsapp', customUrl: 'https://evil.test/',
    });
    const updated = h.store.findById('W');
    assert.equal(updated.name, 'Renamed Site');
    assert.equal(updated.fontSize, 22);
    assert.equal(updated.fontColor, '#ABCDEF');
    assert.equal(updated.openProxy, true);
    assert.equal(updated.protocal, 'socks5');
    assert.equal(updated.hpwd, 'fake-password');
    assert.equal(updated.id, identityBefore.id);
    assert.equal(updated.partition, identityBefore.partition);
    assert.equal(updated.type, identityBefore.type);
    assert.equal(updated.customUrl, identityBefore.customUrl);
    await h.store.move('T', 'up');
    assert.deepEqual(h.store.getSnapshot().accounts.map(x => x.id), ['A', 'T', 'W']);
    await assert.rejects(h.store.move('A', 'up'), /边缘位置/);
    await h.store.move('A', 'down');
    assert.deepEqual(h.store.getSnapshot().accounts.map(x => x.id), ['T', 'A', 'W']);
    await assert.rejects(h.store.move('W', 'down'), /边缘位置/);
    await h.store.moveTo('W', -99);
    assert.deepEqual(h.store.getSnapshot().accounts.map(x => x.id), ['W', 'T', 'A']);
    await h.store.moveTo('W', 999);
    assert.deepEqual(h.store.getSnapshot().accounts.map(x => x.id), ['T', 'A', 'W']);
    await h.store.activate('A');
    const removedA = await h.store.remove('A');
    assert.equal(removedA.snapshot.activeAccountId, 'W');
    await h.store.remove('T');
    await assert.rejects(h.store.remove('MISSING'), /账号不存在/);
    await assert.rejects(h.store.remove('bad id'), /无效的账号 ID/);
    await h.store.remove('W');
    assert.equal(h.store.getSnapshot().activeAccountId, null);
  });
}

async function encryptedPersistenceAndRestart() {
  await withTemp(async dir => {
    const h1 = createStore({ dir, ids: ['A', 'B'] });
    await h1.store.load();
    await h1.store.add({ name: 'A' });
    await h1.store.update('A', { hpwd: 'fake-secret-value', openProxy: true, host: 'proxy.test', port: '8080' });
    await h1.store.add({ name: 'B' });
    await h1.store.move('B', 'up');
    await h1.store.activate('A');
    const before = h1.store.getSnapshot();
    const diskText = await fs.readFile(h1.file, 'utf8');
    assert.ok(!diskText.includes('fake-secret-value'));
    assert.match(diskText, /"hpwd": "enc:/);
    const h2 = createStore({ dir });
    const restored = await h2.store.load();
    assert.deepEqual(restored, before);
    assert.equal(h2.store.findById('A').hpwd, 'fake-secret-value');
  });
}

async function failureIsolation() {
  for (const kind of ['secure-storage', 'encrypt', 'mkdir', 'write', 'rename']) {
    await withTemp(async dir => {
      const h = createStore({ dir, ids: ['A'] });
      await h.store.load();
      await h.store.add({ name: 'A' });
      await h.store.update('A', { hpwd: 'seed-secret' });
      const beforeMemory = h.store.getSnapshot();
      const beforeDisk = await fs.readFile(h.file, 'utf8');
      let notifications = 0;
      const mutateAndNotify = async () => {
        const result = await h.store.update('A', { name: `should-not-commit-${kind}` });
        notifications += 1;
        return result;
      };
      if (kind === 'secure-storage') h.crypto.setEncryptionAvailable(false);
      else if (kind === 'encrypt') h.crypto.failNextEncrypt();
      else h.fsh.failNext(kind);
      await assert.rejects(mutateAndNotify());
      assert.deepEqual(h.store.getSnapshot(), beforeMemory, `${kind}: memory changed after rejected transaction`);
      assert.equal(await fs.readFile(h.file, 'utf8'), beforeDisk, `${kind}: disk changed after rejected transaction`);
      assert.equal(notifications, 0, `${kind}: post-commit notification fired`);
    });
  }
}

async function failedThenSuccessfulDoesNotResurrect() {
  await withTemp(async dir => {
    const h = createStore({ dir, ids: ['A', 'FAILED', 'SUCCESS'] });
    await h.store.load();
    await h.store.add({ name: 'A' });
    h.fsh.failNext('rename');
    await assert.rejects(h.store.add({ name: 'FAILED' }), /synthetic rename failure/);
    await h.store.add({ name: 'SUCCESS' });
    assert.deepEqual(h.store.getSnapshot().accounts.map(x => x.id), ['A', 'SUCCESS']);
    assert.deepEqual((await readDisk(h.file)).accounts.map(x => x.id), ['A', 'SUCCESS']);
  });
}

async function concurrentTransactionsSerializeWholeTransition() {
  await withTemp(async dir => {
    const ids = [];
    let next = 0;
    const fsh = fsHarness(fs);
    const crypto = cryptoHarness();
    const store = createAccountStateStore({
      fs: fsh.adapter,
      filePath: path.join(dir, 'accounts.json'),
      resolveTypeConfig: type => TYPES[type] || null,
      normalizeWebsiteUrl,
      idFactory: () => { const id = ['FIRST', 'SECOND'][next++]; ids.push(id); return id; },
      now: () => '2026-09-12T00:00:00.000Z',
      isEncryptionAvailable: crypto.isEncryptionAvailable,
      encrypt: crypto.encrypt,
      decrypt: crypto.decrypt,
    });
    await store.load();
    const gate = fsh.blockNextWrite();
    const first = store.add({ name: 'first' });
    const second = store.add({ name: 'second' });
    await gate.entered;
    assert.deepEqual(ids, ['FIRST']);
    assert.deepEqual(store.getSnapshot().accounts, []);
    gate.release();
    await Promise.all([first, second]);
    assert.deepEqual(ids, ['FIRST', 'SECOND']);
    assert.deepEqual(store.getSnapshot().accounts.map(x => x.id), ['FIRST', 'SECOND']);
  });
}

async function migrationFailureKeepsLoadedStateAndOriginalDisk() {
  await withTemp(async dir => {
    const file = path.join(dir, 'accounts.json');
    const original = JSON.stringify({ activeAccountId: 'A', accounts: [{ id: 'A', name: 'A', hpwd: 'legacy-secret' }] }, null, 2);
    await fs.writeFile(file, original, 'utf8');
    const fsh = fsHarness(fs);
    fsh.failNext('rename');
    const errors = [];
    const h = createStore({ dir, fsh, onMigrationError: (error, meta) => errors.push([error.message, meta.phase]) });
    const loaded = await h.store.load();
    assert.equal(loaded.accounts[0].hpwd, 'legacy-secret');
    assert.equal(await fs.readFile(file, 'utf8'), original);
    assert.equal(errors.at(-1)?.[1], 'migration');
  });
}

const CASES = {
  startup: startupCompatibility,
  transitions,
  restart: encryptedPersistenceAndRestart,
  'failure-isolation': failureIsolation,
  'queue-regression': failedThenSuccessfulDoesNotResurrect,
  concurrency: concurrentTransactionsSerializeWholeTransition,
  migration: migrationFailureKeepsLoadedStateAndOriginalDisk,
};

(async () => {
  const focus = String(process.env.ACCOUNT_STATE_TEST_FOCUS || '').trim();
  if (focus) {
    if (!CASES[focus]) throw new Error(`Unknown ACCOUNT_STATE_TEST_FOCUS: ${focus}`);
    await CASES[focus]();
  } else {
    for (const run of Object.values(CASES)) await run();
  }
  console.log('ACCOUNT_STATE_TRANSACTION_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
