'use strict';

const assert = require('node:assert/strict');
const managerApi = require('../ui/broadcast-job-manager.js');
const executorApi = require('../ui/broadcast-executor.js');

let now = 1000;
const manager = managerApi.createManager({ now: () => now });
const sleepCalls = [];
const executor = executorApi.createExecutor({
  manager,
  now: () => now,
  random: () => 0,
  sleep: async ms => { sleepCalls.push(ms); now += ms; await Promise.resolve(); },
});

const a = manager.start({ accountId: 'A', targets: [{ id: 'a1' }, { id: 'a2' }], intervalMin: 1, intervalMax: 1 });
const b = manager.start({ accountId: 'B', targets: [{ id: 'b1' }, { id: 'b2' }], intervalMin: 1, intervalMax: 1 });
const sentA = [];
const sentB = [];

(async () => {
  const runA = executor.run(a.id, { sendTarget: async (_job, target) => { sentA.push(target.id); return 'SENT'; } });
  const runB = executor.run(b.id, { sendTarget: async (_job, target) => { sentB.push(target.id); return 'SENT'; } });
  assert.equal(executor.runningJobIds().length, 2, 'different-account jobs should execute concurrently');
  const [doneA, doneB] = await Promise.all([runA, runB]);
  assert.deepEqual(sentA, ['a1', 'a2']);
  assert.deepEqual(sentB, ['b1', 'b2']);
  assert.equal(doneA.state, 'completed');
  assert.equal(doneB.state, 'completed');
  assert.equal(doneA.ok, 2);
  assert.equal(doneB.ok, 2);

  const c = manager.start({ accountId: 'C', targets: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], intervalMin: 0, intervalMax: 0 });
  let cCount = 0;
  const doneC = await executor.run(c.id, {
    sendTarget: async () => {
      cCount += 1;
      if (cCount === 1) await manager.invoke(c.id, 'stop');
      return 'SENT';
    },
  });
  assert.equal(doneC.state, 'stopped');
  assert.equal(doneC.current, 1, 'stop must prevent later targets');

  const d = manager.start({ accountId: 'D', targets: [{ id: 'd1' }, { id: 'd2' }], intervalMin: 0, intervalMax: 0 });
  const doneD = await executor.run(d.id, { sendTarget: async (_job, target) => target.id === 'd1' ? { ok: false, reason: 'NO_CHAT' } : 'SENT' });
  assert.equal(doneD.state, 'completed', 'partial target failures still complete the job');
  assert.equal(doneD.ok, 1);
  assert.equal(doneD.fail, 1);
  assert.equal(doneD.failed[0].targetId, 'd1');
  assert.equal(doneD.failed[0].reason, 'NO_CHAT');

  assert.ok(sleepCalls.length >= 2, 'interval waiting should be driven by the executor');
  console.log('BROADCAST_EXECUTOR_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
