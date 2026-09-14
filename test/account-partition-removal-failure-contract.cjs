'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const start = mainSource.indexOf('async function removeAccount');
const end = mainSource.indexOf('\nlet accountIpcBoundary', start);
assert.ok(start >= 0 && end > start, 'removeAccount production owner must remain extractable for failure-path execution');
const removeAccountSource = mainSource.slice(start, end).trim();

function createHarness({ sessionFailure = null, rmFailure = null, pending = [] } = {}) {
  const removedPartition = 'persist:webview-page-removed';
  const userData = path.join(path.sep, 'tmp', 'geek-partition-contract');
  const partDir = path.join(userData, 'Partitions', 'webview-page-removed');
  const pendingPartitionDeletions = new Set(pending);
  const calls = [];

  const accountSession = {
    async clearStorageData() {
      calls.push('clearStorageData');
      if (sessionFailure) throw sessionFailure;
    },
    async clearCache() { calls.push('clearCache'); },
    async clearAuthCache() { calls.push('clearAuthCache'); },
    async clearHostResolverCache() { calls.push('clearHostResolverCache'); },
    async flushStorageData() { calls.push('flushStorageData'); },
  };

  const context = {
    assertTrustedSender() { calls.push('trusted'); },
    accountState: {
      async remove(accountId) {
        calls.push(`remove:${accountId}`);
        return {
          removedAccount: { id: accountId, partition: removedPartition },
          snapshot: { activeAccountId: null, accounts: [] },
        };
      },
    },
    translationRuntime: { deleteAccount(partition) { calls.push(`translation:${partition}`); } },
    proxyRuntime: { forgetPartition(partition) { calls.push(`proxy:${partition}`); } },
    webContents: { getAllWebContents() { return []; } },
    path,
    app: { getPath(name) { assert.equal(name, 'userData'); return userData; } },
    session: { fromPartition(partition) { assert.equal(partition, removedPartition); return accountSession; } },
    fs: {
      async rm(target, options) {
        calls.push(`rm:${target}`);
        assert.deepEqual(options, { recursive: true, force: true });
        if (rmFailure) throw rmFailure;
      },
    },
    pendingPartitionDeletions,
    console: { error() {} },
    notifyAccountsChanged() { calls.push('notify'); },
    publicState(snapshot) { return snapshot; },
    setTimeout(callback) { callback(); },
  };

  const removeAccount = vm.runInNewContext(`(${removeAccountSource.replace('async function removeAccount', 'async function')})`, context);
  return { removeAccount, pendingPartitionDeletions, calls, partDir };
}

(async () => {
  {
    const harness = createHarness({ sessionFailure: new Error('SESSION_CLEAR_FAILED') });
    await assert.rejects(
      harness.removeAccount({}, 'acct-1'),
      /账号已删除，但登录数据清理失败/,
      'post-commit Session cleanup failure must surface cleanup-pending semantics',
    );
    assert.equal(harness.pendingPartitionDeletions.has(harness.partDir), true, 'the exact removed partition directory must enter exit-time retry');
    assert.equal(harness.calls.some(call => call.startsWith('rm:')), false, 'directory removal must not be attempted after an earlier Session cleanup failure');
    assert.ok(harness.calls.indexOf('remove:acct-1') < harness.calls.indexOf('clearStorageData'), 'durable account removal must commit before child Session cleanup');
    assert.equal(harness.calls.at(-1), 'notify', 'renderer state notification must still run from finally after cleanup failure');
  }

  {
    const expected = path.join(path.sep, 'tmp', 'geek-partition-contract', 'Partitions', 'webview-page-removed');
    const harness = createHarness({ pending: [expected] });
    const result = await harness.removeAccount({}, 'acct-2');
    assert.deepEqual(result, { activeAccountId: null, accounts: [] });
    assert.equal(harness.pendingPartitionDeletions.has(harness.partDir), false, 'successful directory removal must clear a stale pending marker');
    assert.equal(harness.calls.some(call => call === `rm:${harness.partDir}`), true, 'successful path must remove the exact committed partition directory');
  }

  console.log('ACCOUNT_PARTITION_REMOVAL_FAILURE_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
