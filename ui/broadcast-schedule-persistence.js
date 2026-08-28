(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastSchedulePersistence = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STORAGE_KEY = 'broadcastJobSchedules';
  const MAX_RESTORE_ATTEMPTS = 20;
  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  const PENDING = new Set(['scheduled', 'queued']);
  let installed = false;
  const restoreRetries = new Map();
  const dearmedJobIds = new Set();
  const lifecycleByJob = new Map();

  function serializableJob(job) {
    return {
      id: job.id,
      accountId: job.accountId,
      accountName: job.accountName || '',
      partition: job.partition || '',
      platformFamily: job.platformFamily || '',
      targets: (job.targets || []).map(target => ({ ...target })),
      message: job.message || '',
      attachmentRefs: (job.attachmentRefs || []).map(item => ({
        ref: String(item?.ref || ''),
        name: String(item?.name || ''),
        size: Number(item?.size) || 0,
        mime: String(item?.mime || 'application/octet-stream'),
      })).filter(item => item.ref),
      vcards: (job.vcards || []).map(card => ({ ...card })),
      tagAll: !!job.tagAll,
      intervalMin: Number(job.intervalMin) || 5,
      intervalMax: Number(job.intervalMax) || 10,
      scheduledAt: Number(job.scheduledAt) || null,
      createdAt: Number(job.createdAt) || Date.now(),
    };
  }

  function pendingForPersistence(manager, accountId) {
    return manager.getPending(accountId)
      .filter(job => !dearmedJobIds.has(String(job.id || '')))
      .filter(job => !job.files?.length || job.attachmentRefs?.length)
      .map(serializableJob);
  }

  async function persistAccount(accountId) {
    const manager = window.GeekBroadcastJobs;
    if (!manager || !accountId) return;
    const pending = pendingForPersistence(manager, accountId);
    await window.api.accountData.set(String(accountId), STORAGE_KEY, JSON.stringify(pending));
  }

  function withJobLifecycle(jobId, operation) {
    const id = String(jobId || '');
    if (!id) return Promise.reject(new TypeError('scheduled job id is required'));
    const previous = lifecycleByJob.get(id) || Promise.resolve();
    const run = previous.catch(() => {}).then(operation);
    let tracked;
    tracked = run.finally(() => {
      if (lifecycleByJob.get(id) === tracked) lifecycleByJob.delete(id);
    });
    lifecycleByJob.set(id, tracked);
    return tracked;
  }

  async function dearmUnlocked(job) {
    if (!job?.id || !job?.accountId) throw new TypeError('scheduled job owner is required');
    const id = String(job.id);
    dearmedJobIds.add(id);
    try {
      await persistAccount(job.accountId);
      return true;
    } catch (error) {
      dearmedJobIds.delete(id);
      throw error;
    }
  }

  async function dearmForExecution(job) {
    return withJobLifecycle(job?.id, async () => {
      const manager = window.GeekBroadcastJobs;
      const current = manager?.get(job?.id);
      if (!current || TERMINAL.has(current.state)) return false;
      return dearmUnlocked(current);
    });
  }

  function persistenceError(cause) {
    const error = new Error('定时任务保存失败，任务已停止。请检查磁盘/系统安全存储后重新创建。');
    error.code = 'BROADCAST_SCHEDULE_PERSIST_FAILED';
    error.cause = cause;
    return error;
  }

  async function cancelPendingDurably(requestedJob) {
    const manager = window.GeekBroadcastJobs;
    if (!manager || !requestedJob?.id) return null;
    return withJobLifecycle(requestedJob.id, async () => {
      const current = manager.get(requestedJob.id);
      if (!current || TERMINAL.has(current.state)) return current;

      const runtime = window.GeekBroadcastRuntimeInstance;
      const cancelTimers = () => {
        const scheduler = runtime?.scheduler;
        if (!scheduler || typeof scheduler.cancel !== 'function') return;
        scheduler.cancel(current.accountId, `timer-${current.id}`);
        scheduler.cancel(current.accountId, `persisted-${current.id}`);
      };

      if (PENDING.has(current.state)) {
        // Pending cancellation is not allowed to become visible/terminal until the
        // durable auto-replay record has been removed successfully.
        await dearmUnlocked(current);
        cancelTimers();
        return manager.get(current.id);
      }

      // A due Job may have been durably de-armed and moved to `starting` while a
      // user cancellation that began from the pending state was waiting for this
      // lifecycle lock. Stop it here before runtime preflight can reach a target.
      if (current.state === 'starting' || current.state === 'stopping') {
        cancelTimers();
        return manager.markStopped(current.id, {
          current: current.current,
          ok: current.ok,
          fail: current.fail,
        });
      }
      return current;
    });
  }

  function attachPendingControls(job) {
    const manager = window.GeekBroadcastJobs;
    if (!manager || !job?.id || typeof manager.attachControls !== 'function') return;
    manager.attachControls(job.id, {
      stop: pendingJob => cancelPendingDurably(pendingJob),
    });
  }

  async function ensureScheduledDurable(job) {
    const manager = window.GeekBroadcastJobs;
    if (!manager || !job?.id) throw new TypeError('scheduled job is required');
    attachPendingControls(job);
    return withJobLifecycle(job.id, async () => {
      const current = manager.get(job.id);
      if (!current || current.state !== 'scheduled') {
        const error = new Error('定时任务在保存前已失效，请重新创建。');
        error.code = 'BROADCAST_SCHEDULE_NOT_ARMABLE';
        throw error;
      }
      try {
        await persistAccount(current.accountId);
      } catch (cause) {
        const error = persistenceError(cause);
        const latest = manager.get(current.id);
        if (latest && latest.state === 'scheduled') manager.markFailed(latest.id, error);
        throw error;
      }
      const durable = manager.get(current.id);
      if (!durable || durable.state !== 'scheduled') {
        const error = new Error('定时任务在保存期间已取消，请重新创建。');
        error.code = 'BROADCAST_SCHEDULE_NOT_ARMABLE';
        throw error;
      }
      return durable;
    });
  }

  function duePendingJob(manager, accountId) {
    return manager?.getPending(accountId).find(job =>
      job.state === 'queued' || (job.state === 'scheduled' && Number(job.scheduledAt) <= Date.now())
    ) || null;
  }

  function failExhaustedRestore(accountId) {
    const manager = window.GeekBroadcastJobs;
    const due = duePendingJob(manager, accountId);
    if (!manager || !due || !PENDING.has(due.state)) return null;
    const error = new Error('账号页面持续未就绪，定时群发已停止。请打开该账号并重新创建任务。');
    error.code = 'BROADCAST_SCHEDULE_ACCOUNT_UNAVAILABLE';
    return manager.markFailed(due.id, error);
  }

  function scheduleRetry(accountId, previousAttempts = 0) {
    const id = String(accountId || '');
    const previous = restoreRetries.get(id);
    if (previous) clearTimeout(previous.handle);
    const attempts = Math.max(Number(previous?.attempts) || 0, Number(previousAttempts) || 0) + 1;
    if (attempts > MAX_RESTORE_ATTEMPTS) {
      restoreRetries.delete(id);
      failExhaustedRestore(id);
      return;
    }
    const handle = setTimeout(() => {
      restoreRetries.delete(id);
      void startDueForAccount(id, attempts).catch(() => {});
    }, Math.min(5000, 500 + attempts * 250));
    restoreRetries.set(id, { handle, attempts });
  }

  async function startDueForAccount(accountId, attempts = 0) {
    const manager = window.GeekBroadcastJobs;
    const runtime = window.GeekBroadcastRuntimeInstance;
    if (!manager || !runtime) return null;
    const due = duePendingJob(manager, accountId);
    if (!due) return null;

    let claimed;
    try {
      claimed = await withJobLifecycle(due.id, async () => {
        let current = manager.get(due.id);
        if (!current || TERMINAL.has(current.state) || !PENDING.has(current.state)) return null;
        if (manager.hasActive(current.accountId)) {
          if (current.state === 'scheduled') current = manager.transition(current.id, 'queued');
          try { await persistAccount(current.accountId); } catch (_) {}
          return null;
        }
        if (current.state === 'scheduled') current = manager.transition(current.id, 'queued');

        // The durable record is removed and fsynced by accountData *before* the Job
        // can become executable. A crash after this point may lose the scheduled run,
        // but can never auto-replay it from target zero after restart.
        await dearmUnlocked(current);
        current = manager.transition(current.id, 'starting');
        return current;
      });
    } catch (error) {
      const current = manager.get(due.id);
      if (current && PENDING.has(current.state)) scheduleRetry(accountId, attempts);
      throw error;
    }

    if (!claimed) return null;

    // Give a cancellation that started while the Job was still pending a chance to
    // acquire the same lifecycle lock. Its provisional stop control marks `starting`
    // terminal before runtime can reach the executor/sendTarget path.
    await Promise.resolve();
    const latestBeforeRun = manager.get(claimed.id);
    if (!latestBeforeRun || latestBeforeRun.state !== 'starting') return latestBeforeRun || null;

    try {
      const result = await runtime.runJob(claimed.id);
      restoreRetries.delete(String(accountId));
      return result;
    } catch (error) {
      const current = manager.get(claimed.id);
      if (current && PENDING.has(current.state)) scheduleRetry(accountId, attempts);
      throw error;
    }
  }

  function armRestored(job) {
    const runtime = window.GeekBroadcastRuntimeInstance;
    const manager = window.GeekBroadcastJobs;
    if (!runtime || !manager || !job) return;
    attachPendingControls(job);
    if (job.state === 'queued' || Number(job.scheduledAt) <= Date.now()) {
      setTimeout(() => void startDueForAccount(job.accountId).catch(() => {}), 1000);
      return;
    }
    runtime.scheduler.schedule({
      id: `persisted-${job.id}`,
      accountId: job.accountId,
      scheduledAt: job.scheduledAt,
      jobId: job.id,
      targets: job.targets,
      message: job.message,
      intervalMin: job.intervalMin,
      intervalMax: job.intervalMax,
      tagAll: job.tagAll,
    }, async task => {
      const current = manager.get(task.jobId);
      if (!current || TERMINAL.has(current.state)) return;
      if (manager.hasActive(current.accountId)) {
        if (current.state === 'scheduled') manager.transition(current.id, 'queued');
        try { await persistAccount(current.accountId); } catch (_) {}
        return;
      }
      await startDueForAccount(current.accountId);
    });
  }

  async function restore() {
    const manager = window.GeekBroadcastJobs;
    if (!manager || !window.GeekBroadcastRuntimeInstance) return;
    const listed = await window.api.accounts.list();
    const accounts = listed?.accounts || listed || [];
    for (const account of accounts) {
      let records = [];
      try {
        const data = await window.api.accountData.getAll(account.id);
        const parsed = JSON.parse(data?.[STORAGE_KEY] || '[]');
        if (Array.isArray(parsed)) records = parsed;
      } catch (_) {}
      for (const record of records) {
        if (!record?.id || manager.get(record.id)) continue;
        const refs = Array.isArray(record.attachmentRefs)
          ? record.attachmentRefs.filter(item => item && typeof item.ref === 'string' && item.ref)
          : [];
        if (!record.message && !(record.vcards || []).length && !refs.length) continue;
        const scheduledAt = Number(record.scheduledAt);
        if (!Number.isFinite(scheduledAt)) continue;
        try {
          const job = manager.register({
            ...record,
            accountId: String(account.id),
            accountName: record.accountName || account.name || '',
            partition: account.partition || record.partition || '',
            files: [],
            attachmentRefs: refs,
            state: scheduledAt <= Date.now() ? 'queued' : 'scheduled',
            scheduledAt,
          });
          armRestored(job);
        } catch (_) {}
      }
      // One damaged/unwritable account sandbox must not abort restoration for other
      // accounts. Existing on-disk records remain the fail-closed source next launch.
      try { await persistAccount(account.id); } catch (_) {}
    }
  }

  function install() {
    if (installed || typeof window === 'undefined') return;
    const manager = window.GeekBroadcastJobs;
    if (!manager || !window.GeekBroadcastRuntimeInstance) return;
    installed = true;
    manager.subscribe(event => {
      const job = event?.job;
      if (!job?.accountId) return;
      // Initial scheduled creation is deliberately excluded: startFromEditor must
      // explicitly await ensureScheduledDurable() before arming any executable timer.
      if (job.state !== 'queued' && job.state !== 'running' && !TERMINAL.has(job.state)) return;
      queueMicrotask(() => {
        void persistAccount(job.accountId).then(() => {
          if (TERMINAL.has(job.state)) dearmedJobIds.delete(String(job.id || ''));
        }).catch(() => {
          // Pending cancellation/execution has its own awaited durable de-arm. Other
          // observer writes are best-effort mirrors and must never create a send path.
        });
      });
    });
    setTimeout(() => void restore().catch(() => {}), 0);
    window.GeekBroadcastSchedulePersistenceInstance = Object.freeze({
      restore,
      persistAccount,
      ensureScheduledDurable,
      dearmForExecution,
      cancelPendingDurably,
      startDueForAccount,
    });
  }

  return Object.freeze({ STORAGE_KEY, MAX_RESTORE_ATTEMPTS, serializableJob, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastSchedulePersistence.install(), { once: true });
  else window.GeekBroadcastSchedulePersistence.install();
}
