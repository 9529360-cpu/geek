'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createConfigStateStore } = require('../src/config-state.cjs');

function createStore(dir) {
  return createConfigStateStore({
    fs,
    filePath: path.join(dir, 'config.json'),
    isEncryptionAvailable: () => true,
    encrypt: value => Buffer.from(String(value), 'utf8').toString('base64'),
    decrypt: value => Buffer.from(String(value), 'base64').toString('utf8'),
  });
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-config-legacy-theme-'));
  try {
    const file = path.join(dir, 'config.json');
    const legacy = {
      autoLaunch: false,
      isStartupMinimize: false,
      messageSound: true,
      theme: 'purple',
      broadcastGroups: [],
      lockPassword: '',
      openProxy: false,
      protocal: 'http',
      host: '',
      port: '',
      login: '',
      password: '',
    };
    await fs.writeFile(file, JSON.stringify(legacy, null, 2), 'utf8');

    const loaded = await createStore(dir).load();
    assert.equal(loaded.theme, 'system', 'legacy color-valued theme must migrate to the current system theme');
    assert.equal(loaded.accent, 'purple', 'legacy color-valued theme must be preserved as the current accent');

    const migrated = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(migrated.theme, 'system', 'migration must rewrite the legacy overloaded theme field canonically');
    assert.equal(migrated.accent, 'purple', 'migration must persist the recovered accent explicitly');

    const restarted = await createStore(dir).load();
    assert.equal(restarted.theme, 'system');
    assert.equal(restarted.accent, 'purple', 'canonical migrated settings must survive restart');

    console.log('CONFIG_STATE_LEGACY_THEME_MIGRATION_CONTRACT_OK');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
