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
      if (job.state === 'scheduled' || job.state === 'queued') {
        job.state = 'stopped'; emit(job); return { ...job };
      }
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
  assert.deepEqual(manager.invoked.sort(), [['run-a', 'stop'], ['sched-a', 'stop']].sort(), 'only the removed account jobs may be stopped');
  assert.equal(manager.jobs.get('run-a').state, 'stopped');
  assert.equal(manager.jobs.get('sched-a').state, 'stopped');
  assert.equal(manager.jobs.get('run-b').state, 'running', 'other account execution must remain untouched');

  const source = fs.readFileSync(path.join(__dirname, '../ui/broadcast-account-removal.js'), 'utf8');
  const safetyLoader = fs.readFileSync(path.join(__dirname, '../ui/broadcast-safety.js'), 'utf8');
  const mainEntry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
  const accountBoundary = fs.readFileSync(path.join(__dirname, '../src/account-data-boundary.cjs'), 'utf8');
  const attachmentBoundary = fs.readFileSync(path.join(__dirname, '../src/scheduled-broadcast-attachment-boundary.cjs'), 'utf8');
  const attachmentStore = fs.readFileSync(path.join(__dirname, '../src/scheduled-broadcast-attachments.cjs'), 'utf8');

  assert.match(source, /#ctx-menu \.ctx-item\[data-act="delete"\]/, 'delete action must be intercepted before legacy app.js mutates UI state');
  assert.match(source, /event\.stopImmediatePropagation\(\)/, 'legacy delete handler must not run in parallel');
  assert.ok(source.indexOf('await manager.invoke(job.id, \'stop\')') < source.indexOf('window.api.accounts.remove(accountId)'), 'all account jobs must stop before backend account removal');
  assert.ok(source.indexOf('window.api.accounts.remove(accountId)') < source.indexOf('window.location.reload()'), 'renderer may rebuild UI only after backend deletion succeeds');
  assert.match(source, /catch\(error => \{[\s\S]*alert/, 'failed stop/delete must leave current renderer state intact and report an error');
  assert.match(safetyLoader, /broadcast-account-removal\.js/, 'account removal barrier must load with the account-scoped broadcast runtime');
  assert.match(mainEntry, /beforeAccountRemove: \(\{ accountId \}\) => scheduledAttachmentBoundary\.getStore\(\)\.cleanupAccount\(accountId\)/, 'main account deletion must clean durable attachment refs before partition removal');
  assert.ok(accountBoundary.indexOf('await beforeAccountRemove') < accountBoundary.indexOf('await listener(event, accountId'), 'external durable resources must be cleaned before the real accounts:remove handler');
  assert.match(attachmentBoundary, /cleanupAccount/, 'scheduled attachment boundary must own account-scoped cleanup');
  assert.match(attachmentStore, /async function cleanupAccount\(accountId\)/, 'durable store needs an account-scoped cleanup operation');

  console.log('BROADCAST_ACCOUNT_REMOVAL_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
