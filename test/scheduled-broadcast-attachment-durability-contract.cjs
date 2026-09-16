'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createScheduledBroadcastAttachmentStore } = require('../src/scheduled-broadcast-attachments.cjs');

function enoent() {
  return Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
}

function createDurabilityFs({ failFileSyncOnce = false, failDirectorySync = false } = {}) {
  const files = new Map();
  const events = [];
  let shouldFailFileSync = failFileSyncOnce;

  const key = value => path.resolve(String(value));
  const sourcePath = key('fixtures/scheduled-durable.txt');
  const sourceData = Buffer.from('durable-data');
  files.set(sourcePath, {
    data: sourceData,
    size: sourceData.length,
    mtimeMs: 1234,
    isRealFile: true,
  });

  const adapter = {
    async realpath(value) {
      const absolute = key(value);
      if (!files.get(absolute)?.isRealFile) throw enoent();
      return absolute;
    },
    async stat(value) {
      const record = files.get(key(value));
      if (!record) throw enoent();
      return {
        size: record.size,
        mtimeMs: record.mtimeMs,
        isFile: () => record.isRealFile === true,
      };
    },
    async readFile(value, encoding) {
      const record = files.get(key(value));
      if (!record) throw enoent();
      const buffer = Buffer.from(record.data);
      return encoding ? buffer.toString(encoding) : buffer;
    },
    async writeFile() {
      throw new Error('durable production path must use fs.open, not writeFile fallback');
    },
    async mkdir(value) {
      events.push(`mkdir:${key(value)}`);
    },
    async open(value, flags) {
      const absolute = key(value);
      if (flags === 'w') {
        events.push(`open-file:${absolute}`);
        return {
          async writeFile(content) {
            events.push(`write-file:${absolute}`);
            const data = Buffer.from(String(content));
            files.set(absolute, {
              data,
              size: data.length,
              mtimeMs: 2000,
              isRealFile: false,
            });
          },
          async sync() {
            events.push(`sync-file:${absolute}`);
            if (shouldFailFileSync) {
              shouldFailFileSync = false;
              throw Object.assign(new Error('synthetic file fsync failure'), { code: 'EIO' });
            }
          },
          async close() {
            events.push(`close-file:${absolute}`);
          },
        };
      }
      if (flags === 'r') {
        events.push(`open-dir:${absolute}`);
        return {
          async sync() {
            events.push(`sync-dir:${absolute}`);
            if (failDirectorySync) throw Object.assign(new Error('synthetic directory fsync unsupported'), { code: 'EPERM' });
          },
          async close() {
            events.push(`close-dir:${absolute}`);
          },
        };
      }
      throw new Error(`unexpected open flags: ${flags}`);
    },
    async rename(from, to) {
      const source = key(from);
      const target = key(to);
      events.push(`rename:${source}->${target}`);
      const record = files.get(source);
      if (!record) throw enoent();
      files.set(target, { ...record });
      files.delete(source);
    },
    async rm(value) {
      const absolute = key(value);
      events.push(`rm:${absolute}`);
      files.delete(absolute);
    },
  };

  return { adapter, files, events, sourcePath, key };
}

(async () => {
  const storePath = path.resolve('userdata/scheduled-broadcast-attachments.json');
  const tempPath = `${storePath}.tmp`;
  const directory = path.dirname(storePath);

  {
    const harness = createDurabilityFs();
    const store = createScheduledBroadcastAttachmentStore({
      fs: harness.adapter,
      storePath,
      randomBytes: () => Buffer.alloc(24, 0x31),
    });

    const created = await store.registerPaths({
      accountId: 'account-a',
      taskId: 'task-a',
      filePaths: [harness.sourcePath],
    });
    assert.equal(created.length, 1);
    assert.equal(store.size(), 1);

    const expectedCommitEvents = [
      `mkdir:${directory}`,
      `open-file:${tempPath}`,
      `write-file:${tempPath}`,
      `sync-file:${tempPath}`,
      `close-file:${tempPath}`,
      `rename:${tempPath}->${storePath}`,
      `open-dir:${directory}`,
      `sync-dir:${directory}`,
      `close-dir:${directory}`,
    ];
    assert.deepEqual(harness.events, expectedCommitEvents,
      'durable registry commit must fsync and close the complete sibling temp before rename, then fsync the parent directory');
    assert.equal(harness.files.has(tempPath), false, 'published temp must not remain after rename');
    assert.equal(harness.files.has(storePath), true, 'successful durable mutation must publish the registry');
  }

  {
    const harness = createDurabilityFs({ failFileSyncOnce: true });
    const store = createScheduledBroadcastAttachmentStore({
      fs: harness.adapter,
      storePath,
      randomBytes: () => Buffer.alloc(24, 0x32),
    });

    await assert.rejects(
      () => store.registerPaths({ accountId: 'account-a', taskId: 'task-a', filePaths: [harness.sourcePath] }),
      error => error?.code === 'EIO',
      'temp-file fsync failure must reject the mutation before the registry is published',
    );
    assert.equal(store.size(), 0, 'failed precommit durability must roll canonical memory back');
    assert.equal(harness.files.has(storePath), false, 'failed fsync must not rename an unflushed temp into authority');
    assert.equal(harness.files.has(tempPath), false, 'failed precommit temp must be cleaned best effort');
    assert.equal(harness.events.some(event => event.startsWith('rename:')), false, 'rename must not run after file fsync failure');
    assert.deepEqual(harness.events.slice(-2), [
      `close-file:${tempPath}`,
      `rm:${tempPath}`,
    ], 'handle close and temp cleanup must still run after file fsync failure');
  }

  {
    const harness = createDurabilityFs({ failDirectorySync: true });
    const store = createScheduledBroadcastAttachmentStore({
      fs: harness.adapter,
      storePath,
      randomBytes: () => Buffer.alloc(24, 0x33),
    });

    const created = await store.registerPaths({
      accountId: 'account-a',
      taskId: 'task-a',
      filePaths: [harness.sourcePath],
    });
    assert.equal(created.length, 1, 'unsupported directory fsync must remain best effort for Windows compatibility');
    assert.equal(store.size(), 1);
    assert.equal(harness.files.has(storePath), true);
    assert.ok(harness.events.indexOf(`rename:${tempPath}->${storePath}`) < harness.events.indexOf(`sync-dir:${directory}`),
      'directory durability attempt must happen only after atomic publication');
    assert.equal(harness.events.at(-1), `close-dir:${directory}`, 'directory handle must close after a best-effort fsync failure');
  }

  console.log('SCHEDULED_BROADCAST_ATTACHMENT_DURABILITY_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
