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
  assert.doesNotMatch(source, /\bconfirm\s*\(|window\.confirm|\balert\s*\(|window\.alert/, 'account deletion must not use blocking system prompts');

  assert.match(source, /role="alertdialog"/, 'destructive confirmation must expose alertdialog semantics');
  assert.match(source, /aria-modal="true"/, 'destructive confirmation must be modal');
  assert.match(source, /aria-labelledby="account-remove-confirm-title"/, 'dialog must expose a visible accessible name');
  assert.match(source, /aria-describedby="account-remove-confirm-description account-remove-confirm-warning"/, 'dialog must expose both the deletion consequence and irreversible warning');
  assert.match(source, /id="account-remove-confirm-status"[\s\S]*role="status"[\s\S]*aria-live="polite"/, 'async removal feedback must stay inline and non-blocking');
  assert.match(source, /overlay\.querySelector\('#account-remove-cancel'\)\?\.focus/, 'least destructive action must receive initial focus');
  assert.match(source, /event\.key === 'Escape'/, 'Escape must cancel before deletion starts');
  assert.match(source, /event\.key !== 'Tab'/, 'dialog must explicitly own Tab focus movement');
  assert.match(source, /event\.shiftKey/, 'dialog must support reverse focus cycling');
  assert.match(source, /restoreAccountFocus/, 'closing the dialog must return focus to the account controls');
  assert.match(source, /more && more\.offsetParent !== null \? more : main/, 'collapsed sidebar must restore focus to the visible account control');
  assert.match(source, /prefers-reduced-motion:reduce/, 'destructive dialog must respect reduced-motion preference');

  const stopAt = source.indexOf("await manager.invoke(job.id, 'stop')");
  const removeAt = source.indexOf('await win.api.accounts.remove(accountId)');
  const reloadAt = source.indexOf('win.location.reload()');
  assert.ok(stopAt >= 0 && removeAt > stopAt, 'all live Broadcast jobs must stop before authoritative account deletion');
  assert.ok(reloadAt > removeAt, 'renderer reload must happen only after backend deletion succeeds');
  assert.match(source, /reloadRequested = true[\s\S]*finally \{[\s\S]*if \(!reloadRequested\) removalInFlight = false/, 'successful backend deletion must stay locked until reload takes ownership');
  assert.match(source, /catch \(error\) \{[\s\S]*setDialogStatus\(overlay,[\s\S]*'error'\)/, 'deletion failure must stay visible in the dialog');
  assert.match(source, /正在安全停止群发任务并删除账号/, 'pending state must explain the safety sequence');

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