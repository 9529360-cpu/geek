'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createManager } = require('../ui/broadcast-job-manager.js');
const { createExecutor } = require('../ui/broadcast-executor.js');
const checkpointApi = require('../ui/broadcast-execution-checkpoint.js');

function memoryAccountData() {
  const state = new Map();
  let failSet = false;
  return {
    state,
    setFailSet(value) { failSet = !!value; },
    async getAll(accountId) { return { ...(state.get(String(accountId)) || {}) }; },
    async set(accountId, key, value) {
      if (failSet) throw new Error('checkpoint write failed');
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

function seedJob(manager, overrides = {}) {
  return manager.start({
    id: overrides.id || 'job-a',
    accountId: overrides.accountId || 'account-a',
    accountName: 'Account A',
    partition: 'persist:a',
    platformFamily: 'whatsapp',
    targets: overrides.targets || [{ id: 'secret-chat', name: 'Secret Customer' }],
    message: 'secret message body',
    files: [{ filePath: 'opaque-token' }],
    total: overrides.total == null ? 1 : overrides.total,
    intervalMin: 0,
    intervalMax: 0,
  });
}

(async () => {
  const forbidden = new Set(['message', 'text', 'target', 'targets', 'targetId', 'chatId', 'name', 'file', 'files', 'path', 'attachmentRefs', 'vcards']);
  const safe = checkpointApi.checkpointRecord({
    id: 'job-private',
    accountId: 'account-a',
    platformFamily: 'whatsapp',
    targets: [{ id: 'customer-1', name: 'Customer' }],
    message: 'top secret',
    files: [{ path: 'C:/secret.txt' }],
    total: 3,
    current: 1,
    ok: 1,
    fail: 0,
    createdAt: 100,
    startedAt: 110,
  }, 'dispatching', 1, 120);
  for (const key of Object.keys(safe)) assert.equal(forbidden.has(key), false, `checkpoint must not persist sensitive field ${key}`);
  assert.equal(JSON.stringify(safe).includes('top secret'), false);
  assert.equal(JSON.stringify(safe).includes('customer-1'), false);
  assert.equal(JSON.stringify(safe).includes('C:/secret.txt'), false);

  // The pre-dispatch durable write is a hard side-effect gate: a persistence
  // failure must prevent the transport from being invoked at all.
  {
    const accountData = memoryAccountData();
    accountData.setFailSet(true);
    const manager = createManager({ now: () => 1000 });
    const job = seedJob(manager, { id: 'job-write-fails' });
    const store = checkpointApi.createStore({ accountData, now: () => 1001 });
    const executor = createExecutor({ manager, checkpoint: store, sleep: async () => {}, random: () => 0 });
    let sends = 0;
    await assert.rejects(executor.run(job.id, { sendTarget: async () => { sends += 1; return 'SENT'; } }), /checkpoint write failed/);
    assert.equal(sends, 0, 'transport must not run when dispatch checkpoint cannot be durably committed');
    assert.equal(manager.get(job.id).state, 'failed');
  }

  // Once dispatch is durable and the transport has run, a settle-write failure
  // must preserve the earlier dispatch marker. That record is the only durable
  // evidence that the outbound side effect may already exist.
  {
    const accountData = memoryAccountData();
    const originalSet = accountData.set.bind(accountData);
    let setCalls = 0;
    accountData.set = async (...args) => {
      setCalls += 1;
      if (setCalls === 2) throw new Error('checkpoint settle failed');
      return originalSet(...args);
    };
    const manager = createManager({ now: () => 1500 });
    const job = seedJob(manager, { id: 'job-settle-write-fails' });
    const store = checkpointApi.createStore({ accountData, now: () => 1501 });
    const executor = createExecutor({ manager, checkpoint: store, sleep: async () => {}, random: () => 0 });
    let sends = 0;
    await assert.rejects(
      executor.run(job.id, { sendTarget: async () => { sends += 1; return 'SENT'; } }),
      error => error?.broadcastCheckpointPhase === 'settle' && /checkpoint settle failed/.test(String(error?.message || '')),
    );
    assert.equal(sends, 1, 'transport must run exactly once after the dispatch marker is durable');
    assert.equal(manager.get(job.id).state, 'failed');

    const raw = accountData.state.get('account-a')[checkpointApi.STORAGE_KEY];
    const records = checkpointApi.parsePayload(raw);
    assert.equal(records.get(job.id).phase, 'dispatching', 'failed settle must not erase the uncertain dispatch marker');
    assert.equal(records.get(job.id).current, 0, 'uncertain dispatch must preserve the last confirmed aggregate position');
    assert.equal(records.get(job.id).ok, 0);

    const recoveryManager = createManager({ now: () => 1600 });
    const recoveryStore = checkpointApi.createStore({ accountData, manager: recoveryManager, now: () => 1600 });
    const restored = await recoveryStore.restoreAccount({ id: 'account-a', name: 'Account A', partition: 'persist:a' });
    assert.equal(restored.length, 1);
    assert.equal(restored[0].reason, 'BROADCAST_INTERRUPTED_UNCERTAIN');
    assert.equal(recoveryManager.get(`interrupted-${job.id}`).state, 'failed');
  }

  // A crash after the dispatch marker but before settle is recovered as
  // uncertain evidence and never invokes an outbound transport.
  {
    const accountData = memoryAccountData();
    const originalManager = createManager({ now: () => 2000 });
    const job = seedJob(originalManager, { id: 'job-uncertain' });
    const store = checkpointApi.createStore({ accountData, now: () => 2001 });
    await store.enterDispatch(job, 0);
    const raw = accountData.state.get('account-a')[checkpointApi.STORAGE_KEY];
    const records = checkpointApi.parsePayload(raw);
    assert.equal(records.get(job.id).phase, 'dispatching');
    assert.equal(records.get(job.id).current, 0);

    const recoveryManager = createManager({ now: () => 3000 });
    const recoveryStore = checkpointApi.createStore({ accountData, manager: recoveryManager, now: () => 3000 });
    const restored = await recoveryStore.restoreAccount({ id: 'account-a', name: 'Account A', partition: 'persist:a' });
    assert.equal(restored.length, 1);
    assert.equal(restored[0].reason, 'BROADCAST_INTERRUPTED_UNCERTAIN');
    const evidence = recoveryManager.get(`interrupted-${job.id}`);
    assert.equal(evidence.state, 'failed');
    assert.match(evidence.failed[0].reason, /BROADCAST_INTERRUPTED_UNCERTAIN/);
    assert.equal(evidence.current, 0);
    assert.equal(accountData.state.get('account-a')[checkpointApi.STORAGE_KEY], undefined, 'checkpoint may clear only after evidence is registered');
  }

  // A settled checkpoint preserves the last confirmed aggregate counters but is
  // still evidence only: restoration never resumes or replays the job.
  {
    const accountData = memoryAccountData();
    const manager = createManager({ now: () => 4000 });
    const job = seedJob(manager, { id: 'job-settled', total: 2, targets: [{ id: 'a' }, { id: 'b' }] });
    const store = checkpointApi.createStore({ accountData, now: () => 4001 });
    await store.enterDispatch(job, 0);
    manager.update(job.id, { current: 1, ok: 1, fail: 0 });
    await store.settle(manager.get(job.id), 0);

    const parsed = checkpointApi.parsePayload(accountData.state.get('account-a')[checkpointApi.STORAGE_KEY]);
    assert.equal(parsed.get(job.id).phase, 'settled');
    assert.equal(parsed.get(job.id).current, 1);
    assert.equal(parsed.get(job.id).ok, 1);

    const recoveryManager = createManager({ now: () => 5000 });
    const recoveryStore = checkpointApi.createStore({ accountData, manager: recoveryManager, now: () => 5000 });
    const restored = await recoveryStore.restoreAccount({ id: 'account-a', name: 'Account A', partition: 'persist:a' });
    assert.equal(restored[0].reason, 'BROADCAST_INTERRUPTED');
    const evidence = recoveryManager.get(`interrupted-${job.id}`);
    assert.equal(evidence.current, 1);
    assert.equal(evidence.ok, 1);
    assert.equal(evidence.total, 2);
  }

  // Per-account storage remains isolated even when two accounts checkpoint in
  // parallel. A finalization removes only the matching job record.
  {
    const accountData = memoryAccountData();
    const managerA = createManager({ now: () => 6000 });
    const managerB = createManager({ now: () => 6000 });
    const jobA = seedJob(managerA, { id: 'job-a-isolated', accountId: 'account-a' });
    const jobB = seedJob(managerB, { id: 'job-b-isolated', accountId: 'account-b' });
    const store = checkpointApi.createStore({ accountData, now: () => 6001 });
    await Promise.all([store.enterDispatch(jobA, 0), store.enterDispatch(jobB, 0)]);
    assert.ok(accountData.state.get('account-a')[checkpointApi.STORAGE_KEY]);
    assert.ok(accountData.state.get('account-b')[checkpointApi.STORAGE_KEY]);

    managerA.markFailed(jobA.id, new Error('done'));
    await store.finalize(managerA.get(jobA.id));
    assert.equal(accountData.state.get('account-a')[checkpointApi.STORAGE_KEY], undefined);
    assert.ok(accountData.state.get('account-b')[checkpointApi.STORAGE_KEY], 'finalizing A must not delete B checkpoint');
  }

  const root = path.join(__dirname, '..');
  const loader = fs.readFileSync(path.join(root, 'ui/broadcast-safety.js'), 'utf8');
  const checkpointLoad = loader.indexOf("loadScript('./broadcast-execution-checkpoint.js'");
  const executorLoad = loader.indexOf("loadScript('./broadcast-executor.js'");
  assert.ok(checkpointLoad >= 0 && executorLoad > checkpointLoad, 'checkpoint owner must load before executor captures it');

  console.log('BROADCAST_EXECUTION_CHECKPOINT_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
