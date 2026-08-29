'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createScheduledBroadcastAttachmentStore } = require('../src/scheduled-broadcast-attachments.cjs');

function createFakeFs() {
  const files = new Map();
  const dirs = new Set();
  let failNextRename = false;
  function key(value) { return path.resolve(String(value)); }
  function enoent() { return Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }
  return {
    files,
    dirs,
    seed(filePath, data, mtimeMs = 1) {
      const buffer = Buffer.from(data);
      files.set(key(filePath), { data: buffer, size: buffer.length, mtimeMs, isRealFile: true });
    },
    mutate(filePath, data, mtimeMs) {
      const buffer = Buffer.from(data);
      const current = files.get(key(filePath));
      if (!current) throw enoent();
      files.set(key(filePath), { ...current, data: buffer, size: buffer.length, mtimeMs });
    },
    failRenameOnce() { failNextRename = true; },
    async realpath(value) {
      const absolute = key(value);
      const record = files.get(absolute);
      if (!record || !record.isRealFile) throw enoent();
      return absolute;
    },
    async stat(value) {
      const record = files.get(key(value));
      if (!record) throw enoent();
      return { size: record.size, mtimeMs: record.mtimeMs, isFile: () => record.isRealFile === true };
    },
    async mkdir(value) { dirs.add(key(value)); },
    async readFile(value, encoding) {
      const record = files.get(key(value));
      if (!record) throw enoent();
      const buffer = Buffer.from(record.data);
      return encoding ? buffer.toString(encoding) : buffer;
    },
    async writeFile(value, data) {
      const buffer = Buffer.from(String(data));
      files.set(key(value), { data: buffer, size: buffer.length, mtimeMs: Date.now(), isRealFile: false });
    },
    async rename(from, to) {
      if (failNextRename) {
        failNextRename = false;
        throw Object.assign(new Error('EIO'), { code: 'EIO' });
      }
      const source = files.get(key(from));
      if (!source) throw enoent();
      files.set(key(to), { ...source });
      files.delete(key(from));
    },
  };
}

(async () => {
  const fs = createFakeFs();
  const storePath = path.resolve('userdata/scheduled-broadcast-attachments.json');
  fs.seed('docs/a.pdf', 'AAAA', 10);
  fs.seed('docs/b.txt', 'BBBBB', 20);
  let token = 0;
  const randomBytes = () => Buffer.alloc(24, ++token);

  const first = createScheduledBroadcastAttachmentStore({ fs, storePath, randomBytes });
  const selected = await first.registerPaths({
    accountId: 'account-a',
    taskId: 'task-1',
    filePaths: ['docs/a.pdf', 'docs/b.txt'],
  });
  assert.equal(selected.length, 2);
  assert.deepEqual(Object.keys(selected[0]).sort(), ['mime', 'name', 'ref', 'size']);
  assert.equal('filePath' in selected[0], false, 'renderer-facing record must not expose a real path');
  assert.match(selected[0].ref, /^[a-f0-9]{48}$/);

  const one = await first.resolve(selected[0].ref, { accountId: 'account-a', taskId: 'task-1' });
  assert.equal(one.filePath, path.resolve('docs/a.pdf'));
  await assert.rejects(first.resolve(selected[0].ref, { accountId: 'account-b', taskId: 'task-1' }), { code: 'SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID' });
  await assert.rejects(first.resolve(selected[0].ref, { accountId: 'account-a', taskId: 'task-2' }), { code: 'SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID' });

  const restored = createScheduledBroadcastAttachmentStore({ fs, storePath, randomBytes });
  const originalReadFile = fs.readFile.bind(fs);
  let releaseRead;
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  let gated = true;
  fs.readFile = async (...args) => {
    if (gated && path.resolve(String(args[0])) === storePath) await readGate;
    return originalReadFile(...args);
  };
  const initPromise = restored.init();
  const concurrentResolve = restored.resolve(selected[1].ref, { accountId: 'account-a', taskId: 'task-1' });
  gated = false;
  releaseRead();
  await initPromise;
  const afterConcurrentInit = await concurrentResolve;
  assert.equal(afterConcurrentInit.filePath, path.resolve('docs/b.txt'), 'concurrent callers must await the same initialization promise');
  assert.equal(restored.size(), 2, 'persistent refs must survive store reconstruction');
  fs.readFile = originalReadFile;

  fs.mutate('docs/a.pdf', 'CHANGED', 99);
  await assert.rejects(
    restored.resolve(selected[0].ref, { accountId: 'account-a', taskId: 'task-1' }),
    { code: 'SCHEDULED_BROADCAST_ATTACHMENT_CHANGED' },
    'changed source file must fail closed',
  );

  fs.failRenameOnce();
  await assert.rejects(restored.cleanupTask('account-a', 'task-1'), { code: 'EIO' });
  assert.equal(restored.size(), 2, 'failed cleanup persistence must roll back in-memory deletion');
  const stillThere = await restored.resolve(selected[1].ref, { accountId: 'account-a', taskId: 'task-1' });
  assert.equal(stillThere.filePath, path.resolve('docs/b.txt'));

  const removed = await restored.cleanupTask('account-a', 'task-1');
  assert.equal(removed, 2);
  assert.equal(restored.size(), 0);
  await assert.rejects(restored.resolve(selected[1].ref, { accountId: 'account-a', taskId: 'task-1' }), { code: 'SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID' });

  const restartedAfterCleanup = createScheduledBroadcastAttachmentStore({ fs, storePath, randomBytes });
  await restartedAfterCleanup.init();
  assert.equal(restartedAfterCleanup.size(), 0, 'cleanup must persist across restart');

  fs.seed('docs/large.bin', '01234567890', 30);
  const limited = createScheduledBroadcastAttachmentStore({
    fs,
    storePath: path.resolve('userdata/limited.json'),
    randomBytes,
    limits: { maxFiles: 2, maxFileBytes: 10, maxTotalBytes: 10 },
  });
  await assert.rejects(
    limited.registerPaths({ accountId: 'account-a', taskId: 'task-limit', filePaths: ['docs/large.bin'] }),
    { code: 'BROADCAST_FILE_SIZE_LIMIT' },
  );

  console.log('SCHEDULED_BROADCAST_ATTACHMENTS_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
