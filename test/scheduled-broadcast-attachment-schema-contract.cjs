'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createScheduledBroadcastAttachmentStore } = require('../src/scheduled-broadcast-attachments.cjs');

const CORRUPT = 'SCHEDULED_BROADCAST_ATTACHMENT_STORE_CORRUPT';

function makeStore(storePath, randomByte = 0x5a) {
  return createScheduledBroadcastAttachmentStore({
    fs,
    storePath,
    randomBytes: () => Buffer.alloc(24, randomByte),
  });
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-scheduled-attachment-schema-'));
  try {
    const source = path.join(root, 'source.txt');
    await fs.writeFile(source, 'DATA', 'utf8');
    const canonicalPath = await fs.realpath(source);
    const stat = await fs.stat(canonicalPath);
    const validRef = 'a'.repeat(48);
    const validEntry = {
      ref: validRef,
      accountId: 'account-a',
      taskId: 'task-a',
      canonicalPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };

    const invalidRoots = [
      '',
      '{}',
      JSON.stringify({ version: 2, entries: [] }),
      JSON.stringify({ version: 1, entries: {} }),
      JSON.stringify({ version: 1, entries: [null] }),
      JSON.stringify({ version: 1, entries: [{ ...validEntry, size: String(validEntry.size) }] }),
      JSON.stringify({ version: 1, entries: [validEntry, { ...validEntry, taskId: 'task-b' }] }),
    ];

    for (let index = 0; index < invalidRoots.length; index += 1) {
      const storePath = path.join(root, `invalid-${index}.json`);
      await fs.writeFile(storePath, invalidRoots[index], 'utf8');
      const store = makeStore(storePath, 0x10 + index);
      await assert.rejects(
        () => store.init(),
        error => error?.code === CORRUPT,
        `invalid persisted registry case ${index} must fail closed`,
      );
    }

    // A valid record followed by an invalid record must not partially populate
    // canonical memory, and a mutating API must not rewrite the broken registry.
    const retryPath = path.join(root, 'retry.json');
    const mixedState = JSON.stringify({
      version: 1,
      entries: [validEntry, { ...validEntry, ref: 'b'.repeat(48), mtimeMs: 'invalid' }],
    });
    await fs.writeFile(retryPath, mixedState, 'utf8');
    const retryStore = makeStore(retryPath, 0x33);
    await assert.rejects(
      () => retryStore.registerPaths({ accountId: 'account-a', taskId: 'task-new', filePaths: [source] }),
      error => error?.code === CORRUPT,
      'mutation entry must fail before rewriting a partially decoded registry',
    );
    assert.equal(await fs.readFile(retryPath, 'utf8'), mixedState, 'failed schema initialization must leave durable bytes unchanged');

    await fs.writeFile(retryPath, JSON.stringify({ version: 1, entries: [] }), 'utf8');
    await retryStore.init();
    assert.equal(retryStore.size(), 0, 'retry after repairing disk state must not retain entries decoded before the prior failure');
    const created = await retryStore.registerPaths({ accountId: 'account-a', taskId: 'task-new', filePaths: [source] });
    assert.equal(created.length, 1);
    const retryPersisted = JSON.parse(await fs.readFile(retryPath, 'utf8'));
    assert.equal(retryPersisted.version, 1);
    assert.equal(retryPersisted.entries.length, 1);

    // Unknown future fields are allowed; required current fields remain strict.
    const forwardPath = path.join(root, 'forward.json');
    await fs.writeFile(forwardPath, JSON.stringify({
      version: 1,
      entries: [{ ...validEntry, futureMetadata: { owner: 'future' } }],
      futureRootMetadata: { format: 2 },
    }), 'utf8');
    const forwardStore = makeStore(forwardPath, 0x44);
    await forwardStore.init();
    assert.equal(forwardStore.size(), 1);
    const resolved = await forwardStore.resolve(validRef, { accountId: 'account-a', taskId: 'task-a' });
    assert.equal(resolved.filePath, canonicalPath);
    assert.equal(resolved.size, stat.size);

    console.log('SCHEDULED_BROADCAST_ATTACHMENT_SCHEMA_CONTRACT_OK');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
