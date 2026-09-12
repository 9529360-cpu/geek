'use strict';

const path = require('node:path');

const CONFIG_STATE_RECOVERY_REQUIRED = 'CONFIG_STATE_RECOVERY_REQUIRED';
const CONFIG_STATE_SECRET_DECRYPT_FAILED = 'CONFIG_STATE_SECRET_DECRYPT_FAILED';
const DEFAULT_CONFIG = Object.freeze({
  autoLaunch: false,
  isStartupMinimize: false,
  messageSound: true,
  theme: 'system',
  accent: 'green',
  broadcastGroups: [],
  lockPassword: '',
  openProxy: false,
  protocal: 'http',
  host: '',
  port: '',
  login: '',
  password: '',
});

function cloneConfig(config) {
  return {
    ...config,
    broadcastGroups: Array.isArray(config.broadcastGroups)
      ? config.broadcastGroups.map(group => ({ ...group }))
      : [],
  };
}

function createError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function createConfigStateStore(options = {}) {
  const fs = options.fs;
  const filePath = options.filePath;
  const backupPath = options.backupPath || `${filePath}.bak`;
  const temporaryFile = `${filePath}.tmp`;
  const backupTemporaryFile = `${backupPath}.tmp`;
  const isEncryptionAvailable = options.isEncryptionAvailable;
  const encrypt = options.encrypt;
  const decrypt = options.decrypt;
  const onRecoveryEvent = typeof options.onRecoveryEvent === 'function' ? options.onRecoveryEvent : () => {};

  if (!fs || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function' || typeof fs.rename !== 'function' || typeof fs.mkdir !== 'function') {
    throw new TypeError('Config state fs adapter is required');
  }
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('Config state filePath is required');
  if (typeof isEncryptionAvailable !== 'function') throw new TypeError('isEncryptionAvailable is required');
  if (typeof encrypt !== 'function') throw new TypeError('encrypt is required');
  if (typeof decrypt !== 'function') throw new TypeError('decrypt is required');

  let state = cloneConfig(DEFAULT_CONFIG);
  let transactionTail = Promise.resolve();

  function report(error, phase, recovered = false) {
    try { onRecoveryEvent(error, { phase, recovered: recovered === true }); } catch {}
  }

  function decodeSecret(value) {
    if (typeof value !== 'string') return '';
    if (!value.startsWith('enc:')) return value;
    try {
      const decoded = decrypt(value.slice(4));
      if (typeof decoded !== 'string') throw new Error('invalid decrypted config secret');
      return decoded;
    } catch (cause) {
      throw createError('配置敏感字段解密失败，需要恢复配置状态', CONFIG_STATE_SECRET_DECRYPT_FAILED, cause);
    }
  }

  function normalizeConfig(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      autoLaunch: typeof value.autoLaunch === 'boolean' ? value.autoLaunch : DEFAULT_CONFIG.autoLaunch,
      isStartupMinimize: typeof value.isStartupMinimize === 'boolean' ? value.isStartupMinimize : DEFAULT_CONFIG.isStartupMinimize,
      messageSound: typeof value.messageSound === 'boolean' ? value.messageSound : DEFAULT_CONFIG.messageSound,
      theme: ['system', 'light'].includes(value.theme) ? value.theme : value.theme === 'dark' ? 'dark' : 'system',
      broadcastGroups: Array.isArray(value.broadcastGroups)
        ? value.broadcastGroups.filter(group => group && group.id && group.name).map(group => ({ ...group }))
        : [],
      accent: ['green', 'blue', 'purple', 'cyan', 'orange', 'pink'].includes(value.theme) ? value.theme
        : ['green', 'blue', 'purple', 'cyan', 'orange', 'pink'].includes(value.accent) ? value.accent : 'green',
      lockPassword: typeof value.lockPassword === 'string' ? decodeSecret(value.lockPassword) : '',
      openProxy: typeof value.openProxy === 'boolean' ? value.openProxy : DEFAULT_CONFIG.openProxy,
      protocal: value.protocal === 'https' || value.protocal === 'socks4' || value.protocal === 'socks5' ? value.protocal : 'http',
      host: typeof value.host === 'string' ? value.host : DEFAULT_CONFIG.host,
      port: typeof value.port === 'string' ? value.port : DEFAULT_CONFIG.port,
      login: typeof value.login === 'string' ? value.login : DEFAULT_CONFIG.login,
      password: typeof value.password === 'string' ? decodeSecret(value.password) : DEFAULT_CONFIG.password,
    };
  }

  function encryptSecret(value) {
    if (!value) return '';
    if (!isEncryptionAvailable()) {
      throw createError('系统安全存储不可用，拒绝明文保存敏感配置', 'SECURE_STORAGE_UNAVAILABLE');
    }
    try {
      return `enc:${encrypt(String(value))}`;
    } catch (cause) {
      throw createError('敏感配置加密失败，未写入磁盘', 'SECURE_STORAGE_ENCRYPT_FAILED', cause);
    }
  }

  function serialize(candidate) {
    return JSON.stringify({
      ...candidate,
      broadcastGroups: candidate.broadcastGroups.map(group => ({ ...group })),
      lockPassword: encryptSecret(candidate.lockPassword),
      password: encryptSecret(candidate.password),
    }, null, 2);
  }

  async function safeRemove(file) {
    if (typeof fs.rm !== 'function') return;
    try { await fs.rm(file, { force: true }); } catch {}
  }

  async function writeSynced(file, content) {
    if (typeof fs.open !== 'function') {
      await fs.writeFile(file, content, 'utf8');
      return;
    }
    let handle;
    try {
      handle = await fs.open(file, 'w');
      await handle.writeFile(content, 'utf8');
      if (typeof handle.sync === 'function') await handle.sync();
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function syncDirectory(directory) {
    if (typeof fs.open !== 'function') return;
    let handle;
    try {
      handle = await fs.open(directory, 'r');
      if (typeof handle.sync === 'function') await handle.sync();
    } catch {
      // Best effort: some Windows/filesystem combinations do not support directory fsync.
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function readOptional(file) {
    try {
      return { exists: true, content: await fs.readFile(file, 'utf8') };
    } catch (error) {
      if (error?.code === 'ENOENT') return { exists: false, content: null };
      throw error;
    }
  }

  function parseStored(content) {
    return normalizeConfig(JSON.parse(content));
  }

  async function loadBackup() {
    const backup = await readOptional(backupPath);
    if (!backup.exists) return null;
    return { content: backup.content, state: parseStored(backup.content) };
  }

  async function restoreRawSnapshot(content) {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    try {
      await writeSynced(temporaryFile, content);
      await fs.rename(temporaryFile, filePath);
      await syncDirectory(directory);
    } catch (error) {
      await safeRemove(temporaryFile);
      throw error;
    }
  }

  function recoveryRequired(primaryError, backupError) {
    const error = createError('配置状态无法安全恢复', CONFIG_STATE_RECOVERY_REQUIRED, primaryError);
    error.primaryCode = typeof primaryError?.code === 'string' ? primaryError.code : String(primaryError?.name || 'UNKNOWN');
    error.backupCode = typeof backupError?.code === 'string' ? backupError.code : backupError ? String(backupError?.name || 'UNKNOWN') : 'ENOENT';
    return error;
  }

  async function recover(primaryError) {
    let backup;
    try {
      backup = await loadBackup();
    } catch (backupError) {
      const error = recoveryRequired(primaryError, backupError);
      report(error, 'recovery', false);
      throw error;
    }
    if (!backup) {
      const error = recoveryRequired(primaryError, null);
      report(error, 'recovery', false);
      throw error;
    }
    try {
      await restoreRawSnapshot(backup.content);
    } catch (restoreError) {
      const error = recoveryRequired(primaryError, restoreError);
      report(error, 'recovery', false);
      throw error;
    }
    state = backup.state;
    report(primaryError, 'recovery', true);
  }

  async function durableWrite(candidate, { migration = false } = {}) {
    const snapshot = serialize(candidate);
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    let current = null;
    try {
      if (!migration) current = await readOptional(filePath);
      await writeSynced(temporaryFile, snapshot);
      await writeSynced(backupTemporaryFile, migration || !current?.exists ? snapshot : current.content);
      await fs.rename(backupTemporaryFile, backupPath);
      await fs.rename(temporaryFile, filePath);
      await syncDirectory(directory);
    } catch (error) {
      await safeRemove(temporaryFile);
      await safeRemove(backupTemporaryFile);
      throw error;
    }
  }

  async function migrateLoadedState() {
    try {
      await durableWrite(state, { migration: true });
    } catch (error) {
      report(error, 'migration', false);
    }
  }

  async function load() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let target;
    try {
      target = await readOptional(filePath);
    } catch (error) {
      await recover(error);
      await migrateLoadedState();
      return cloneConfig(state);
    }

    if (!target.exists) {
      let backup;
      try {
        backup = await loadBackup();
      } catch (error) {
        const recoveryError = recoveryRequired(Object.assign(new Error('config.json missing'), { code: 'ENOENT' }), error);
        report(recoveryError, 'recovery', false);
        throw recoveryError;
      }
      if (backup) {
        await restoreRawSnapshot(backup.content);
        state = backup.state;
        report(Object.assign(new Error('config.json missing'), { code: 'ENOENT' }), 'recovery', true);
        await migrateLoadedState();
        return cloneConfig(state);
      }
      const defaults = cloneConfig(DEFAULT_CONFIG);
      await durableWrite(defaults, { migration: true });
      state = defaults;
      return cloneConfig(state);
    }

    try {
      state = parseStored(target.content);
    } catch (error) {
      await recover(error);
      await migrateLoadedState();
      return cloneConfig(state);
    }

    await migrateLoadedState();
    return cloneConfig(state);
  }

  function getSnapshot() {
    return cloneConfig(state);
  }

  function update(patchData = {}) {
    const run = transactionTail.then(async () => {
      const raw = patchData && typeof patchData === 'object' ? patchData : {};
      const candidate = normalizeConfig({ ...cloneConfig(state), ...raw });
      await durableWrite(candidate);
      state = candidate;
      return cloneConfig(state);
    });
    transactionTail = run.then(() => undefined, () => undefined);
    return run;
  }

  function whenIdle() {
    return transactionTail;
  }

  return { load, getSnapshot, update, whenIdle };
}

module.exports = {
  CONFIG_STATE_RECOVERY_REQUIRED,
  CONFIG_STATE_SECRET_DECRYPT_FAILED,
  DEFAULT_CONFIG,
  createConfigStateStore,
};
