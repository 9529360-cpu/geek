'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cleanupPendingPartitions } = require('../src/exit-partition-cleanup.cjs');

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-exit-cleanup-'));
  try {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    await fsp.mkdir(first, { recursive: true });
    await fsp.mkdir(second, { recursive: true });
    await fsp.writeFile(path.join(first, 'cookie.db'), 'x');
    await fsp.writeFile(path.join(second, 'local-storage.db'), 'y');

    const pending = new Set([first, second]);
    const result = cleanupPendingPartitions(pending);
    assert.deepEqual(result, { attempted: 2, removed: 2, failed: 0 });
    assert.equal(fs.existsSync(first), false, 'first pending partition must be removed synchronously');
    assert.equal(fs.existsSync(second), false, 'second pending partition must be removed synchronously');
    assert.equal(pending.size, 0, 'successfully removed partitions should leave the pending set');

    const remaining = new Set(['locked-partition', 'removable-partition']);
    const simulated = cleanupPendingPartitions(remaining, {
      removeSync(target) {
        if (target === 'locked-partition') throw new Error('locked');
      }
    });
    assert.deepEqual(simulated, { attempted: 2, removed: 1, failed: 1 });
    assert.equal(remaining.has('locked-partition'), true, 'failed cleanup must remain pending');
    assert.equal(remaining.has('removable-partition'), false, 'successful cleanup must be removed from pending');

    const main = await fsp.readFile(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
    assert.match(main, /cleanupPendingPartitions\(pendingPartitionDeletions\)/, 'will-quit must use the synchronous cleanup helper');
    assert.doesNotMatch(main, /fs\.rmSync\(/, 'node:fs/promises must never be used for rmSync');
    assert.match(main, /pending-partition-exit-cleanup/, 'exit cleanup result must be recorded without logging directory paths');

    console.log('EXIT_PARTITION_CLEANUP_CONTRACT_OK');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
