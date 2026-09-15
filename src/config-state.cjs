'use strict';

const { createCommittedStateMirror } = require('./committed-state-mirror.cjs');

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
  // Missing Config State is intentionally not materialized during load: the
  // runtime-path migration may still copy a legacy project config afterwards.
  // The first real mutation owns creation of the initial proof-backed snapshot.
  let needsInitialCommit = false;

  function report(error, phase, recovered = false) {
    try { onRecoveryEvent(error, { phase, recovered: recovered === true }); } catch {}
  }

  const mirror = createCommittedStateMirror({
    fs,
    filePath,
    backupPath,
    onPostCommitError(error, meta) {
      report(error, meta?.phase || 'backup-mirror', false);
    },
  });

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

  function parseStored(content) {
    return normalizeConfig(JSON.parse(content));
  }

  function recoveryRequired(primaryError, backupError) {
    const error = createError('配置状态无法安全恢复', CONFIG_STATE_RECOVERY_REQUIRED, primaryError);
    error.primaryCode = typeof primaryError?.code === 'string' ? primaryError.code : String(primaryError?.name || 'UNKNOWN');
    error.backupCode = typeof backupError?.code === 'string' ? backupError.code : backupError ? String(backupError?.name || 'UNKNOWN') : 'ENOENT';
    return error;
  }

  function wrapMirrorRecovery(error) {
    if (error?.code === CONFIG_STATE_RECOVERY_REQUIRED) return error;
    return recoveryRequired(error?.primaryError || error, error?.backupError || null);
  }

  async function durableWrite(candidate, { initializing = false } = {}) {
    const snapshot = serialize(candidate);
    return mirror.commit(snapshot, { initializing });
  }

  async function migrateLoadedState({ initializing = false } = {}) {
    try {
      await durableWrite(state, { initializing });
    } catch (error) {
      report(error, 'migration', false);
    }
  }

  async function load() {
    let loaded;
    try {
      loaded = await mirror.load(parseStored);
    } catch (error) {
      const recoveryError = wrapMirrorRecovery(error);
      report(recoveryError, 'recovery', false);
      throw recoveryError;
    }

    if (loaded.status === 'empty') {
      state = cloneConfig(DEFAULT_CONFIG);
      needsInitialCommit = true;
      return cloneConfig(state);
    }

    needsInitialCommit = false;
    state = loaded.state;
    if (loaded.status === 'recovered') {
      report(loaded.primaryError || Object.assign(new Error('config state recovered'), { code: 'CONFIG_STATE_PRIMARY_RECOVERED' }), 'recovery', true);
    }
    await migrateLoadedState({ initializing: loaded.status === 'legacy' });
    return cloneConfig(state);
  }

  function getSnapshot() {
    return cloneConfig(state);
  }

  function update(patchData = {}) {
    const run = transactionTail.then(async () => {
      const raw = patchData && typeof patchData === 'object' ? patchData : {};
      const candidate = normalizeConfig({ ...cloneConfig(state), ...raw });
      const initializing = needsInitialCommit;
      await durableWrite(candidate, { initializing });
      state = candidate;
      needsInitialCommit = false;
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
