'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  installScheduledBroadcastAttachmentBoundary,
  CHANNELS,
} = require('../src/scheduled-broadcast-attachment-boundary.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeFs() {
  const files = new Map();
  const key = value => path.resolve(String(value));
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    seed(filePath, data, mtimeMs = 1, isRealFile = true) {
      const buffer = Buffer.from(data);
      files.set(key(filePath), { data: buffer, size: buffer.length, mtimeMs, isRealFile });
    },
    async realpath(value) {
      const record = files.get(key(value));
      if (!record || !record.isRealFile) throw enoent();
      return key(value);
    },
    async stat(value) {
      const record = files.get(key(value));
      if (!record) throw enoent();
      return { size: record.size, mtimeMs: record.mtimeMs, isFile: () => record.isRealFile };
    },
    async mkdir() {},
    async readFile(value, encoding) {
      const record = files.get(key(value));
      if (!record) throw enoent();
      return encoding ? record.data.toString(encoding) : Buffer.from(record.data);
    },
    async writeFile(value, data) {
      const buffer = Buffer.from(String(data));
      files.set(key(value), { data: buffer, size: buffer.length, mtimeMs: 1, isRealFile: false });
    },
    async rename(from, to) {
      const record = files.get(key(from));
      if (!record) throw enoent();
      files.set(key(to), { ...record });
      files.delete(key(from));
    },
  };
}

