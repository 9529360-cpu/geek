(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastExecutor = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function normalizeResult(value) {
    if (value === true || value === 'SENT' || value === 'CLICKED') return { ok: true, reason: '' };
    if (value && typeof value === 'object' && value.ok === true) return { ok: true, reason: '' };
    if (value && typeof value === 'object') return { ok: false, reason: String(value.reason || value.error || 'SEND_FAILED') };
    return { ok: false, reason: String(value || 'SEND_FAILED') };
  }

  function createExecutor(options = {}) {
    const manager = options.manager;
    if (!manager) throw new TypeError('broadcast executor requires manager');
    const sleep = typeof options.sleep === 'function' ? options.sleep : ms => new Promise(resolve => setTimeout(resolve, ms));
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const random = typeof options.random === 'function' ? options.random : () => Math.random();
    const controls = new Map();
    const running = new Map();

    function executionCheckpoint() {
      return options.checkpoint || globalThis.GeekBroadcastExecutionCheckpointInstance || null;
    }

    function control(jobId) {
      const id = String(jobId || '');
      if (!controls.has(id)) controls.set(id, { paused: false, stopRequested: false });
      return controls.get(id);
    }

    async function waitUntilResumed(jobId) {
      const state = control(jobId);
      while (state.paused && !state.stopRequested) await sleep(100);
      return !state.stopRequested;
    }

    async function waitBetweenTargets(jobId, seconds) {
      const state = control(jobId);
      let remaining = Math.max(0, Number(seconds) || 0) * 1000;
      let last = now();
      manager.update(jobId, { nextSendAt: last + remaining });
      while (remaining > 0) {
        if (state.stopRequested) return false;
        if (state.paused) {
          const canContinue = await waitUntilResumed(jobId);
          if (!canContinue) return false;
          last = now();
          manager.update(jobId, { nextSendAt: last + remaining });
          continue;
        }
        await sleep(Math.min(250, Math.max(1, remaining)));
        const current = now();
        remaining = Math.max(0, remaining - Math.max(0, current - last));
        last = current;
        manager.update(jobId, { nextSendAt: remaining ? current + remaining : null });
      }
      return true;
    }

    async function persistCheckpoint(method, job, index) {
      const checkpoint = executionCheckpoint();
      if (!checkpoint || typeof checkpoint[method] !== 'function') {
        if (typeof window !== 'undefined') {
          const error = new Error('broadcast execution checkpoint is not ready');
          error.code = 'BROADCAST_CHECKPOINT_NOT_READY';
          error.broadcastCheckpointPhase = method;
          throw error;
        }
        return null;
      }
      try { return await checkpoint[method](job, index); }
      catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error || 'broadcast checkpoint failed'));
        wrapped.broadcastCheckpointPhase = method;
        throw wrapped;
      }
    }

    async function finalizeCheckpoint(job, preserve = false) {
      const checkpoint = executionCheckpoint();
      if (preserve || !checkpoint || typeof checkpoint.finalize !== 'function' || !job) return false;
      try { return await checkpoint.finalize(job); }
      catch (_) { return false; }
    }

    async function run(jobId, handlers = {}) {
      const id = String(jobId || '');
      if (running.has(id)) return running.get(id);
      if (typeof handlers.sendTarget !== 'function') throw new TypeError('broadcast executor requires sendTarget');

      const task = (async () => {
        let detachControls = null;
        try {
          let job = manager.get(id);
          if (!job) throw new Error(`broadcast job not found: ${id}`);
          if (job.state === 'scheduled' || job.state === 'queued' || job.state === 'starting') manager.transition(id, 'running');
          job = manager.get(id);
          if (job.state !== 'running' && job.state !== 'paused') throw new Error(`broadcast job is not executable: ${job.state}`);

          const state = control(id);
          state.paused = job.state === 'paused';
          state.stopRequested = !!job.stopRequested;
          detachControls = manager.attachControls(id, {
            pause: async () => { state.paused = true; },
            resume: async () => { state.paused = false; },
            stop: async () => { state.stopRequested = true; state.paused = false; },
          });

          let ok = Number(job.ok) || 0;
          let fail = Number(job.fail) || 0;
          let current = Number(job.current) || 0;
          const failures = Array.isArray(job.failed) ? job.failed.slice() : [];

          for (let index = current; index < job.targets.length; index++) {
            if (state.stopRequested || !(await waitUntilResumed(id))) break;
            job = manager.get(id);
            const target = job.targets[index];
            if (typeof handlers.beforeTarget === 'function') await handlers.beforeTarget(job, target, index);

            // This durable write is the side-effect gate. If it fails, sending must
            // fail closed so a restart never invents certainty about an unrecorded
            // outbound mutation.
            await persistCheckpoint('enterDispatch', manager.get(id), index);

            let outcome;
            try { outcome = normalizeResult(await handlers.sendTarget(manager.get(id), target, index)); }
            catch (error) { outcome = { ok: false, reason: String(error?.message || error || 'SEND_EXCEPTION') }; }

            current = index + 1;
            if (outcome.ok) ok += 1;
            else {
              fail += 1;
              failures.push(Object.freeze({ targetId: String(target?.id || ''), name: String(target?.name || target?.id || ''), reason: outcome.reason, index, at: now() }));
            }
            manager.update(id, { current, ok, fail, failed: failures, nextSendAt: null });

            // Only after the in-memory aggregate has advanced do we replace the
            // dispatching marker with a settled checkpoint. A crash in between is
            // deliberately recovered as an uncertain last send, never auto-replayed.
            await persistCheckpoint('settle', manager.get(id), index);
            if (typeof handlers.afterTarget === 'function') await handlers.afterTarget(manager.get(id), target, index, outcome);

            if (index < job.targets.length - 1 && !state.stopRequested) {
              const latest = manager.get(id);
              const lo = Math.max(0, Number(latest.intervalMin) || 0);
              const hi = Math.max(lo, Number(latest.intervalMax) || lo);
              if (!(await waitBetweenTargets(id, lo + random() * (hi - lo)))) break;
            }
          }

          const latest = manager.get(id);
          const finalPatch = { current, ok, fail, failed: failures, nextSendAt: null };
          if (state.stopRequested || latest.state === 'stopping') manager.markStopped(id, finalPatch);
          else manager.complete(id, finalPatch);
          const finalJob = manager.get(id);
          if (typeof handlers.finished === 'function') await handlers.finished(finalJob);
          await finalizeCheckpoint(finalJob);
          return finalJob;
        } catch (error) {
          const job = manager.get(id);
          if (job && !['completed', 'stopped', 'failed'].includes(job.state)) {
            try { manager.markFailed(id, error); } catch (_) {}
          }
          if (typeof handlers.failed === 'function') await handlers.failed(manager.get(id), error);
          await finalizeCheckpoint(manager.get(id), !!error?.broadcastCheckpointPhase);
          throw error;
        } finally {
          if (detachControls) detachControls();
          controls.delete(id);
          running.delete(id);
        }
      })();

      running.set(id, task);
      return task;
    }

    return Object.freeze({ run, isRunning: jobId => running.has(String(jobId || '')), runningJobIds: () => [...running.keys()] });
  }

  return Object.freeze({ createExecutor, normalizeResult });
});
