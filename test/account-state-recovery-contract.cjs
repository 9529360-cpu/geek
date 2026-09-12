'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ACCOUNT_PARTITION_PREFIX,
  ACCOUNT_STATE_RECOVERY_REQUIRED,
  createAccountStateStore,
} = require('../src/account-state.cjs');

const TYPES = {
  whatsapp: { name: 'WhatsApp' },
  website: { name: 'Website' },
  'telegram-z': { name: 'TelegramZ' },
};

function normalizeWebsiteUrl(value) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'https:') throw new Error('WEBSITE_URL_INVALID');
  return parsed.href;
}

function cryptoHarness() {
  let available = true;
  let decryptFailure = false;
  return {
    setAvailable(value) { available = value === true; },
    failDecrypt(value = true) { decryptFailure = value === true; },
    isEncryptionAvailable: () => available,
    encrypt(value) {
      return Buffer.from(`cipher:${value}`, 'utf8').toString('base64');
    },
    decrypt(value) {
      if (decryptFailure) throw new Error('synthetic decrypt failure');
      const decoded = Buffer.from(String(value), 'base64').toString('utf8');
      if (!decoded.startsWith('cipher:')) throw new Error('bad cipher');
      return decoded.slice('cipher:'.length);
    },
    encode(value) {
      return `enc:${Buffer.from(`cipher:${value}`, 'utf8').toString('base64')}`;
    },
  };
}

function createStore({ dir, adapter = fs, crypto = cryptoHarness(), ids = [], errors = [] }) {
  let index = 0;
  const file = path.join(dir, 'accounts.json');
  return {
    file,
    backup: `${file}.bak`,
    crypto,
    errors,
    store: createAccountStateStore({
      fs: adapter,
      filePath: file,
      resolveTypeConfig: type => TYPES[type] || null,
      normalizeWebsiteUrl,
      idFactory: () => ids[index++] || `ID_${index}`,
      now: () => '2026-09-12T00:00:00.000Z',
      isEncryptionAvailable: crypto.isEncryptionAvailable,
      encrypt: crypto.encrypt,
      decrypt: crypto.decrypt,
      onMigrationError(error, meta) {
        errors.push({ code: error?.code || error?.name || 'UNKNOWN', ...meta });
      },
    }),
  };
}

