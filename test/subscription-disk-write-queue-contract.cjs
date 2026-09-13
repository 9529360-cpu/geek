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
    let bothReadsResolve;
    let releaseReads;
    const bothReads = new Promise((resolve) => { bothReadsResolve = resolve; });
    const readRelease = new Promise((resolve) => { releaseReads = resolve; });
    fsp.readFile = async (file, ...args) => {
      if (path.resolve(file) === path.resolve(stateFile) && reads < 2) {
        reads += 1;
        if (reads === 2) bothReadsResolve();
        await readRelease;
      }
      return originalReadFile(file, ...args);
    };

    let activeRenames = 0;
    let maxActiveRenames = 0;
    let renameCalls = 0;
    fsp.rename = async (from, to) => {
      if (path.resolve(to) !== path.resolve(stateFile)) return originalRename(from, to);
      renameCalls += 1;
      activeRenames += 1;
      maxActiveRenames = Math.max(maxActiveRenames, activeRenames);
      try {
        for (let i = 0; i < 40 && activeRenames === 1; i += 1) await immediate();
        if (activeRenames > 1) {
          const error = new Error('simulated overlapping cold-load migration rename');
          error.code = 'EBUSY';
          throw error;
        }
        return await originalRename(from, to);
      } finally {
        activeRenames -= 1;
      }
    };

    const stateA = store.getState();
    const stateB = store.getState();
    await bothReads;
    releaseReads();
    const [a, b] = await Promise.all([stateA, stateB]);

    assert.equal(a.loggedIn, true);
    assert.equal(b.loggedIn, true);
    assert.equal(a.email, 'cold-load@example.invalid');
    assert.equal(b.email, 'cold-load@example.invalid');
    assert.equal(renameCalls, 2, 'fixture must exercise both concurrent cold-load disk rewrites');
    assert.equal(maxActiveRenames, 1, 'all physical subscription writes must share one serialized disk queue');

    fsp.readFile = originalReadFile;
    const disk = JSON.parse(await originalReadFile(stateFile, 'utf8'));
    assert.equal(disk.token, 'enc:cold-load-token', 'serialized compatibility rewrite must preserve encrypted token storage');
    assert.equal(disk.remaining_chars, 88);
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
