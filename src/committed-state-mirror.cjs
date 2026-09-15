'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const COMMIT_PROOF_VERSION = 1;
const SHA256_RE = /^[0-9a-f]{64}$/;

function createMirrorError(code, message, cause) {
  const error = new Error(message || code);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function createCommittedStateMirror(options = {}) {
  const fs = options.fs;
  const filePath = String(options.filePath || '');
  const backupPath = String(options.backupPath || (filePath ? `${filePath}.bak` : ''));
  const temporaryFile = String(options.temporaryFile || (filePath ? `${filePath}.tmp` : ''));
  const backupTemporaryFile = String(options.backupTemporaryFile || (backupPath ? `${backupPath}.tmp` : ''));
  const commitPath = String(options.commitPath || (filePath ? `${filePath}.commit` : ''));
  const commitTemporaryFile = String(options.commitTemporaryFile || (commitPath ? `${commitPath}.tmp` : ''));
  const onPostCommitError = typeof options.onPostCommitError === 'function' ? options.onPostCommitError : () => {};

  if (!fs || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function' || typeof fs.rename !== 'function' || typeof fs.mkdir !== 'function') {
    throw new TypeError('Committed state mirror fs adapter is required');
  }
  if (!filePath) throw new TypeError('Committed state mirror filePath is required');

  const directory = path.dirname(filePath);

  function hashSnapshot(content) {
    return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
  }

  function proofText(content) {
    return `${JSON.stringify({ version: COMMIT_PROOF_VERSION, sha256: hashSnapshot(content) })}\n`;
  }

  function parseProof(content) {
    let parsed;
    try {
      parsed = JSON.parse(String(content || ''));
    } catch (cause) {
      throw createMirrorError('COMMITTED_STATE_PROOF_INVALID', '状态提交证明损坏', cause);
    }
    const sha256 = String(parsed?.sha256 || '').toLowerCase();
    if (parsed?.version !== COMMIT_PROOF_VERSION || !SHA256_RE.test(sha256)) {
      throw createMirrorError('COMMITTED_STATE_PROOF_INVALID', '状态提交证明格式不受支持');
    }
    return Object.freeze({ version: COMMIT_PROOF_VERSION, sha256 });
  }

  async function safeRemove(file) {
    if (typeof fs.rm !== 'function') return;
    try { await fs.rm(file, { force: true }); } catch {}
  }

  async function writeSynced(file, content) {
    if (typeof fs.open !== 'function') {
      await fs.writeFile(file, content, 'utf8');
      return;
    }
    let handle;
    try {
      handle = await fs.open(file, 'w');
      await handle.writeFile(content, 'utf8');
      if (typeof handle.sync === 'function') await handle.sync();
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function syncDirectory() {
    if (typeof fs.open !== 'function') return;
    let handle;
    try {
      handle = await fs.open(directory, 'r');
      if (typeof handle.sync === 'function') await handle.sync();
    } catch {
      // Some Windows/filesystem combinations do not support directory fsync.
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function readOptional(file) {
    try {
      return { exists: true, content: await fs.readFile(file, 'utf8'), error: null };
    } catch (error) {
      if (error?.code === 'ENOENT') return { exists: false, content: null, error: null };
      return { exists: false, content: null, error };
    }
  }

  async function readProof() {
    const proof = await readOptional(commitPath);
    if (proof.error) throw createMirrorError('COMMITTED_STATE_PROOF_READ_FAILED', '状态提交证明读取失败', proof.error);
    if (!proof.exists) return null;
    return parseProof(proof.content);
  }

  function mismatchError(code, message) {
    return createMirrorError(code, message);
  }

  async function restorePrimary(content) {
    await writeSynced(temporaryFile, content);
    await fs.rename(temporaryFile, filePath);
    await syncDirectory();
  }

  async function promoteStagedBackup(expectedHash) {
    const staged = await readOptional(backupTemporaryFile);
    if (staged.error) throw staged.error;
    if (!staged.exists || hashSnapshot(staged.content) !== expectedHash) return false;
    await fs.rename(backupTemporaryFile, backupPath);
    await syncDirectory();
    return true;
  }

  async function stableBackupMatches(expectedHash) {
    const backup = await readOptional(backupPath);
    if (backup.error) throw backup.error;
    return backup.exists && hashSnapshot(backup.content) === expectedHash;
  }

  async function ensureStableBackup(expectedHash) {
    if (await stableBackupMatches(expectedHash)) {
      const staged = await readOptional(backupTemporaryFile);
      if (!staged.error && staged.exists && hashSnapshot(staged.content) === expectedHash) await safeRemove(backupTemporaryFile);
      return true;
    }
    try {
      if (await promoteStagedBackup(expectedHash)) return true;
    } catch (cause) {
      throw createMirrorError('COMMITTED_STATE_BACKUP_PROMOTION_FAILED', '已提交状态恢复副本无法落稳', cause);
    }

    const primary = await readOptional(filePath);
    if (primary.error) throw createMirrorError('COMMITTED_STATE_PRIMARY_READ_FAILED', '已提交状态主文件读取失败', primary.error);
    if (!primary.exists || hashSnapshot(primary.content) !== expectedHash) {
      throw createMirrorError('COMMITTED_STATE_RECOVERY_MIRROR_MISSING', '已提交状态缺少可验证恢复副本');
    }
    try {
      await writeSynced(backupTemporaryFile, primary.content);
      await syncDirectory();
      await fs.rename(backupTemporaryFile, backupPath);
      await syncDirectory();
      return true;
    } catch (cause) {
      throw createMirrorError('COMMITTED_STATE_BACKUP_PROMOTION_FAILED', '已提交状态恢复副本无法落稳', cause);
    }
  }

  async function sealLegacyPrimary(content) {
    const expectedHash = hashSnapshot(content);
    await fs.mkdir(directory, { recursive: true });
    try {
      await writeSynced(backupTemporaryFile, content);
      await writeSynced(commitTemporaryFile, proofText(content));
      await syncDirectory();
      await fs.rename(commitTemporaryFile, commitPath);
      await syncDirectory();
      try {
        await fs.rename(backupTemporaryFile, backupPath);
        await syncDirectory();
      } catch (error) {
        onPostCommitError(error, { phase: 'backup-mirror', sha256: expectedHash });
      }
    } catch (error) {
      await safeRemove(commitTemporaryFile);
      throw error;
    }
    return expectedHash;
  }

  async function load(parse) {
    if (typeof parse !== 'function') throw new TypeError('Committed state mirror parse is required');
    await fs.mkdir(directory, { recursive: true });

    let proof;
    try {
      proof = await readProof();
    } catch (error) {
      error.primaryError = error;
      throw error;
    }

    const primary = await readOptional(filePath);
    if (!proof) {
      if (primary.error) {
        const error = createMirrorError('COMMITTED_STATE_RECOVERY_UNSAFE', '缺少提交证明，无法安全恢复状态', primary.error);
        error.primaryError = primary.error;
        throw error;
      }
      if (primary.exists) {
        try {
          return Object.freeze({ status: 'legacy', content: primary.content, state: parse(primary.content), primaryError: null });
        } catch (primaryError) {
          const error = createMirrorError('COMMITTED_STATE_RECOVERY_UNSAFE', '旧状态主文件无效，拒绝使用未证明的备份', primaryError);
          error.primaryError = primaryError;
          throw error;
        }
      }
      const [backup, staged] = await Promise.all([readOptional(backupPath), readOptional(backupTemporaryFile)]);
      const backupError = backup.error || staged.error || null;
      if (backupError || backup.exists || staged.exists) {
        const error = createMirrorError('COMMITTED_STATE_RECOVERY_UNSAFE', '主状态缺失且备份没有提交证明', backupError || mismatchError('COMMITTED_STATE_PROOF_MISSING', '状态提交证明缺失'));
        error.primaryError = mismatchError('ENOENT', '状态主文件缺失');
        error.backupError = backupError || mismatchError('COMMITTED_STATE_PROOF_MISSING', '状态提交证明缺失');
        throw error;
      }
      return Object.freeze({ status: 'empty', content: null, state: null, primaryError: null });
    }

    const expectedHash = proof.sha256;
    let primaryError = primary.error;
    if (!primaryError && primary.exists) {
      if (hashSnapshot(primary.content) === expectedHash) {
        try {
          return Object.freeze({ status: 'current', content: primary.content, state: parse(primary.content), primaryError: null, sha256: expectedHash });
        } catch (error) {
          primaryError = error;
        }
      } else {
        primaryError = mismatchError('COMMITTED_STATE_PRIMARY_UNCOMMITTED', '状态主文件不匹配已提交证明');
      }
    } else if (!primaryError) {
      primaryError = mismatchError('ENOENT', '状态主文件缺失');
    }

    let backupError = null;
    for (const [source, file] of [['backup', backupPath], ['staged-backup', backupTemporaryFile]]) {
      const candidate = await readOptional(file);
      if (candidate.error) {
        backupError = candidate.error;
        continue;
      }
      if (!candidate.exists) continue;
      if (hashSnapshot(candidate.content) !== expectedHash) {
        backupError = mismatchError('COMMITTED_STATE_BACKUP_STALE', '恢复副本不匹配已提交证明');
        continue;
      }
      let parsed;
      try {
        parsed = parse(candidate.content);
      } catch (error) {
        backupError = error;
        continue;
      }
      try {
        await restorePrimary(candidate.content);
        if (source === 'staged-backup') {
          try { await promoteStagedBackup(expectedHash); }
          catch (error) { onPostCommitError(error, { phase: 'backup-mirror', sha256: expectedHash }); }
        }
      } catch (restoreError) {
        const error = createMirrorError('COMMITTED_STATE_RECOVERY_RESTORE_FAILED', '已提交状态恢复失败', restoreError);
        error.primaryError = primaryError;
        error.backupError = restoreError;
        throw error;
      }
      return Object.freeze({
        status: 'recovered',
        content: candidate.content,
        state: parsed,
        primaryError,
        sha256: expectedHash,
      });
    }

    const error = createMirrorError('COMMITTED_STATE_RECOVERY_UNSAFE', '找不到与提交证明匹配的状态快照', primaryError);
    error.primaryError = primaryError;
    error.backupError = backupError;
    throw error;
  }

  async function prepareForMutation() {
    const loaded = await load(content => content);
    if (loaded.status === 'legacy') {
      await sealLegacyPrimary(loaded.content);
      return;
    }
    if (loaded.status === 'empty') {
      throw createMirrorError('COMMITTED_STATE_AUTHORITY_MISSING', '状态尚未初始化，拒绝直接提交事务');
    }
    await ensureStableBackup(loaded.sha256);
  }

  async function commit(content, { initializing = false } = {}) {
    const snapshot = String(content);
    await fs.mkdir(directory, { recursive: true });
    if (!initializing) await prepareForMutation();

    const expectedHash = hashSnapshot(snapshot);
    let committed = false;
    try {
      await writeSynced(temporaryFile, snapshot);
      await writeSynced(backupTemporaryFile, snapshot);
      await writeSynced(commitTemporaryFile, proofText(snapshot));
      await syncDirectory();

      await fs.rename(temporaryFile, filePath);
      await fs.rename(commitTemporaryFile, commitPath);
      committed = true;
      await syncDirectory();

      try {
        await fs.rename(backupTemporaryFile, backupPath);
        await syncDirectory();
      } catch (error) {
        // Commit already happened. Keep the fsynced staged backup as the recovery
        // mirror; a later load/mutation will promote it before overwriting it.
        onPostCommitError(error, { phase: 'backup-mirror', sha256: expectedHash });
      }
      return Object.freeze({ sha256: expectedHash });
    } catch (error) {
      await safeRemove(temporaryFile);
      await safeRemove(commitTemporaryFile);
      if (!committed) await safeRemove(backupTemporaryFile);
      throw error;
    }
  }

  return Object.freeze({
    filePath,
    backupPath,
    commitPath,
    stagedBackupPath: backupTemporaryFile,
    hashSnapshot,
    load,
    commit,
  });
}

module.exports = {
  COMMIT_PROOF_VERSION,
  createCommittedStateMirror,
};
