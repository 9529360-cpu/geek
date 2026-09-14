'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installAccountDataBoundary } = require('../src/account-data-boundary.cjs');

function missingError() {
  return Object.assign(new Error('账号沙箱不存在'), { code: 'ACCOUNT_DATA_ACCOUNT_MISSING' });
}

function configuredHarness(listener, cleanup = async ({ calls }) => { calls.push(['cleanup']); }) {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const uiEntryPath = path.resolve('ui/index.html');
  const sender = { id: 42 };
  const win = { webContents: { id: 42, getURL: () => pathToFileURL(uiEntryPath).href }, isDestroyed: () => false };
  const BrowserWindow = { fromWebContents(value) { return value === sender ? win : null; } };
  let accountExists = true;
  const calls = [];
  const partition = 'persist:webview-page-A';
  const store = {
    async getAll() { return {}; },
    async set() { return true; },
    async remove() { return true; },
    async beginDelete(value) { calls.push(['begin', value]); },
    cancelDelete(value) { calls.push(['cancel', value]); },
    finalizeDelete(value) { calls.push(['finalize', value]); },
  };
  const boundary = installAccountDataBoundary({
    ipcMain,
    BrowserWindow,
    uiEntryPath,
    store,
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
  return { handlers, event: { sender }, calls, partition };
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
    ['parent-start'],
    ['parent-committed'],
    ['cleanup'],
    ['finalize', committedFailure.partition],
  ], 'post-commit failure must still cleanup committed child state exactly once before finalizing');

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
    ['parent-start'],
    ['cancel', uncommitted.partition],
  ], 'a failure while the account still exists must never cleanup scheduled attachments');

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
    ['parent-start'],
    ['parent-committed'],
    ['cleanup'],
    ['finalize', committedSuccess.partition],
  ], 'successful parent deletion must run irreversible cleanup only after commit');

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
  assert.equal(cleanupAttempts, 1, 'committed cleanup must not be retried inside the same removal call');
  assert.deepEqual(cleanupFailure.calls, [
    ['begin', cleanupFailure.partition],
    ['parent-start'],
    ['parent-committed'],
    ['cleanup-failed'],
    ['finalize', cleanupFailure.partition],
  ]);

  console.log('ACCOUNT_REMOVE_COMMIT_SEMANTICS_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
