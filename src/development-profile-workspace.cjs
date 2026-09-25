'use strict';

const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const path = require('node:path');

const MARKER_FILENAME = '.geek-development-workspace.json';
const MARKER_VERSION = 1;
const MAX_MARKER_BYTES = 1024;

function createWorkspaceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalWorkspacePath(workspaceDir, options = {}) {
  const fs = options.fs || nodeFs;
  const platform = options.platform || process.platform;
  const raw = String(workspaceDir || '').trim();
  if (!raw || !path.isAbsolute(raw)) throw new TypeError('workspaceDir must be an absolute path');

  let resolved = path.resolve(raw);
  const realpathSync = fs.realpathSync?.native || fs.realpathSync;
  if (typeof realpathSync === 'function') resolved = realpathSync(resolved);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function workspaceFingerprint(workspaceDir, options = {}) {
  return crypto
    .createHash('sha256')
    .update(canonicalWorkspacePath(workspaceDir, options), 'utf8')
    .digest('hex');
}

function readMarker(markerPath, fs) {
  try {
    const stat = fs.lstatSync(markerPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_MARKER_BYTES) {
      throw createWorkspaceError('DEV_PROFILE_WORKSPACE_MARKER_INVALID', 'development profile workspace marker is invalid');
    }
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (
      parsed?.version !== MARKER_VERSION
      || !/^[a-f0-9]{64}$/.test(String(parsed?.workspaceHash || ''))
    ) {
      throw createWorkspaceError('DEV_PROFILE_WORKSPACE_MARKER_INVALID', 'development profile workspace marker is invalid');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'DEV_PROFILE_WORKSPACE_MARKER_INVALID') throw error;
    throw createWorkspaceError('DEV_PROFILE_WORKSPACE_MARKER_INVALID', 'development profile workspace marker is unreadable');
  }
}

function writeMarker(markerPath, marker, fs) {
  let fd;
  try {
    fd = fs.openSync(markerPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(marker), 'utf8');
    if (typeof fs.fsyncSync === 'function') fs.fsyncSync(fd);
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function claimDevelopmentProfileWorkspace(options = {}) {
  const profile = String(options.profile || '');
  if (profile !== 'development') {
    return Object.freeze({ enforced: false, claimed: false, matched: false });
  }

  const fs = options.fs || nodeFs;
  const rawUserDataDir = String(options.userDataDir || '').trim();
  if (!rawUserDataDir || !path.isAbsolute(rawUserDataDir)) throw new TypeError('userDataDir must be an absolute path');
  const userDataDir = path.resolve(rawUserDataDir);

  const workspaceHash = workspaceFingerprint(options.workspaceDir, {
    fs,
    platform: options.platform,
  });
  fs.mkdirSync(userDataDir, { recursive: true });
  const markerPath = path.join(userDataDir, MARKER_FILENAME);
  const marker = Object.freeze({ version: MARKER_VERSION, workspaceHash });

  if (writeMarker(markerPath, marker, fs)) {
    return Object.freeze({ enforced: true, claimed: true, matched: true });
  }

  const existing = readMarker(markerPath, fs);
  if (existing.workspaceHash !== workspaceHash) {
    throw createWorkspaceError(
      'DEV_PROFILE_WORKSPACE_MISMATCH',
      'development userData belongs to another workspace; choose a different GEEK_USER_DATA_DIR',
    );
  }
  return Object.freeze({ enforced: true, claimed: false, matched: true });
}

module.exports = {
  MARKER_FILENAME,
  MARKER_VERSION,
  canonicalWorkspacePath,
  workspaceFingerprint,
  claimDevelopmentProfileWorkspace,
};
