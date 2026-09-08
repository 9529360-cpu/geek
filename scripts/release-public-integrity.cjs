'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const DEFAULT_ROOT = 'https://geek-release.9529360.workers.dev';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 10;
const MAX_DELAY_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;

function checkError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizeRoot(value) {
  const raw = String(value ?? DEFAULT_ROOT).trim();
  if (!raw || raw.includes('?') || raw.includes('#')) throw checkError('PUBLIC_RELEASE_ROOT_INVALID');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw checkError('PUBLIC_RELEASE_ROOT_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw checkError('PUBLIC_RELEASE_ROOT_INVALID');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed;
}

async function loadManifest(manifestPath, version) {
  if (!VERSION_PATTERN.test(String(version || ''))) throw checkError('PUBLIC_RELEASE_VERSION_INVALID');
  if (typeof manifestPath !== 'string' || !manifestPath.trim()) throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');

  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');
  }
  if (!manifest || manifest.version !== version || !Array.isArray(manifest.files)) {
    throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');
  }

  const expectedNames = [
    `geek-setup-${version}.exe`,
    `geek-setup-${version}.exe.blockmap`,
    'latest.yml',
  ];
  const byName = new Map();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.name !== 'string' || !entry.name || byName.has(entry.name)) {
      throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');
    }
    byName.set(entry.name, entry);
  }

  return Object.freeze(expectedNames.map((name) => {
    const entry = byName.get(name);
    if (!entry || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
        typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
      throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');
    }
    return Object.freeze({
      name,
      size: entry.size,
      sha256: entry.sha256.toLowerCase(),
    });
  }));
}

async function cancelBody(body) {
  if (!body || typeof body.cancel !== 'function') return;
  try {
    await body.cancel();
  } catch {
    // Cancellation is best-effort after an already authoritative HTTP failure.
  }
}

async function digestResponse(response, expected) {
  if (!response || response.status !== 200) {
    await cancelBody(response?.body);
    throw checkError('PUBLIC_RELEASE_ARTIFACT_HTTP', { artifact: expected.name });
  }
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
    throw checkError('PUBLIC_RELEASE_ARTIFACT_BODY_MISSING', { artifact: expected.name });
  }

  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > expected.size) {
      throw checkError('PUBLIC_RELEASE_SIZE_MISMATCH', { artifact: expected.name });
    }
    hash.update(bytes);
  }

  if (size !== expected.size) {
    throw checkError('PUBLIC_RELEASE_SIZE_MISMATCH', { artifact: expected.name });
  }
  const sha256 = hash.digest('hex');
  if (sha256 !== expected.sha256) {
    throw checkError('PUBLIC_RELEASE_HASH_MISMATCH', { artifact: expected.name });
  }
  return Object.freeze({ name: expected.name, size, sha256 });
}

async function fetchAndVerify({ fetchImpl, url, expected, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    return await digestResponse(response, expected);
  } catch (error) {
    if (String(error?.code || '').startsWith('PUBLIC_RELEASE_')) throw error;
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw checkError('PUBLIC_RELEASE_ARTIFACT_TIMEOUT', { artifact: expected.name });
    }
    throw checkError('PUBLIC_RELEASE_ARTIFACT_NETWORK', { artifact: expected.name });
  } finally {
    clearTimeout(timer);
  }
}

function artifactUrl(root, name, attempt, requestOrdinal, now) {
  const url = new URL(root.toString());
  const prefix = url.pathname.replace(/\/+$/, '');
  url.pathname = `${prefix}/${name}`.replace(/^\/*/, '/');
  url.searchParams.set('integrity', `${now()}-${attempt}-${requestOrdinal}`);
  return url.toString();
}

function formatFailure(error, attempt) {
  const parts = [
    'public-release-integrity',
    `code=${String(error?.code || 'PUBLIC_RELEASE_INTEGRITY_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'PUBLIC_RELEASE_INTEGRITY_FAILED'}`,
  ];
  if (error?.artifact) parts.push(`artifact=${String(error.artifact).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 180)}`);
  const effectiveAttempt = Number.isInteger(attempt) ? attempt : error?.attempt;
  if (Number.isInteger(effectiveAttempt) && effectiveAttempt > 0) parts.push(`attempt=${effectiveAttempt}`);
  return parts.join(' ');
}

async function verifyPublicArtifactIntegrity(options = {}) {
  const version = String(options.version || '').trim();
  const root = normalizeRoot(options.root);
  const manifestValue = String(options.manifestPath || '').trim();
  if (!manifestValue) throw checkError('PUBLIC_RELEASE_MANIFEST_INVALID');
  const manifestPath = path.resolve(manifestValue);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const attempts = Number(options.attempts ?? 3);
  const delayMs = Number(options.delayMs ?? 5_000);
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const logger = options.logger || console;

  if (typeof fetchImpl !== 'function') throw checkError('PUBLIC_RELEASE_FETCH_UNAVAILABLE');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
    throw checkError('PUBLIC_RELEASE_ATTEMPTS_INVALID');
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
    throw checkError('PUBLIC_RELEASE_DELAY_INVALID');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw checkError('PUBLIC_RELEASE_TIMEOUT_INVALID');
  }
  if (typeof sleep !== 'function' || typeof now !== 'function') {
    throw checkError('PUBLIC_RELEASE_ARGUMENT_INVALID');
  }

  const expectedFiles = await loadManifest(manifestPath, version);
  let requestOrdinal = 0;
  let lastError = checkError('PUBLIC_RELEASE_INTEGRITY_NOT_RUN');

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const results = [];
      for (const expected of expectedFiles) {
        requestOrdinal += 1;
        results.push(await fetchAndVerify({
          fetchImpl,
          url: artifactUrl(root, expected.name, attempt, requestOrdinal, now),
          expected,
          timeoutMs,
        }));
      }
      return Object.freeze(results);
    } catch (error) {
      lastError = error && typeof error === 'object' ? error : checkError('PUBLIC_RELEASE_INTEGRITY_FAILED');
      lastError.attempt = attempt;
      if (logger && typeof logger.warn === 'function') logger.warn(formatFailure(lastError, attempt));
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
  console.log(`public-release-integrity files=${result.length}`);
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(formatFailure(error));
    process.exitCode = 1;
  });
}

module.exports = {
  loadManifest,
  verifyPublicArtifactIntegrity,
  runCli,
};
