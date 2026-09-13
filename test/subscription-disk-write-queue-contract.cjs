'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const ACCOUNT_NO = `GK-${'d'.repeat(32)}`;

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-disk-queue-'));
  const stateFile = path.join(dir, 'subscription.json');
  const originalReadFile = fsp.readFile;
  const originalRename = fsp.rename;

  try {
    await fsp.writeFile(stateFile, JSON.stringify({
      token: 'enc:cold-load-token',
      email: 'cold-load@example.invalid',
      user_id: 7,
      account_no: ACCOUNT_NO,
      account_ref: ACCOUNT_NO,
      remaining_chars: 88,
    }, null, 2), { encoding: 'utf8', mode: 0o600 });

    const store = createSubscriptionStore({ userDataDir: dir });
    store._injectCrypto({
      encrypt: (value) => String(value),
      decrypt: (value) => String(value),
    });

    let reads = 0;
    let firstReadStartedResolve;
    let releaseRead;
    const firstReadStarted = new Promise((resolve) => { firstReadStartedResolve = resolve; });
    const readRelease = new Promise((resolve) => { releaseRead = resolve; });
    fsp.readFile = async (file, ...args) => {
      if (path.resolve(file) === path.resolve(stateFile)) {
        reads += 1;
        if (reads === 1) {
          firstReadStartedResolve();
          await readRelease;
        }
      }
      return originalReadFile(file, ...args);
    };

    let activeRenames = 0;
    let maxActiveRenames = 0;
    let renameCalls = 0;
    let firstRenameStartedResolve;
    const firstRenameStarted = new Promise((resolve) => { firstRenameStartedResolve = resolve; });
    fsp.rename = async (from, to) => {
      if (path.resolve(to) !== path.resolve(stateFile)) return originalRename(from, to);
      renameCalls += 1;
      activeRenames += 1;
      maxActiveRenames = Math.max(maxActiveRenames, activeRenames);
      if (renameCalls === 1) firstRenameStartedResolve();
      try {
        for (let i = 0; i < 80 && activeRenames === 1; i += 1) await immediate();
        if (activeRenames > 1) {
          const error = new Error('simulated overlapping subscription disk rename');
          error.code = 'EBUSY';
          throw error;
        }
        return await originalRename(from, to);
      } finally {
        activeRenames -= 1;
      }
    };

    // Two cold readers arrive while the first physical read is blocked. They must share one load Promise.
    const stateA = store.getState();
    await firstReadStarted;
    const stateB = store.getState();
    await immediate();
    assert.equal(reads, 1, 'concurrent cold loads must single-flight one subscription.json read');
    releaseRead();

    // The cold-load compatibility rewrite begins; enqueue logout while its rename is still in flight.
    // Both physical writes must share the disk queue even though logout does not call load().
    await firstRenameStarted;
    const logoutPromise = store.logout();
    const [a, b] = await Promise.all([stateA, stateB]);
    await logoutPromise;

    assert.equal(a.loggedIn, true, 'read that began before logout may return the pre-logout committed state');
    assert.equal(b.loggedIn, true, 'single-flight peer must observe the same cold-load snapshot');
    assert.equal(a.email, 'cold-load@example.invalid');
    assert.equal(b.email, 'cold-load@example.invalid');
    assert.equal(reads, 1, 'cold-load single-flight must remain one physical read');
    assert.equal(renameCalls, 2, 'fixture must exercise cold-load rewrite followed by logout tombstone');
    assert.equal(maxActiveRenames, 1, 'all physical subscription writes must share one serialized disk queue');

    fsp.readFile = originalReadFile;
    assert.deepEqual(await store.getState(), { loggedIn: false }, 'logout must become the final in-memory authority');
    const disk = JSON.parse(await originalReadFile(stateFile, 'utf8'));
    assert.deepEqual(disk, {}, 'logout tombstone must be the final durable write after the cold-load rewrite');
  } finally {
    fsp.readFile = originalReadFile;
    fsp.rename = originalRename;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_DISK_WRITE_QUEUE_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
