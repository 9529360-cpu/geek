'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_LIMITS = Object.freeze({
  coldLoadBytes: 1024 * 1024,
  compactTriggerBytes: 1024 * 1024,
  compactedMaxBytes: 512 * 1024,
  maxEntries: 512,
  appendsBeforeCompact: 256,
});
const WINDOWS_RENAME_RETRY_MS = Object.freeze([0, 20, 50, 100]);

function normalizedLimits(value = {}) {
  const number = (key, fallback, minimum = 1) => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
  };
  const compactedMaxBytes = number('compactedMaxBytes', DEFAULT_LIMITS.compactedMaxBytes);
  return Object.freeze({
    coldLoadBytes: Math.max(compactedMaxBytes, number('coldLoadBytes', DEFAULT_LIMITS.coldLoadBytes)),
    compactTriggerBytes: Math.max(compactedMaxBytes, number('compactTriggerBytes', DEFAULT_LIMITS.compactTriggerBytes)),
    compactedMaxBytes,
    maxEntries: number('maxEntries', DEFAULT_LIMITS.maxEntries),
    appendsBeforeCompact: number('appendsBeforeCompact', DEFAULT_LIMITS.appendsBeforeCompact),
  });
}

function createTranslationCacheStore(options = {}) {
  const {
    fs,
    safeStorage,
    getUserDataDir,
    cacheVersion,
    isPartitionDeleted = () => false,
    randomUUID = crypto.randomUUID,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = Date.now,
    maxAgeMs = null,
    limits: rawLimits,
  } = options;
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.appendFile !== 'function') throw new TypeError('fs cache API is required');
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') throw new TypeError('safeStorage is required');
  if (typeof getUserDataDir !== 'function') throw new TypeError('getUserDataDir is required');
  if (!cacheVersion) throw new TypeError('cacheVersion is required');

  const limits = normalizedLimits(rawLimits);
  const boundedMaxAgeMs = Number.isFinite(Number(maxAgeMs)) && Number(maxAgeMs) > 0
    ? Math.floor(Number(maxAgeMs))
    : null;
  const queues = new Map();
  const metadata = new Map();
  const deleted = new Set();
  const supportsMaintenance = ['stat', 'open', 'rename', 'unlink'].every(name => typeof fs[name] === 'function');

  function encryptionAvailable() {
    try { return safeStorage.isEncryptionAvailable() === true; } catch { return false; }
  }

  function isDeleted(partition) {
    return deleted.has(partition) || isPartitionDeleted(partition) === true;
  }

  function cacheFile(partition) {
    const dirName = String(partition || '').replace(/^persist:/, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(dirName)) throw new Error('账号沙箱不合法');
    return path.join(getUserDataDir(), 'Partitions', dirName, 'geek-translation-cache.jsonl');
  }

  function metaFor(partition) {
    if (!metadata.has(partition)) metadata.set(partition, { bytes: 0, appends: 0 });
    return metadata.get(partition);
  }

  function cleanupQueue(partition, promise) {
    if (queues.get(partition) === promise) queues.delete(partition);
  }

  function enqueue(partition, task) {
    const previous = queues.get(partition) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(partition, next);
    void next.then(
      () => cleanupQueue(partition, next),
      () => cleanupQueue(partition, next),
    );
    return next;
  }

  function itemIsFresh(item) {
    if (!boundedMaxAgeMs) return true;
    const at = Number(item?.at);
    const age = Number(now()) - at;
    return Number.isFinite(at) && at > 0 && age >= 0 && age <= boundedMaxAgeMs;
  }

  function decodeRecord(line) {
    if (!line || !line.trim()) return null;
    try {
      const record = JSON.parse(line);
      if (record.version !== cacheVersion || typeof record.key !== 'string' || !record.key || typeof record.value !== 'string' || !record.value) return null;
      const item = { text: safeStorage.decryptString(Buffer.from(record.value, 'base64')), at: Number(record.at) || 0 };
      if (!itemIsFresh(item)) return null;
      return { key: record.key, item };
    } catch {
      return null;
    }
  }

  function applyRecords(cache, text, dropFirstPartialLine = false) {
    const lines = String(text || '').split(/\r?\n/);
    if (dropFirstPartialLine && lines.length) lines.shift();
    for (const line of lines) {
      const decoded = decodeRecord(line);
      if (decoded) cache.set(decoded.key, decoded.item);
    }
  }

  async function readBounded(file) {
    if (!supportsMaintenance) {
      try {
        const text = await fs.readFile(file, 'utf8');
        return { text, bytes: Buffer.byteLength(String(text || ''), 'utf8'), truncated: false, dropFirstPartialLine: false };
      } catch (error) {
        if (error?.code === 'ENOENT') return { text: '', bytes: 0, truncated: false, dropFirstPartialLine: false };
        throw error;
      }
    }

    let stat;
    try { stat = await fs.stat(file); } catch (error) {
      if (error?.code === 'ENOENT') return { text: '', bytes: 0, truncated: false, dropFirstPartialLine: false };
      throw error;
    }
    const size = Math.max(0, Number(stat?.size) || 0);
    if (size <= limits.coldLoadBytes) {
      const text = await fs.readFile(file, 'utf8');
      return { text, bytes: size, truncated: false, dropFirstPartialLine: false };
    }

    const start = Math.max(0, size - limits.coldLoadBytes);
    const includeBoundaryByte = start > 0;
    const readStart = includeBoundaryByte ? start - 1 : start;
    const readLength = size - readStart;
    const buffer = Buffer.allocUnsafe(readLength);
    const handle = await fs.open(file, 'r');
    try {
      const { bytesRead } = await handle.read(buffer, 0, readLength, readStart);
      const data = buffer.subarray(0, bytesRead);
      if (!includeBoundaryByte) {
        return { text: data.toString('utf8'), bytes: size, truncated: true, dropFirstPartialLine: false };
      }
      const boundaryWasNewline = data.length > 0 && data[0] === 0x0a;
      return {
        text: data.subarray(Math.min(1, data.length)).toString('utf8'),
        bytes: size,
        truncated: true,
        dropFirstPartialLine: !boundaryWasNewline,
      };
    } finally {
      await handle.close();
    }
  }

  function serializedRecord(key, item) {
    const record = {
      version: cacheVersion,
      key,
      at: Number(item?.at) || 0,
      value: safeStorage.encryptString(String(item?.text || '')).toString('base64'),
    };
    return JSON.stringify(record) + '\n';
  }

  function compactedContent(cache) {
    const candidates = [...cache.entries()]
      .filter(([key, item]) => typeof key === 'string' && key && item && typeof item.text === 'string' && itemIsFresh(item))
      .sort((a, b) => (Number(b[1].at) || 0) - (Number(a[1].at) || 0));
    const lines = [];
    let bytes = 0;
    for (const [key, item] of candidates) {
      if (lines.length >= limits.maxEntries) break;
      let line;
      try { line = serializedRecord(key, item); } catch { continue; }
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (lineBytes > limits.compactedMaxBytes) continue;
      if (bytes + lineBytes > limits.compactedMaxBytes) continue;
      lines.push(line);
      bytes += lineBytes;
    }
    return { content: lines.join(''), bytes };
  }

  function transientRenameError(error) {
    return error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY');
  }

  async function renameWithRetry(from, to) {
    let lastError;
    for (let index = 0; index < WINDOWS_RENAME_RETRY_MS.length; index += 1) {
      const delay = WINDOWS_RENAME_RETRY_MS[index];
      if (delay) await sleep(delay);
      try {
        await fs.rename(from, to);
        return;
      } catch (error) {
        lastError = error;
        if (!transientRenameError(error) || index === WINDOWS_RENAME_RETRY_MS.length - 1) throw error;
      }
    }
    throw lastError;
  }

  async function unlinkQuietly(file) {
    try { await fs.unlink(file); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }

  async function compactNow(partition, cache) {
    if (!supportsMaintenance || isDeleted(partition) || !encryptionAvailable()) return false;
    const file = cacheFile(partition);
    const { content, bytes } = compactedContent(cache);
    const temp = `${file}.tmp-${String(randomUUID()).replace(/[^A-Za-z0-9_-]/g, '')}`;
    let handle = null;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      if (typeof handle.sync === 'function') await handle.sync();
      await handle.close();
      handle = null;
      if (isDeleted(partition)) {
        await unlinkQuietly(temp);
        return false;
      }
      await renameWithRetry(temp, file);
      const meta = metaFor(partition);
      meta.bytes = bytes;
      meta.appends = 0;
      return true;
    } catch (error) {
      if (handle) {
        try { await handle.close(); } catch {}
      }
      try { await unlinkQuietly(temp); } catch {}
      throw error;
    }
  }

  function scheduleCompaction(partition, cache) {
    if (!supportsMaintenance || isDeleted(partition) || !encryptionAvailable()) return Promise.resolve(false);
    return enqueue(partition, async () => {
      if (isDeleted(partition)) return false;
      try { return await compactNow(partition, cache); } catch { return false; }
    });
  }

  async function load(partition, cache) {
    if (isDeleted(partition) || !encryptionAvailable()) return { truncated: false, bytes: 0 };
    const file = cacheFile(partition);
    let loaded;
    try { loaded = await readBounded(file); } catch { return { truncated: false, bytes: 0 }; }
    if (isDeleted(partition)) return { truncated: loaded.truncated, bytes: loaded.bytes };
    applyRecords(cache, loaded.text, loaded.dropFirstPartialLine);
    const meta = metaFor(partition);
    meta.bytes = loaded.bytes;
    meta.appends = 0;
    if (loaded.truncated || loaded.bytes > limits.compactTriggerBytes) {
      void scheduleCompaction(partition, cache).catch(() => {});
    }
    return { truncated: loaded.truncated, bytes: loaded.bytes };
  }

  function append(partition, key, item, cache) {
    if (isDeleted(partition) || !encryptionAvailable()) return Promise.resolve(false);
    let line;
    try { line = serializedRecord(key, item); } catch { return Promise.resolve(false); }
    const lineBytes = Buffer.byteLength(line, 'utf8');
    return enqueue(partition, async () => {
      if (isDeleted(partition)) return false;
      const file = cacheFile(partition);
      await fs.appendFile(file, line, 'utf8');
      const meta = metaFor(partition);
      meta.bytes += lineBytes;
      meta.appends += 1;
      if (
        supportsMaintenance &&
        (meta.bytes > limits.compactTriggerBytes || meta.appends >= limits.appendsBeforeCompact)
      ) {
        try { await compactNow(partition, cache); } catch {}
      }
      return true;
    });
  }

  function deletePartition(partition) {
    deleted.add(String(partition || ''));
    metadata.delete(partition);
  }

  async function whenIdle(partition) {
    const pending = queues.get(partition);
    if (pending) await pending.catch(() => {});
  }

  return Object.freeze({
    limits,
    load,
    append,
    deletePartition,
    whenIdle,
  });
}

module.exports = {
  DEFAULT_LIMITS,
  WINDOWS_RENAME_RETRY_MS,
  createTranslationCacheStore,
};
