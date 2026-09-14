'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyPublicRelease } = require('./release-public-check.cjs');
const { verifyPublicArtifactIntegrity } = require('./release-public-integrity.cjs');

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const DEFAULT_ROOT = 'https://geek-release.9529360.workers.dev';

function checkError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function loadCandidateManifest(manifestPath, version) {
  if (!VERSION_PATTERN.test(version)) throw checkError('SAME_VERSION_RELEASE_VERSION_INVALID');
  if (typeof manifestPath !== 'string' || !manifestPath.trim()) {
    throw checkError('SAME_VERSION_RELEASE_MANIFEST_INVALID');
  }

  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), 'utf8'));
  } catch {
    throw checkError('SAME_VERSION_RELEASE_MANIFEST_INVALID');
  }
  if (!manifest || manifest.version !== version || !Array.isArray(manifest.files)) {
    throw checkError('SAME_VERSION_RELEASE_MANIFEST_INVALID');
  }

  const byName = new Map();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.name !== 'string' || !entry.name || byName.has(entry.name)) {
      throw checkError('SAME_VERSION_RELEASE_MANIFEST_INVALID');
    }
    byName.set(entry.name, entry);
  }
  for (const name of [`geek-setup-${version}.exe`, `geek-setup-${version}.exe.blockmap`]) {
    const entry = byName.get(name);
    if (!entry || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
        typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
      throw checkError('SAME_VERSION_RELEASE_MANIFEST_INVALID');
    }
  }
  return manifest;
}

async function verifySameVersionRelease(options = {}) {
  const version = String(options.version || '').trim();
  const manifestPath = String(options.manifestPath || '').trim();
  const candidate = await loadCandidateManifest(manifestPath, version);

  // First prove that public metadata still names this exact semantic version and
  // that both versioned updater assets exist. This is the existing release-state
  // owner; no R2 mutation is allowed before this read-only boundary succeeds.
  const metadata = await verifyPublicRelease({
    root: options.root || DEFAULT_ROOT,
    version,
    fetchImpl: options.fetchImpl,
    attempts: options.attempts,
    delayMs: options.delayMs,
    timeoutMs: options.timeoutMs,
    sleep: options.sleep,
    now: options.now,
  });

  // latest.yml contains generated fields such as releaseDate and is the mutable
  // promotion pointer. For same-version immutability we compare the versioned EXE
  // and blockmap against the local release manifest, but validate latest.yml
  // against the exact public metadata snapshot we just observed. The existing
  // integrity verifier remains the only full-body SHA-256 authority.
  const publicLatest = Buffer.from(metadata.text, 'utf8');
  const files = candidate.files
    .filter((entry) => entry?.name !== 'latest.yml')
    .map((entry) => ({ ...entry }));
  files.push({
    name: 'latest.yml',
    size: publicLatest.length,
    sha256: sha256(publicLatest),
  });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-release-same-version-'));
  const tempManifest = path.join(tempDir, 'release-manifest.json');
  try {
    await fs.writeFile(tempManifest, JSON.stringify({ ...candidate, files }), 'utf8');
    const verified = await verifyPublicArtifactIntegrity({
      root: options.root || DEFAULT_ROOT,
      version,
      manifestPath: tempManifest,
      fetchImpl: options.fetchImpl,
      attempts: options.attempts,
      delayMs: options.delayMs,
      timeoutMs: options.integrityTimeoutMs ?? options.timeoutMs,
      sleep: options.sleep,
      now: options.now,
      logger: options.logger,
    });
    return Object.freeze({
      version,
      immutableAssets: Object.freeze(verified
        .filter((entry) => entry.name !== 'latest.yml')
        .map((entry) => Object.freeze({ ...entry }))),
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw checkError('SAME_VERSION_RELEASE_ARGUMENT_INVALID');
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw checkError('SAME_VERSION_RELEASE_ARGUMENT_INVALID');
    values[key] = value;
    index += 1;
  }
  return values;
}

async function runCli(argv = process.argv.slice(2)) {
  const values = parseArgs(argv);
  const result = await verifySameVersionRelease({
    root: values.root || DEFAULT_ROOT,
    version: values.version,
    manifestPath: values.manifest,
    attempts: values.attempts == null ? 3 : Number(values.attempts),
    delayMs: values.delayMs == null ? 5_000 : Number(values.delayMs),
    timeoutMs: values.timeoutMs == null ? 120_000 : Number(values.timeoutMs),
  });
  console.log(`same-version-release-immutable version=${result.version} assets=${result.immutableAssets.length}`);
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`same-version-release-check code=${String(error?.code || 'SAME_VERSION_RELEASE_CHECK_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 100) || 'SAME_VERSION_RELEASE_CHECK_FAILED'}`);
    process.exitCode = 1;
  });
}

module.exports = {
  loadCandidateManifest,
  verifySameVersionRelease,
  runCli,
};
