'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function cryptoHarness() {
  return {
    isEncryptionAvailable: () => true,
    encrypt(value) { return Buffer.from(`cipher:${value}`, 'utf8').toString('base64'); },
    decrypt(value) {
      const decoded = Buffer.from(String(value), 'base64').toString('utf8');
      if (!decoded.startsWith('cipher:')) throw new Error('bad cipher');
      return decoded.slice('cipher:'.length);
    },
  };
}

function makeStore({ createConfigStateStore, filePath, crypto }) {
  return createConfigStateStore({
    fs,
    filePath,
    isEncryptionAvailable: crypto.isEncryptionAvailable,
    encrypt: crypto.encrypt,
    decrypt: crypto.decrypt,
  });
}

async function missing(file) {
  try { await fs.access(file); return false; }
  catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
}

(async () => {
  const runtimePaths = require('../src/runtime-paths.cjs');
  const { DEFAULT_CONFIG, createConfigStateStore } = require('../src/config-state.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-config-migration-retry-'));
  const projectRoot = path.join(root, 'project');
  const userDataDir = path.join(root, 'user-data');
  const legacyDir = path.join(projectRoot, 'data');
  const configFile = runtimePaths.configFile(userDataDir);
  const crypto = cryptoHarness();

  try {
    await fs.mkdir(legacyDir, { recursive: true });
    const legacy = {
      ...DEFAULT_CONFIG,
      theme: 'dark',
      accent: 'purple',
      openProxy: true,
      host: 'legacy.proxy.test',
      port: '8443',
      login: 'legacy-user',
      password: 'legacy-secret',
    };
    await fs.writeFile(runtimePaths.legacyConfigFile(projectRoot), JSON.stringify(legacy, null, 2), 'utf8');

    const first = makeStore({ createConfigStateStore, filePath: configFile, crypto });
    const defaults = await first.load();
    assert.equal(defaults.theme, DEFAULT_CONFIG.theme);
    assert.equal(defaults.openProxy, DEFAULT_CONFIG.openProxy);
    assert.equal(await missing(configFile), true, 'missing config load must not create an authoritative defaults shadow');
    assert.equal(await missing(`${configFile}.bak`), true, 'missing config load must not create a backup shadow either');

    const migration = await runtimePaths.migrateRuntimeFiles({ userDataDir, projectRoot });
    assert.ok(migration.some(item => item.file === configFile && item.action === 'copied'), 'legacy config must remain retryable after the earlier missing load');

    const restarted = makeStore({ createConfigStateStore, filePath: configFile, crypto });
    const loaded = await restarted.load();
    assert.equal(loaded.theme, 'dark');
    assert.equal(loaded.accent, 'purple');
    assert.equal(loaded.openProxy, true);
    assert.equal(loaded.host, 'legacy.proxy.test');
    assert.equal(loaded.port, '8443');
    assert.equal(loaded.login, 'legacy-user');
    assert.equal(loaded.password, 'legacy-secret');
    const canonical = await fs.readFile(configFile, 'utf8');
    assert.match(canonical, /"password": "enc:/, 'legacy plaintext secret must still migrate through the secure canonical writer');
    assert.doesNotMatch(canonical, /legacy-secret/, 'canonical config must not retain the legacy plaintext secret');

    const freshDir = path.join(root, 'fresh-user-data');
    const freshFile = runtimePaths.configFile(freshDir);
    const fresh = makeStore({ createConfigStateStore, filePath: freshFile, crypto });
    await fresh.load();
    assert.equal(await missing(freshFile), true);
    const updated = await fresh.update({ theme: 'dark' });
    assert.equal(updated.theme, 'dark');
    assert.equal(await missing(freshFile), false, 'first real mutation must still durably create config.json');
    assert.equal(await missing(`${freshFile}.bak`), false, 'first real mutation must still create the recovery backup');

    console.log('CONFIG_STATE_MISSING_RETRY_CONTRACT_OK');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
