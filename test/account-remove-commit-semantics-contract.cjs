'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installAccountDataBoundary } = require('../src/account-data-boundary.cjs');

function missingError() {
  return Object.assign(new Error('账号沙箱不存在'), { code: 'ACCOUNT_DATA_ACCOUNT_MISSING' });
}

function configuredHarness(listener) {
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
    beforeAccountRemove: async () => { calls.push(['before']); },
  });
  ipcMain.handle('accounts:remove', (event, accountId) => boundary.runAccountRemoval(
    event,
    accountId,
    async (...args) => listener({
      commit: () => { accountExists = false; },
      args,
    }),
  ));
  return { handlers, event: { sender }, calls, partition };
}

(async () => {
  const committed = configuredHarness(({ commit }) => {
    commit();
    throw new Error('账号已删除，但登录数据清理失败');
  });
  const response = await committed.handlers.get('accounts:remove')(committed.event, 'A');
  assert.deepEqual(response, { ok: true, deleted: true, cleanupPending: true });
  assert.deepEqual(committed.calls, [
    ['begin', committed.partition],
    ['before'],
    ['finalize', committed.partition],
  ], 'a committed deletion must finalize the account-data tombstone and never pretend rollback');

  const uncommitted = configuredHarness(() => {
    throw new Error('pre-commit failure');
  });
  await assert.rejects(
    uncommitted.handlers.get('accounts:remove')(uncommitted.event, 'A'),
    /pre-commit failure/,
  );
  assert.deepEqual(uncommitted.calls, [
    ['begin', uncommitted.partition],
    ['before'],
    ['cancel', uncommitted.partition],
  ], 'a failure while the account still exists must cancel the delete tombstone and propagate');

  console.log('ACCOUNT_REMOVE_COMMIT_SEMANTICS_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});