async function nextTurn() {
  await new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const uiEntryPath = path.resolve('ui/index.html');
  const mainFrame = { url: pathToFileURL(uiEntryPath).href };
  const sender = { id: 42, mainFrame };
  const win = {
    webContents: { id: 42, getURL: () => mainFrame.url },
    isDestroyed: () => false,
  };
  const BrowserWindow = { fromWebContents(value) { return value === sender ? win : null; } };
  const fs = createFakeFs();
  fs.seed('docs/a.pdf', 'AAAA', 10);
  fs.seed('docs/b.pdf', 'BBBB', 20);
  fs.seed('docs/c.pdf', 'CCCC', 30);
  const storePath = path.resolve('user-data/scheduled-broadcast-attachments.json');

  const ephemeral = new Map([
    ['persist-a', { filePath: path.resolve('docs/a.pdf'), name: 'a.pdf', size: 4, mime: 'application/pdf' }],
    ['seed-b', { filePath: path.resolve('docs/b.pdf'), name: 'b.pdf', size: 4, mime: 'application/pdf' }],
    ['seed-c', { filePath: path.resolve('docs/c.pdf'), name: 'c.pdf', size: 4, mime: 'application/pdf' }],
  ]);
  const persistResolveEntered = deferred();
  const releasePersistResolve = deferred();
  const materializeSelectionEntered = deferred();
  const releaseMaterializeSelection = deferred();
  let gatePersist = false;
  let gateMaterialize = false;
  let tokenCounter = 0;
  const releasedTokens = [];

  const ephemeralRegistry = {
    limits: { maxFiles: 10 },
    async resolve(token, ownerId) {
      assert.equal(ownerId, '42');
      const file = ephemeral.get(token);
      if (!file) throw new Error('BAD_SHORT_TOKEN');
      if (gatePersist && token === 'persist-a') {
        persistResolveEntered.resolve();
        await releasePersistResolve.promise;
      }
      return file;
    },
    async registerSelection(filePaths, ownerId) {
      assert.equal(ownerId, '42');
      if (gateMaterialize && filePaths[0] === path.resolve('docs/b.pdf')) {
        materializeSelectionEntered.resolve();
        await releaseMaterializeSelection.promise;
      }
      return filePaths.map(filePath => {
        const token = `materialized-${++tokenCounter}`;
        const name = path.basename(filePath);
        const record = { filePath, name, size: 4, mime: 'application/pdf' };
        ephemeral.set(token, record);
        return { token, name, size: 4, mime: 'application/pdf' };
      });
    },
    releaseMany(tokens, ownerId) {
      assert.equal(ownerId, '42');
      let released = 0;
      for (const token of tokens) {
        releasedTokens.push(token);
        if (ephemeral.delete(token)) released += 1;
      }
      return released;
    },
  };

  const boundary = installScheduledBroadcastAttachmentBoundary({
    ipcMain,
    BrowserWindow,
    fs,
    uiEntryPath,
    ephemeralRegistry,
    getUserDataDir: () => path.dirname(storePath),
  });
  const event = { sender, senderFrame: mainFrame };

  // Persist that was admitted before deletion must drain before terminal account cleanup.
  gatePersist = true;
  const pendingPersist = handlers.get(CHANNELS.persist)(event, {
    accountId: 'account-a',
    taskId: 'task-a',
    fileTokens: ['persist-a'],
  });
  await persistResolveEntered.promise;

  let cleanupAFinished = false;
  const cleanupA = boundary.cleanupAccount('account-a').then(value => {
    cleanupAFinished = true;
    return value;
  });
  await nextTurn();
  assert.equal(cleanupAFinished, false, 'account cleanup must wait for an already-admitted persist operation');

  releasePersistResolve.resolve();
  const persistedA = await pendingPersist;
  assert.equal(persistedA.length, 1, 'admitted persist may finish before terminal cleanup');
  assert.equal(await cleanupA, 1, 'terminal cleanup must delete the ref created by the drained persist');
  assert.equal(boundary.getStore().listTask('account-a', 'task-a').length, 0, 'no durable ref may survive account retirement');
  await assert.rejects(
    handlers.get(CHANNELS.persist)(event, {
      accountId: 'account-a', taskId: 'late-a', fileTokens: ['persist-a'],
    }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_ACCOUNT_RETIRED' },
    'new persist work must fail closed once account retirement begins',
  );

  // Seed B before retirement, then stop materialization after durable resolution but before token publication.
  gatePersist = false;
  const persistedB = await handlers.get(CHANNELS.persist)(event, {
    accountId: 'account-b',
    taskId: 'task-b',
    fileTokens: ['seed-b'],
  });
  assert.equal(persistedB.length, 1);

  gateMaterialize = true;
  const pendingMaterialize = handlers.get(CHANNELS.materialize)(event, {
    accountId: 'account-b',
    taskId: 'task-b',
    refs: [persistedB[0].ref],
  });
  await materializeSelectionEntered.promise;

  let cleanupBFinished = false;
  const cleanupB = boundary.cleanupAccount('account-b').then(value => {
    cleanupBFinished = true;
    return value;
  });
  await nextTurn();
  assert.equal(cleanupBFinished, false, 'account cleanup must wait for an already-admitted materialize operation');

  releaseMaterializeSelection.resolve();
  const materializedB = await pendingMaterialize;
  assert.equal(materializedB.length, 1);
  const lateToken = materializedB[0].token;
  assert.equal(await cleanupB, 1, 'terminal cleanup must delete B durable refs after the drain');
  assert.equal(ephemeral.has(lateToken), false, 'terminal account cleanup must release the token created by drained materialize work');
  assert.ok(releasedTokens.includes(lateToken), 'late materialized token must pass through the canonical release owner');
  assert.equal(boundary.getStore().listTask('account-b', 'task-b').length, 0, 'no B durable ref may survive account retirement');
  await assert.rejects(
    handlers.get(CHANNELS.materialize)(event, {
      accountId: 'account-b', taskId: 'task-b', refs: [persistedB[0].ref],
    }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_ACCOUNT_RETIRED' },
    'new materialize work must fail closed once account retirement begins',
  );

  // Cleanup is idempotent and retirement of A/B must not affect another live account.
  assert.equal(await boundary.cleanupAccount('account-a'), 0, 'repeated terminal cleanup must remain idempotent');
  const persistedC = await handlers.get(CHANNELS.persist)(event, {
    accountId: 'account-c',
    taskId: 'task-c',
    fileTokens: ['seed-c'],
  });
  assert.equal(persistedC.length, 1, 'retiring one account must not close admission for another account');
  assert.equal(boundary.getStore().listTask('account-c', 'task-c').length, 1);

  console.log('SCHEDULED_BROADCAST_ATTACHMENT_ACCOUNT_RETIREMENT_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});