'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createBroadcastFileRegistry } = require('../src/broadcast-files.cjs');

function record(size = 1, mtimeMs = 1) {
  return { size, mtimeMs, isFile: () => true };
}

(async () => {
  const files = new Map([
    [path.resolve('a1.txt'), record(1, 11)],
    [path.resolve('a2.txt'), record(1, 12)],
    [path.resolve('b1.txt'), record(1, 21)],
    [path.resolve('b2.txt'), record(1, 22)],
    [path.resolve('c1.txt'), record(1, 31)],
  ]);
  let firstStageStarts = 0;
  let releaseStageBarrier;
  const stageBarrier = new Promise(resolve => { releaseStageBarrier = resolve; });

  const fs = {
    async realpath(value) {
      const absolute = path.resolve(value);
      if (!files.has(absolute)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      if (absolute.endsWith(`${path.sep}a1.txt`) || absolute.endsWith(`${path.sep}b1.txt`)) {
        firstStageStarts += 1;
        if (firstStageStarts === 2) releaseStageBarrier();
        await Promise.race([
          stageBarrier,
          new Promise((_, reject) => setTimeout(() => reject(new Error('file staging was serialized before admission')), 1000)),
        ]);
      }
      return absolute;
    },
    async stat(value) {
      const item = files.get(path.resolve(value));
      if (!item) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return item;
    },
    async open() { throw new Error('open is not used by this contract'); },
  };

  let tokenCounter = 0;
  const registry = createBroadcastFileRegistry({
    fs,
    randomBytes: () => Buffer.alloc(24, ++tokenCounter),
    limits: {
      maxFiles: 2,
      maxFileBytes: 10,
      maxTotalBytes: 20,
      maxImportBytes: 20,
      tokenTtlMs: 10000,
      maxRegistryEntries: 3,
    },
  });

  const owners = ['owner-a', 'owner-b'];
  const results = await Promise.allSettled([
    registry.registerSelection(['a1.txt', 'a2.txt'], owners[0]),
    registry.registerSelection(['b1.txt', 'b2.txt'], owners[1]),
  ]);

  assert.equal(firstStageStarts, 2, 'concurrent selections must be allowed to stage files in parallel before admission');
  const fulfilledIndexes = results.map((result, index) => result.status === 'fulfilled' ? index : -1).filter(index => index >= 0);
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilledIndexes.length, 1, 'only one two-file selection may commit into a three-entry registry');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, 'BROADCAST_FILE_REGISTRY_LIMIT');
  assert.equal(registry.size(), 2, 'concurrent admission must never exceed maxRegistryEntries');

  const winnerIndex = fulfilledIndexes[0];
  const winner = results[winnerIndex].value;
  assert.equal(registry.releaseMany(winner.map(file => file.token), owners[winnerIndex]), 2);
  assert.equal(registry.size(), 0);

  const later = await registry.registerSelection(['c1.txt'], 'owner-c');
  assert.equal(later.length, 1, 'a rejected admission must not poison the commit queue');
  assert.equal(registry.size(), 1);

  console.log('BROADCAST_FILE_REGISTRY_CONCURRENCY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
