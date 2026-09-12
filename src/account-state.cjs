'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-';
const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

function cloneState(state) {
  return {
    activeAccountId: state.activeAccountId,
    accounts: state.accounts.map(account => ({ ...account })),
  };
}

function cloneAccount(account) {
  return account ? { ...account } : null;
}

function createError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function assertValidAccountId(accountId) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error('无效的账号 ID');
  }
}

function partitionFor(accountId) {
  assertValidAccountId(accountId);
  return `${ACCOUNT_PARTITION_PREFIX}${accountId}`;
}

function sanitizeAccountName(name, fallback) {
  if (typeof name !== 'string') return fallback;
  const normalized = name.trim().replace(/\s+/g, ' ');
  return normalized.slice(0, 40) || fallback;
}

function createAccountStateStore(options = {}) {
  const fs = options.fs;
  const filePath = options.filePath;
  const resolveTypeConfig = options.resolveTypeConfig;
  const normalizeWebsiteUrl = options.normalizeWebsiteUrl;
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const now = options.now || (() => new Date().toISOString());
  const isEncryptionAvailable = options.isEncryptionAvailable;
  const encrypt = options.encrypt;
  const decrypt = options.decrypt;
  const onMigrationError = typeof options.onMigrationError === 'function' ? options.onMigrationError : () => {};

  if (!fs || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function' || typeof fs.rename !== 'function' || typeof fs.mkdir !== 'function') {
    throw new TypeError('Account state fs adapter is required');
  }
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('Account state filePath is required');
  if (typeof resolveTypeConfig !== 'function') throw new TypeError('resolveTypeConfig is required');
  if (typeof normalizeWebsiteUrl !== 'function') throw new TypeError('normalizeWebsiteUrl is required');
  if (typeof isEncryptionAvailable !== 'function') throw new TypeError('isEncryptionAvailable is required');
  if (typeof encrypt !== 'function') throw new TypeError('encrypt is required');
  if (typeof decrypt !== 'function') throw new TypeError('decrypt is required');

  let state = { activeAccountId: null, accounts: [] };
  let transactionTail = Promise.resolve();

  function decryptStoredPassword(value) {
    if (typeof value !== 'string') return '';
    if (!value.startsWith('enc:')) return value;
    try {
      return decrypt(value.slice(4));
    } catch {
      return '';
    }
  }

  function normalizeStoredState(value) {
    const rawAccounts = Array.isArray(value)
      ? value
      : Array.isArray(value?.accounts)
        ? value.accounts
        : [];

    const seenIds = new Set();
    const accounts = [];
    for (const item of rawAccounts) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!ACCOUNT_ID_PATTERN.test(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      const type = resolveTypeConfig(item.type) ? item.type : 'whatsapp';
      accounts.push({
        id,
        type,
        name: sanitizeAccountName(item.name, `账号 ${accounts.length + 1}`),
        partition: partitionFor(id),
        customUrl: typeof item.customUrl === 'string' ? item.customUrl : '',
        fontSize: Number.isInteger(item.fontSize) ? item.fontSize : 16,
        fontColor: typeof item.fontColor === 'string' ? item.fontColor : '#18A058',
        openProxy: item.openProxy === true,
        protocal: item.protocal === 'https' || item.protocal === 'socks4' || item.protocal === 'socks5' ? item.protocal : 'http',
        host: typeof item.host === 'string' ? item.host : '',
        port: typeof item.port === 'string' ? item.port : '',
        huser: typeof item.huser === 'string' ? item.huser : '',
        hpwd: decryptStoredPassword(item.hpwd),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : now(),
      });
    }

    const requestedActiveId = !Array.isArray(value) && typeof value?.activeAccountId === 'string'
      ? value.activeAccountId
      : rawAccounts.find(item => item?.active)?.id;
    const activeAccountId = accounts.some(account => account.id === requestedActiveId)
      ? requestedActiveId
      : accounts[0]?.id ?? null;
    return { activeAccountId, accounts };
  }

  function encryptPassword(value) {
    if (!value) return '';
    if (!isEncryptionAvailable()) {
      throw createError('系统安全存储不可用，拒绝明文保存账号敏感配置', 'SECURE_STORAGE_UNAVAILABLE');
    }
    try {
      return `enc:${encrypt(String(value))}`;
    } catch (cause) {
      throw createError('账号敏感配置加密失败，未写入磁盘', 'SECURE_STORAGE_ENCRYPT_FAILED', cause);
    }
  }

  function serialize(candidate) {
    const accountsForDisk = candidate.accounts.map(account => ({
      ...account,
      hpwd: encryptPassword(account.hpwd),
    }));
    return JSON.stringify({
      activeAccountId: candidate.activeAccountId,
      accounts: accountsForDisk,
    }, null, 2);
  }

  async function durableWrite(candidate) {
    const snapshot = serialize(candidate);
    const directory = path.dirname(filePath);
    const temporaryFile = `${filePath}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporaryFile, snapshot, 'utf8');
      await fs.rename(temporaryFile, filePath);
    } catch (error) {
      if (typeof fs.rm === 'function') {
        try { await fs.rm(temporaryFile, { force: true }); } catch {}
      }
      throw error;
    }
  }

  function enqueueTransition(buildCandidate) {
    const run = transactionTail.then(async () => {
      const candidate = cloneState(state);
      const result = buildCandidate(candidate);
      await durableWrite(candidate);
      state = candidate;
      return {
        ...result,
        snapshot: cloneState(state),
      };
    });
    transactionTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async function load() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      const content = await fs.readFile(filePath, 'utf8');
      state = normalizeStoredState(JSON.parse(content));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        onMigrationError(error, { phase: 'read' });
      }
      const empty = { activeAccountId: null, accounts: [] };
      await durableWrite(empty);
      state = empty;
      return cloneState(state);
    }

    try {
      await durableWrite(state);
    } catch (error) {
      onMigrationError(error, { phase: 'migration' });
    }
    return cloneState(state);
  }

  function getSnapshot() {
    return cloneState(state);
  }

  function findById(accountId) {
    assertValidAccountId(accountId);
    return cloneAccount(state.accounts.find(account => account.id === accountId));
  }

  function findByPartition(partition) {
    if (typeof partition !== 'string') return null;
    return cloneAccount(state.accounts.find(account => account.partition === partition));
  }

  function resolvePartition(accountId) {
    const account = findById(accountId);
    if (!account?.partition) {
      const error = new Error('账号沙箱不存在');
      error.code = 'ACCOUNT_DATA_ACCOUNT_MISSING';
      throw error;
    }
    return account.partition;
  }

  function add(payload = {}) {
    return enqueueTransition(candidate => {
      const raw = typeof payload === 'string' ? { name: payload } : payload || {};
      const type = raw.type === undefined ? 'whatsapp' : raw.type;
      const config = resolveTypeConfig(type);
      if (!config) throw createError('ACCOUNT_TYPE_UNSUPPORTED', 'ACCOUNT_TYPE_UNSUPPORTED');
      const customUrl = type === 'website' ? normalizeWebsiteUrl(raw.customUrl) : '';
      const id = idFactory();
      assertValidAccountId(id);
      if (candidate.accounts.some(account => account.id === id)) throw new Error('账号 ID 已存在');
      const account = {
        id,
        type,
        name: sanitizeAccountName(raw.name, `账号 ${candidate.accounts.length + 1}`),
        partition: partitionFor(id),
        customUrl,
        fontSize: 16,
        fontColor: '#18A058',
        openProxy: false,
        protocal: 'http',
        host: '',
        port: '',
        huser: '',
        hpwd: '',
        createdAt: now(),
      };
      candidate.accounts.push(account);
      candidate.activeAccountId = id;
      return { account: cloneAccount(account) };
    });
  }

  function activate(accountId) {
    return enqueueTransition(candidate => {
      assertValidAccountId(accountId);
      if (!candidate.accounts.some(account => account.id === accountId)) throw new Error('账号不存在');
      candidate.activeAccountId = accountId;
      return { account: cloneAccount(candidate.accounts.find(account => account.id === accountId)) };
    });
  }

  function update(accountId, patchData) {
    return enqueueTransition(candidate => {
      assertValidAccountId(accountId);
      const account = candidate.accounts.find(item => item.id === accountId);
      if (!account) throw new Error('账号不存在');
      const raw = patchData && typeof patchData === 'object' ? patchData : {};
      if (typeof raw.name === 'string') {
        const name = sanitizeAccountName(raw.name, account.name);
        if (name) account.name = name;
      }
      if (Number.isInteger(raw.fontSize) && raw.fontSize >= 10 && raw.fontSize <= 28) account.fontSize = raw.fontSize;
      if (typeof raw.fontColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.fontColor)) account.fontColor = raw.fontColor;
      if (typeof raw.openProxy === 'boolean') account.openProxy = raw.openProxy;
      if (raw.protocal === 'http' || raw.protocal === 'https' || raw.protocal === 'socks4' || raw.protocal === 'socks5') account.protocal = raw.protocal;
      if (typeof raw.host === 'string') account.host = raw.host;
      if (typeof raw.port === 'string') account.port = raw.port;
      if (typeof raw.huser === 'string') account.huser = raw.huser;
      if (typeof raw.hpwd === 'string') account.hpwd = raw.hpwd;
      return { account: cloneAccount(account) };
    });
  }

  function move(accountId, direction) {
    return enqueueTransition(candidate => {
      assertValidAccountId(accountId);
      const index = candidate.accounts.findIndex(item => item.id === accountId);
      if (index === -1) throw new Error('账号不存在');
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= candidate.accounts.length) throw new Error('已经是边缘位置');
      const [moved] = candidate.accounts.splice(index, 1);
      candidate.accounts.splice(target, 0, moved);
      return { account: cloneAccount(moved) };
    });
  }

  function moveTo(accountId, targetIndex) {
    return enqueueTransition(candidate => {
      assertValidAccountId(accountId);
      const index = candidate.accounts.findIndex(item => item.id === accountId);
      if (index === -1) throw new Error('账号不存在');
      const insertAt = Math.max(0, Math.min(candidate.accounts.length - 1, targetIndex | 0));
      const [moved] = candidate.accounts.splice(index, 1);
      candidate.accounts.splice(insertAt, 0, moved);
      return { account: cloneAccount(moved) };
    });
  }

  function remove(accountId) {
    return enqueueTransition(candidate => {
      assertValidAccountId(accountId);
      const accountIndex = candidate.accounts.findIndex(account => account.id === accountId);
      if (accountIndex === -1) throw new Error('账号不存在');
      const [removedAccount] = candidate.accounts.splice(accountIndex, 1);
      if (candidate.activeAccountId === accountId) {
        candidate.activeAccountId = candidate.accounts[accountIndex]?.id ?? candidate.accounts[accountIndex - 1]?.id ?? null;
      }
      return { removedAccount: cloneAccount(removedAccount) };
    });
  }

  function whenIdle() {
    return transactionTail;
  }

  return {
    load,
    getSnapshot,
    findById,
    findByPartition,
    resolvePartition,
    add,
    activate,
    update,
    move,
    moveTo,
    remove,
    whenIdle,
  };
}

module.exports = {
  ACCOUNT_PARTITION_PREFIX,
  createAccountStateStore,
};
