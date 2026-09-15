'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createConfigStateStore } = require('../src/config-state.cjs');

function createStore(filePath) {
  return createConfigStateStore({
    fs,
    filePath,
    isEncryptionAvailable: () => true,
    encrypt: value => Buffer.from(String(value), 'utf8').toString('base64'),
    decrypt: value => Buffer.from(String(value), 'base64').toString('utf8'),
  });
}

function group(accountId, id) {
  return {
    ...(accountId === undefined ? {} : { accountId }),
    id,
    name: `Group ${id}`,
    chatIds: [`chat-${id}`],
  };
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-config-legacy-groups-'));
  const filePath = path.join(root, 'config.json');
  try {
    const store = createStore(filePath);
    await store.load();

    const emptyCleanup = await store.removeLegacyBroadcastGroupsForAccount('A');
    assert.deepEqual(
      { changed: emptyCleanup.changed, removed: emptyCleanup.removed },
      { changed: false, removed: 0 },
      'cleanup with no legacy records must be idempotent',
    );
    await assert.rejects(
      fs.stat(filePath),
      error => error?.code === 'ENOENT',
      'read-only cleanup must not materialize a missing Config State',
    );

    assert.throws(
      () => store.removeOrphanedLegacyBroadcastGroups(),
      /liveAccountIds iterable is required/,
      'startup orphan cleanup must fail closed when authoritative Account State owners are missing',
    );
    assert.throws(
      () => store.removeOrphanedLegacyBroadcastGroups('B'),
      /liveAccountIds iterable is required/,
      'a string must not be accepted as an accidental iterable owner set',
    );

    await store.update({
      theme: 'light',
      lockPassword: 'screen-secret',
      password: 'proxy-secret',
      broadcastGroups: [
        group('A', 'a-1'),
        group('B', 'b-1'),
        group(undefined, 'legacy-unowned'),
        group('C', 'orphan-c'),
      ],
    });

    const deleteA = await store.removeLegacyBroadcastGroupsForAccount('A');
    assert.equal(deleteA.changed, true, 'delete-before-migration cleanup must mutate legacy Config State');
    assert.equal(deleteA.removed, 1, 'only explicit records owned by the deleted account may be removed');
    assert.deepEqual(
      deleteA.snapshot.broadcastGroups.map(item => item.id),
      ['b-1', 'legacy-unowned', 'orphan-c'],
      'other-account and unowned compatibility records must survive account cleanup',
    );

    const deleteAAgain = await store.removeLegacyBroadcastGroupsForAccount('A');
    assert.equal(deleteAAgain.changed, false, 'replayed account cleanup must be harmless');
    assert.equal(deleteAAgain.removed, 0, 'replayed cleanup must not manufacture work');

    await Promise.all([
      store.update({ messageSound: false }),
      store.removeLegacyBroadcastGroupsForAccount('missing-account'),
    ]);
    assert.equal(store.getSnapshot().messageSound, false, 'cleanup must serialize behind ordinary Config State mutations');

    const orphanCleanup = await store.removeOrphanedLegacyBroadcastGroups(['B']);
    assert.equal(orphanCleanup.changed, true, 'startup reconciliation must remove explicit owners that no longer exist');
    assert.equal(orphanCleanup.removed, 1, 'startup reconciliation must remove only orphaned explicit owners');
    assert.deepEqual(
      orphanCleanup.snapshot.broadcastGroups.map(item => item.id),
      ['b-1', 'legacy-unowned'],
      'startup reconciliation must preserve live-account and unowned legacy records',
    );

    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.deepEqual(
      persisted.broadcastGroups.map(item => item.id),
      ['b-1', 'legacy-unowned'],
      'cleanup must persist through the Config State owner',
    );
    assert.match(persisted.lockPassword, /^enc:/, 'legacy cleanup must preserve encrypted lock-password persistence');
    assert.match(persisted.password, /^enc:/, 'legacy cleanup must preserve encrypted proxy-password persistence');
    assert.notEqual(persisted.lockPassword, 'screen-secret', 'cleanup must never rewrite lock password in plaintext');
    assert.notEqual(persisted.password, 'proxy-secret', 'cleanup must never rewrite proxy password in plaintext');

    const restarted = createStore(filePath);
    const restored = await restarted.load();
    assert.deepEqual(
      restored.broadcastGroups.map(item => item.id),
      ['b-1', 'legacy-unowned'],
      'cleaned Config State must remain stable after restart',
    );
    assert.equal(restored.lockPassword, 'screen-secret');
    assert.equal(restored.password, 'proxy-secret');

    console.log('CONFIG_LEGACY_BROADCAST_GROUP_CLEANUP_CONTRACT_OK');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
