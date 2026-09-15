'use strict';

const path = require('node:path');

const JOURNAL_VERSION = 1;
const ACCOUNT_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const PARTITION_PREFIX = 'persist:webview-page-';

function journalError(code, message, cause) {
  const error = new Error(message || code);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function normalizeRecord(value, now = Date.now) {
  const accountId = String(value?.accountId || '').trim();
  const partition = String(value?.partition || '').trim();
  if (!ACCOUNT_ID.test(accountId) || partition !== `${PARTITION_PREFIX}${accountId}`) {
    throw journalError('ACCOUNT_REMOVAL_CLEANUP_JOURNAL_INVALID', '账号删除恢复记录不合法');
  }
  return {
    accountId,
    partition,
    createdAt: Number.isFinite(Number(value?.createdAt)) ? Number(value.createdAt) : Number(now()),
  };
}

function createAccountRemovalCleanupJournal(options = {}) {
  const fs = options.fs;
  const filePath = String(options.filePath || '');
  const now = options.now || Date.now;
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function' || typeof fs.rename !== 'function' || typeof fs.mkdir !== 'function') {
    throw new TypeError('fs promises API is required');
  }
  if (!filePath) throw new TypeError('filePath is required');

  const pending = new Map();
  let initialized = false;
  let initPromise = null;
  let mutationQueue = Promise.resolve();

  function serialize() {
    return JSON.stringify({ version: JOURNAL_VERSION, pending: [...pending.values()] });
  }

  async function syncDirectory(directory) {
    if (typeof fs.open !== 'function') return;
    let handle;
    try {
      handle = await fs.open(directory, 'r');
      if (typeof handle.sync === 'function') await handle.sync();
    } catch {
      // Directory fsync is not supported on every Windows/filesystem combination.
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function writeSynced(target, content) {
    if (typeof fs.open !== 'function') {
      await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
      return;
    }
    let handle;
    try {
      handle = await fs.open(target, 'w', 0o600);
      await handle.writeFile(content, 'utf8');
      if (typeof handle.sync === 'function') await handle.sync();
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function writeSnapshot() {
    const directory = path.dirname(filePath);
    const tempPath = `${filePath}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    await writeSynced(tempPath, serialize());
    await fs.rename(tempPath, filePath);
    await syncDirectory(directory);
  }

  async function init() {
    if (initialized) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      let raw = '';
      try {
        raw = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          initialized = true;
          return;
        }
        throw error;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw || '{}');
      } catch (cause) {
        throw journalError('ACCOUNT_REMOVAL_CLEANUP_JOURNAL_CORRUPT', '账号删除恢复记录损坏', cause);
      }
      if (parsed?.version !== JOURNAL_VERSION || !Array.isArray(parsed?.pending)) {
        throw journalError('ACCOUNT_REMOVAL_CLEANUP_JOURNAL_CORRUPT', '账号删除恢复记录版本不受支持');
      }
      for (const value of parsed.pending) {
        const record = normalizeRecord(value, now);
        if (pending.has(record.accountId)) {
          throw journalError('ACCOUNT_REMOVAL_CLEANUP_JOURNAL_CORRUPT', '账号删除恢复记录重复');
        }
        pending.set(record.accountId, record);
      }
      initialized = true;
    })();
    try {
      await initPromise;
    } catch (error) {
      initPromise = null;
      throw error;
    }
  }

  function enqueue(operation) {
    const run = mutationQueue.catch(() => {}).then(operation);
    mutationQueue = run.catch(() => {});
    return run;
  }

  async function markPending(meta) {
    await init();
    const record = normalizeRecord({ ...meta, createdAt: now() }, now);
    return enqueue(async () => {
      const previous = pending.get(record.accountId);
      pending.set(record.accountId, record);
      try {
        await writeSnapshot();
      } catch (error) {
        if (previous) pending.set(record.accountId, previous);
        else pending.delete(record.accountId);
        throw error;
      }
      return Object.freeze({ ...record });
    });
  }

  async function clear(accountId) {
    await init();
    const id = String(accountId || '').trim();
    if (!ACCOUNT_ID.test(id)) throw journalError('ACCOUNT_REMOVAL_CLEANUP_JOURNAL_INVALID', '账号删除恢复记录不合法');
    return enqueue(async () => {
      const previous = pending.get(id);
      if (!previous) return false;
      pending.delete(id);
      try {
        await writeSnapshot();
      } catch (error) {
        pending.set(id, previous);
        throw error;
      }
      return true;
    });
  }

  async function recover({ resolveAccountPartition, cleanup }) {
    if (typeof resolveAccountPartition !== 'function') throw new TypeError('resolveAccountPartition is required');
    if (typeof cleanup !== 'function') throw new TypeError('cleanup is required');
    await init();
    return enqueue(async () => {
      const cleared = [];
      const recovered = [];
      const failed = [];
      const removedRecords = [];
      for (const record of [...pending.values()]) {
        let ownerExists = true;
        try {
          await resolveAccountPartition(record.accountId);
        } catch (error) {
          if (error?.code === 'ACCOUNT_DATA_ACCOUNT_MISSING') ownerExists = false;
          else {
            failed.push({ accountId: record.accountId, code: String(error?.code || error?.name || 'UNKNOWN') });
            continue;
          }
        }
        if (!ownerExists) {
          try {
            await cleanup({ accountId: record.accountId, partition: record.partition, recovered: true });
            recovered.push(record.accountId);
          } catch (error) {
            failed.push({ accountId: record.accountId, code: String(error?.code || error?.name || 'UNKNOWN') });
            continue;
          }
        } else {
          cleared.push(record.accountId);
        }
        pending.delete(record.accountId);
        removedRecords.push(record);
      }
      if (removedRecords.length) {
        try {
          await writeSnapshot();
        } catch (error) {
          for (const record of removedRecords) pending.set(record.accountId, record);
          throw error;
        }
      }
      return Object.freeze({
        recovered: Object.freeze(recovered),
        cleared: Object.freeze(cleared),
        failed: Object.freeze(failed),
      });
    });
  }

  async function list() {
    await init();
    await mutationQueue.catch(() => {});
    return Object.freeze([...pending.values()].map(record => Object.freeze({ ...record })));
  }

  return Object.freeze({ init, markPending, clear, recover, list });
}

module.exports = {
  JOURNAL_VERSION,
  createAccountRemovalCleanupJournal,
};
