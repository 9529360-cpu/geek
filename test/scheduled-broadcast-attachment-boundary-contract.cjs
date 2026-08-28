'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installScheduledBroadcastAttachmentBoundary, CHANNELS } = require('../src/scheduled-broadcast-attachment-boundary.cjs');

function createFakeFs() {
  const files = new Map();
  function key(value) { return path.resolve(String(value)); }
  function enoent() { return Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }
  return {
    seed(filePath, data, mtimeMs = 1, isRealFile = true) {
      const buffer = Buffer.from(data);
      files.set(key(filePath), { data: buffer, size: buffer.length, mtimeMs, isRealFile });
    },
    async realpath(value) { const record = files.get(key(value)); if (!record || !record.isRealFile) throw enoent(); return key(value); },
    async stat(value) { const record = files.get(key(value)); if (!record) throw enoent(); return { size: record.size, mtimeMs: record.mtimeMs, isFile: () => record.isRealFile }; },
    async mkdir() {},
    async readFile(value, encoding) { const record = files.get(key(value)); if (!record) throw enoent(); return encoding ? record.data.toString(encoding) : Buffer.from(record.data); },
    async writeFile(value, data) { const buffer = Buffer.from(String(data)); files.set(key(value), { data: buffer, size: buffer.length, mtimeMs: 1, isRealFile: false }); },
    async rename(from, to) { const record = files.get(key(from)); if (!record) throw enoent(); files.set(key(to), { ...record }); files.delete(key(from)); },
  };
}

(async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const uiEntryPath = path.resolve('ui/index.html');
  const sender = { id: 42 };
  const win = { webContents: { id: 42, getURL: () => pathToFileURL(uiEntryPath).href }, isDestroyed: () => false };
  const BrowserWindow = { fromWebContents(value) { return value === sender ? win : null; } };
  const fs = createFakeFs();
  fs.seed('docs/a.pdf', 'AAAA', 10);
  const storePath = path.resolve('user-data/scheduled-broadcast-attachments.json');

  let ephemeralCounter = 0;
  const releaseCalls = [];
  const ephemeral = new Map([['short-a', { filePath: path.resolve('docs/a.pdf'), name: 'a.pdf', size: 4, mime: 'application/pdf' }]]);
  const ephemeralRegistry = {
    limits: { maxFiles: 10 },
    async resolve(token, ownerId) {
      assert.equal(ownerId, '42');
      const file = ephemeral.get(token);
      if (!file) throw new Error('BAD_SHORT_TOKEN');
      return file;
    },
    async registerSelection(filePaths, ownerId) {
      assert.equal(ownerId, '42');
      assert.deepEqual(filePaths, [path.resolve('docs/a.pdf')]);
      const token = `fresh-${++ephemeralCounter}`;
      ephemeral.set(token, { filePath: path.resolve('docs/a.pdf'), name: 'a.pdf', size: 4, mime: 'application/pdf' });
      return [{ token, name: 'a.pdf', size: 4, mime: 'application/pdf' }];
    },
    releaseMany(tokens, ownerId) {
      assert.equal(ownerId, '42');
      const values = [...tokens];
      releaseCalls.push(values);
      let released = 0;
      for (const token of values) {
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
  assert.deepEqual(boundary.channels, CHANNELS);
  assert.equal(typeof boundary.cleanupAccount, 'function');
  assert.equal(handlers.size, 4);
  assert.equal(typeof handlers.get(CHANNELS.cleanupAccount), 'function', 'trusted account cleanup channel must be installed');

  const event = { sender };
  const persisted = await handlers.get(CHANNELS.persist)(event, { accountId: 'account-a', taskId: 'task-1', fileTokens: ['short-a'] });
  assert.equal(persisted.length, 1);
  assert.deepEqual(releaseCalls, [['short-a']], 'durable persist must release the original picker token');
  assert.equal(ephemeral.has('short-a'), false);
  assert.deepEqual(Object.keys(persisted[0]).sort(), ['mime', 'name', 'ref', 'size']);
  assert.equal('filePath' in persisted[0], false, 'persistent response must not expose paths');

  const materialized = await handlers.get(CHANNELS.materialize)(event, { accountId: 'account-a', taskId: 'task-1', refs: [persisted[0].ref] });
  assert.deepEqual(materialized, [{ token: 'fresh-1', name: 'a.pdf', size: 4, mime: 'application/pdf' }]);
  assert.equal('filePath' in materialized[0], false, 'materialized response must still be opaque');
  assert.equal(ephemeral.has('fresh-1'), true);

  await assert.rejects(
    handlers.get(CHANNELS.materialize)(event, { accountId: 'account-b', taskId: 'task-1', refs: [persisted[0].ref] }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID' },
  );

  assert.equal(await handlers.get(CHANNELS.cleanup)(event, { accountId: 'account-a', taskId: 'task-1' }), 1);
  assert.deepEqual(releaseCalls.at(-1), ['fresh-1'], 'terminal durable cleanup must release materialized short tokens');
  assert.equal(ephemeral.has('fresh-1'), false);
  await assert.rejects(
    handlers.get(CHANNELS.materialize)(event, { accountId: 'account-a', taskId: 'task-1', refs: [persisted[0].ref] }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID' },
  );

  const badEvent = { sender: { id: 777 } };
  await assert.rejects(
    handlers.get(CHANNELS.persist)(badEvent, { accountId: 'account-a', taskId: 'task-2', fileTokens: ['short-a'] }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_OWNER_INVALID' },
  );
  await assert.rejects(
    handlers.get(CHANNELS.cleanupAccount)(badEvent, { accountId: 'account-a' }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_OWNER_INVALID' },
    'account cleanup must retain the same trusted-renderer owner check',
  );

  console.log('SCHEDULED_BROADCAST_ATTACHMENT_BOUNDARY_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
