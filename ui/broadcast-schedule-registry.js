(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastScheduleRegistry = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Browser/Node timers use a signed 32-bit delay. Keep a margin below the
  // implementation limit and re-arm long schedules instead of allowing a
  // far-future task to overflow into an immediate/short timeout.
  const MAX_TIMER_DELAY_MS = 0x7fffffff - 1000;

  function asId(value, label) {
    const id = String(value == null ? '' : value).trim();
    if (!id) throw new TypeError(`broadcast schedule requires ${label}`);
    return id;
  }

  function schedulePersistenceReady() {
    if (typeof window === 'undefined') return true;
    const persistence = window.GeekBroadcastSchedulePersistenceInstance;
    return !!persistence && typeof persistence.awaitScheduledDurable === 'function';
  }

  function persistenceNotReadyError() {
    const error = new Error('定时任务持久化尚未就绪，请稍后重试。');
    error.code = 'BROADCAST_SCHEDULE_PERSISTENCE_NOT_READY';
    return error;
  }

  function createRegistry(options = {}) {
    const clock = typeof options.now === 'function' ? options.now : () => Date.now();
    const setTimer = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    const clearTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
    const canSchedule = typeof options.canSchedule === 'function' ? options.canSchedule : schedulePersistenceReady;
    const beforeDue = typeof options.beforeDue === 'function'
      ? options.beforeDue
      : async task => {
        if (typeof window === 'undefined') return true;
        const persistence = window.GeekBroadcastSchedulePersistenceInstance;
        if (!persistence || typeof persistence.awaitScheduledDurable !== 'function') return false;
        return persistence.awaitScheduledDurable(task.jobId || task.id);
      };
    const timersByAccount = new Map();
    const tasksByAccount = new Map();

    function taskMap(accountId) {
      const id = asId(accountId, 'accountId');
      if (!tasksByAccount.has(id)) tasksByAccount.set(id, new Map());
      return tasksByAccount.get(id);
    }

    function timerMap(accountId) {
      const id = asId(accountId, 'accountId');
      if (!timersByAccount.has(id)) timersByAccount.set(id, new Map());
      return timersByAccount.get(id);
    }

    function normalizeTask(seed = {}) {
      const accountId = asId(seed.accountId, 'accountId');
      const id = String(seed.id || `sched-${clock()}-${Math.random().toString(16).slice(2)}`);
      const scheduledAt = Number(seed.scheduledAt ?? seed.time);
      if (!Number.isFinite(scheduledAt)) throw new TypeError('broadcast schedule requires scheduledAt');
      return Object.freeze({
        ...seed,
        id,
        accountId,
        scheduledAt,
        targets: Object.freeze(Array.isArray(seed.targets) ? seed.targets.map(item => Object.freeze({ ...item })) : []),
        files: Object.freeze(Array.isArray(seed.files) ? seed.files.map(item => Object.freeze({ ...item })) : []),
        vcards: Object.freeze(Array.isArray(seed.vcards) ? seed.vcards.map(item => Object.freeze({ ...item })) : []),
        message: String(seed.message || ''),
        intervalMin: Number.isFinite(Number(seed.intervalMin)) ? Number(seed.intervalMin) : 5,
        intervalMax: Number.isFinite(Number(seed.intervalMax)) ? Number(seed.intervalMax) : 10,
        tagAll: !!seed.tagAll,
        createdAt: Number(seed.createdAt) || clock(),
      });
    }

    function cancel(accountId, taskId) {
      const account = String(accountId || '');
      const id = String(taskId || '');
      const timers = timersByAccount.get(account);
      if (timers?.has(id)) {
        clearTimer(timers.get(id));
        timers.delete(id);
        if (!timers.size) timersByAccount.delete(account);
      }
      const tasks = tasksByAccount.get(account);
      const existed = !!tasks?.delete(id);
      if (tasks && !tasks.size) tasksByAccount.delete(account);
      return existed;
    }

    function schedule(seed, onDue) {
      if (typeof onDue !== 'function') throw new TypeError('broadcast schedule requires onDue callback');
      const task = normalizeTask(seed);
      // runtime.js currently loads before schedule persistence. Do not allow that
      // short startup window to arm a timer for a Job whose first durable write has
      // no subscriber yet. Runtime catches this synchronously, marks the Job failed,
      // and cleans any durable attachment refs it created before scheduling.
      if (!canSchedule(task)) throw persistenceNotReadyError();
      cancel(task.accountId, task.id);
      taskMap(task.accountId).set(task.id, task);

      const arm = () => {
        if (!tasksByAccount.get(task.accountId)?.has(task.id)) return;
        const remaining = Math.max(0, task.scheduledAt - clock());
        const delay = Math.min(remaining, MAX_TIMER_DELAY_MS);
        const handle = setTimer(async () => {
          const timers = timersByAccount.get(task.accountId);
          timers?.delete(task.id);
          if (timers && !timers.size) timersByAccount.delete(task.accountId);

          if (task.scheduledAt > clock()) {
            arm();
            return;
          }

          try {
            if (!(await beforeDue(task))) return;
            if (tasksByAccount.get(task.accountId)?.get(task.id) !== task) return;
            await onDue(task);
          } finally {
            const tasks = tasksByAccount.get(task.accountId);
            if (tasks?.get(task.id) === task) tasks.delete(task.id);
            if (tasks && !tasks.size) tasksByAccount.delete(task.accountId);
          }
        }, delay);
        timerMap(task.accountId).set(task.id, handle);
      };

      arm();
      return task;
    }

    function rearmAccount(accountId, tasks, onDue) {
      const account = asId(accountId, 'accountId');
      cancelAccount(account);
      const armed = [];
      for (const seed of Array.isArray(tasks) ? tasks : []) {
        const normalized = normalizeTask({ ...seed, accountId: account });
        if (normalized.scheduledAt <= clock()) continue;
        armed.push(schedule(normalized, onDue));
      }
      return armed;
    }

    function cancelAccount(accountId) {
      const account = String(accountId || '');
      const timers = timersByAccount.get(account);
      if (timers) for (const handle of timers.values()) clearTimer(handle);
      timersByAccount.delete(account);
      tasksByAccount.delete(account);
    }

    function list(accountId) {
      if (accountId == null) {
        return [...tasksByAccount.values()].flatMap(map => [...map.values()]);
      }
      return [...(tasksByAccount.get(String(accountId))?.values() || [])];
    }

    function has(accountId, taskId) {
      return !!tasksByAccount.get(String(accountId || ''))?.has(String(taskId || ''));
    }

    function timerCount(accountId) {
      if (accountId == null) return [...timersByAccount.values()].reduce((sum, map) => sum + map.size, 0);
      return timersByAccount.get(String(accountId || ''))?.size || 0;
    }

    return Object.freeze({ schedule, rearmAccount, cancel, cancelAccount, list, has, timerCount, normalizeTask });
  }

  return Object.freeze({ MAX_TIMER_DELAY_MS, schedulePersistenceReady, createRegistry });
});
