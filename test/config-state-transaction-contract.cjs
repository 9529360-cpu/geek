'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  CONFIG_STATE_RECOVERY_REQUIRED,
  DEFAULT_CONFIG,
  createConfigStateStore,
} = require('../src/config-state.cjs');

function cryptoHarness() {
  let available = true;
  let failEncrypt = false;
  let failDecrypt = false;
  return {
    setAvailable(value) { available = value === true; },
    failNextEncrypt() { failEncrypt = true; },
    failDecrypt(value = true) { failDecrypt = value === true; },
    isEncryptionAvailable: () => available,
    encrypt(value) {
      if (failEncrypt) { failEncrypt = false; throw new Error('synthetic encrypt failure'); }
      return Buffer.from(`cipher:${value}`, 'utf8').toString('base64');
    },
    decrypt(value) {
      if (failDecrypt) throw new Error('synthetic decrypt failure');
      const decoded = Buffer.from(String(value), 'base64').toString('utf8');
      if (!decoded.startsWith('cipher:')) throw new Error('bad cipher');
      return decoded.slice('cipher:'.length);
    },
    encode(value) { return `enc:${Buffer.from(`cipher:${value}`, 'utf8').toString('base64')}`; },
  };
}

function makeStore({ dir, adapter = fs, crypto = cryptoHarness(), events = [] }) {
  const file = path.join(dir, 'config.json');
  return {
    file,
    backup: `${file}.bak`,
    crypto,
    events,
    store: createConfigStateStore({
      fs: adapter,
      filePath: file,
      isEncryptionAvailable: crypto.isEncryptionAvailable,
      encrypt: crypto.encrypt,
      decrypt: crypto.decrypt,
      onRecoveryEvent(error, meta) { events.push({ code: error?.code || error?.name || 'UNKNOWN', ...meta }); },
    }),
  };
}