async function withTemp(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-account-recovery-'));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

async function readText(file) {
  return fs.readFile(file, 'utf8');
}

function diskState(crypto, { activeAccountId = 'A', accounts } = {}) {
  const list = accounts || [
    {
      id: 'A',
      type: 'whatsapp',
      name: 'Alpha',
      partition: 'ignored-on-load',
      customUrl: '',
      hpwd: crypto.encode('top-secret'),
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  return JSON.stringify({ activeAccountId, accounts: list }, null, 2);
}

async function bootstrapAndValidCurrent() {
  await withTemp(async dir => {
    const h = createStore({ dir, ids: ['A'] });
    assert.deepEqual(await h.store.load(), { activeAccountId: null, accounts: [] });
    assert.deepEqual(JSON.parse(await readText(h.file)), { activeAccountId: null, accounts: [] });
    assert.deepEqual(JSON.parse(await readText(h.backup)), { activeAccountId: null, accounts: [] });
    await h.store.add({ name: 'Alpha' });
    const before = h.store.getSnapshot();
    const restarted = createStore({ dir });
    assert.deepEqual(await restarted.store.load(), before);
  });
}

async function corruptionFailsClosed() {
  for (const [name, text] of [
    ['malformed', '{ nope'],
    ['truncated', '{"activeAccountId":"A","accounts":[{"id":"A"}'],
  ]) {
    await withTemp(async dir => {
      const h = createStore({ dir });
      await fs.writeFile(h.file, text, 'utf8');
      await assert.rejects(h.store.load(), error => error?.code === ACCOUNT_STATE_RECOVERY_REQUIRED, name);
      assert.equal(await readText(h.file), text, `${name}: target was overwritten`);
      assert.ok(!h.errors.some(item => JSON.stringify(item).includes('top-secret')));
    });
  }
}

function readFailureAdapter(target, code) {
  let injected = false;
  return {
    ...fs,
    async readFile(file, ...rest) {
      if (!injected && String(file) === target) {
        injected = true;
        throw Object.assign(new Error(`synthetic ${code}`), { code });
      }
      return fs.readFile(file, ...rest);
    },
  };
}

async function readFailuresDoNotOverwrite() {
  for (const code of ['EACCES', 'EIO']) {
    await withTemp(async dir => {
      const crypto = cryptoHarness();
      const target = path.join(dir, 'accounts.json');
      const original = diskState(crypto);
      await fs.writeFile(target, original, 'utf8');
      const h = createStore({ dir, crypto, adapter: readFailureAdapter(target, code) });
      await assert.rejects(h.store.load(), error => error?.code === ACCOUNT_STATE_RECOVERY_REQUIRED);
      assert.equal(await readText(target), original, `${code}: target was overwritten`);
    });
  }
}

async function recoversValidatedBackup() {
  await withTemp(async dir => {
    const crypto = cryptoHarness();
    const h = createStore({ dir, crypto, ids: ['C'] });
    const backup = diskState(crypto, {
      activeAccountId: 'B',
      accounts: [
        { id: 'A', type: 'website', name: 'Site A', partition: 'evil', customUrl: 'https://a.example/app', hpwd: crypto.encode('one'), createdAt: 'old-a' },
        { id: 'B', type: 'telegram-z', name: 'Bee', partition: 'evil2', customUrl: '', hpwd: crypto.encode('two'), createdAt: 'old-b' },
      ],
    });
    await fs.writeFile(h.file, '{broken', 'utf8');
    await fs.writeFile(h.backup, backup, 'utf8');
    const recovered = await h.store.load();
    assert.equal(recovered.activeAccountId, 'B');
    assert.deepEqual(recovered.accounts.map(account => account.id), ['A', 'B']);
    assert.deepEqual(recovered.accounts.map(account => account.type), ['website', 'telegram-z']);
    assert.deepEqual(recovered.accounts.map(account => account.partition), [
      `${ACCOUNT_PARTITION_PREFIX}A`, `${ACCOUNT_PARTITION_PREFIX}B`,
    ]);
    assert.equal(recovered.accounts[0].customUrl, 'https://a.example/app');
    assert.deepEqual(recovered.accounts.map(account => account.hpwd), ['one', 'two']);
    assert.ok(h.errors.some(item => item.phase === 'recovery' && item.recovered === true));

    const restart = createStore({ dir, crypto });
    assert.deepEqual(await restart.store.load(), recovered, 'restart after recovery changed state');

    await h.store.add({ type: 'whatsapp', name: 'Charlie' });
    assert.deepEqual(h.store.getSnapshot().accounts.map(account => account.id), ['A', 'B', 'C']);
  });
}

async function corruptBackupAlsoFailsClosed() {
  await withTemp(async dir => {
    const h = createStore({ dir });
    const target = '{bad-target';
    const backup = '{bad-backup';
    await fs.writeFile(h.file, target, 'utf8');
    await fs.writeFile(h.backup, backup, 'utf8');
    await assert.rejects(h.store.load(), error => error?.code === ACCOUNT_STATE_RECOVERY_REQUIRED);
    assert.equal(await readText(h.file), target);
    assert.equal(await readText(h.backup), backup);
  });
}

async function decryptFailurePreservesCiphertext() {
  await withTemp(async dir => {
    const crypto = cryptoHarness();
    const h = createStore({ dir, crypto });
    const original = diskState(crypto);
    await fs.writeFile(h.file, original, 'utf8');
    crypto.failDecrypt();
    await assert.rejects(h.store.load(), error => error?.code === ACCOUNT_STATE_RECOVERY_REQUIRED);
    const after = await readText(h.file);
    assert.equal(after, original);
    assert.match(after, /"hpwd": "enc:/);
    assert.ok(!after.includes('"hpwd": ""'));
  });
}

async function secureStorageUnavailableDuringMigrationPreservesPlaintext() {
  await withTemp(async dir => {
    const crypto = cryptoHarness();
    const h = createStore({ dir, crypto });
    const original = JSON.stringify({
      activeAccountId: 'A',
      accounts: [{ id: 'A', type: 'whatsapp', name: 'A', hpwd: 'legacy-plain-secret', createdAt: 'old' }],
    }, null, 2);
    await fs.writeFile(h.file, original, 'utf8');
    crypto.setAvailable(false);
    const loaded = await h.store.load();
    assert.equal(loaded.accounts[0].hpwd, 'legacy-plain-secret');
    assert.equal(await readText(h.file), original);
    assert.ok(h.errors.some(item => item.code === 'SECURE_STORAGE_UNAVAILABLE' && item.phase === 'migration'));
  });
}

async function backupDecryptFailureIsNotAccepted() {
  await withTemp(async dir => {
    const crypto = cryptoHarness();
    const h = createStore({ dir, crypto });
    await fs.writeFile(h.file, '{broken', 'utf8');
    await fs.writeFile(h.backup, diskState(crypto), 'utf8');
    crypto.failDecrypt();
    await assert.rejects(h.store.load(), error => error?.code === ACCOUNT_STATE_RECOVERY_REQUIRED);
    assert.equal(await readText(h.file), '{broken');
  });
}

async function durabilityUsesFileSync() {
  await withTemp(async dir => {
    let syncs = 0;
    const adapter = {
      ...fs,
      async open(...args) {
        const handle = await fs.open(...args);
        const originalSync = handle.sync.bind(handle);
        handle.sync = async () => { syncs += 1; return originalSync(); };
        return handle;
      },
    };
    const h = createStore({ dir, adapter });
    await h.store.load();
    assert.ok(syncs >= 2, `expected synced temp/backup writes, got ${syncs}`);
  });
}

const CASES = {
  bootstrap: bootstrapAndValidCurrent,
  corrupt: corruptionFailsClosed,
  'read-errors': readFailuresDoNotOverwrite,
  recovery: recoversValidatedBackup,
  'corrupt-backup': corruptBackupAlsoFailsClosed,
  decrypt: decryptFailurePreservesCiphertext,
  'migration-storage': secureStorageUnavailableDuringMigrationPreservesPlaintext,
  'backup-decrypt': backupDecryptFailureIsNotAccepted,
  durability: durabilityUsesFileSync,
};

async function main() {
  const only = process.argv[2];
  if (only) {
    assert.ok(CASES[only], `unknown case: ${only}`);
    await CASES[only]();
    console.log(`account-state recovery contract passed: ${only}`);
    return;
  }
  for (const [name, run] of Object.entries(CASES)) {
    await run();
    console.log(`account-state recovery contract passed: ${name}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
