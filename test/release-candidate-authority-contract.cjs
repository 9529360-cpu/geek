'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  resolveAuthorizedCandidate,
  validateCandidate,
} = require('../scripts/release-candidate-authority.cjs');

const root = path.join(__dirname, '..');
const workflowPath = path.join(root, '.github', 'workflows', 'release-client-production.yml');
const legacyWorkflowPath = path.join(root, '.github', 'workflows', 'release-client.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n?/g, '\n');

assert.equal(fs.existsSync(legacyWorkflowPath), false, 'legacy dispatchable release workflow path must be retired so historical refs cannot reuse its old manual-recovery logic');
assert.match(workflow, /^  workflow_dispatch:$/m, 'same-version recovery must remain an explicit manual action');
const rejectAt = workflow.indexOf('- name: Reject unsupported recovery ref');
const checkoutAt = workflow.indexOf('- name: Checkout trusted release control plane');
const resolveAt = workflow.indexOf('- name: Resolve authorized release candidate');
const materializeAt = workflow.indexOf('- name: Materialize authorized candidate source');
const validateAt = workflow.indexOf('- name: Validate authorized release candidate');
const installAt = workflow.indexOf('- name: Install candidate dependencies without lifecycle scripts');
const buildAt = workflow.indexOf('- name: Build tested Windows release');
const uploadAt = workflow.indexOf('- name: Upload installer and blockmap to R2');
for (const [name, index] of Object.entries({ rejectAt, checkoutAt, resolveAt, materializeAt, validateAt, installAt, buildAt, uploadAt })) {
  assert.ok(index >= 0, `release workflow must contain ${name}`);
}
assert.ok(rejectAt < checkoutAt, 'unsupported manual refs must fail before repository checkout');
assert.ok(checkoutAt < resolveAt && resolveAt < materializeAt && materializeAt < validateAt && validateAt < installAt, 'candidate identity/version must settle before dependency installation');
assert.ok(installAt < buildAt && buildAt < uploadAt, 'authorized candidate must be installed/built before any R2 mutation');
assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'[\s\S]*GITHUB_REF -ne 'refs\/heads\/master'/, 'manual recovery must reject non-master refs before checkout');
assert.match(workflow, /uses: actions\/checkout@v7[\s\S]*ref: \$\{\{ github\.sha \}\}[\s\S]*fetch-depth: 0/, 'trusted control-plane checkout must be pinned to the triggering SHA with full history');
assert.match(workflow, /release-candidate-authority\.cjs'[\s\S]*'resolve'/, 'workflow must derive the repository-authorized candidate rather than accept an operator SHA');
assert.match(workflow, /git worktree add --detach candidate \$env:RELEASE_CANDIDATE_SHA/, 'build source must be materialized at the exact authorized candidate SHA');
assert.match(workflow, /release-candidate-authority\.cjs validate[\s\S]*--candidate-dir 'candidate'/, 'candidate package/lock/marker state must be revalidated before build');
assert.match(workflow, /Push-Location 'candidate'[\s\S]*npm ci --ignore-scripts/, 'dependencies must be installed from the authorized candidate tree');
assert.match(workflow, /Push-Location 'candidate'[\s\S]*npm run dist[\s\S]*Move-Item 'candidate\\dist-release' 'dist-release'/, 'published artifacts must come from the authorized candidate build while current control-plane scripts remain at repository root');
assert.doesNotMatch(workflow, /workflow_dispatch:\s*\n\s*inputs:/, 'manual recovery must not trust an operator-supplied candidate SHA input');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writeVersion(repo, version) {
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'release-client-version'), `${version}\n`, 'utf8');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'geek', version }, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(repo, 'package-lock.json'),
    JSON.stringify({ name: 'geek', version, lockfileVersion: 3, packages: { '': { name: 'geek', version } } }, null, 2),
    'utf8',
  );
}