async function withTemp(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-config-state-'));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

async function normalLoadAndEncryptedRestart() {
  await withTemp(async dir => {
    const h = makeStore({ dir });
    assert.deepEqual(await h.store.load(), { ...DEFAULT_CONFIG, broadcastGroups: [] });
    const updated = await h.store.update({ theme: 'dark', lockPassword: 'lock', password: 'proxy', broadcastGroups: [{ id: 'g', name: 'G' }] });
    assert.equal(updated.theme, 'dark');
    const raw = await fs.readFile(h.file, 'utf8');
    assert.match(raw, /"lockPassword": "enc:/);
    assert.match(raw, /"password": "enc:/);
    assert.ok(!raw.includes('"lockPassword": "lock"'));
    const restart = makeStore({ dir, crypto: h.crypto });
    assert.deepEqual(await restart.store.load(), updated);
  });
}

async function plaintextMigration() {
  await withTemp(async dir => {
    const h = makeStore({ dir });
    const legacy = JSON.stringify({ ...DEFAULT_CONFIG, lockPassword: 'legacy-lock', password: 'legacy-proxy' }, null, 2);
    await fs.writeFile(h.file, legacy, 'utf8');
    const loaded = await h.store.load();
    assert.equal(loaded.lockPassword, 'legacy-lock');
    assert.equal(loaded.password, 'legacy-proxy');
    const migrated = await fs.readFile(h.file, 'utf8');
    assert.match(migrated, /"lockPassword": "enc:/);
    assert.match(migrated, /"password": "enc:/);
  });
}

async function normalizationContract() {
  await withTemp(async dir => {
    const h = makeStore({ dir });
    await h.store.load();
    const snapshot = await h.store.update({
      autoLaunch: true,
      theme: 'invalid',
      accent: 'purple',
      protocal: 'wat',
      broadcastGroups: [{ id: 'ok', name: 'Okay' }, { id: '', name: 'bad' }, null],
    });
    assert.equal(snapshot.autoLaunch, true);
    assert.equal(snapshot.theme, 'system');
    assert.equal(snapshot.accent, 'purple');
    assert.equal(snapshot.protocal, 'http');
    assert.deepEqual(snapshot.broadcastGroups, [{ id: 'ok', name: 'Okay' }]);
  });
}

function failureAdapter(target, kind) {
  let hit = false;
  let armed = false;
  return {
    arm() { armed = true; },
    adapter: {
      ...fs,
      async mkdir(...args) {
        if (armed && !hit && kind === 'mkdir') { hit = true; throw Object.assign(new Error('mkdir fail'), { code: 'EACCES' }); }
        return fs.mkdir(...args);
      },
      async open(file, flags, ...rest) {
        if (armed && !hit && kind === 'write' && String(file).endsWith('.tmp') && !String(file).endsWith('.bak.tmp')) {
          hit = true; throw Object.assign(new Error('write fail'), { code: 'EIO' });
        }
        return fs.open(file, flags, ...rest);
      },
      async rename(from, to) {
        if (armed && !hit && kind === 'rename' && String(to) === target) { hit = true; throw Object.assign(new Error('rename fail'), { code: 'EIO' }); }
        return fs.rename(from, to);
      },
    },
  };
}

async function failedMutationDoesNotCommitOrResurrect() {
  for (const kind of ['mkdir', 'write', 'rename']) {
    await withTemp(async dir => {
      const base = makeStore({ dir });
      await base.store.load();
      await base.store.update({ theme: 'dark', host: 'before' });
      const beforeDisk = await fs.readFile(base.file, 'utf8');
      const failure = failureAdapter(base.file, kind);
      const h = makeStore({ dir, adapter: failure.adapter, crypto: base.crypto });
      await h.store.load();
      const before = h.store.getSnapshot();
      failure.arm();
      await assert.rejects(h.store.update({ host: `failed-${kind}` }));
      assert.deepEqual(h.store.getSnapshot(), before, `${kind}: memory committed failed mutation`);
      assert.equal(await fs.readFile(h.file, 'utf8'), beforeDisk, `${kind}: disk target changed`);
      const after = await h.store.update({ port: '8080' });
      assert.equal(after.host, 'before', `${kind}: failed mutation resurrected`);
      assert.equal(after.port, '8080');
    });
  }
}

async function encryptFailureDoesNotCommit() {
  await withTemp(async dir => {
    const h = makeStore({ dir });
    await h.store.load();
    await h.store.update({ lockPassword: 'old' });
    const before = h.store.getSnapshot();
    const beforeDisk = await fs.readFile(h.file, 'utf8');
    h.crypto.failNextEncrypt();
    await assert.rejects(h.store.update({ lockPassword: 'new' }), /加密失败/);
    assert.deepEqual(h.store.getSnapshot(), before);
    assert.equal(await fs.readFile(h.file, 'utf8'), beforeDisk);
  });
}

async function malformedFailsClosedAndBackupRecovers() {
  await withTemp(async dir => {
    const h = makeStore({ dir });
    const corrupt = '{broken';
    await fs.writeFile(h.file, corrupt, 'utf8');
    await assert.rejects(h.store.load(), error => error?.code === CONFIG_STATE_RECOVERY_REQUIRED);
    assert.equal(await fs.readFile(h.file, 'utf8'), corrupt);
  });
  await withTemp(async dir => {
    const crypto = cryptoHarness();
    const h = makeStore({ dir, crypto });
    const backup = JSON.stringify({ ...DEFAULT_CONFIG, theme: 'dark', lockPassword: crypto.encode('secret') }, null, 2);
    await fs.writeFile(h.file, '{broken', 'utf8');
    await fs.writeFile(h.backup, backup, 'utf8');
    const recovered = await h.store.load();
    assert.equal(recovered.theme, 'dark');
    assert.equal(recovered.lockPassword, 'secret');
    assert.ok(h.events.some(item => item.phase === 'recovery' && item.recovered === true));
    const restart = makeStore({ dir, crypto });
    assert.deepEqual(await restart.store.load(), recovered);
  });
}

async function decryptFailurePreservesCiphertext() {
  await withTemp(async dir => {
    const crypto = cryptoHarness();
    const h = makeStore({ dir, crypto });
    const original = JSON.stringify({ ...DEFAULT_CONFIG, lockPassword: crypto.encode('lock'), password: crypto.encode('proxy') }, null, 2);
    await fs.writeFile(h.file, original, 'utf8');
    crypto.failDecrypt();
    await assert.rejects(h.store.load(), error => error?.code === CONFIG_STATE_RECOVERY_REQUIRED);
    assert.equal(await fs.readFile(h.file, 'utf8'), original);
  });
}

async function secureStorageUnavailablePreservesPlaintextMigration() {
  await withTemp(async dir => {
    const crypto = cryptoHarness();
    const h = makeStore({ dir, crypto });
    const original = JSON.stringify({ ...DEFAULT_CONFIG, lockPassword: 'plain-lock' }, null, 2);
    await fs.writeFile(h.file, original, 'utf8');
    crypto.setAvailable(false);
    const loaded = await h.store.load();
    assert.equal(loaded.lockPassword, 'plain-lock');
    assert.equal(await fs.readFile(h.file, 'utf8'), original);
    assert.ok(h.events.some(item => item.phase === 'migration' && item.code === 'SECURE_STORAGE_UNAVAILABLE'));
  });
}

async function concurrentTransactionsSerializeWholeMutation() {
  await withTemp(async dir => {
    let gateResolve;
    let firstTargetRename = true;
    const gate = new Promise(resolve => { gateResolve = resolve; });
    const target = path.join(dir, 'config.json');
    const adapter = {
      ...fs,
      async rename(from, to) {
        if (String(to) === target && firstTargetRename) {
          firstTargetRename = false;
          await gate;
        }
        return fs.rename(from, to);
      },
    };
    const h = makeStore({ dir, adapter });
    const boot = h.store.load();
    gateResolve();
    await boot;
    const one = h.store.update({ host: 'one' });
    const two = h.store.update({ port: 'two' });
    await Promise.all([one, two]);
    const final = h.store.getSnapshot();
    assert.equal(final.host, 'one');
    assert.equal(final.port, 'two');
  });
}

const CASES = {
  normal: normalLoadAndEncryptedRestart,
  plaintext: plaintextMigration,
  normalize: normalizationContract,
  failures: failedMutationDoesNotCommitOrResurrect,
  encrypt: encryptFailureDoesNotCommit,
  recovery: malformedFailsClosedAndBackupRecovers,
  decrypt: decryptFailurePreservesCiphertext,
  storage: secureStorageUnavailablePreservesPlaintextMigration,
  concurrent: concurrentTransactionsSerializeWholeMutation,
};

async function main() {
  const only = process.argv[2];
  if (only) { await CASES[only](); console.log(`config-state contract passed: ${only}`); return; }
  for (const [name, run] of Object.entries(CASES)) { await run(); console.log(`config-state contract passed: ${name}`); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
