'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createScheduledBroadcastAttachmentStore } = require('../src/scheduled-broadcast-attachments.cjs');

function createControlledFs() {
  const files = new Map();
  const key = value => path.resolve(String(value));
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  let firstRenameEnteredResolve;
  let releaseFirstRenameResolve;
  const firstRenameEntered = new Promise(resolve => { firstRenameEnteredResolve = resolve; });
  const releaseFirstRename = new Promise(resolve => { releaseFirstRenameResolve = resolve; });
  let renameCount = 0;
  return {
    files,
    firstRenameEntered,
    releaseFirstRename: () => releaseFirstRenameResolve(),
    seed(file, data, mtimeMs) {
      const buffer = Buffer.from(data);
      files.set(key(file), { data: buffer, size: buffer.length, mtimeMs, isRealFile: true });
    },
    async realpath(value) {
      const absolute = key(value);
      if (!files.get(absolute)?.isRealFile) throw enoent();
      return absolute;
    },
    async stat(value) {
      const record = files.get(key(value));
      if (!record) throw enoent();
      return { size: record.size, mtimeMs: record.mtimeMs, isFile: () => record.isRealFile === true };
    },
    async mkdir() {},
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
      renameCount += 1;
      if (renameCount === 1) {
        firstRenameEnteredResolve();
        await releaseFirstRename;
        files.delete(key(from));
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
  const fs = createControlledFs();
  fs.seed('docs/a.pdf', 'A', 1);
  fs.seed('docs/b.pdf', 'B', 2);
  const storePath = path.resolve('userdata/concurrent-scheduled.json');
  let token = 0;
  const randomBytes = () => Buffer.alloc(24, ++token);
  const store = createScheduledBroadcastAttachmentStore({ fs, storePath, randomBytes });

  const first = store.registerPaths({ accountId: 'A', taskId: 'task-a', filePaths: ['docs/a.pdf'] });
  await fs.firstRenameEntered;
  const second = store.registerPaths({ accountId: 'B', taskId: 'task-b', filePaths: ['docs/b.pdf'] });

  // While A's durable write is unresolved, B must not mutate the shared Map yet.
  // The pre-fix implementation changed entries before joining the write queue and
  // would expose size=2 here, allowing B to snapshot A's eventually-failed mutation.
  await Promise.resolve();
  assert.equal(store.size(), 1, 'second mutation must wait for the first mutation+write transaction');

  fs.releaseFirstRename();
  await assert.rejects(first, { code: 'EIO' });
  const bRefs = await second;
  assert.equal(bRefs.length, 1);
  assert.equal(store.size(), 1, 'failed A must be rolled back before B mutates and persists');
  assert.equal(store.listTask('A', 'task-a').length, 0);
  assert.equal(store.listTask('B', 'task-b').length, 1);

  const restarted = createScheduledBroadcastAttachmentStore({ fs, storePath, randomBytes });
  await restarted.init();
  assert.equal(restarted.listTask('A', 'task-a').length, 0, 'failed mutation must not be resurrected from a later snapshot');
  assert.equal(restarted.listTask('B', 'task-b').length, 1, 'successful later mutation must survive restart');

  console.log('SCHEDULED_BROADCAST_ATTACHMENT_CONCURRENCY_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
