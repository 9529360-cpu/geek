'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createScheduledBroadcastAttachmentStore } = require('../src/scheduled-broadcast-attachments.cjs');

function fakeFs() {
  const files = new Map();
  const key = value => path.resolve(String(value));
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    seed(file, text, mtimeMs) { const data = Buffer.from(text); files.set(key(file), { data, size: data.length, mtimeMs, real: true }); },
    async realpath(file) { const record = files.get(key(file)); if (!record?.real) throw enoent(); return key(file); },
    async stat(file) { const record = files.get(key(file)); if (!record) throw enoent(); return { size: record.size, mtimeMs: record.mtimeMs, isFile: () => record.real === true }; },
    async mkdir() {},
    async readFile(file, encoding) { const record = files.get(key(file)); if (!record) throw enoent(); return encoding ? Buffer.from(record.data).toString(encoding) : Buffer.from(record.data); },
    async writeFile(file, data) { const buffer = Buffer.from(String(data)); files.set(key(file), { data: buffer, size: buffer.length, mtimeMs: Date.now(), real: false }); },
    async rename(from, to) { const record = files.get(key(from)); if (!record) throw enoent(); files.set(key(to), { ...record }); files.delete(key(from)); },
  };
}

(async () => {
  const fs = fakeFs();
  const storePath = path.resolve('userdata/scheduled.json');
  fs.seed('files/a.txt', 'A', 1);
  fs.seed('files/b.txt', 'B', 2);
  let token = 0;
  const randomBytes = () => Buffer.alloc(24, ++token);
  const store = createScheduledBroadcastAttachmentStore({ fs, storePath, randomBytes });

  await store.registerPaths({ accountId: 'A', taskId: 'A-1', filePaths: ['files/a.txt'] });
  await store.registerPaths({ accountId: 'B', taskId: 'B-1', filePaths: ['files/b.txt'] });
  assert.equal(store.listTask('A', 'A-1').length, 1);
  assert.equal(store.listTask('B', 'B-1').length, 1);

  const removed = await store.cleanupAccount('A');
  assert.equal(removed, 1);
  assert.equal(store.listTask('A', 'A-1').length, 0);
  assert.equal(store.listTask('B', 'B-1').length, 1, 'cleaning A must not remove B refs');

  const restarted = createScheduledBroadcastAttachmentStore({ fs, storePath, randomBytes });
  await restarted.init();
  assert.equal(restarted.listTask('A', 'A-1').length, 0, 'deleted account refs must remain absent after restart');
  assert.equal(restarted.listTask('B', 'B-1').length, 1, 'other account refs must survive restart');

  console.log('SCHEDULED_BROADCAST_ACCOUNT_CLEANUP_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
