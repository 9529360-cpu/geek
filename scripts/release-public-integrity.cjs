'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_ROOT = 'https://geek-release.9529360.workers.dev';
const DEFAULT_TIMEOUT_MS = 120_000;

function checkError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizeRoot(value) {
  let parsed;
  try { parsed = new URL(String(value || DEFAULT_ROOT)); } catch { throw checkError('PUBLIC_RELEASE_ROOT_INVALID'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw checkError('PUBLIC_RELEASE_ROOT_INVALID');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

async function loadManifest(manifestPath, version) {
  if (!VERSION_PATTERN.test(String(version || ''))) throw checkError('PUBLIC_RELEASE_VERSION_INVALID');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID'); }
  if (manifest?.version !== version || !Array.isArray(manifest.files)) throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');

  const expectedNames = [
    `geek-setup-${version}.exe`,
    `geek-setup-${version}.exe.blockmap`,
    'latest.yml',
  ];
  const byName = new Map();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.name !== 'string' || byName.has(entry.name)) throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');
    byName.set(entry.name, entry);
  }
  return expectedNames.map((name) => {
    const entry = byName.get(name);
    const size = Number(entry?.size);
    const sha256 = String(entry?.sha256 || '').toLowerCase();
    if (!Number.isSafeInteger(size) || size < 0 || !SHA256_PATTERN.test(sha256)) {
      throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');
    }
    return Object.freeze({ name, size, sha256 });
  });
}

async function digestResponse(response, expected, timer) {
  if (response.status !== 200) throw checkError('PUBLIC_RELEASE_ARTIFACT_HTTP', { status: response.status, artifact: expected.name });
  if (!response.body) throw checkError('PUBLIC_RELEASE_ARTIFACT_BODY_MISSING', { artifact: expected.name });
  const hash = crypto.createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > expected.size) throw checkError('PUBLIC_RELEASE_SIZE_MISMATCH', { artifact: expected.name });
      hash.update(bytes);
    }
  } finally {
    clearTimeout(timer);
  }
  const sha256 = hash.digest('hex');
  if (size !== expected.size) throw checkError('PUBLIC_RELEASE_SIZE_MISMATCH', { artifact: expected.name });
  if (sha256 !== expected.sha256) throw checkError('PUBLIC_RELEASE_HASH_MISMATCH', { artifact: expected.name });
  return Object.freeze({ name: expected.name, size, sha256 });
}

async function fetchAndVerify({ fetchImpl, url, expected, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    return await digestResponse(response, expected, timer);
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') throw checkError('PUBLIC_RELEASE_ARTIFACT_TIMEOUT', { artifact: expected.name });
    throw error;
  }
}

async function verifyPublicArtifactIntegrity(options = {}) {
  const version = String(options.version || '').trim();
  const manifestPath = path.resolve(String(options.manifestPath || ''));
  const root = normalizeRoot(options.root);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const attempts = Number(options.attempts ?? 3);
  const delayMs = Number(options.delayMs ?? 5_000);
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (typeof fetchImpl !== 'function') throw checkError('PUBLIC_RELEASE_FETCH_UNAVAILABLE');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw checkError('PUBLIC_RELEASE_ATTEMPTS_INVALID');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw checkError('PUBLIC_RELEASE_DELAY_INVALID');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw checkError('PUBLIC_RELEASE_TIMEOUT_INVALID');

  const expectedFiles = await loadManifest(manifestPath, version);
  let lastError = checkError('PUBLIC_RELEASE_INTEGRITY_NOT_RUN');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const results = [];
      for (const expected of expectedFiles) {
        const url = new URL(`${root}/${expected.name}`);
        url.searchParams.set('integrity', `${Date.now()}-${attempt}`);
        results.push(await fetchAndVerify({ fetchImpl, url: url.toString(), expected, timeoutMs }));
      }
      return Object.freeze(results);
    } catch (error) {
      lastError = error;
      console.warn(`public release integrity attempt ${attempt} failed: ${String(error?.code || error?.name || 'FAILED').slice(0, 120)}`);
      if (attempt < attempts && delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastError;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw checkError('PUBLIC_RELEASE_ARGUMENT_INVALID');
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw checkError('PUBLIC_RELEASE_ARGUMENT_INVALID');
    values[key] = value;
    index += 1;
  }
  return values;
}

async function runCli(argv = process.argv.slice(2)) {
  const values = parseArgs(argv);
  const result = await verifyPublicArtifactIntegrity({
    root: values.root || DEFAULT_ROOT,
    version: values.version,
    manifestPath: values.manifest,
    attempts: values.attempts == null ? undefined : Number(values.attempts),
    delayMs: values.delayMs == null ? undefined : Number(values.delayMs),
    timeoutMs: values.timeoutMs == null ? undefined : Number(values.timeoutMs),
  });
  console.log(`public-release-integrity=${values.version} files=${result.length}`);
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`release public integrity failed: ${String(error?.code || error?.name || 'FAILED').slice(0, 120)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  loadManifest,
  verifyPublicArtifactIntegrity,
  runCli,
};
