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
      needsCompaction ||= record.needsCompaction === true;
      if (record.ignored) {
        snapshotCompatible = false;
        return;
      }
      if (record.deleted || cache.has(record.key)) snapshotCompatible = false;
      if (record.deleted) cache.delete(record.key);
      else cache.set(record.key, record.value);
    }

    function processCompleteLine(line) {
      if (!line.trim()) return;
      applyRecord(decodeRecord(line, false));
    }

    for await (const chunk of input) {
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer, 'utf8') > limits.maxRecordBytes && !buffer.includes('\n')) {
        throw createStoreError('ACCOUNT_DATA_RECORD_TOO_LARGE', '账号数据记录过大');
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (Buffer.byteLength(line, 'utf8') > limits.maxRecordBytes) {
          throw createStoreError('ACCOUNT_DATA_RECORD_TOO_LARGE', '账号数据记录过大');
        }
        processCompleteLine(line);
      }
    }
    buffer += decoder.end();
    if (buffer) {
      if (Buffer.byteLength(buffer, 'utf8') > limits.maxRecordBytes) {
        throw createStoreError('ACCOUNT_DATA_RECORD_TOO_LARGE', '账号数据记录过大');
      }
      const tail = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      if (tail.trim()) {
        const record = decodeRecord(tail, true);
        if (record.corruptTail) {
          needsCompaction = true;
          repairRequired = true;
          snapshotCompatible = false;
        } else applyRecord(record);
      }
    }

    return { cache, recordCount, needsCompaction, repairRequired, snapshotCompatible };
  }

  async function exists(file) {
    try {
      await fs.stat(file);
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function safeRemove(file) {
    try {
      await fs.rm(file, { force: true });
    } catch {
      // A stale temp file is harmless; the next load retries cleanup.
    }
  }

  async function recoverTemp(partition) {
    const target = fileFor(partition);
    const temporary = tempFileFor(partition);
    const tempExists = await exists(temporary);
    if (!tempExists) return;
    if (await exists(target)) {
      await safeRemove(temporary);
      return;
    }
    ensureEncryptionAvailable(isEncryptionAvailable);
    const recovered = await readLogFile(temporary);
    if (recovered.needsCompaction || !recovered.snapshotCompatible) {
      throw createStoreError('ACCOUNT_DATA_TEMP_INVALID', '账号数据恢复文件损坏');
    }
    await fs.rename(temporary, target);
  }

  async function loadState(state) {
    if (state.loaded) return state;
    if (state.loading) return state.loading;

    state.loading = (async () => {
      assertWritableState(state);
      ensureEncryptionAvailable(isEncryptionAvailable);
      const file = fileFor(state.partition);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await recoverTemp(state.partition);
      try {
        const stat = await fs.stat(file);
        const loaded = await readLogFile(file);
        state.cache = loaded.cache;
        state.recordCount = loaded.recordCount;
        state.fileBytes = Number(stat.size) || 0;
        state.needsCompaction = loaded.needsCompaction
          || state.recordCount >= limits.compactRecordCount
          || state.fileBytes >= limits.compactFileBytes;
        state.repairRequired = loaded.repairRequired === true;
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
        state.cache = new Map();
        state.recordCount = 0;
        state.fileBytes = 0;
        state.needsCompaction = false;
        state.repairRequired = false;
      }
      state.loaded = true;
      return state;
    })();

    try {
      return await state.loading;
    } finally {
      state.loading = null;
    }
  }

  function serializeRecord(key, value, deleted = false) {
    const encrypted = encrypt(String(value ?? ''));
    if (typeof encrypted !== 'string' || !encrypted) {
      throw createStoreError('ACCOUNT_DATA_ENCRYPT_FAILED', '账号数据加密失败');
    }
    const line = JSON.stringify({ key, deleted, at: now(), value: encrypted }) + '\n';
    if (Buffer.byteLength(line, 'utf8') > limits.maxRecordBytes) {
      throw createStoreError('ACCOUNT_DATA_RECORD_TOO_LARGE', '账号数据记录过大');
    }
    return line;
  }

  async function appendLine(state, line) {
    const file = fileFor(state.partition);
    await fs.mkdir(path.dirname(file), { recursive: true });
    let handle;
    try {
      handle = await fs.open(file, 'a');
      await handle.writeFile(line, 'utf8');
      await handle.sync();
    } finally {
      if (handle) await handle.close();
    }
    state.recordCount += 1;
    state.fileBytes += Buffer.byteLength(line, 'utf8');
    if (state.recordCount >= limits.compactRecordCount || state.fileBytes >= limits.compactFileBytes) {
      state.needsCompaction = true;
    }
  }

  async function syncDirectory(directory) {
    let handle;
    try {
      handle = await fs.open(directory, 'r');
      await handle.sync();
    } catch {
      // Directory fsync is not supported on every Windows/filesystem combination.
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function compact(state) {
    assertWritableState(state);
    ensureEncryptionAvailable(isEncryptionAvailable);
    const target = fileFor(state.partition);
    const temporary = tempFileFor(state.partition);
    const lines = [];
    for (const [key, value] of state.cache) {
      lines.push(serializeRecord(key, value, false));
    }
    const snapshot = lines.join('');
    let handle;
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      handle = await fs.open(temporary, 'w');
      await handle.writeFile(snapshot, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, target);
      await syncDirectory(path.dirname(target));
      state.recordCount = state.cache.size;
      state.fileBytes = Buffer.byteLength(snapshot, 'utf8');
      state.needsCompaction = false;
      state.repairRequired = false;
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function compactBestEffort(state) {
    if (!state.needsCompaction || state.deleting) return false;
    try {
      await compact(state);
      return true;
    } catch (error) {
      state.needsCompaction = true;
      await safeRemove(tempFileFor(state.partition));
      try { onCompactionError(error, state.partition); } catch {}
      return false;
    }
  }

  async function getAll(partition) {
    const state = stateFor(partition);
    return enqueue(state, async () => {
      assertWritableState(state);
      await loadState(state);
      assertWritableState(state);
      if (state.needsCompaction) await compactBestEffort(state);
      return Object.fromEntries(state.cache);
    });
  }

  async function set(partition, key, value) {
    const allowedKey = assertAllowedKey(key, allowedKeys);
    const raw = String(value ?? '');
    if (Buffer.byteLength(raw, 'utf8') > limits.maxValueBytes) {
      throw createStoreError('ACCOUNT_DATA_VALUE_TOO_LARGE', '账号数据过大');
    }
    const state = stateFor(partition);
    return enqueue(state, async () => {
      assertWritableState(state);
      await loadState(state);
      assertWritableState(state);
      let attemptedCompaction = false;
      if (state.needsCompaction) {
        await compactBestEffort(state);
        attemptedCompaction = true;
      }
      if (state.repairRequired) {
        throw createStoreError('ACCOUNT_DATA_REPAIR_REQUIRED', '账号数据尾记录需要修复后才能写入');
      }
      ensureEncryptionAvailable(isEncryptionAvailable);
      const line = serializeRecord(allowedKey, raw, false);
      await appendLine(state, line);
      state.cache.set(allowedKey, raw);
      if (state.needsCompaction && !attemptedCompaction) await compactBestEffort(state);
      return true;
    });
  }

  async function remove(partition, key) {
    const allowedKey = assertAllowedKey(key, allowedKeys);
    const state = stateFor(partition);
    return enqueue(state, async () => {
      assertWritableState(state);
      await loadState(state);
      assertWritableState(state);
      let attemptedCompaction = false;
      if (state.needsCompaction) {
        await compactBestEffort(state);
        attemptedCompaction = true;
      }
      if (state.repairRequired) {
        throw createStoreError('ACCOUNT_DATA_REPAIR_REQUIRED', '账号数据尾记录需要修复后才能写入');
      }
      ensureEncryptionAvailable(isEncryptionAvailable);
      const line = serializeRecord(allowedKey, '', true);
      await appendLine(state, line);
      state.cache.delete(allowedKey);
      if (state.needsCompaction && !attemptedCompaction) await compactBestEffort(state);
      return true;
    });
  }

  async function beginDelete(partition) {
    const state = stateFor(partition);
    state.deleting = true;
    await state.queue.catch(() => {});
  }

  function cancelDelete(partition) {
    const state = stateFor(partition);
    state.deleting = false;
  }

  function finalizeDelete(partition) {
    states.delete(String(partition || ''));
  }

  return Object.freeze({
    allowedKeys: Object.freeze([...allowedKeys]),
    limits,
    fileFor,
    tempFileFor,
    getAll,
    set,
    remove,
    beginDelete,
    cancelDelete,
    finalizeDelete,
  });
}

module.exports = {
  ACCOUNT_DATA_KEYS,
  DEFAULT_LIMITS,
  createAccountDataStore,
  createStoreError,
};