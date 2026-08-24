(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastSchedulePersistence = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STORAGE_KEY = 'broadcastJobSchedules';
  const MAX_RESTORE_ATTEMPTS = 20;
  let installed = false;
  const restoreRetries = new Map();

  function serializableJob(job) {
    return {
      id: job.id,
      accountId: job.accountId,
      accountName: job.accountName || '',
      partition: job.partition || '',
      platformFamily: job.platformFamily || '',
      targets: (job.targets || []).map(target => ({ ...target })),
      message: job.message || '',
      vcards: (job.vcards || []).map(card => ({ ...card })),
      tagAll: !!job.tagAll,
      intervalMin: Number(job.intervalMin) || 5,
      intervalMax: Number(job.intervalMax) || 10,
      scheduledAt: Number(job.scheduledAt) || null,
      createdAt: Number(job.createdAt) || Date.now(),
    };
  }

  async function persistAccount(accountId) {
    const manager = window.GeekBroadcastJobs;
    if (!manager || !accountId) return;
    const pending = manager.getPending(accountId)
      .filter(job => !job.files?.length)
      .map(serializableJob);
    await window.api.accountData.set(String(accountId), STORAGE_KEY, JSON.stringify(pending));
  }

  function duePendingJob(manager, accountId) {
    return manager?.getPending(accountId).find(job =>
      job.state === 'queued' || (job.state === 'scheduled' && Number(job.scheduledAt) <= Date.now())
    ) || null;
  }

  function failExhaustedRestore(accountId) {
    const manager = window.GeekBroadcastJobs;
    const due = duePendingJob(manager, accountId);
    if (!manager || !due || !['queued', 'scheduled'].includes(due.state)) return null;
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
      void startDueForAccount(id, attempts);
    }, Math.min(5000, 500 + attempts * 250));
    restoreRetries.set(id, { handle, attempts });
  }

  async function startDueForAccount(accountId, attempts = 0) {
    const manager = window.GeekBroadcastJobs;
    const runtime = window.GeekBroadcastRuntimeInstance;
    if (!manager || !runtime) return;
    if (manager.hasActive(accountId)) return;
    const due = duePendingJob(manager, accountId);
    if (!due) return;
    if (due.state === 'scheduled') manager.transition(due.id, 'queued');
    try {
      await runtime.runJob(due.id);
      restoreRetries.delete(String(accountId));
    } catch (error) {
      const job = manager.get(due.id);
      if (job && (job.state === 'queued' || job.state === 'scheduled')) scheduleRetry(accountId, attempts);
    }
  }

  function armRestored(job) {
    const runtime = window.GeekBroadcastRuntimeInstance;
    const manager = window.GeekBroadcastJobs;
    if (!runtime || !manager || !job) return;
    if (job.state === 'queued' || Number(job.scheduledAt) <= Date.now()) {
      setTimeout(() => void startDueForAccount(job.accountId), 1000);
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
      if (!current || ['completed', 'stopped', 'failed'].includes(current.state)) return;
      if (manager.hasActive(current.accountId)) {
        if (current.state === 'scheduled') manager.transition(current.id, 'queued');
        await persistAccount(current.accountId);
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
        if (!record.message && !(record.vcards || []).length) continue;
        const scheduledAt = Number(record.scheduledAt);
        if (!Number.isFinite(scheduledAt)) continue;
        try {
          const job = manager.register({
            ...record,
            accountId: String(account.id),
            accountName: record.accountName || account.name || '',
            partition: account.partition || record.partition || '',
            files: [],
            state: scheduledAt <= Date.now() ? 'queued' : 'scheduled',
            scheduledAt,
          });
          armRestored(job);
        } catch (_) {}
      }
      await persistAccount(account.id);
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
      if (job.state === 'scheduled' || job.state === 'queued' || ['completed', 'stopped', 'failed', 'running'].includes(job.state)) {
        queueMicrotask(() => void persistAccount(job.accountId));
      }
    });
    setTimeout(() => void restore(), 0);
    window.GeekBroadcastSchedulePersistenceInstance = Object.freeze({ restore, persistAccount, startDueForAccount });
  }

  return Object.freeze({ STORAGE_KEY, MAX_RESTORE_ATTEMPTS, serializableJob, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastSchedulePersistence.install(), { once: true });
  else window.GeekBroadcastSchedulePersistence.install();
}
