'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MASTER_REF = 'refs/heads/master';
const MARKER_PATH = '.github/release-client-version';
const SHA_RE = /^[0-9a-f]{40}$/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function runGit(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) fail('RELEASE_CANDIDATE_GIT_FAILED', result.error.message);
  if (result.status !== 0 && !allowFailure) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(0, 300);
    fail('RELEASE_CANDIDATE_GIT_FAILED', `git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function canonicalCommit(cwd, value) {
  const raw = String(value || '').trim();
  if (!raw) fail('RELEASE_CANDIDATE_SHA_REQUIRED', 'release candidate SHA is required');
  const resolved = runGit(cwd, ['rev-parse', '--verify', `${raw}^{commit}`]).stdout.toLowerCase();
  if (!SHA_RE.test(resolved)) fail('RELEASE_CANDIDATE_SHA_INVALID', 'resolved release candidate SHA is invalid');
  return resolved;
}

function requireMasterRef(ref) {
  if (String(ref || '').trim() !== MASTER_REF) {
    fail('RELEASE_CANDIDATE_UNSUPPORTED_REF', `release workflow must run from ${MASTER_REF}`);
  }
}

function isAncestor(cwd, ancestor, descendant) {
  return runGit(cwd, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true }).status === 0;
}

function resolveAuthorizedCandidate({ eventName, ref, sha, before, repoDir = process.cwd() }) {
  requireMasterRef(ref);
  const event = String(eventName || '').trim();
  const head = canonicalCommit(repoDir, sha);

  if (event === 'push') {
    const previous = canonicalCommit(repoDir, before);
    const firstParent = canonicalCommit(repoDir, `${head}^1`);
    if (previous !== firstParent) {
      fail(
        'RELEASE_CANDIDATE_PUSH_NOT_SINGLE_COMMIT',
        'release marker push must advance master by exactly one reviewed commit',
      );
    }
    const changed = runGit(repoDir, ['diff', '--name-only', previous, head, '--', MARKER_PATH]).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    if (!changed.includes(MARKER_PATH)) {
      fail('RELEASE_CANDIDATE_MARKER_NOT_CHANGED', 'release push head does not change the release marker');
    }
    return head;
  }

  if (event === 'workflow_dispatch') {
    const candidate = runGit(repoDir, ['log', '-1', '--format=%H', head, '--', MARKER_PATH]).stdout.toLowerCase();
    if (!SHA_RE.test(candidate)) {
      fail('RELEASE_CANDIDATE_AUTHORITY_MISSING', 'no release marker authority commit exists on master');
    }
    if (!isAncestor(repoDir, candidate, head)) {
      fail('RELEASE_CANDIDATE_NOT_ANCESTOR', 'release authority commit is not an ancestor of the dispatched master');
    }
    return candidate;
  }

  fail('RELEASE_CANDIDATE_EVENT_UNSUPPORTED', `unsupported release event: ${event || 'unknown'}`);
}

function readJson(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail(code, `invalid JSON: ${path.basename(filePath)}`);
  }
}

function validateCandidate({ controlDir = process.cwd(), candidateDir, expectedSha }) {
  if (!candidateDir) fail('RELEASE_CANDIDATE_DIR_REQUIRED', 'candidate directory is required');
  const candidateRoot = path.resolve(candidateDir);
  const expected = canonicalCommit(controlDir, expectedSha);
  const actual = canonicalCommit(candidateRoot, 'HEAD');
  if (actual !== expected) {
    fail('RELEASE_CANDIDATE_HEAD_MISMATCH', 'candidate worktree HEAD does not match authorized release candidate');
  }

  const controlHead = canonicalCommit(controlDir, 'HEAD');
  if (!isAncestor(controlDir, expected, controlHead)) {
    fail('RELEASE_CANDIDATE_NOT_ANCESTOR', 'authorized release candidate is not contained in the trusted control-plane checkout');
  }

  const pkg = readJson(path.join(candidateRoot, 'package.json'), 'RELEASE_CANDIDATE_PACKAGE_INVALID');
  const lock = readJson(path.join(candidateRoot, 'package-lock.json'), 'RELEASE_CANDIDATE_LOCK_INVALID');
  let marker = '';
  let controlMarker = '';
  try {
    marker = fs.readFileSync(path.join(candidateRoot, MARKER_PATH), 'utf8').trim();
    controlMarker = fs.readFileSync(path.join(controlDir, MARKER_PATH), 'utf8').trim();
  } catch {
    fail('RELEASE_CANDIDATE_MARKER_INVALID', 'release marker is missing');
  }

  const version = String(pkg?.version || '').trim();
  const lockVersion = String(lock?.version || '').trim();
  const rootLockVersion = String(lock?.packages?.['']?.version || '').trim();
  if (!version || marker !== version || lockVersion !== version || rootLockVersion !== version) {
    fail('RELEASE_CANDIDATE_VERSION_MISMATCH', 'candidate package, lockfile and release marker versions must match');
  }
  if (controlMarker !== version) {
    fail('RELEASE_CANDIDATE_SUPERSEDED', 'trusted master release marker no longer matches the authorized candidate version');
  }

  return { sha: expected, version };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) fail('RELEASE_CANDIDATE_ARGUMENT_INVALID', `unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[i + 1];
    if (value == null || value.startsWith('--')) fail('RELEASE_CANDIDATE_ARGUMENT_INVALID', `missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function appendEnv(filePath, values) {
  if (!filePath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  fs.appendFileSync(filePath, `${lines}\n`, 'utf8');
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'resolve') {
    const candidate = resolveAuthorizedCandidate({
      eventName: args.event,
      ref: args.ref,
      sha: args.sha,
      before: args.before,
      repoDir: args.repo || process.cwd(),
    });
    appendEnv(args['github-env'], { RELEASE_CANDIDATE_SHA: candidate });
    console.log(`release-candidate=${candidate}`);
    return;
  }
  if (args.command === 'validate') {
    const result = validateCandidate({
      controlDir: args['control-dir'] || process.cwd(),
      candidateDir: args['candidate-dir'],
      expectedSha: args['expected-sha'],
    });
    appendEnv(args['github-env'], {
      RELEASE_CANDIDATE_SHA: result.sha,
      RELEASE_VERSION: result.version,
    });
    console.log(`release-candidate=${result.sha} version=${result.version}`);
    return;
  }
  fail('RELEASE_CANDIDATE_COMMAND_INVALID', 'expected resolve or validate command');
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(`${error?.code || 'RELEASE_CANDIDATE_FAILED'}: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  MASTER_REF,
  MARKER_PATH,
  resolveAuthorizedCandidate,
  validateCandidate,
  runCli,
};
