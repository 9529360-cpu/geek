'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MARKER_FILENAME,
  claimDevelopmentProfileWorkspace,
} = require('../src/development-profile-workspace.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-dev-workspace-contract-'));
const userDataDir = path.join(temp, 'geek-dev');
const workspaceA = path.join(temp, 'workspace-a');
const workspaceB = path.join(temp, 'workspace-b');
fs.mkdirSync(workspaceA, { recursive: true });
fs.mkdirSync(workspaceB, { recursive: true });

try {
  assert.throws(
    () => claimDevelopmentProfileWorkspace({ profile: 'development', userDataDir: '', workspaceDir: workspaceA }),
    /userDataDir must be an absolute path/,
  );

  const claimed = claimDevelopmentProfileWorkspace({
    profile: 'development',
    userDataDir,
    workspaceDir: workspaceA,
  });
  assert.equal(claimed.enforced, true);
  assert.equal(claimed.claimed, true);

  const markerPath = path.join(userDataDir, MARKER_FILENAME);
  const markerText = fs.readFileSync(markerPath, 'utf8');
  const marker = JSON.parse(markerText);
  assert.equal(marker.version, 1);
  assert.match(marker.workspaceHash, /^[a-f0-9]{64}$/);
  assert.equal(markerText.includes(workspaceA), false, 'marker must not persist the raw workspace path');

  const matched = claimDevelopmentProfileWorkspace({
    profile: 'development',
    userDataDir,
    workspaceDir: workspaceA,
  });
  assert.equal(matched.claimed, false);
  assert.equal(matched.matched, true);

  assert.throws(
    () => claimDevelopmentProfileWorkspace({
      profile: 'development',
      userDataDir,
      workspaceDir: workspaceB,
    }),
    error => error?.code === 'DEV_PROFILE_WORKSPACE_MISMATCH',
  );

  const isolated = path.join(temp, 'explicit-profile');
  const isolatedClaim = claimDevelopmentProfileWorkspace({
    profile: 'development',
    userDataDir: isolated,
    workspaceDir: workspaceB,
  });
  assert.equal(isolatedClaim.enforced, true);
  assert.equal(isolatedClaim.claimed, true);
  assert.equal(fs.existsSync(path.join(isolated, MARKER_FILENAME)), true);
  assert.throws(
    () => claimDevelopmentProfileWorkspace({
      profile: 'development',
      userDataDir: isolated,
      workspaceDir: workspaceA,
    }),
    error => error?.code === 'DEV_PROFILE_WORKSPACE_MISMATCH',
  );

  for (const profile of ['validation', 'production']) {
    const dir = path.join(temp, profile);
    const bypass = claimDevelopmentProfileWorkspace({
      profile,
      userDataDir: dir,
      workspaceDir: workspaceB,
    });
    assert.equal(bypass.enforced, false);
    assert.equal(fs.existsSync(path.join(dir, MARKER_FILENAME)), false);
  }

  fs.writeFileSync(markerPath, '{"version":1,"workspaceHash":"broken"}');
  assert.throws(
    () => claimDevelopmentProfileWorkspace({
      profile: 'development',
      userDataDir,
      workspaceDir: workspaceA,
    }),
    error => error?.code === 'DEV_PROFILE_WORKSPACE_MARKER_INVALID',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('DEVELOPMENT_PROFILE_WORKSPACE_CONTRACT_OK');
