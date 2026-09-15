'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const removal = require('../ui/broadcast-account-removal.js');
const safety = require('../ui/broadcast-safety.js');

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

function createRemovalEvent() {
  const state = { prevented: 0, stopped: 0 };
  return {
    state,
    event: {
      preventDefault() { state.prevented += 1; },
      stopImmediatePropagation() { state.stopped += 1; },
    },
  };
}

(async () => {
  const blockedEvent = createRemovalEvent();
  assert.deepEqual(
    safety.routeAccountRemoval({ event: blockedEvent.event, owner: null, accountId: 'A' }),
    { handled: true, ready: false, opened: false, reason: 'OWNER_NOT_READY' },
    'delete must fail closed until the lifecycle owner is ready',
  );
  assert.deepEqual(blockedEvent.state, { prevented: 1, stopped: 1 }, 'pre-ready delete must consume the event before legacy app.js can see it');

  const missingEvent = createRemovalEvent();
  assert.deepEqual(
    safety.routeAccountRemoval({ event: missingEvent.event, owner: { openDialog() { throw new Error('must not open'); } }, accountId: '' }),
    { handled: true, ready: false, opened: false, reason: 'ACCOUNT_MISSING' },
    'delete must fail closed when the account owner cannot be resolved',
  );
  assert.deepEqual(missingEvent.state, { prevented: 1, stopped: 1 });

  let openedAccountId = '';
  const delegatedEvent = createRemovalEvent();
  assert.deepEqual(
    safety.routeAccountRemoval({
      event: delegatedEvent.event,
      owner: { openDialog(accountId) { openedAccountId = accountId; return true; } },
      accountId: 'A',
    }),
    { handled: true, ready: true, opened: true, reason: '' },
    'ready delete must delegate only to the lifecycle owner dialog',
  );
  assert.equal(openedAccountId, 'A');
  assert.deepEqual(delegatedEvent.state, { prevented: 1, stopped: 1 });
  assert.throws(() => safety.routeAccountRemoval({ event: {}, owner: null, accountId: 'A' }), /account removal event is required/);

  const manager = createManager();
  assert.deepEqual(removal.liveJobsForAccount(manager, 'A').map(job => job.id).sort(), ['run-a', 'sched-a']);
  await removal.beforeAccountRemoval('A', { manager, timeoutMs: 1000 });
  assert.deepEqual(manager.invoked.sort(), [['run-a', 'stop'], ['sched-a', 'stop']].sort());
  assert.equal(manager.jobs.get('run-a').state, 'stopped');
  assert.equal(manager.jobs.get('sched-a').state, 'stopped');
  assert.equal(manager.jobs.get('run-b').state, 'running');

  const source = fs.readFileSync(path.join(__dirname, '../ui/broadcast-account-removal.js'), 'utf8');
  const safetyLoader = fs.readFileSync(path.join(__dirname, '../ui/broadcast-safety.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
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

  const safetyScriptAt = index.indexOf('<script src="broadcast-safety.js"></script>');
  const appScriptAt = index.indexOf('<script src="app.js"></script>');
  const readinessGateAt = safetyLoader.indexOf("const item = event.target?.closest?.('#ctx-menu .ctx-item[data-act=\"delete\"]')");
  const asyncBroadcastLoaderAt = safetyLoader.indexOf("loadScript('./broadcast-job-manager.js'");
  assert.ok(safetyScriptAt >= 0 && appScriptAt > safetyScriptAt, 'readiness gate owner must load synchronously before app.js installs its legacy bubble handler');
  assert.ok(readinessGateAt >= 0 && asyncBroadcastLoaderAt > readinessGateAt, 'delete readiness gate must register before the asynchronous Broadcast dependency chain starts');
  assert.match(safetyLoader, /routeAccountRemoval\(\{[\s\S]*owner:\s*window\.GeekBroadcastAccountRemoval[\s\S]*accountId/,
    'synchronous capture gate must delegate only to GeekBroadcastAccountRemoval');
  assert.match(safetyLoader, /event\.preventDefault\(\)[\s\S]*event\.stopImmediatePropagation\(\)/,
    'readiness gate must consume the destructive click before the legacy bubble path');
  assert.doesNotMatch(safetyLoader, /window\.api\.accounts\.remove|wvMap\.delete|accounts\s*=\s*accounts\.filter/,
    'readiness gate must never perform destructive account or renderer-state mutation itself');
  assert.match(safetyLoader, /账号删除功能正在初始化，请稍后重试。/, 'pre-ready fail-closed path must give user-visible feedback');
  assert.match(safetyLoader, /broadcast-account-removal\.js/);

  assert.match(main, /beforeAccountRemove: \(\{ accountId \}\) => scheduledAttachmentBoundary\.cleanupAccount\(accountId\)/, 'main composition must connect account deletion to scheduled attachment cleanup');
  assert.match(main, /accountDataBoundary\.runAccountRemoval\(event, accountId, removeAccount\)/, 'accounts:remove must explicitly enter the account-data lifecycle');

  const beginDeleteAt = accountBoundary.indexOf('await store.beginDelete(partition)');
  const finalizerPendingAt = accountBoundary.indexOf('await cleanupJournal.markPending({ accountId: id, partition })');
  const parentDeleteAt = accountBoundary.indexOf('response = await removeImplementation(event, id, ...rest)');
  assert.ok(
    beginDeleteAt >= 0 && finalizerPendingAt > beginDeleteAt && parentDeleteAt > finalizerPendingAt,
    'durable child-cleanup finalizer must be recorded before authoritative account deletion can commit',
  );

  const settleAt = accountBoundary.indexOf('async function settleCommittedRemoval');
  const childCleanupAt = accountBoundary.indexOf('await committedAccountCleanup({ event, accountId, partition })', settleAt);
  const finalizerClearAt = accountBoundary.indexOf('await cleanupJournal.clear(accountId)', settleAt);
  const finalizeDeleteAt = accountBoundary.indexOf('store.finalizeDelete(partition)', settleAt);
  assert.ok(
    settleAt >= 0 && childCleanupAt > settleAt && finalizerClearAt > childCleanupAt && finalizeDeleteAt > finalizerClearAt,
    'after parent commit, scheduled child cleanup must complete before clearing durable debt and finalizing the in-memory delete barrier',
  );
  assert.match(accountBoundary, /reconcileCommittedCleanup\(\)\.catch/, 'startup composition must begin durable child-cleanup reconciliation');
  assert.match(accountBoundary, /ACCOUNT_DATA_ACCOUNT_MISSING[\s\S]*settleCommittedRemoval/, 'a committed parent delete must enter post-commit cleanup instead of pretending rollback');
  assert.match(attachmentBoundary, /async function cleanupAccount\(accountId\)/);
  assert.match(attachmentStore, /async function cleanupAccount\(accountId\)/);

  console.log('BROADCAST_ACCOUNT_REMOVAL_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});