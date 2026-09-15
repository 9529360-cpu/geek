'use strict';

const assert = require('node:assert/strict');
const { createManager } = require('../ui/broadcast-job-manager.js');
const { createExecutor } = require('../ui/broadcast-executor.js');
const checkpointApi = require('../ui/broadcast-execution-checkpoint.js');

function memoryAccountData() {
  const state = new Map();
  return {
    state,
    seed(accountId, value) {
      state.set(String(accountId), { [checkpointApi.STORAGE_KEY]: value });
    },
    raw(accountId) {
      return state.get(String(accountId))?.[checkpointApi.STORAGE_KEY];
    },
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

function jobSeed(id, accountId) {
  return {
    id,
    accountId,
    accountName: accountId,
    partition: `persist:${accountId}`,
    platformFamily: 'whatsapp',
    targets: [{ id: `${accountId}-target`, name: 'Target' }],
    message: 'private message',
    total: 1,
    intervalMin: 0,
    intervalMax: 0,
  };
}

function validRecord(id = 'job-valid', accountId = 'account-a') {
  return checkpointApi.checkpointRecord({
    id,
    accountId,
    platformFamily: 'whatsapp',
    total: 1,
    current: 0,
    ok: 0,
    fail: 0,
    createdAt: 1000,
    startedAt: 1001,
  }, 'dispatching', 0, 1002);
}

function payload(records) {
  return JSON.stringify({ version: checkpointApi.VERSION, records });
}

(async () => {
  assert.equal(checkpointApi.parsePayload(undefined).size, 0, 'only an absent payload may mean no checkpoints');

  const valid = validRecord();
  const invalidPayloads = [
    '',
    '{not-json-secret-customer-data',
    'null',
    '[]',
    '{}',
    JSON.stringify({ version: 2, records: [] }),
    JSON.stringify({ version: 1, records: {} }),
    payload([null]),
    payload([{ ...valid, version: 2 }]),
    payload([{ ...valid, current: '0' }]),
    payload([{ ...valid, message: 'private customer content' }]),
    payload([{ ...valid }, { ...valid }]),
  ];

  for (let index = 0; index < invalidPayloads.length; index += 1) {
    assert.throws(
      () => checkpointApi.parsePayload(invalidPayloads[index]),
      error => error?.code === checkpointApi.CORRUPT_CODE
        && !String(error?.message || '').includes('customer')
        && !String(error?.message || '').includes('private'),
      `invalid checkpoint payload case ${index} must fail closed without echoing raw metadata`,
    );
  }
  assert.throws(
    () => checkpointApi.parsePayload('{bad}', { present: false }),
    error => error?.code === checkpointApi.CORRUPT_CODE,
    'a present raw payload cannot be disguised as absence by parser options',
  );

  const parsed = checkpointApi.parsePayload(payload([valid]));
  assert.equal(parsed.size, 1);
  assert.deepEqual(parsed.get(valid.jobId), valid);

  const presentUndefinedData = memoryAccountData();
  presentUndefinedData.seed('account-undefined', undefined);
  const presentUndefinedStore = checkpointApi.createStore({ accountData: presentUndefinedData });
  await assert.rejects(
    presentUndefinedStore.load('account-undefined'),
    error => error?.code === checkpointApi.CORRUPT_CODE,
    'an existing account-data key with an invalid value is not an absent checkpoint',
  );

  // Account A starts valid so the store has a cache entry. A later forced restore
  // sees corrupt durable data and must poison/remove the stale cache instead of
  // allowing a later mutation to overwrite the recovery debt from old memory.
  const accountData = memoryAccountData();
  accountData.seed('account-a', payload([valid]));
  const recoveryManager = createManager({ now: () => 2000 });
  const store = checkpointApi.createStore({ accountData, manager: recoveryManager, now: () => 2000 });
  assert.equal((await store.load('account-a')).size, 1);

  const corruptRaw = JSON.stringify({
    version: 1,
    records: [{ ...valid, message: 'must-remain-private-and-durable' }],
  });
  accountData.seed('account-a', corruptRaw);

  await assert.rejects(
    store.restoreAccount({ id: 'account-a', name: 'Account A', partition: 'persist:account-a' }),
    error => error?.code === checkpointApi.CORRUPT_CODE,
    'restore must fail closed when checkpoint integrity is unknown',
  );
  assert.equal(accountData.raw('account-a'), corruptRaw, 'restore must preserve corrupt recovery authority verbatim');
  assert.equal(recoveryManager.list('account-a').length, 0, 'corrupt checkpoint must not create fake interruption certainty');

  await assert.rejects(
    store.load('account-a'),
    error => error?.code === checkpointApi.CORRUPT_CODE,
    'failed forced load must not leave a stale valid cache behind',
  );
  assert.equal(accountData.raw('account-a'), corruptRaw);

  // The existing pre-dispatch checkpoint gate must stop a new outbound side
  // effect before sendTarget when the account's recovery metadata is corrupt.
  const manager = createManager({ now: () => 3000 });
  const jobA = manager.start(jobSeed('job-new-a', 'account-a'));
  const executor = createExecutor({ manager, checkpoint: store, sleep: async () => {}, random: () => 0 });
  let sendsA = 0;
  await assert.rejects(
    executor.run(jobA.id, { sendTarget: async () => { sendsA += 1; return 'SENT'; } }),
    error => error?.code === checkpointApi.CORRUPT_CODE && error?.broadcastCheckpointPhase === 'enterDispatch',
  );
  assert.equal(sendsA, 0, 'corrupt recovery authority must block transport before any outbound side effect');
  assert.equal(manager.get(jobA.id).state, 'failed');
  assert.equal(accountData.raw('account-a'), corruptRaw, 'failed new send must not normalize or overwrite the corrupt payload');

  // Corruption is account-local. Another account with no checkpoint debt remains
  // executable through the same store/executor.
  const jobB = manager.start(jobSeed('job-new-b', 'account-b'));
  let sendsB = 0;
  const completedB = await executor.run(jobB.id, { sendTarget: async () => { sendsB += 1; return 'SENT'; } });
  assert.equal(sendsB, 1);
  assert.equal(completedB.state, 'completed');
  assert.equal(accountData.raw('account-b'), undefined, 'terminal B checkpoint must still finalize normally');
  assert.equal(accountData.raw('account-a'), corruptRaw, 'B execution must not modify A recovery debt');

  // Owner mismatch is durable corruption, not a record to delete opportunistically.
  const mismatchData = memoryAccountData();
  const wrongOwnerRaw = payload([validRecord('job-wrong-owner', 'account-b')]);
  mismatchData.seed('account-a', wrongOwnerRaw);
  const mismatchStore = checkpointApi.createStore({ accountData: mismatchData });
  await assert.rejects(
    mismatchStore.load('account-a'),
    error => error?.code === checkpointApi.CORRUPT_CODE,
  );
  assert.equal(mismatchData.raw('account-a'), wrongOwnerRaw);

  console.log('BROADCAST_EXECUTION_CHECKPOINT_CORRUPTION_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