const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-release-candidate-'));
const repo = path.join(tempParent, 'repo');
const candidateDir = path.join(tempParent, 'candidate');
fs.mkdirSync(repo, { recursive: true });

try {
  git(repo, 'init', '-b', 'master');
  git(repo, 'config', 'user.email', 'release-contract@example.invalid');
  git(repo, 'config', 'user.name', 'Release Contract');

  writeVersion(repo, '1.2.24');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n', 'utf8');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD').toLowerCase();

  writeVersion(repo, '1.2.25');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'release 1.2.25');
  const release = git(repo, 'rev-parse', 'HEAD').toLowerCase();

  fs.appendFileSync(path.join(repo, 'README.md'), 'maintenance\n', 'utf8');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-m', 'maintenance');
  const maintenance = git(repo, 'rev-parse', 'HEAD').toLowerCase();

  assert.equal(
    resolveAuthorizedCandidate({ eventName: 'push', ref: 'refs/heads/master', sha: release, before: base, repoDir: repo }),
    release,
    'normal release push must bind to the exact one-commit master advance that changed the marker',
  );
  assert.equal(
    resolveAuthorizedCandidate({ eventName: 'workflow_dispatch', ref: 'refs/heads/master', sha: maintenance, repoDir: repo }),
    release,
    'manual recovery after later maintenance must recover the last marker-authority commit, not current master HEAD',
  );
  assert.throws(
    () => resolveAuthorizedCandidate({ eventName: 'workflow_dispatch', ref: 'refs/heads/feature', sha: maintenance, repoDir: repo }),
    { code: 'RELEASE_CANDIDATE_UNSUPPORTED_REF' },
  );
  assert.throws(
    () => resolveAuthorizedCandidate({ eventName: 'push', ref: 'refs/heads/master', sha: maintenance, before: release, repoDir: repo }),
    { code: 'RELEASE_CANDIDATE_MARKER_NOT_CHANGED' },
    'a normal maintenance commit cannot become a release candidate',
  );
  assert.throws(
    () => resolveAuthorizedCandidate({ eventName: 'push', ref: 'refs/heads/master', sha: maintenance, before: base, repoDir: repo }),
    { code: 'RELEASE_CANDIDATE_PUSH_NOT_SINGLE_COMMIT' },
    'a multi-commit push cannot smuggle post-authorization maintenance into the release candidate',
  );

  git(repo, 'worktree', 'add', '--detach', candidateDir, release);
  assert.deepEqual(
    validateCandidate({ controlDir: repo, candidateDir, expectedSha: release }),
    { sha: release, version: '1.2.25' },
  );

  const validLock = fs.readFileSync(path.join(candidateDir, 'package-lock.json'), 'utf8');
  fs.writeFileSync(
    path.join(candidateDir, 'package-lock.json'),
    JSON.stringify({ name: 'geek', version: '9.9.9', lockfileVersion: 3, packages: { '': { name: 'geek', version: '9.9.9' } } }),
    'utf8',
  );
  assert.throws(
    () => validateCandidate({ controlDir: repo, candidateDir, expectedSha: release }),
    { code: 'RELEASE_CANDIDATE_VERSION_MISMATCH' },
    'candidate package/lock/marker mismatch must fail before publication',
  );
  fs.writeFileSync(path.join(candidateDir, 'package-lock.json'), validLock, 'utf8');

  fs.writeFileSync(path.join(repo, '.github', 'release-client-version'), '1.2.26\n', 'utf8');
  assert.throws(
    () => validateCandidate({ controlDir: repo, candidateDir, expectedSha: release }),
    { code: 'RELEASE_CANDIDATE_SUPERSEDED' },
    'manual recovery cannot publish an old candidate after trusted master authorizes a newer version',
  );
} finally {
  try { git(repo, 'worktree', 'remove', '--force', candidateDir); } catch {}
  fs.rmSync(tempParent, { recursive: true, force: true });
}

console.log('RELEASE_CANDIDATE_AUTHORITY_CONTRACT_OK');
