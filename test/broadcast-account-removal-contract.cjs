'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const removal = require('../ui/broadcast-account-removal.js');

function createManager() {
  const jobs = new Map([
    ['run-a', { id: 'run-a', accountId: 'A', state: 'running' }],
    ['sched-a', { id: 'sched-a', accountId: 'A', state: 'scheduled' }],
    ['run-b', { id: 'run-b', accountId: 'B', state: 'running' }],
  ]);
  const listeners = new Set();
  const invoked = [];
  const emit = job => { for (const listener of listeners) listener({ type: 'state', job: { ...job } }); };
  return {
    jobs, invoked,
    list(accountId) { return [...jobs.values()].filter(job => accountId == null || job.accountId === accountId).map(job => ({ ...job })); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async invoke(jobId, action) {
      invoked.push([jobId, action]);
      const job = jobs.get(jobId);
      assert.equal(action, 'stop');
      if (job.state === 'scheduled' || job.state === 'queued') { job.state = 'stopped'; emit(job); return { ...job }; }
      job.state = 'stopping'; emit(job);
      await Promise.resolve();
      job.state = 'stopped'; emit(job);
      return { ...job };
    },
  };
}

(async () => {
  const manager = createManager();
  assert.deepEqual(removal.liveJobsForAccount(manager, 'A').map(job => job.id).sort(), ['run-a', 'sched-a']);
  await removal.beforeAccountRemoval('A', { manager, timeoutMs: 1000 });
  assert.deepEqual(manager.invoked.sort(), [['run-a', 'stop'], ['sched-a', 'stop']].sort());
  assert.equal(manager.jobs.get('run-a').state, 'stopped');
  assert.equal(manager.jobs.get('sched-a').state, 'stopped');
  assert.equal(manager.jobs.get('run-b').state, 'running');

  const source = fs.readFileSync(path.join(__dirname, '../ui/broadcast-account-removal.js'), 'utf8');
  const safetyLoader = fs.readFileSync(path.join(__dirname, '../ui/broadcast-safety.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
  const accountBoundary = fs.readFileSync(path.join(__dirname, '../src/account-data-boundary.cjs'), 'utf8');
  const attachmentBoundary = fs.readFileSync(path.join(__dirname, '../src/scheduled-broadcast-attachment-boundary.cjs'), 'utf8');
  const attachmentStore = fs.readFileSync(path.join(__dirname, '../src/scheduled-broadcast-attachments.cjs'), 'utf8');

  assert.match(source, /#ctx-menu \.ctx-item\[data-act="delete"\]/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.ok(source.indexOf("await manager.invoke(job.id, 'stop')") < source.indexOf('window.api.accounts.remove(accountId)'));
  assert.ok(source.indexOf('window.api.accounts.remove(accountId)') < source.indexOf('window.location.reload()'));
  assert.match(source, /catch\(error => \{[\s\S]*alert/);
  assert.match(safetyLoader, /broadcast-account-removal\.js/);
  assert.match(main, /beforeAccountRemove: \(\{ accountId \}\) => scheduledAttachmentBoundary\.cleanupAccount\(accountId\)/, 'main composition must connect account deletion to scheduled attachment cleanup');
  assert.match(main, /accountDataBoundary\.runAccountRemoval\(event, accountId, removeAccount\)/, 'accounts:remove must explicitly enter the account-data lifecycle');
  assert.ok(accountBoundary.indexOf('await beforeAccountRemove') < accountBoundary.indexOf('await removeImplementation(event, id'), 'durable resources must be cleaned before authoritative account deletion');
  assert.match(attachmentBoundary, /async function cleanupAccount\(accountId\)/);
  assert.match(attachmentStore, /async function cleanupAccount\(accountId\)/);

  console.log('BROADCAST_ACCOUNT_REMOVAL_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});