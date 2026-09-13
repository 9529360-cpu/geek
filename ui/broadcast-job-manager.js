(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.GeekBroadcastJobManager = api;
    root.GeekBroadcastJobs = api.defaultManager;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL_STATES = Object.freeze(['completed', 'stopped', 'failed']);
  const TERMINAL = new Set(TERMINAL_STATES);
  const EXECUTING = new Set(['starting', 'running', 'paused', 'stopping']);
  const PENDING = new Set(['scheduled', 'queued']);
  const TRANSITIONS = Object.freeze({
    scheduled: new Set(['queued', 'starting', 'running', 'stopped', 'failed']),
    queued: new Set(['starting', 'running', 'stopped', 'failed']),
    starting: new Set(['running', 'paused', 'stopping', 'stopped', 'failed']),
    running: new Set(['paused', 'stopping', 'completed', 'stopped', 'failed']),
    paused: new Set(['running', 'stopping', 'stopped', 'failed']),
    stopping: new Set(['stopped', 'completed', 'failed']),
    completed: new Set(),
    stopped: new Set(),
    failed: new Set(),
  });

  function now() { return Date.now(); }

  function asId(value, label) {
    const id = String(value == null ? '' : value).trim();
    if (!id) throw new TypeError(`broadcast job requires ${label}`);
    return id;
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegativeInt(value, fallback = 0) {
    return Math.max(0, Math.floor(finiteNumber(value, fallback)));
  }

  function freezeRecord(value) {
    if (!value || typeof value !== 'object') return value;
    return Object.freeze({ ...value });
  }

  function freezeList(value) {
    if (!Array.isArray(value)) return Object.freeze([]);
    return Object.freeze(value.map(item => freezeRecord(item)));
  }

  function createJob(seed = {}) {
    const accountId = asId(seed.accountId, 'accountId');
    const createdAt = finiteNumber(seed.createdAt, now());
    const targets = freezeList(seed.targets);
    const total = nonNegativeInt(seed.total, targets.length);
    const intervalMin = Math.max(0, finiteNumber(seed.intervalMin, 5));
    const intervalMax = Math.max(intervalMin, finiteNumber(seed.intervalMax, Math.max(intervalMin, 10)));
    const state = String(seed.state || (seed.scheduledAt ? 'scheduled' : 'starting'));
    if (!TRANSITIONS[state]) throw new TypeError(`invalid broadcast job state: ${state}`);

    return {
      id: String(seed.id || `bc-${createdAt}-${Math.random().toString(16).slice(2)}`),
      accountId,
      accountName: String(seed.accountName || ''),
      partition: String(seed.partition || ''),
      platformFamily: String(seed.platformFamily || ''),
      webviewId: String(seed.webviewId || ''),
      guestId: seed.guestId == null ? null : seed.guestId,
      targets,
      message: String(seed.message || ''),
      files: freezeList(seed.files),
      attachmentRefs: freezeList(seed.attachmentRefs),
      vcards: freezeList(seed.vcards),
      tagAll: !!seed.tagAll,
      intervalMin,
      intervalMax,
      scheduledAt: seed.scheduledAt == null ? null : finiteNumber(seed.scheduledAt, null),
      state,
      current: nonNegativeInt(seed.current),
      total,
      ok: nonNegativeInt(seed.ok),
      fail: nonNegativeInt(seed.fail),
      failed: freezeList(seed.failed),
      nextSendAt: seed.nextSendAt == null ? null : finiteNumber(seed.nextSendAt, null),
      stopRequested: !!seed.stopRequested,
      createdAt,
      startedAt: seed.startedAt == null ? (state === 'running' ? createdAt : null) : finiteNumber(seed.startedAt, null),
      updatedAt: createdAt,
      finishedAt: seed.finishedAt == null ? null : finiteNumber(seed.finishedAt, null),
      dismissed: !!seed.dismissed,
      revision: nonNegativeInt(seed.revision),
    };
  }

  function publicSnapshot(job) {
    if (!job) return null;
    return Object.freeze({
      ...job,
      targets: Object.freeze(job.targets.slice()),
      files: Object.freeze(job.files.slice()),
      attachmentRefs: Object.freeze(job.attachmentRefs.slice()),
      vcards: Object.freeze(job.vcards.slice()),
      failed: Object.freeze(job.failed.slice()),
    });
  }

  function visibleFor(job, activeAccountId) {
    return !!job && !job.dismissed && String(job.accountId) === String(activeAccountId || '');
  }

  function createManager(options = {}) {
    const jobs = new Map();
    const executingByAccount = new Map();
    const controls = new Map();
    const listeners = new Set();
    const clock = typeof options.now === 'function' ? options.now : now;

    function emit(type, job, extra = {}) {
      const event = Object.freeze({ type, job: publicSnapshot(job), ...extra });
      for (const listener of [...listeners]) {
        try { listener(event); } catch (_) {}
      }
      return event.job;
    }

    function touch(job) {
      job.updatedAt = clock();
      job.revision += 1;
      return job;
    }

    function requireJob(jobId) {
      const job = jobs.get(String(jobId || ''));
      if (!job) throw new Error(`broadcast job not found: ${jobId}`);
      return job;
    }

    function executingJob(accountId) {
      const id = executingByAccount.get(String(accountId || ''));
      const job = id ? jobs.get(id) : null;
      return job && EXECUTING.has(job.state) ? job : null;
    }

    function latestJob(accountId, includeDismissed = false) {
      const id = String(accountId || '');
      let latest = null;
      for (const job of jobs.values()) {
        if (job.accountId !== id || (!includeDismissed && job.dismissed)) continue;
        if (!latest || job.createdAt > latest.createdAt || (job.createdAt === latest.createdAt && job.revision > latest.revision)) latest = job;
      }
      return latest;
    }

    function pendingJobs(accountId) {
      const id = String(accountId || '');
      return [...jobs.values()]
        .filter(job => job.accountId === id && PENDING.has(job.state))
        .sort((a, b) => {
          const at = a.scheduledAt == null ? a.createdAt : a.scheduledAt;
          const bt = b.scheduledAt == null ? b.createdAt : b.scheduledAt;
          return at - bt || a.createdAt - b.createdAt;
        });
    }

    function claimExecutionSlot(job) {
      if (!EXECUTING.has(job.state)) return;
      const other = executingJob(job.accountId);
      if (other && other.id !== job.id) throw new Error(`account already has a running broadcast job: ${job.accountId}`);
      executingByAccount.set(job.accountId, job.id);
    }

    function register(seed = {}) {
      const job = createJob({ ...seed, createdAt: seed.createdAt == null ? clock() : seed.createdAt });
      if (jobs.has(job.id)) throw new Error(`broadcast job already exists: ${job.id}`);
      claimExecutionSlot(job);
      jobs.set(job.id, job);
      if (EXECUTING.has(job.state)) executingByAccount.set(job.accountId, job.id);
      return emit('created', job);
    }

    function start(seed = {}) {
      const state = seed.scheduledAt && finiteNumber(seed.scheduledAt, 0) > clock() ? 'scheduled' : 'running';
      return register({ ...seed, state, startedAt: state === 'running' ? clock() : null });
    }

    function transition(jobId, nextState, patch = {}) {
      const job = requireJob(jobId);
      const previousState = job.state;
      const next = String(nextState || '');
      if (!TRANSITIONS[next]) throw new TypeError(`invalid broadcast job state: ${next}`);
      if (previousState !== next && !TRANSITIONS[previousState].has(next)) throw new Error(`invalid broadcast transition: ${previousState} -> ${next}`);
      if (EXECUTING.has(next) && !EXECUTING.has(previousState)) {
        const other = executingJob(job.accountId);
        if (other && other.id !== job.id) throw new Error(`account already has a running broadcast job: ${job.accountId}`);
      }
      if (patch.current !== undefined) job.current = nonNegativeInt(patch.current, job.current);
      if (patch.total !== undefined) job.total = nonNegativeInt(patch.total, job.total);
      if (patch.ok !== undefined) job.ok = nonNegativeInt(patch.ok, job.ok);
      if (patch.fail !== undefined) job.fail = nonNegativeInt(patch.fail, job.fail);
      if (patch.failed !== undefined) job.failed = freezeList(patch.failed);
      if (patch.nextSendAt !== undefined) job.nextSendAt = patch.nextSendAt == null ? null : finiteNumber(patch.nextSendAt, null);
      if (patch.stopRequested !== undefined) job.stopRequested = !!patch.stopRequested;
      job.state = next;
      if (next === 'running' && job.startedAt == null) job.startedAt = clock();
      if (TERMINAL.has(next)) {
        job.finishedAt = patch.finishedAt == null ? clock() : finiteNumber(patch.finishedAt, clock());
        job.nextSendAt = null;
        if (executingByAccount.get(job.accountId) === job.id) executingByAccount.delete(job.accountId);
        controls.delete(job.id);
      } else if (EXECUTING.has(next)) {
        executingByAccount.set(job.accountId, job.id);
      } else if (executingByAccount.get(job.accountId) === job.id) {
        executingByAccount.delete(job.accountId);
      }
      touch(job);
      return emit('state', job, { previousState });
    }

    function update(jobId, patch = {}) {
      const job = requireJob(jobId);
      if (TERMINAL.has(job.state)) return publicSnapshot(job);
      if (patch.current !== undefined) job.current = nonNegativeInt(patch.current, job.current);
      if (patch.total !== undefined) job.total = nonNegativeInt(patch.total, job.total);
      if (patch.ok !== undefined) job.ok = nonNegativeInt(patch.ok, job.ok);
      if (patch.fail !== undefined) job.fail = nonNegativeInt(patch.fail, job.fail);
      if (patch.failed !== undefined) job.failed = freezeList(patch.failed);
      if (patch.nextSendAt !== undefined) job.nextSendAt = patch.nextSendAt == null ? null : finiteNumber(patch.nextSendAt, null);
      if (patch.stopRequested !== undefined) job.stopRequested = !!patch.stopRequested;
      touch(job);
      return emit('progress', job);
    }

    function complete(jobId, patch = {}) { return transition(jobId, 'completed', patch); }
    function markStopped(jobId, patch = {}) { return transition(jobId, 'stopped', { ...patch, stopRequested: true }); }

    function markFailed(jobId, error, patch = {}) {
      const failed = Array.isArray(patch.failed) ? patch.failed : requireJob(jobId).failed;
      const nextFailed = error ? [...failed, freezeRecord({ message: String(error.message || error), at: clock() })] : failed;
      return transition(jobId, 'failed', { ...patch, failed: nextFailed });
    }

    function attachControls(jobId, handlers = {}) {
      requireJob(jobId);
      controls.set(String(jobId), {
        pause: typeof handlers.pause === 'function' ? handlers.pause : null,
        resume: typeof handlers.resume === 'function' ? handlers.resume : null,
        stop: typeof handlers.stop === 'function' ? handlers.stop : null,
      });
      return () => controls.delete(String(jobId));
    }

    async function invoke(jobId, action) {
      const job = requireJob(jobId);
      const handler = controls.get(job.id)?.[action];
      if (action === 'pause') {
        if (job.state !== 'running') return publicSnapshot(job);
        if (handler) await handler(publicSnapshot(job));
        return transition(job.id, 'paused');
      }
      if (action === 'resume') {
        if (job.state !== 'paused') return publicSnapshot(job);
        if (handler) await handler(publicSnapshot(job));
        return transition(job.id, 'running');
      }
      if (action === 'stop') {
        if (TERMINAL.has(job.state) || job.state === 'stopping') return publicSnapshot(job);
        if (PENDING.has(job.state)) {
          if (handler) await handler(publicSnapshot(job));
          return markStopped(job.id, { current: job.current, ok: job.ok, fail: job.fail });
        }
        if (handler) {
          await handler(publicSnapshot(job));
          const latest = requireJob(job.id);
          if (TERMINAL.has(latest.state) || latest.state === 'stopping') return publicSnapshot(latest);
          return transition(latest.id, 'stopping', { stopRequested: true });
        }
        return transition(job.id, 'stopping', { stopRequested: true });
      }
      throw new TypeError(`unsupported broadcast action: ${action}`);
    }

    function dismiss(jobId) {
      const job = requireJob(jobId);
      if (!TERMINAL.has(job.state)) return publicSnapshot(job);
      job.dismissed = true;
      touch(job);
      return emit('dismissed', job);
    }

    function get(jobId) { return publicSnapshot(jobs.get(String(jobId || ''))); }
    function getActive(accountId) { return publicSnapshot(executingJob(accountId)); }
    function hasActive(accountId) { return !!executingJob(accountId); }
    function getPending(accountId) { return pendingJobs(accountId).map(publicSnapshot); }
    function getNextPending(accountId) { return publicSnapshot(pendingJobs(accountId)[0] || null); }
    function getCurrent(accountId) {
      return publicSnapshot(executingJob(accountId) || pendingJobs(accountId)[0] || latestJob(accountId));
    }
    function list(accountId) {
      const wanted = accountId == null ? null : String(accountId);
      return [...jobs.values()]
        .filter(job => wanted == null || job.accountId === wanted)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(publicSnapshot);
    }
    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('broadcast listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return Object.freeze({
      start,
      register,
      transition,
      update,
      complete,
      markStopped,
      markFailed,
      attachControls,
      invoke,
      dismiss,
      get,
      getActive,
      getCurrent,
      getPending,
      getNextPending,
      hasActive,
      list,
      subscribe,
    });
  }

  const defaultManager = createManager();
  return Object.freeze({ TERMINAL_STATES, createJob, visibleFor, createManager, defaultManager });
});
