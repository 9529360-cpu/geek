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
  const dearmedJobIds = new Set();

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

  async function dearmForExecution(job) {
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
      void startDueForAccount(id, attempts).catch(() => {});
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
      // Remove this Job from the auto-replay durable set *before* any target is sent.
      // A crash after this point may require manual recreation, but it cannot replay
      // the same scheduled Job from the first target on the next app launch.
      await dearmForExecution(due);
      await runtime.runJob(due.id);
      restoreRetries.delete(String(accountId));
    } catch (error) {
      const job = manager.get(due.id);
      if (job && (job.state === 'queued' || job.state === 'scheduled')) scheduleRetry(accountId, attempts);
      throw error;
    }
  }

  function armRestored(job) {
    const runtime = window.GeekBroadcastRuntimeInstance;
    const manager = window.GeekBroadcastJobs;
    if (!runtime || !manager || !job) return;
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
      // accounts. The existing on-disk records remain fail-closed inputs next launch.
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
      if (job.state === 'scheduled' || job.state === 'queued' || ['completed', 'stopped', 'failed', 'running'].includes(job.state)) {
        queueMicrotask(() => {
          void persistAccount(job.accountId).then(() => {
            if (['completed', 'stopped', 'failed'].includes(job.state)) dearmedJobIds.delete(String(job.id || ''));
          }).catch(() => {
            // Explicit scheduled creation and due execution both have awaited durable
            // gates. Background state refreshes are best-effort and must not become
            // unhandled renderer rejections.
          });
        });
      }
    });
    setTimeout(() => void restore().catch(() => {}), 0);
    window.GeekBroadcastSchedulePersistenceInstance = Object.freeze({ restore, persistAccount, dearmForExecution, startDueForAccount });
  }

  return Object.freeze({ STORAGE_KEY, MAX_RESTORE_ATTEMPTS, serializableJob, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastSchedulePersistence.install(), { once: true });
  else window.GeekBroadcastSchedulePersistence.install();
}
