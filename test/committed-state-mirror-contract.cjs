'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCommittedStateMirror } = require('../src/committed-state-mirror.cjs');

function failingFs(realFs, targets = {}) {
  const state = { proofRename: 0, backupRename: 0, primaryRename: 0 };
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
        if (targets.filePath && to === targets.filePath && state.primaryRename > 0) {
          state.primaryRename -= 1;
          throw Object.assign(new Error('synthetic primary rename failure'), { code: 'EACCES' });
        }
        return realFs.rename(from, to);
      },
    },
    failProofRename() { state.proofRename += 1; },
    failBackupRename() { state.backupRename += 1; },
    failPrimaryRename(count = 1) { state.primaryRename += Math.max(1, count | 0); },
  };
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-committed-mirror-'));
  try {
    // A fresh store has no proof-backed generation to disambiguate a candidate
    // primary from an authentic legacy primary. If first-proof publication fails,
    // the rejected candidate must therefore never become visible at the live path.
    const freshPath = path.join(root, 'fresh.json');
    const freshBackupPath = `${freshPath}.bak`;
    const freshCommitPath = `${freshPath}.commit`;
    const freshFs = failingFs(fs, { filePath: freshPath, backupPath: freshBackupPath, commitPath: freshCommitPath });
    const fresh = createCommittedStateMirror({
      fs: freshFs.adapter,
      filePath: freshPath,
      backupPath: freshBackupPath,
    });
    freshFs.failProofRename();
    await assert.rejects(() => fresh.commit('first-candidate', { initializing: true }), error => error?.code === 'EACCES');
    await assert.rejects(() => fs.readFile(freshPath, 'utf8'), error => error?.code === 'ENOENT');
    const freshRestart = createCommittedStateMirror({ fs, filePath: freshPath, backupPath: freshBackupPath });
    const freshLoad = await freshRestart.load(value => value);
    assert.equal(freshLoad.status, 'empty', 'failed first-proof publication must restart as genuinely empty state');

    // The same rule applies while migrating a real legacy primary: a rejected
    // normalized candidate must not overwrite the only pre-protocol authority.
    const migrationPath = path.join(root, 'migration.json');
    const migrationBackupPath = `${migrationPath}.bak`;
    const migrationCommitPath = `${migrationPath}.commit`;
    await fs.writeFile(migrationPath, 'legacy-authority', 'utf8');
    const migrationFs = failingFs(fs, {
      filePath: migrationPath,
      backupPath: migrationBackupPath,
      commitPath: migrationCommitPath,
    });
    const migration = createCommittedStateMirror({
      fs: migrationFs.adapter,
      filePath: migrationPath,
      backupPath: migrationBackupPath,
    });
    migrationFs.failProofRename();
    await assert.rejects(() => migration.commit('normalized-candidate', { initializing: true }), error => error?.code === 'EACCES');
    assert.equal(await fs.readFile(migrationPath, 'utf8'), 'legacy-authority');
    const migrationRestart = createCommittedStateMirror({ fs, filePath: migrationPath, backupPath: migrationBackupPath });
    const migrationLoad = await migrationRestart.load(value => value);
    assert.equal(migrationLoad.status, 'legacy');
    assert.equal(migrationLoad.state, 'legacy-authority', 'legacy authority must survive a failed first-proof migration');

    // After the first proof publishes, primary materialization is post-commit.
    // Even persistent primary rename failure must resolve as a committed write and
    // remain recoverable through the already-fsynced proof-matching backup.
    const committedInitPath = path.join(root, 'committed-init.json');
    const committedInitBackupPath = `${committedInitPath}.bak`;
    const committedInitCommitPath = `${committedInitPath}.commit`;
    const committedInitFs = failingFs(fs, {
      filePath: committedInitPath,
      backupPath: committedInitBackupPath,
      commitPath: committedInitCommitPath,
    });
    const committedInitErrors = [];
    const committedInit = createCommittedStateMirror({
      fs: committedInitFs.adapter,
      filePath: committedInitPath,
      backupPath: committedInitBackupPath,
      onPostCommitError(error, meta) {
        committedInitErrors.push({ code: error?.code, phase: meta?.phase });
      },
    });
    committedInitFs.failPrimaryRename(2);
    await committedInit.commit('proof-committed', { initializing: true });
    assert.deepEqual(committedInitErrors.slice(0, 2), [
      { code: 'EACCES', phase: 'primary-mirror' },
      { code: 'EACCES', phase: 'primary-recovery' },
    ]);
    await assert.rejects(() => fs.readFile(committedInitPath, 'utf8'), error => error?.code === 'ENOENT');
    assert.equal(await fs.readFile(committedInitBackupPath, 'utf8'), 'proof-committed');
    const committedInitRestart = createCommittedStateMirror({ fs, filePath: committedInitPath, backupPath: committedInitBackupPath });
    const committedInitLoad = await committedInitRestart.load(value => value);
    assert.equal(committedInitLoad.status, 'recovered');
    assert.equal(committedInitLoad.state, 'proof-committed');
    assert.equal(await fs.readFile(committedInitPath, 'utf8'), 'proof-committed');

    const filePath = path.join(root, 'state.json');
    const backupPath = `${filePath}.bak`;
    const commitPath = `${filePath}.commit`;
    const fsh = failingFs(fs, { filePath, backupPath, commitPath });
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

    // Candidate primary may become visible before the proof rename once an older
    // proof exists. If proof publication fails, restart must restore the old
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
