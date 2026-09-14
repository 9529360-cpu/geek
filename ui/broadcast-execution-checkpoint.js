(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastExecutionCheckpoint = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STORAGE_KEY = 'broadcastExecutionCheckpoints';
  const VERSION = 1;
  const PHASES = new Set(['dispatching', 'settled']);
  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  const FORBIDDEN_FIELDS = new Set(['message', 'text', 'target', 'targets', 'targetId', 'chatId', 'name', 'file', 'files', 'path', 'attachmentRefs', 'vcards']);

  function asId(value) {
    return String(value == null ? '' : value).trim();
  }

  function nonNegativeInt(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : Math.max(0, Math.floor(Number(fallback) || 0));
  }

  function finiteTime(value, fallback = Date.now()) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : Math.floor(Number(fallback) || Date.now());
  }

  function checkpointRecord(job, phase, index, at = Date.now()) {
    if (!job || typeof job !== 'object') throw new TypeError('broadcast checkpoint requires job');
    const jobId = asId(job.id);
    const accountId = asId(job.accountId);
    const normalizedPhase = String(phase || '');
    if (!jobId || !accountId) throw new TypeError('broadcast checkpoint requires job/account id');
    if (!PHASES.has(normalizedPhase)) throw new TypeError(`invalid broadcast checkpoint phase: ${normalizedPhase}`);
    const current = nonNegativeInt(job.current);
    const targetIndex = nonNegativeInt(index, current);
    return Object.freeze({
      version: VERSION,
      jobId,
      accountId,
      platformFamily: String(job.platformFamily || ''),
      phase: normalizedPhase,
      index: targetIndex,
      total: nonNegativeInt(job.total),
      current,
      ok: nonNegativeInt(job.ok),
      fail: nonNegativeInt(job.fail),
      createdAt: finiteTime(job.createdAt, at),
      startedAt: job.startedAt == null ? null : finiteTime(job.startedAt, at),
      updatedAt: finiteTime(at, Date.now()),
    });
  }

  function normalizeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const key of FORBIDDEN_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(value, key)) return null;
    }
    const jobId = asId(value.jobId);
    const accountId = asId(value.accountId);
    const phase = String(value.phase || '');
    if (!jobId || !accountId || !PHASES.has(phase)) return null;
    return checkpointRecord({
      id: jobId,
      accountId,
      platformFamily: String(value.platformFamily || ''),
      total: value.total,
      current: value.current,
      ok: value.ok,
      fail: value.fail,
      createdAt: value.createdAt,
      startedAt: value.startedAt,
    }, phase, value.index, value.updatedAt);
  }

  function parsePayload(raw) {
    if (!raw) return new Map();
    let parsed;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch (_) { return new Map(); }
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    const result = new Map();
    for (const candidate of records) {
      const record = normalizeRecord(candidate);
      if (record) result.set(record.jobId, record);
    }
    return result;
  }

  function serializeRecords(records) {
    const list = [...records.values()].map(record => ({ ...record }));
    return JSON.stringify({ version: VERSION, records: list });
  }

  function recoveryReason(record) {
    return record?.phase === 'dispatching'
      ? 'BROADCAST_INTERRUPTED_UNCERTAIN'
      : 'BROADCAST_INTERRUPTED';
  }

  function recoveryMessage(record) {
    return record?.phase === 'dispatching'
      ? '群发在发送过程中中断，最后一次发送结果不确定。未自动重发，请先在对应平台核对后再决定是否重新发送。'
      : '群发在已确认进度之后中断。未自动继续发送，请确认剩余对象后再决定是否重新发送。';
  }

  function createStore(options = {}) {
    const api = options.api;
    const manager = options.manager;
    const accountsApi = options.accountsApi || api?.accounts;
    const accountData = options.accountData || api?.accountData;
    const clock = typeof options.now === 'function' ? options.now : () => Date.now();
    if (!accountData || typeof accountData.getAll !== 'function' || typeof accountData.set !== 'function' || typeof accountData.remove !== 'function') {
      throw new TypeError('broadcast execution checkpoint requires accountData API');
    }

    const cache = new Map();
    const queues = new Map();

    function serial(accountId, operation) {
      const id = asId(accountId);
      const previous = queues.get(id) || Promise.resolve();
      const next = previous.catch(() => {}).then(operation);
      queues.set(id, next);
      return next.finally(() => {
        if (queues.get(id) === next) queues.delete(id);
      });
    }

    async function load(accountId, force = false) {
      const id = asId(accountId);
      if (!id) throw new TypeError('broadcast checkpoint requires account id');
      if (!force && cache.has(id)) return cache.get(id);
      const all = await accountData.getAll(id);
      const records = parsePayload(all?.[STORAGE_KEY]);
      cache.set(id, records);
      return records;
    }

    async function persist(accountId, nextRecords) {
      const id = asId(accountId);
      if (nextRecords.size === 0) await accountData.remove(id, STORAGE_KEY);
      else await accountData.set(id, STORAGE_KEY, serializeRecords(nextRecords));
      cache.set(id, nextRecords);
      return true;
    }

    async function upsert(job, phase, index) {
      const record = checkpointRecord(job, phase, index, clock());
      return serial(record.accountId, async () => {
        const current = await load(record.accountId);
        const next = new Map(current);
        next.set(record.jobId, record);
        await persist(record.accountId, next);
        return record;
      });
    }

    async function enterDispatch(job, index) {
      return upsert(job, 'dispatching', index);
    }

    async function settle(job, index) {
      return upsert(job, 'settled', index);
    }

    async function clear(jobOrAccountId, maybeJobId) {
      const accountId = typeof jobOrAccountId === 'object' ? asId(jobOrAccountId?.accountId) : asId(jobOrAccountId);
      const jobId = typeof jobOrAccountId === 'object' ? asId(jobOrAccountId?.id) : asId(maybeJobId);
      if (!accountId || !jobId) return false;
      return serial(accountId, async () => {
        const current = await load(accountId);
        if (!current.has(jobId)) return true;
        const next = new Map(current);
        next.delete(jobId);
        await persist(accountId, next);
        return true;
      });
    }

    async function restoreAccount(account) {
      const accountId = asId(account?.id);
      if (!accountId) return [];
      const records = await serial(accountId, () => load(accountId, true));
      const restored = [];
      for (const record of records.values()) {
        if (record.accountId !== accountId) {
          try { await clear(accountId, record.jobId); } catch (_) {}
          continue;
        }
        const reason = recoveryReason(record);
        const message = recoveryMessage(record);
        const at = clock();
        let evidence = null;
        if (manager && typeof manager.get === 'function' && typeof manager.register === 'function') {
          const evidenceId = `interrupted-${record.jobId}`;
          evidence = manager.get(evidenceId);
          if (!evidence) {
            evidence = manager.register({
              id: evidenceId,
              accountId,
              accountName: String(account?.name || ''),
              partition: String(account?.partition || ''),
              platformFamily: String(record.platformFamily || ''),
              state: 'failed',
              targets: [],
              total: record.total,
              current: record.current,
              ok: record.ok,
              fail: record.fail,
              failed: [{ code: reason, reason: `${reason}：${message}`, at }],
              createdAt: at,
              startedAt: record.startedAt,
              finishedAt: at,
            });
          }
        }
        restored.push({ record, evidence, reason });
        if (evidence || !manager) {
          try { await clear(accountId, record.jobId); } catch (_) {}
        }
      }
      return restored;
    }

    async function restore() {
      if (!accountsApi || typeof accountsApi.list !== 'function') return [];
      const listed = await accountsApi.list();
      const accounts = listed?.accounts || listed || [];
      const restored = [];
      for (const account of accounts) {
        try { restored.push(...await restoreAccount(account)); }
        catch (_) {}
      }
      return restored;
    }

    async function finalize(job) {
      if (!job || !TERMINAL.has(String(job.state || ''))) return false;
      try { return await clear(job); }
      catch (_) { return false; }
    }

    return Object.freeze({ enterDispatch, settle, clear, finalize, restore, restoreAccount, load });
  }

  function install() {
    if (typeof window === 'undefined') return null;
    if (window.GeekBroadcastExecutionCheckpointInstance) return window.GeekBroadcastExecutionCheckpointInstance;
    const manager = window.GeekBroadcastJobs;
    if (!manager || !window.api?.accountData) return null;
    const instance = createStore({ api: window.api, manager });
    window.GeekBroadcastExecutionCheckpointInstance = instance;
    setTimeout(() => { void instance.restore().catch(() => {}); }, 0);
    return instance;
  }

  return Object.freeze({ STORAGE_KEY, VERSION, checkpointRecord, normalizeRecord, parsePayload, serializeRecords, recoveryReason, recoveryMessage, createStore, install });
});

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastExecutionCheckpoint.install(), { once: true });
  else window.GeekBroadcastExecutionCheckpoint.install();
}
