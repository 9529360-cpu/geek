'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const DEFAULT_ROOT = 'https://geek-release.9529360.workers.dev';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_METADATA_BYTES = 64 * 1024;

function createCheckError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function assertVersion(value, field = 'version') {
  const version = String(value || '').trim();
  if (!VERSION_PATTERN.test(version)) {
    throw createCheckError('PUBLIC_RELEASE_VERSION_INVALID', { field });
  }
  return version;
}

function normalizeRoot(value) {
  let parsed;
  try {
    parsed = new URL(String(value || DEFAULT_ROOT));
  } catch {
    throw createCheckError('PUBLIC_RELEASE_ROOT_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw createCheckError('PUBLIC_RELEASE_ROOT_INVALID');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function parseLatestMetadata(value) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') > MAX_METADATA_BYTES) {
    throw createCheckError('PUBLIC_RELEASE_METADATA_TOO_LARGE');
  }
  const version = text.match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m)?.[1] || '';
  const artifactPath = text.match(/^path:\s*(geek-setup-[0-9]+\.[0-9]+\.[0-9]+\.exe)\s*$/m)?.[1] || '';
  const sha512 = text.match(/^sha512:\s*([^\s]+)\s*$/m)?.[1] || '';
  if (!VERSION_PATTERN.test(version) || !artifactPath || !sha512) {
    throw createCheckError('PUBLIC_RELEASE_METADATA_INVALID');
  }
  if (artifactPath !== `geek-setup-${version}.exe`) {
    throw createCheckError('PUBLIC_RELEASE_METADATA_PATH_MISMATCH');
  }
  return Object.freeze({ version, artifactPath, sha512, text });
}

function cacheBustedUrl(value, label, attempt, now = Date.now) {
  const url = new URL(value);
  url.searchParams.set(label, `${now()}-${attempt}`);
  return url.toString();
}

async function cancelResponseBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
  } catch {
    // Body cancellation is best-effort; status validation remains authoritative.
  }
}

