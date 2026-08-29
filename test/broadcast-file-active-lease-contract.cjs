'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createBroadcastFileRegistry } = require('../src/broadcast-files.cjs');

function fakeFs() {
  const filePath = path.resolve('lease.txt');
  return {
    async realpath(value) {
      assert.equal(path.resolve(value), filePath);
      return filePath;
    },
    async stat(value) {
      assert.equal(path.resolve(value), filePath);
      return { size: 5, mtimeMs: 10, isFile: () => true };
    },
    async open() { throw new Error('not used'); },
  };
}

(async () => {
  let now = 1000;
  let tokenCounter = 0;
  const registry = createBroadcastFileRegistry({
    fs: fakeFs(),
    now: () => now,
    randomBytes: () => Buffer.alloc(24, ++tokenCounter),
    limits: { tokenTtlMs: 100, maxRegistryEntries: 10 },
  });

  const [active] = await registry.registerSelection(['lease.txt'], 'owner-a');
  now = 1050;
  assert.equal((await registry.resolve(active.token, 'owner-a')).filePath, path.resolve('lease.txt'));
  now = 1120;
  assert.equal(
    (await registry.resolve(active.token, 'owner-a')).filePath,
    path.resolve('lease.txt'),
    'successful owner use must renew the idle lease beyond the original absolute expiry',
  );

  const [foreignProbe] = await registry.registerSelection(['lease.txt'], 'owner-a');
  now = 1170;
  await assert.rejects(registry.resolve(foreignProbe.token, 'owner-b'), { code: 'BROADCAST_FILE_TOKEN_INVALID' });
  now = 1221;
  await assert.rejects(
    registry.resolve(foreignProbe.token, 'owner-a'),
    { code: 'BROADCAST_FILE_TOKEN_EXPIRED' },
    'wrong-owner probes must not renew another renderer owner capability',
  );

  const [idle] = await registry.registerSelection(['lease.txt'], 'owner-a');
  now = 1322;
  await assert.rejects(
    registry.resolve(idle.token, 'owner-a'),
    { code: 'BROADCAST_FILE_TOKEN_EXPIRED' },
    'truly idle tokens must still expire',
  );

  console.log('BROADCAST_FILE_ACTIVE_LEASE_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
