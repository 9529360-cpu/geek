'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installAccountDataBoundary } = require('../src/account-data-boundary.cjs');

function missingError() {
  return Object.assign(new Error('账号沙箱不存在'), { code: 'ACCOUNT_DATA_ACCOUNT_MISSING' });
}

function configuredHarness(listener, cleanup = async ({ calls }) => { calls.push(['cleanup']); }, journalOptions = {}) {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const uiEntryPath = path.resolve('ui/index.html');
  const sender = { id: 42 };
  const win = { webContents: { id: 42, getURL: () => pathToFileURL(uiEntryPath).href }, isDestroyed: () => false };
  const BrowserWindow = { fromWebContents(value) { return value === sender ? win : null; } };
  let accountExists = true;
  const calls = [];
  const pending = new Set();
  const partition = 'persist:webview-page-A';
  const store = {
    async getAll() { return {}; },
    async set() { return true; },
    async remove() { return true; },
    async beginDelete(value) { calls.push(['begin', value]); },
    cancelDelete(value) { calls.push(['cancel', value]); },
    finalizeDelete(value) { calls.push(['finalize', value]); },
  };
  const cleanupJournal = {
    async recover() { return { recovered: [], cleared: [], failed: [] }; },
    async markPending(meta) {
      calls.push(['finalizer-pending', meta.accountId]);
      if (journalOptions.markError) throw journalOptions.markError;
      pending.add(meta.accountId);
    },
    async clear(accountId) {
      calls.push(['finalizer-clear', accountId]);
      if (journalOptions.clearError) throw journalOptions.clearError;
      pending.delete(accountId);
      return true;
    },
  };
  const boundary = installAccountDataBoundary({
    ipcMain,
    BrowserWindow,
    uiEntryPath,
    store,
    cleanupJournal,
    resolveAccountPartition: async accountId => {
      assert.equal(accountId, 'A');
      if (!accountExists) throw missingError();
      return partition;
    },
    beforeAccountRemove: async meta => cleanup({ ...meta, calls }),
  });
  ipcMain.handle('accounts:remove', (event, accountId) => boundary.runAccountRemoval(
    event,
    accountId,
    async (...args) => listener({
      commit: () => { accountExists = false; },
      mark: value => { calls.push([value]); },
      args,
    }),
  ));
  return { handlers, event: { sender }, calls, pending, partition };
}

(async () => {
  const committedFailure = configuredHarness(({ commit, mark }) => {
    mark('parent-start');
    commit();
    mark('parent-committed');
    throw new Error('账号已删除，但登录数据清理失败');
  });
  const response = await committedFailure.handlers.get('accounts:remove')(committedFailure.event, 'A');
  assert.deepEqual(response, { ok: true, deleted: true, cleanupPending: true });
  assert.deepEqual(committedFailure.calls, [
    ['begin', committedFailure.partition],
    ['finalizer-pending', 'A'],
    ['parent-start'],
    ['parent-committed'],
    ['cleanup'],
    ['finalizer-clear', 'A'],
    ['finalize', committedFailure.partition],
  ], 'post-commit parent failure must still settle child cleanup and durable finalizer before in-memory finalization');
  assert.equal(committedFailure.pending.size, 0);

  const uncommitted = configuredHarness(({ mark }) => {
    mark('parent-start');
    throw new Error('pre-commit failure');
  });
  await assert.rejects(
    uncommitted.handlers.get('accounts:remove')(uncommitted.event, 'A'),
    /pre-commit failure/,
  );
  assert.deepEqual(uncommitted.calls, [
    ['begin', uncommitted.partition],
    ['finalizer-pending', 'A'],
    ['parent-start'],
    ['finalizer-clear', 'A'],
    ['cancel', uncommitted.partition],
  ], 'a failure while the account still exists must clear the finalizer without irreversible child cleanup');
  assert.equal(uncommitted.pending.size, 0);

  const committedSuccess = configuredHarness(({ commit, mark }) => {
    mark('parent-start');
    commit();
    mark('parent-committed');
    return { accounts: [] };
  });
  assert.deepEqual(
    await committedSuccess.handlers.get('accounts:remove')(committedSuccess.event, 'A'),
    { accounts: [] },
  );
  assert.deepEqual(committedSuccess.calls, [
    ['begin', committedSuccess.partition],
    ['finalizer-pending', 'A'],
    ['parent-start'],
    ['parent-committed'],
    ['cleanup'],
    ['finalizer-clear', 'A'],
    ['finalize', committedSuccess.partition],
  ], 'successful parent deletion must clear the durable finalizer only after committed child cleanup');
  assert.equal(committedSuccess.pending.size, 0);

  let cleanupAttempts = 0;
  const cleanupFailure = configuredHarness(
    ({ commit, mark }) => {
      mark('parent-start');
      commit();
      mark('parent-committed');
      return { accounts: [] };
    },
    async ({ calls }) => {
      cleanupAttempts += 1;
      calls.push(['cleanup-failed']);
      throw new Error('cleanup failed');
    },
  );
  assert.deepEqual(
    await cleanupFailure.handlers.get('accounts:remove')(cleanupFailure.event, 'A'),
    { ok: true, deleted: true, cleanupPending: true },
    'child cleanup failure after parent commit must be reported as pending cleanup, not rollback',
  );
  assert.equal(cleanupAttempts, 1, 'committed cleanup must not spin inside the same removal call');
  assert.deepEqual(cleanupFailure.calls, [
    ['begin', cleanupFailure.partition],
    ['finalizer-pending', 'A'],
    ['parent-start'],
    ['parent-committed'],
    ['cleanup-failed'],
    ['finalize', cleanupFailure.partition],
  ]);
  assert.deepEqual([...cleanupFailure.pending], ['A'], 'failed child cleanup must leave a durable recovery marker');

  let parentCalls = 0;
  const finalizerWriteFailure = configuredHarness(
    () => {
      parentCalls += 1;
      return { accounts: [] };
    },
    undefined,
    { markError: Object.assign(new Error('disk full'), { code: 'ENOSPC' }) },
  );
  await assert.rejects(
    finalizerWriteFailure.handlers.get('accounts:remove')(finalizerWriteFailure.event, 'A'),
    error => error?.code === 'ENOSPC',
    'parent delete must not start if durable cleanup authority cannot be recorded',
  );
  assert.equal(parentCalls, 0);
  assert.deepEqual(finalizerWriteFailure.calls, [
    ['begin', finalizerWriteFailure.partition],
    ['finalizer-pending', 'A'],
    ['cancel', finalizerWriteFailure.partition],
  ]);

  console.log('ACCOUNT_REMOVE_COMMIT_SEMANTICS_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
