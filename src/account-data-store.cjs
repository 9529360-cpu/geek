'use strict';

const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const MiB = 1024 * 1024;

const ACCOUNT_DATA_KEYS = Object.freeze([
  '__schema',
  'scheduleTasks',
  'broadcastJobSchedules',
  'broadcastLegacyScheduleBackup',
  'broadcastLegacyScheduleNeedsReview',
  'broadcastScheduleMigrationV2',
  'sendHistory',
  'savedMessages',
  'savedLists',
  'broadcastExclude',
  'broadcastExcludeContacts',
  'broadcastExcludeGroups',
  'broadcastGroups',
  'savedGroups',
  'groupLinks',
  'gtAutoCfg',
  'gtCmdCfg',
  'gtCmdNames',
  'translationGlobal',
  'translationChats',
]);

const DEFAULT_LIMITS = Object.freeze({
  maxValueBytes: 2 * MiB,
  compactRecordCount: 512,
  compactFileBytes: 64 * MiB,
  maxRecordBytes: 3 * MiB,
});

function createStoreError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function assertPartition(partition) {
  const value = String(partition || '');
  const dirName = value.replace(/^persist:/, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(dirName)) {
    throw createStoreError('ACCOUNT_DATA_PARTITION_INVALID', '账号沙箱不合法');
  }
  return dirName;
}

function assertAllowedKey(key, allowedKeys) {
  const value = String(key || '');
  if (!allowedKeys.has(value)) {
    throw createStoreError('ACCOUNT_DATA_KEY_NOT_ALLOWED', '账号数据键不允许');
  }
  return value;
}

function ensureEncryptionAvailable(isEncryptionAvailable) {
  if (!isEncryptionAvailable()) {
    throw createStoreError('SECURE_STORAGE_UNAVAILABLE', '系统安全存储不可用，账号数据未保存');
  }
}

