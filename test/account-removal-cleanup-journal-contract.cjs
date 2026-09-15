'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAccountRemovalCleanupJournal } = require('../src/account-removal-cleanup-journal.cjs');

function missingAccount() {
  return Object.assign(new Error('账号沙箱不存在'), { code: 'ACCOUNT_DATA_ACCOUNT_MISSING' });
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-account-cleanup-journal-'));
  const filePath = path.join(root, 'account-removal-cleanup.json');
  try {
    const first = createAccountRemovalCleanupJournal({ fs, filePath, now: () => 100 });
    await first.markPending({ accountId: 'A', partition: 'persist:webview-page-A' });
    assert.deepEqual(await first.list(), [{ accountId: 'A', partition: 'persist:webview-page-A', createdAt: 100 }]);

    // Simulate hard termination after Account State commit but before child cleanup:
    // a fresh process instance must recover the durable finalizer and clear it.
    const recoveredCalls = [];
    const second = createAccountRemovalCleanupJournal({ fs, filePath, now: () => 200 });
    const recovered = await second.recover({
      resolveAccountPartition: async () => { throw missingAccount(); },
      cleanup: async meta => { recoveredCalls.push(meta); },
    });
    assert.deepEqual(recovered.recovered, ['A']);
    assert.equal(recoveredCalls.length, 1);
    assert.deepEqual(
      { accountId: recoveredCalls[0].accountId, partition: recoveredCalls[0].partition, recovered: recoveredCalls[0].recovered },
      { accountId: 'A', partition: 'persist:webview-page-A', recovered: true },
    );
    assert.deepEqual(await second.list(), [], 'successful restart reconciliation must durably clear the finalizer');

    // If the parent account still exists, the durable marker represents a
    // pre-commit interruption and must be discarded without irreversible cleanup.
    await second.markPending({ accountId: 'B', partition: 'persist:webview-page-B' });
    let unexpectedCleanup = 0;
    const existing = await second.recover({
      resolveAccountPartition: async accountId => `persist:webview-page-${accountId}`,
      cleanup: async () => { unexpectedCleanup += 1; },
    });
    assert.deepEqual(existing.cleared, ['B']);
    assert.equal(unexpectedCleanup, 0);
    assert.deepEqual(await second.list(), []);

    // Cleanup failure must leave the finalizer durable so another process/startup
    // can retry exactly the dependent cleanup that did not complete.
    await second.markPending({ accountId: 'C', partition: 'persist:webview-page-C' });
    let cleanupAttempts = 0;
    const failed = await second.recover({
      resolveAccountPartition: async () => { throw missingAccount(); },
      cleanup: async () => {
        cleanupAttempts += 1;
        throw Object.assign(new Error('locked'), { code: 'ATTACHMENT_STORE_LOCKED' });
      },
    });
    assert.equal(cleanupAttempts, 1);
    assert.deepEqual(failed.failed, [{ accountId: 'C', code: 'ATTACHMENT_STORE_LOCKED' }]);
    assert.equal((await second.list()).length, 1, 'failed cleanup must remain pending on disk');

    const third = createAccountRemovalCleanupJournal({ fs, filePath, now: () => 300 });
    const retried = await third.recover({
      resolveAccountPartition: async () => { throw missingAccount(); },
      cleanup: async () => { cleanupAttempts += 1; },
    });
    assert.equal(cleanupAttempts, 2);
    assert.deepEqual(retried.recovered, ['C']);
    assert.deepEqual(await third.list(), []);

    // The journal must reject forged ownership instead of persisting arbitrary
    // partition identifiers into a recovery authority file.
    await assert.rejects(
      () => third.markPending({ accountId: 'D', partition: 'persist:webview-page-E' }),
      error => error?.code === 'ACCOUNT_REMOVAL_CLEANUP_JOURNAL_INVALID',
    );

    console.log('ACCOUNT_REMOVAL_CLEANUP_JOURNAL_CONTRACT_OK');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
