'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createAccountStateStore,
  ACCOUNT_STATE_RECOVERY_REQUIRED,
} = require('../src/account-state.cjs');
const {
  createConfigStateStore,
  CONFIG_STATE_RECOVERY_REQUIRED,
} = require('../src/config-state.cjs');

const TYPES = {
  whatsapp: { name: 'WhatsApp', url: 'https://web.whatsapp.com/' },
  website: { name: 'Website' },
};

function cryptoAdapter() {
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

function accountStore(dir, ids = []) {
  let index = 0;
  const crypto = cryptoAdapter();
  return createAccountStateStore({
    fs,
    filePath: path.join(dir, 'accounts.json'),
    resolveTypeConfig: type => TYPES[type] || null,
    normalizeWebsiteUrl(value) { return new URL(value).href; },
    idFactory: () => ids[index++] || `GEN_${index}`,
    now: () => '2026-09-15T00:00:00.000Z',
    ...crypto,
  });
}

function configStore(dir) {
  return createConfigStateStore({
    fs,
    filePath: path.join(dir, 'config.json'),
    ...cryptoAdapter(),
  });
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-state-authority-'));
  try {
    const accountDir = path.join(root, 'account');
    await fs.mkdir(accountDir, { recursive: true });
    const accounts = accountStore(accountDir, ['A']);
    await accounts.load();
    await accounts.add({ name: 'A' });
    await accounts.update('A', {
      openProxy: true,
      host: 'proxy.old.test',
      port: '8080',
      huser: 'old-user',
      hpwd: 'old-secret',
    });
    await accounts.update('A', {
      host: 'proxy.new.test',
      huser: 'new-user',
      hpwd: 'new-secret',
    });

    const accountFile = path.join(accountDir, 'accounts.json');
    const accountBackup = `${accountFile}.bak`;
    assert.equal(await fs.readFile(accountFile, 'utf8'), await fs.readFile(accountBackup, 'utf8'), 'successful account update must leave stable backup on the same committed snapshot');
    await fs.writeFile(accountFile, '{broken-primary', 'utf8');
    const recoveredAccount = accountStore(accountDir);
    const recoveredAccountState = await recoveredAccount.load();
    assert.equal(recoveredAccountState.accounts.length, 1);
    assert.equal(recoveredAccount.findById('A').host, 'proxy.new.test');
    assert.equal(recoveredAccount.findById('A').huser, 'new-user');
    assert.equal(recoveredAccount.findById('A').hpwd, 'new-secret', 'recovery must preserve the latest committed encrypted proxy secret');

    await recoveredAccount.remove('A');
    assert.equal((await recoveredAccount.load()).accounts.length, 0);
    assert.equal(await fs.readFile(accountFile, 'utf8'), await fs.readFile(accountBackup, 'utf8'), 'successful account deletion must mirror the committed empty snapshot');
    await fs.rm(accountFile);
    const afterDelete = accountStore(accountDir);
    assert.deepEqual(await afterDelete.load(), { activeAccountId: null, accounts: [] }, 'missing primary after committed delete must not resurrect the deleted account');

    const configDir = path.join(root, 'config');
    await fs.mkdir(configDir, { recursive: true });
    const config = configStore(configDir);
    await config.load();
    await config.update({
      lockPassword: 'old-lock',
      openProxy: true,
      host: 'proxy.old.test',
      login: 'old-login',
      password: 'old-proxy-secret',
    });
    await config.update({
      lockPassword: 'new-lock',
      host: 'proxy.new.test',
      login: 'new-login',
      password: 'new-proxy-secret',
    });

    const configFile = path.join(configDir, 'config.json');
    const configBackup = `${configFile}.bak`;
    assert.equal(await fs.readFile(configFile, 'utf8'), await fs.readFile(configBackup, 'utf8'), 'successful config update must leave stable backup on the same committed snapshot');
    await fs.writeFile(configFile, '{broken-primary', 'utf8');
    const recoveredConfig = configStore(configDir);
    const recovered = await recoveredConfig.load();
    assert.equal(recovered.lockPassword, 'new-lock');
    assert.equal(recovered.host, 'proxy.new.test');
    assert.equal(recovered.login, 'new-login');
    assert.equal(recovered.password, 'new-proxy-secret', 'Config recovery must preserve the latest committed security-sensitive values');

    // Legacy backups do not carry commit proof. A valid legacy primary remains
    // authoritative and is migrated, but a backup alone must fail closed rather
    // than potentially roll back a previously committed mutation.
    const legacyDir = path.join(root, 'legacy');
    await fs.mkdir(legacyDir, { recursive: true });
    const legacyAccountFile = path.join(legacyDir, 'accounts.json');
    await fs.writeFile(`${legacyAccountFile}.bak`, JSON.stringify({ activeAccountId: 'OLD', accounts: [{ id: 'OLD', name: 'Old', type: 'whatsapp' }] }), 'utf8');
    const legacyAccounts = accountStore(legacyDir);
    await assert.rejects(
      () => legacyAccounts.load(),
      error => error?.code === ACCOUNT_STATE_RECOVERY_REQUIRED,
      'unproven legacy account backup must not resurrect state when primary is absent',
    );

    const legacyConfigDir = path.join(root, 'legacy-config');
    await fs.mkdir(legacyConfigDir, { recursive: true });
    const legacyConfigFile = path.join(legacyConfigDir, 'config.json');
    await fs.writeFile(`${legacyConfigFile}.bak`, JSON.stringify({ lockPassword: 'stale-plain' }), 'utf8');
    const legacyConfig = configStore(legacyConfigDir);
    await assert.rejects(
      () => legacyConfig.load(),
      error => error?.code === CONFIG_STATE_RECOVERY_REQUIRED,
      'unproven legacy config backup must not restore a stale security setting',
    );

    console.log('STATE_BACKUP_COMMIT_AUTHORITY_CONTRACT_OK');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