async function fetchMetadataOnce({ fetchImpl, url, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await cancelResponseBody(response);
      throw createCheckError('PUBLIC_RELEASE_METADATA_HTTP', { status: response.status });
    }
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) {
      await cancelResponseBody(response);
      throw createCheckError('PUBLIC_RELEASE_METADATA_TOO_LARGE');
    }
    const text = await response.text();
    return parseLatestMetadata(text);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createCheckError('PUBLIC_RELEASE_METADATA_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchArtifactOnce({ fetchImpl, url, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    const status = Number(response.status);
    await cancelResponseBody(response);
    if (status !== 200 && status !== 206) {
      throw createCheckError('PUBLIC_RELEASE_ARTIFACT_HTTP', { status });
    }
    return status;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createCheckError('PUBLIC_RELEASE_ARTIFACT_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function safeFailureSummary(error) {
  if (Number.isInteger(error?.status)) return `${error.code || 'PUBLIC_RELEASE_CHECK_FAILED'} HTTP ${error.status}`;
  return String(error?.code || error?.name || 'PUBLIC_RELEASE_CHECK_FAILED').slice(0, 120);
}

async function retryCheck(label, task, options = {}) {
  const attempts = Number(options.attempts);
  const delayMs = Number(options.delayMs);
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError = createCheckError('PUBLIC_RELEASE_CHECK_NOT_RUN');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      console.warn(`${label} attempt ${attempt} failed: ${safeFailureSummary(error)}`);
      if (attempt < attempts && delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastError;
}

function checkOptions(options = {}) {
  const attempts = Number(options.attempts ?? 6);
  const delayMs = Number(options.delayMs ?? 10_000);
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 120) {
    throw createCheckError('PUBLIC_RELEASE_ATTEMPTS_INVALID');
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw createCheckError('PUBLIC_RELEASE_DELAY_INVALID');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw createCheckError('PUBLIC_RELEASE_TIMEOUT_INVALID');
  }
  return { attempts, delayMs, timeoutMs };
}

async function readPublicMetadata(options = {}) {
  const root = normalizeRoot(options.root);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw createCheckError('PUBLIC_RELEASE_FETCH_UNAVAILABLE');
  const config = checkOptions(options);
  const now = options.now || Date.now;
  return retryCheck(
    'public metadata GET',
    (attempt) => fetchMetadataOnce({
      fetchImpl,
      url: cacheBustedUrl(`${root}/latest.yml`, 'check', attempt, now),
      timeoutMs: config.timeoutMs,
    }),
    { ...config, sleep: options.sleep },
  );
}

async function verifyDeclaredArtifact(root, artifactPath, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const config = checkOptions(options);
  const now = options.now || Date.now;
  return retryCheck(
    `public artifact GET ${path.basename(artifactPath)}`,
    (attempt) => fetchArtifactOnce({
      fetchImpl,
      url: cacheBustedUrl(`${root}/${artifactPath}`, 'check', attempt, now),
      timeoutMs: config.timeoutMs,
    }),
    { ...config, sleep: options.sleep },
  );
}

async function appendEnvironment(file, values) {
  if (!file) throw createCheckError('PUBLIC_RELEASE_GITHUB_ENV_MISSING');
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
  await fs.appendFile(file, lines, 'utf8');
}

async function capturePreviousStable(options = {}) {
  const root = normalizeRoot(options.root);
  const releaseVersion = assertVersion(options.releaseVersion, 'releaseVersion');
  const metadata = await readPublicMetadata({ ...options, root });

  if (metadata.version === releaseVersion) {
    await appendEnvironment(options.githubEnv, { ROLLBACK_AVAILABLE: 'false' });
    return Object.freeze({ idempotent: true, metadata });
  }

  await verifyDeclaredArtifact(root, metadata.artifactPath, options);
  await verifyDeclaredArtifact(root, `${metadata.artifactPath}.blockmap`, options);

  if (!options.metadataOut) throw createCheckError('PUBLIC_RELEASE_METADATA_OUT_MISSING');
  await fs.mkdir(path.dirname(options.metadataOut), { recursive: true });
  await fs.writeFile(options.metadataOut, metadata.text, 'utf8');
  await appendEnvironment(options.githubEnv, {
    PREVIOUS_RELEASE_VERSION: metadata.version,
    ROLLBACK_AVAILABLE: 'true',
  });
  return Object.freeze({ idempotent: false, metadata });
}

async function verifyPublicRelease(options = {}) {
  const root = normalizeRoot(options.root);
  const version = assertVersion(options.version);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const config = checkOptions(options);
  const now = options.now || Date.now;
  const sleep = options.sleep;

  return retryCheck(
    `public release ${version}`,
    async (attempt) => {
      const metadata = await fetchMetadataOnce({
        fetchImpl,
        url: cacheBustedUrl(`${root}/latest.yml`, 'release', attempt, now),
        timeoutMs: config.timeoutMs,
      });
      if (metadata.version !== version || metadata.artifactPath !== `geek-setup-${version}.exe`) {
        throw createCheckError('PUBLIC_RELEASE_VERSION_NOT_PROMOTED');
      }
      await fetchArtifactOnce({
        fetchImpl,
        url: cacheBustedUrl(`${root}/${metadata.artifactPath}`, 'release', attempt, now),
        timeoutMs: config.timeoutMs,
      });
      await fetchArtifactOnce({
        fetchImpl,
        url: cacheBustedUrl(`${root}/${metadata.artifactPath}.blockmap`, 'release', attempt, now),
        timeoutMs: config.timeoutMs,
      });
      return metadata;
    },
    { ...config, sleep },
  );
}

function parseCli(argv) {
  const [mode, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw createCheckError('PUBLIC_RELEASE_ARGUMENT_INVALID');
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = rest[index + 1];
    if (value == null || value.startsWith('--')) throw createCheckError('PUBLIC_RELEASE_ARGUMENT_INVALID');
    values[key] = value;
    index += 1;
  }
  return { mode, values };
}

async function runCli(argv = process.argv.slice(2)) {
  const { mode, values } = parseCli(argv);
  const common = {
    root: values.root || DEFAULT_ROOT,
    attempts: values.attempts == null ? undefined : Number(values.attempts),
    delayMs: values.delayMs == null ? undefined : Number(values.delayMs),
    timeoutMs: values.timeoutMs == null ? undefined : Number(values.timeoutMs),
  };
  if (mode === 'capture') {
    const result = await capturePreviousStable({
      ...common,
      releaseVersion: values.releaseVersion,
      metadataOut: values.metadataOut,
      githubEnv: values.githubEnv,
    });
    console.log(result.idempotent
      ? `production-already=${result.metadata.version}`
      : `rollback-target=${result.metadata.version}`);
    return;
  }
  if (mode === 'verify') {
    const result = await verifyPublicRelease({ ...common, version: values.version });
    console.log(`public-release=${result.version}`);
    return;
  }
  throw createCheckError('PUBLIC_RELEASE_MODE_INVALID');
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`release public check failed: ${safeFailureSummary(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_ROOT,
  parseLatestMetadata,
  capturePreviousStable,
  verifyPublicRelease,
  runCli,
};
