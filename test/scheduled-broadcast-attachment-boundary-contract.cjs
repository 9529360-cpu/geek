'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
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
  const win = { webContents: { id: 42, getURL: () => `file://${uiEntryPath}` }, isDestroyed: () => false };
  const BrowserWindow = { fromWebContents(value) { return value === sender ? win : null; } };
  const fs = createFakeFs();
  fs.seed('docs/a.pdf', 'AAAA', 10);
  const storePath = path.resolve('user-data/scheduled-broadcast-attachments.json');

  let ephemeralCounter = 0;
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
      return [{ token, name: 'a.pdf', size: 4, mime: 'application/pdf' }];
    },
  };

  const boundary = installScheduledBroadcastAttachmentBoundary({
    ipcMain,
    BrowserWindow,
    fs,
    uiEntryPath,
    ephemeralRegistry,
    getUserDataDir: () => path.dirname(storePath),
    fileURLToPath: url => url.pathname,
  });
  assert.deepEqual(boundary.channels, CHANNELS);
  assert.equal(handlers.size, 3);

  const event = { sender };
  const persisted = await handlers.get(CHANNELS.persist)(event, { accountId: 'account-a', taskId: 'task-1', fileTokens: ['short-a'] });
  assert.equal(persisted.length, 1);
  assert.deepEqual(Object.keys(persisted[0]).sort(), ['mime', 'name', 'ref', 'size']);
  assert.equal('filePath' in persisted[0], false, 'persistent response must not expose paths');

  const materialized = await handlers.get(CHANNELS.materialize)(event, { accountId: 'account-a', taskId: 'task-1', refs: [persisted[0].ref] });
  assert.deepEqual(materialized, [{ token: 'fresh-1', name: 'a.pdf', size: 4, mime: 'application/pdf' }]);
  assert.equal('filePath' in materialized[0], false, 'materialized response must still be opaque');

  await assert.rejects(
    handlers.get(CHANNELS.materialize)(event, { accountId: 'account-b', taskId: 'task-1', refs: [persisted[0].ref] }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID' },
  );

  assert.equal(await handlers.get(CHANNELS.cleanup)(event, { accountId: 'account-a', taskId: 'task-1' }), 1);
  await assert.rejects(
    handlers.get(CHANNELS.materialize)(event, { accountId: 'account-a', taskId: 'task-1', refs: [persisted[0].ref] }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID' },
  );

  const badEvent = { sender: { id: 777 } };
  await assert.rejects(
    handlers.get(CHANNELS.persist)(badEvent, { accountId: 'account-a', taskId: 'task-2', fileTokens: ['short-a'] }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_OWNER_INVALID' },
  );

  console.log('SCHEDULED_BROADCAST_ATTACHMENT_BOUNDARY_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
