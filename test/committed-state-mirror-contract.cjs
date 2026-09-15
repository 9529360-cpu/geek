'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCommittedStateMirror } = require('../src/committed-state-mirror.cjs');

function failingFs(realFs, targets = {}) {
  const state = { proofRename: 0, backupRename: 0 };
  return {
    adapter: {
      readFile: (...args) => realFs.readFile(...args),
      writeFile: (...args) => realFs.writeFile(...args),
      mkdir: (...args) => realFs.mkdir(...args),
      rm: (...args) => realFs.rm(...args),
      open: (...args) => realFs.open(...args),
      async rename(from, to) {
        if (targets.commitPath && to === targets.commitPath && state.proofRename > 0) {
          state.proofRename -= 1;
          throw Object.assign(new Error('synthetic commit-proof rename failure'), { code: 'EACCES' });
        }
        if (targets.backupPath && to === targets.backupPath && state.backupRename > 0) {
          state.backupRename -= 1;
          throw Object.assign(new Error('synthetic backup rename failure'), { code: 'EACCES' });
        }
        return realFs.rename(from, to);
      },
    },
    failProofRename() { state.proofRename += 1; },
    failBackupRename() { state.backupRename += 1; },
  };
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-committed-mirror-'));
  try {
    const filePath = path.join(root, 'state.json');
    const backupPath = `${filePath}.bak`;
    const commitPath = `${filePath}.commit`;
    const fsh = failingFs(fs, { backupPath, commitPath });
    const postCommitErrors = [];
    const mirror = createCommittedStateMirror({
      fs: fsh.adapter,
      filePath,
      backupPath,
      onPostCommitError(error, meta) { postCommitErrors.push({ code: error?.code, phase: meta?.phase }); },
    });

    await mirror.commit('old', { initializing: true });
    assert.equal(await fs.readFile(filePath, 'utf8'), 'old');
    assert.equal(await fs.readFile(backupPath, 'utf8'), 'old');
    assert.match(await fs.readFile(commitPath, 'utf8'), /^[\s\S]*"sha256":"[0-9a-f]{64}"[\s\S]*$/);

    // Candidate primary may become visible before the proof rename. If proof
    // publication fails, the operation rejects and restart must restore the old
    // proof-authorized snapshot rather than promote the candidate.
    fsh.failProofRename();
    await assert.rejects(() => mirror.commit('uncommitted'), error => error?.code === 'EACCES');
    assert.equal(await fs.readFile(filePath, 'utf8'), 'uncommitted', 'fixture must reach the primary-before-proof crash boundary');
    const afterRejected = createCommittedStateMirror({ fs, filePath, backupPath });
    const rejectedLoad = await afterRejected.load(value => value);
    assert.equal(rejectedLoad.status, 'recovered');
    assert.equal(rejectedLoad.state, 'old');
    assert.equal(await fs.readFile(filePath, 'utf8'), 'old', 'old committed snapshot must be restored after rejected candidate');

    // Once proof publication succeeds, the new snapshot is committed. Failure
    // to promote the staged mirror to the stable .bak name must not roll back or
    // reject the committed operation; the fsynced staged mirror remains recovery authority.
    fsh.failBackupRename();
    await mirror.commit('new');
    assert.deepEqual(postCommitErrors.at(-1), { code: 'EACCES', phase: 'backup-mirror' });
    assert.equal(await fs.readFile(filePath, 'utf8'), 'new');
    assert.equal(await fs.readFile(`${backupPath}.tmp`, 'utf8'), 'new');
    await fs.rm(filePath);
    const afterCommitted = createCommittedStateMirror({ fs, filePath, backupPath });
    const committedLoad = await afterCommitted.load(value => value);
    assert.equal(committedLoad.status, 'recovered');
    assert.equal(committedLoad.state, 'new');
    assert.equal(await fs.readFile(filePath, 'utf8'), 'new');
    assert.equal(await fs.readFile(backupPath, 'utf8'), 'new', 'staged committed mirror must be promoted during recovery');

    // A legacy valid primary remains the upgrade authority and can be migrated.
    const legacyPath = path.join(root, 'legacy.json');
    await fs.writeFile(legacyPath, 'latest-primary', 'utf8');
    await fs.writeFile(`${legacyPath}.bak`, 'stale-backup', 'utf8');
    const legacy = createCommittedStateMirror({ fs, filePath: legacyPath });
    const legacyLoad = await legacy.load(value => value);
    assert.equal(legacyLoad.status, 'legacy');
    assert.equal(legacyLoad.state, 'latest-primary');

    // But an unproven legacy backup must never resurrect state when primary is gone.
    await fs.rm(legacyPath);
    const legacyMissing = createCommittedStateMirror({ fs, filePath: legacyPath });
    await assert.rejects(
      () => legacyMissing.load(value => value),
      error => error?.code === 'COMMITTED_STATE_RECOVERY_UNSAFE',
    );

    console.log('COMMITTED_STATE_MIRROR_CONTRACT_OK');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
