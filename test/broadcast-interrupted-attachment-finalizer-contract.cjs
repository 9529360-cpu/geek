'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createManager } = require('../ui/broadcast-job-manager.js');
const checkpointApi = require('../ui/broadcast-execution-checkpoint.js');

function memoryAccountData() {
  const state = new Map();
  return {
    state,
    async getAll(accountId) { return { ...(state.get(String(accountId)) || {}) }; },
    async set(accountId, key, value) {
      const id = String(accountId);
      state.set(id, { ...(state.get(id) || {}), [key]: value });
      return true;
    },
    async remove(accountId, key) {
      const id = String(accountId);
      const next = { ...(state.get(id) || {}) };
      delete next[key];
      state.set(id, next);
      return true;
    },
  };
}

function seedInterruptedCheckpoint(accountData, id = 'scheduled-with-files') {
  const manager = createManager({ now: () => 1000 });
  const job = manager.start({
    id,
    accountId: 'account-a',
    accountName: 'Account A',
    partition: 'persist:a',
    platformFamily: 'whatsapp',
    targets: [{ id: 'private-target' }],
    message: 'private-message',
    total: 1,
    intervalMin: 0,
    intervalMax: 0,
  });
  const store = checkpointApi.createStore({ accountData, now: () => 1001 });
  return store.enterDispatch(job, 0).then(() => job);
}

(async () => {
  // Recovery is the finalizer for resources owned by the original scheduled Job.
  // It must use only opaque owner identity and clear the checkpoint after cleanup.
  {
    const accountData = memoryAccountData();
    const job = await seedInterruptedCheckpoint(accountData);
    const cleanupCalls = [];
    const recoveryManager = createManager({ now: () => 2000 });
    const recoveryStore = checkpointApi.createStore({
      accountData,
      manager: recoveryManager,
      scheduledAttachments: {
        async cleanup(owner) { cleanupCalls.push({ ...owner }); return 1; },
      },
      requireResourceCleanup: true,
      now: () => 2000,
    });

    const restored = await recoveryStore.restoreAccount({ id: 'account-a', name: 'Account A', partition: 'persist:a' });
    assert.equal(restored.length, 1);
    assert.equal(restored[0].resourcesFinalized, true);
    assert.deepEqual(cleanupCalls, [{ accountId: 'account-a', taskId: job.id }]);
    assert.equal(recoveryManager.get(`interrupted-${job.id}`).state, 'failed');
    assert.equal(accountData.state.get('account-a')[checkpointApi.STORAGE_KEY], undefined, 'checkpoint must clear only after owned resources are reclaimed');
  }

  // Cleanup failure must retain the durable checkpoint. A later startup can see
  // the same owner again, reuse the already-created interruption evidence, and retry.
  {
    const accountData = memoryAccountData();
    const job = await seedInterruptedCheckpoint(accountData, 'scheduled-cleanup-retry');
    const recoveryManager = createManager({ now: () => 3000 });
    let attempts = 0;
    const failingStore = checkpointApi.createStore({
      accountData,
      manager: recoveryManager,
      scheduledAttachments: {
        async cleanup(owner) {
          attempts += 1;
          assert.deepEqual(owner, { accountId: 'account-a', taskId: job.id });
          throw new Error('simulated durable attachment store failure');
        },
      },
      requireResourceCleanup: true,
      now: () => 3000,
    });

    const first = await failingStore.restoreAccount({ id: 'account-a', name: 'Account A', partition: 'persist:a' });
    assert.equal(first[0].resourcesFinalized, false);
    assert.equal(attempts, 1);
    assert.ok(accountData.state.get('account-a')[checkpointApi.STORAGE_KEY], 'failed cleanup must retain finalizer authority');
    const evidence = recoveryManager.get(`interrupted-${job.id}`);
    assert.ok(evidence && evidence.state === 'failed');

    const retryStore = checkpointApi.createStore({
      accountData,
      manager: recoveryManager,
      scheduledAttachments: {
        async cleanup(owner) {
          attempts += 1;
          assert.deepEqual(owner, { accountId: 'account-a', taskId: job.id });
          return 0;
        },
      },
      requireResourceCleanup: true,
      now: () => 4000,
    });
    const second = await retryStore.restoreAccount({ id: 'account-a', name: 'Account A', partition: 'persist:a' });
    assert.equal(second[0].resourcesFinalized, true, 'idempotent no-op cleanup must finalize an already-reclaimed owner');
    assert.equal(attempts, 2);
    assert.equal(recoveryManager.list('account-a').filter(item => item.id === `interrupted-${job.id}`).length, 1, 'retry must not duplicate interruption evidence');
    assert.equal(accountData.state.get('account-a')[checkpointApi.STORAGE_KEY], undefined);
  }

  // The browser-installed mode requires the dependent-resource finalizer. If the
  // bridge capability is missing, preserve both interruption evidence and the
  // original checkpoint instead of silently abandoning cleanup authority.
  {
    const accountData = memoryAccountData();
    const job = await seedInterruptedCheckpoint(accountData, 'scheduled-cleanup-unavailable');
    const recoveryManager = createManager({ now: () => 5000 });
    const recoveryStore = checkpointApi.createStore({
      accountData,
      manager: recoveryManager,
      requireResourceCleanup: true,
      now: () => 5000,
    });
    const restored = await recoveryStore.restoreAccount({ id: 'account-a', name: 'Account A', partition: 'persist:a' });
    assert.equal(restored[0].resourcesFinalized, false);
    assert.equal(recoveryManager.get(`interrupted-${job.id}`).state, 'failed');
    assert.ok(accountData.state.get('account-a')[checkpointApi.STORAGE_KEY], 'missing cleanup capability must not discard finalizer authority');
    await assert.rejects(
      recoveryStore.cleanupInterruptedResources(restored[0].record),
      error => error?.code === 'BROADCAST_INTERRUPTED_RESOURCE_CLEANUP_UNAVAILABLE',
    );
  }

  // Browser installation must opt into the fail-closed cleanup contract.
  const source = fs.readFileSync(path.join(__dirname, '../ui/broadcast-execution-checkpoint.js'), 'utf8');
  assert.match(source, /createStore\(\{ api: window\.api, manager, requireResourceCleanup: true \}\)/);
  assert.match(source, /BROADCAST_INTERRUPTED_RESOURCE_CLEANUP_UNAVAILABLE/);
  assert.match(source, /scheduledAttachments\.cleanup\(\{ accountId: record\.accountId, taskId: record\.jobId \}\)/);

  console.log('BROADCAST_INTERRUPTED_ATTACHMENT_FINALIZER_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