function createAccountDataStore(options = {}) {
  const fs = options.fs;
  const createReadStream = options.createReadStream;
  const getUserDataDir = options.getUserDataDir;
  const encrypt = options.encrypt;
  const decrypt = options.decrypt;
  const isEncryptionAvailable = options.isEncryptionAvailable;
  const now = options.now || Date.now;
  const onCompactionError = options.onCompactionError || (() => {});
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...(options.limits || {}) });
  const allowedKeys = new Set(options.allowedKeys || ACCOUNT_DATA_KEYS);

  if (!fs || typeof fs.open !== 'function' || typeof fs.rename !== 'function' || typeof fs.rm !== 'function') {
    throw new TypeError('fs promises API is required');
  }
  if (typeof createReadStream !== 'function') throw new TypeError('createReadStream is required');
  if (typeof getUserDataDir !== 'function') throw new TypeError('getUserDataDir is required');
  if (typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new TypeError('encrypt/decrypt are required');
  if (typeof isEncryptionAvailable !== 'function') throw new TypeError('isEncryptionAvailable is required');

  const states = new Map();

  function fileFor(partition) {
    const dirName = assertPartition(partition);
    return path.join(getUserDataDir(), 'Partitions', dirName, 'geek-account-data.jsonl');
  }

  function tempFileFor(partition) {
    return `${fileFor(partition)}.compact.tmp`;
  }

  function stateFor(partition) {
    const key = String(partition || '');
    if (!states.has(key)) {
      states.set(key, {
        partition: key,
        cache: new Map(),
        loaded: false,
        loading: null,
        queue: Promise.resolve(),
        recordCount: 0,
        fileBytes: 0,
        needsCompaction: false,
        repairRequired: false,
        deleting: false,
      });
    }
    return states.get(key);
  }

  function enqueue(state, task) {
    const run = state.queue.catch(() => {}).then(task);
    state.queue = run.catch(() => {});
    return run;
  }

  function assertWritableState(state) {
    if (state.deleting) {
      throw createStoreError('ACCOUNT_DATA_PARTITION_DELETING', '账号沙箱正在删除');
    }
  }

  function decodeRecord(line, isTail) {
    let item;
    try {
      item = JSON.parse(line);
      if (!item || typeof item !== 'object' || typeof item.key !== 'string' || typeof item.value !== 'string') {
        throw new Error('invalid record shape');
      }
      if (!allowedKeys.has(item.key)) {
        return { ignored: true, needsCompaction: true };
      }
      const value = decrypt(item.value);
      return {
        key: item.key,
        value: String(value),
        deleted: item.deleted === true,
        needsCompaction: false,
      };
    } catch (cause) {
      if (isTail) return { corruptTail: true, needsCompaction: true };
      const error = createStoreError('ACCOUNT_DATA_LOG_CORRUPT', '账号数据日志中段损坏');
      error.cause = cause;
      throw error;
    }
  }

  async function readLogFile(file) {
    const cache = new Map();
    let recordCount = 0;
    let needsCompaction = false;
    let repairRequired = false;
    let snapshotCompatible = true;
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    const input = createReadStream(file);

    function applyRecord(record) {
      recordCount += 1;
      if (record.ignored) {
        needsCompaction = true;
        snapshotCompatible = false;
        return;
      }
      if (record.corruptTail) {
        needsCompaction = true;
        snapshotCompatible = false;
        return;
      }
      if (record.needsCompaction) needsCompaction = true;
      if (record.deleted) cache.delete(record.key);
      else cache.set(record.key, record.value);
    }

    try {
      for await (const chunk of input) {
        buffer += decoder.write(chunk);
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          applyRecord(decodeRecord(line, false));
        }
      }
      buffer += decoder.end();
      const tail = buffer.trim();
      if (tail) applyRecord(decodeRecord(tail, true));
    } catch (error) {
      if (error?.code === 'ENOENT') return { cache, recordCount: 0, fileBytes: 0, needsCompaction: false, repairRequired: false };
      repairRequired = true;
      throw error;
    }

    let fileBytes = 0;
    try { fileBytes = Number((await fs.stat(file)).size) || 0; } catch (_) {}
    return { cache, recordCount, fileBytes, needsCompaction, repairRequired, snapshotCompatible };
  }

  async function ensureLoaded(state) {
    if (state.loaded) return;
    if (state.loading) return state.loading;
    state.loading = (async () => {
      const loaded = await readLogFile(fileFor(state.partition));
      state.cache = loaded.cache;
      state.recordCount = loaded.recordCount;
      state.fileBytes = loaded.fileBytes;
      state.needsCompaction = loaded.needsCompaction;
      state.repairRequired = loaded.repairRequired;
      state.loaded = true;
    })().finally(() => { state.loading = null; });
    return state.loading;
  }

  async function ensureDir(file) {
    await fs.mkdir(path.dirname(file), { recursive: true });
  }

  async function appendRecord(state, key, value, deleted) {
    assertWritableState(state);
    ensureEncryptionAvailable(isEncryptionAvailable);
    const encrypted = encrypt(String(value));
    const record = JSON.stringify({ key, value: encrypted, deleted: deleted === true, at: now() }) + '\n';
    const recordBytes = Buffer.byteLength(record);
    if (recordBytes > limits.maxRecordBytes) throw createStoreError('ACCOUNT_DATA_RECORD_TOO_LARGE', '账号数据记录过大');
    const file = fileFor(state.partition);
    await ensureDir(file);
    await fs.appendFile(file, record, { encoding: 'utf8', mode: 0o600 });
    state.recordCount += 1;
    state.fileBytes += recordBytes;
    if (deleted) state.cache.delete(key);
    else state.cache.set(key, String(value));
  }

  async function compactUnlocked(state) {
    assertWritableState(state);
    ensureEncryptionAvailable(isEncryptionAvailable);
    const file = fileFor(state.partition);
    const temp = tempFileFor(state.partition);
    await ensureDir(file);
    const lines = [];
    for (const [key, value] of state.cache) {
      const encrypted = encrypt(String(value));
      lines.push(JSON.stringify({ key, value: encrypted, deleted: false, at: now() }));
    }
    const body = lines.length ? `${lines.join('\n')}\n` : '';
    await fs.writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, file);
    state.recordCount = lines.length;
    state.fileBytes = Buffer.byteLength(body);
    state.needsCompaction = false;
    state.repairRequired = false;
  }

  async function maybeCompact(state) {
    if (!state.needsCompaction && state.recordCount < limits.compactRecordCount && state.fileBytes < limits.compactFileBytes) return;
    try { await compactUnlocked(state); } catch (error) { onCompactionError(error, state.partition); }
  }

  async function getAll(partition) {
    const state = stateFor(partition);
    await ensureLoaded(state);
    return Object.fromEntries(state.cache);
  }

  async function set(partition, key, value) {
    const normalizedKey = assertAllowedKey(key, allowedKeys);
    const normalizedValue = String(value ?? '');
    if (Buffer.byteLength(normalizedValue) > limits.maxValueBytes) throw createStoreError('ACCOUNT_DATA_VALUE_TOO_LARGE', '账号数据值过大');
    const state = stateFor(partition);
    return enqueue(state, async () => {
      await ensureLoaded(state);
      await appendRecord(state, normalizedKey, normalizedValue, false);
      await maybeCompact(state);
      return true;
    });
  }

  async function remove(partition, key) {
    const normalizedKey = assertAllowedKey(key, allowedKeys);
    const state = stateFor(partition);
    return enqueue(state, async () => {
      await ensureLoaded(state);
      await appendRecord(state, normalizedKey, '', true);
      await maybeCompact(state);
      return true;
    });
  }

  async function clear(partition) {
    const state = stateFor(partition);
    return enqueue(state, async () => {
      state.deleting = true;
      try {
        await fs.rm(path.dirname(fileFor(partition)), { recursive: true, force: true });
        state.cache.clear();
        state.recordCount = 0;
        state.fileBytes = 0;
        state.needsCompaction = false;
        state.repairRequired = false;
        state.loaded = true;
      } finally {
        state.deleting = false;
      }
      return true;
    });
  }

  return Object.freeze({ getAll, set, remove, clear, compact: (partition) => enqueue(stateFor(partition), async () => {
    await ensureLoaded(stateFor(partition));
    await compactUnlocked(stateFor(partition));
    return true;
  }) });
}

module.exports = { ACCOUNT_DATA_KEYS, DEFAULT_LIMITS, createAccountDataStore, createStoreError, assertPartition, assertAllowedKey };