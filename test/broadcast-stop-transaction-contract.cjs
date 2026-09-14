'use strict';

const assert = require('node:assert/strict');
const jobApi = require('../ui/broadcast-job-manager.js');

(async () => {
  let clock = 1000;
  const manager = jobApi.createManager({ now: () => clock });
  const job = manager.start({ id: 'job-a', accountId: 'account-a', targets: [{ id: 'a1' }] });

  manager.attachControls(job.id, {
    stop: async () => {
      throw new Error('STOP_SIGNAL_FAILED');
    },
  });

  clock = 2000;
  await assert.rejects(() => manager.invoke(job.id, 'stop'), /STOP_SIGNAL_FAILED/);
  assert.equal(manager.get(job.id).state, 'running', 'failed stop signal must not commit stopping');
  assert.equal(manager.get(job.id).stopRequested, false, 'failed stop signal must not commit stopRequested');
  assert.equal(manager.hasActive('account-a'), true, 'failed stop signal must retain the account execution slot');
  assert.throws(
    () => manager.start({ id: 'job-a-2', accountId: 'account-a', targets: [] }),
    /already has a running broadcast job/,
    'a failed stop signal must not allow a second job to race the still-live executor',
  );

  let stopped = false;
  manager.attachControls(job.id, {
    stop: async snapshot => {
      assert.equal(snapshot.state, 'running', 'handler receives the pre-commit state');
      stopped = true;
    },
  });
  clock = 3000;
  const stopping = await manager.invoke(job.id, 'stop');
  assert.equal(stopped, true);
  assert.equal(stopping.state, 'stopping');
  assert.equal(stopping.stopRequested, true);

  manager.markStopped(job.id);
  assert.equal(manager.hasActive('account-a'), false);

  const concurrentManager = jobApi.createManager();
  const concurrentJob = concurrentManager.start({ id: 'job-b', accountId: 'account-b', targets: [{ id: 'b1' }] });
  let releaseStop;
  let stopCalls = 0;
  concurrentManager.attachControls(concurrentJob.id, {
    stop: async () => {
      stopCalls += 1;
      await new Promise(resolve => { releaseStop = resolve; });
    },
  });
  const firstStop = concurrentManager.invoke(concurrentJob.id, 'stop');
  const secondStop = concurrentManager.invoke(concurrentJob.id, 'stop');
  await Promise.resolve();
  assert.equal(stopCalls, 1, 'concurrent stop requests must share one in-flight stop signal');
  releaseStop();
  const [firstResult, secondResult] = await Promise.all([firstStop, secondStop]);
  assert.equal(firstResult.state, 'stopping');
  assert.equal(secondResult.state, 'stopping');
  assert.equal(stopCalls, 1, 'coalesced stop requests must not duplicate handler side effects');

  console.log('BROADCAST_STOP_TRANSACTION_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
