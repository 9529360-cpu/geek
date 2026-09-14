'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const ACCOUNT_NO = `GK-${'c'.repeat(32)}`;

function createStore(userDataDir) {
  const store = createSubscriptionStore({ userDataDir });
  store._injectCrypto({
    encrypt: (value) => String(value),
    decrypt: (value) => String(value),
  });
  return store;
}

async function writeAuthenticatedState(file, remaining = 100) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify({
    token: 'enc:queue-session-token',
    email: 'queue@example.invalid',
    user_id: 42,
    account_no: ACCOUNT_NO,
    account_ref: ACCOUNT_NO,
    remaining_chars: remaining,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function installOverlapRejectingRename(originalRename, targetFile, options = {}) {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  let firstStartedResolve;
  const firstStarted = new Promise((resolve) => { firstStartedResolve = resolve; });

  fsp.rename = async (from, to) => {
    if (path.resolve(to) !== path.resolve(targetFile)) return originalRename(from, to);
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (calls === 1) firstStartedResolve();
    try {
      const turns = options.turns ?? 40;
      for (let i = 0; i < turns && active === 1; i += 1) await immediate();
      if (active > 1) {
        const error = new Error('simulated concurrent subscription rename collision');
        error.code = 'EBUSY';
        throw error;
      }
      return await originalRename(from, to);
    } finally {
      active -= 1;
    }
  };

  return {
    firstStarted,
    stats: () => ({ calls, maxActive }),
  };
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-queue-'));
  const originalFetch = global.fetch;
  const originalRename = fsp.rename;

  try {
    // 1. Two public write paths begin together. Their disk critical sections must never overlap,
    //    and the second state patch must be based on the first committed cache rather than stale state.
    {
      const dir = path.join(root, 'compose');
      const stateFile = path.join(dir, 'subscription.json');
      await writeAuthenticatedState(stateFile, 100);
      const store = createStore(dir);
      assert.equal((await store.getState()).remaining_chars, 100);

      const renameProbe = installOverlapRejectingRename(originalRename, stateFile);
      let requestCount = 0;
      let releaseRequests;
      let bothStartedResolve;
      const release = new Promise((resolve) => { releaseRequests = resolve; });
      const bothStarted = new Promise((resolve) => { bothStartedResolve = resolve; });

      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.endsWith('/api/status') && !url.endsWith('/api/quota')) throw new Error(`unexpected request: ${url}`);
        requestCount += 1;
        if (requestCount === 2) bothStartedResolve();
        await release;
        if (url.endsWith('/api/status')) return jsonResponse({ remaining_chars: 200 });
        return jsonResponse({ remaining_chars: 300, email: 'queue@example.invalid' });
      };

      const refreshPromise = store.refresh();
      const quotaPromise = store.getQuota(true);
      await bothStarted;
      releaseRequests();
      const [refreshed, quota] = await Promise.all([refreshPromise, quotaPromise]);

      assert.equal(refreshed.networkError, undefined, 'serialized refresh write must succeed');
      assert.equal(quota.remaining_chars, 300, 'serialized quota write must succeed');
      assert.equal(renameProbe.stats().maxActive, 1, 'subscription state renames must never overlap in one store');
      assert.equal(renameProbe.stats().calls, 2, 'both distinct state mutations must durably commit');

      const disk = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
      assert.equal(disk.remaining_chars, 200, 'refresh patch must survive the concurrent quota save');
      assert.equal(disk.quota_cache?.remaining_chars, 300, 'quota patch must compose with the committed refresh patch');
      assert.equal((await store.getState()).remaining_chars, 200, 'memory must reflect the same composed committed state');
    }

    // 2. A failed mutation must reject only itself and release the queue for later work.
    {
      fsp.rename = originalRename;
      const dir = path.join(root, 'failure-release');
      const stateFile = path.join(dir, 'subscription.json');
      await writeAuthenticatedState(stateFile, 100);
      const store = createStore(dir);
      await store.getState();

      let targetCalls = 0;
      fsp.rename = async (from, to) => {
        if (path.resolve(to) === path.resolve(stateFile)) {
          targetCalls += 1;
          if (targetCalls === 1) {
            const error = new Error('simulated first queued mutation failure');
            error.code = 'EPERM';
            throw error;
          }
        }
        return originalRename(from, to);
      };
      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/api/status')) return jsonResponse({ remaining_chars: 444 });
        throw new Error(`unexpected request: ${url}`);
      };

      const logoutPromise = store.logout();
      const refreshPromise = store.refresh();
      await assert.rejects(logoutPromise, /simulated first queued mutation failure/);
      const refreshed = await refreshPromise;
      assert.equal(refreshed.networkError, undefined, 'queue must continue after the prior mutation rejects');
      assert.equal(refreshed.remaining_chars, 444);
      assert.equal(targetCalls, 2, 'later mutation must reach durable commit after queue recovery');
      assert.equal(JSON.parse(await fsp.readFile(stateFile, 'utf8')).remaining_chars, 444);
    }

    // 3. Refresh obtains a response while logout's clear is committing. A stale refresh must queue behind
    //    clear, derive from the tokenless committed cache, and never resurrect the old token on disk.
    {
      fsp.rename = originalRename;
      const dir = path.join(root, 'clear-vs-save');
      const stateFile = path.join(dir, 'subscription.json');
      await writeAuthenticatedState(stateFile, 100);
      const store = createStore(dir);
      await store.getState();

      const renameProbe = installOverlapRejectingRename(originalRename, stateFile, { turns: 100 });
      let statusStartedResolve;
      let releaseStatus;
      const statusStarted = new Promise((resolve) => { statusStartedResolve = resolve; });
      const statusRelease = new Promise((resolve) => { releaseStatus = resolve; });
      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.endsWith('/api/status')) throw new Error(`unexpected request: ${url}`);
        statusStartedResolve();
        await statusRelease;
        return jsonResponse({ remaining_chars: 555 });
      };

      const refreshPromise = store.refresh();
      await statusStarted;
      const logoutPromise = store.logout();
      await renameProbe.firstStarted;
      releaseStatus();

      await logoutPromise;
      const refreshed = await refreshPromise;
      assert.equal(renameProbe.stats().maxActive, 1, 'stale refresh save must not overlap logout clear');
      assert.equal(refreshed.loggedIn, false, 'refresh completing after logout must observe the tokenless authority');
      assert.deepEqual(await store.getState(), { loggedIn: false });

      const disk = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
      assert.equal(Object.hasOwn(disk, 'token'), false, 'queued stale refresh must never resurrect the cleared session token');
      const restarted = createStore(dir);
      assert.deepEqual(await restarted.getState(), { loggedIn: false }, 'restart must remain logged out after refresh/logout race');
    }
  } finally {
    global.fetch = originalFetch;
    fsp.rename = originalRename;
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_STATE_MUTATION_QUEUE_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
