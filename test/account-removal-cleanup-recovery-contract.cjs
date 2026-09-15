'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installAccountDataBoundary } = require('../src/account-data-boundary.cjs');
const { createAccountRemovalCleanupJournal } = require('../src/account-removal-cleanup-journal.cjs');
const { createScheduledBroadcastAttachmentStore } = require('../src/scheduled-broadcast-attachments.cjs');

function missingAccount() {
  return Object.assign(new Error('账号沙箱不存在'), { code: 'ACCOUNT_DATA_ACCOUNT_MISSING' });
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-account-cleanup-recovery-'));
  try {
    const source = path.join(root, 'scheduled-file.txt');
    const attachmentStorePath = path.join(root, 'scheduled-broadcast-attachments.json');
    const finalizerPath = path.join(root, 'account-removal-cleanup.json');
    await fs.writeFile(source, 'scheduled payload', 'utf8');

    const attachmentStore = createScheduledBroadcastAttachmentStore({ fs, storePath: attachmentStorePath });
    await attachmentStore.registerPaths({ accountId: 'A', taskId: 'task-1', filePaths: [source] });
    assert.equal(attachmentStore.size(), 1, 'fixture must begin with one durable account-owned attachment ref');

    // Simulate a hard crash after Account State deletion committed but before the
    // post-commit scheduled attachment cleanup ran.
    const finalizer = createAccountRemovalCleanupJournal({ fs, filePath: finalizerPath });
    await finalizer.markPending({ accountId: 'A', partition: 'persist:webview-page-A' });

    const handlers = new Map();
    const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); }, removeHandler() {} };
    const uiEntryPath = path.join(root, 'ui', 'index.html');
    const sender = { id: 7 };
    const win = { webContents: { id: 7, getURL: () => pathToFileURL(uiEntryPath).href }, isDestroyed: () => false };
    const BrowserWindow = { fromWebContents(value) { return value === sender ? win : null; } };
    const accountDataStore = {
      async getAll() { return {}; },
      async set() { return true; },
      async remove() { return true; },
      async beginDelete() {},
      cancelDelete() {},
      finalizeDelete() {},
    };

    const boundary = installAccountDataBoundary({
      ipcMain,
      BrowserWindow,
      uiEntryPath,
      fs,
      getUserDataDir: () => root,
      store: accountDataStore,
      resolveAccountPartition: async () => { throw missingAccount(); },
      beforeAccountRemove: ({ accountId }) => attachmentStore.cleanupAccount(accountId),
    });

    // Production starts reconciliation when the boundary is installed. Calling the
    // exposed owner method here deterministically waits behind that startup pass.
    const result = await boundary.reconcileCommittedCleanup();
    assert.equal(attachmentStore.size(), 0, 'restart reconciliation must remove orphan attachment refs for deleted accounts');
    assert.equal(await fs.readFile(source, 'utf8'), 'scheduled payload', 'cleanup must never delete the user source file itself');

    const recoveredJournal = createAccountRemovalCleanupJournal({ fs, filePath: finalizerPath });
    assert.deepEqual(await recoveredJournal.list(), [], 'successful restart reconciliation must clear the durable finalizer');
    assert.deepEqual(result.failed, []);

    console.log('ACCOUNT_REMOVAL_CLEANUP_RECOVERY_CONTRACT_OK');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
