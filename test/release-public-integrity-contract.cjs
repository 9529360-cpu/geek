'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verifyPublicArtifactIntegrity } = require('../scripts/release-public-integrity.cjs');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function makeFiles(version) {
  return new Map([
    [`geek-setup-${version}.exe`, Buffer.from('installer-bytes')],
    [`geek-setup-${version}.exe.blockmap`, Buffer.from('blockmap-bytes')],
    ['latest.yml', Buffer.from(`version: ${version}\npath: geek-setup-${version}.exe\nsha512: test\n`)],
  ]);
}

function manifestFor(version, files) {
  return {
    version,
    files: [...files].map(([name, bytes]) => ({ name, size: bytes.length, sha256: sha256(bytes) })),
  };
}

let manifestCounter = 0;
function writeManifest(dir, manifest) {
  manifestCounter += 1;
  const manifestPath = path.join(dir, `release-manifest-${manifestCounter}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

function bodyFromChunks(chunks, tracker = {}) {
  tracker.reads = 0;
  tracker.cancelled = false;
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for (const chunk of chunks) {
          tracker.reads += 1;
          yield chunk;
        }
      } finally {
        tracker.closed = true;
      }
    },
    async cancel() {
      tracker.cancelled = true;
    },
  };
}

function response(status, chunks, tracker) {
  return { status, body: chunks == null ? null : bodyFromChunks(chunks, tracker) };
}

function nameFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname.split('/').pop());
}

function quietLogger(logs = []) {
  return { warn(message) { logs.push(String(message)); } };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

(async () => {
  const version = '9.8.7';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-public-integrity-'));
  try {
    const files = makeFiles(version);
    const manifest = manifestFor(version, files);
    const manifestPath = writeManifest(dir, manifest);

    // Happy path: every public artifact is fetched completely in release order, without Range.
    const requests = [];
    const successFetch = async (url, options) => {
      const parsed = new URL(url);
      const name = nameFromUrl(url);
      requests.push({ name, url: parsed, options });
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'follow');
      assert.equal(new Headers(options.headers || {}).has('range'), false, 'integrity GET must not use Range');
      assert.ok(options.signal instanceof AbortSignal);
      return response(200, [files.get(name)]);
    };
    const verified = await verifyPublicArtifactIntegrity({
      root: 'https://release.example.test/geek',
      version,
      manifestPath,
      fetchImpl: successFetch,
      attempts: 1,
      delayMs: 0,
      timeoutMs: 5000,
      now: () => 12345,
      logger: quietLogger(),
    });
    assert.deepEqual(verified.map((entry) => entry.name), [...files.keys()]);
    assert.deepEqual(requests.map((entry) => entry.name), [...files.keys()]);
    assert.equal(new Set(requests.map((entry) => entry.url.searchParams.get('integrity'))).size, 3, 'each GET must get a distinct cache buster');
    assert.ok(requests.every((entry) => entry.url.pathname.startsWith('/geek/')), 'public root path prefix must be preserved');

    // HTTP failures are fail-closed and response bodies are cancelled, not logged or consumed.
    const secret = Buffer.from('SECRET_RESPONSE_BODY');
    const httpTracker = {};
    const httpLogs = [];
    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: async () => response(503, [secret], httpTracker),
        attempts: 1, delayMs: 0, timeoutMs: 5000, logger: quietLogger(httpLogs),
      }),
      'PUBLIC_RELEASE_ARTIFACT_HTTP',
    );
    assert.equal(httpTracker.cancelled, true, 'non-200 body must be cancelled');
    assert.equal(httpTracker.reads, 0, 'non-200 body must never be read');
    assert.equal(httpLogs.some((line) => line.includes(secret.toString())), false, 'response body must never reach logs');
    assert.match(httpLogs[0], /code=PUBLIC_RELEASE_ARTIFACT_HTTP .*artifact=geek-setup-9\.8\.7\.exe .*attempt=1/);
    assert.equal(httpLogs[0].includes('release.example.test'), false, 'public root must not be logged on failure');

    // Oversized files stop at the first chunk that crosses the manifest boundary.
    const largeTracker = {};
    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: async () => response(200, [Buffer.alloc(files.values().next().value.length + 1), Buffer.from('must-not-read')], largeTracker),
        attempts: 1, delayMs: 0, timeoutMs: 5000, logger: quietLogger(),
      }),
      'PUBLIC_RELEASE_SIZE_MISMATCH',
    );
    assert.equal(largeTracker.reads, 1, 'oversized download must fail before reading another chunk');

    // Truncated files fail exact-size verification.
    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: async (url) => {
          const expected = files.get(nameFromUrl(url));
          return response(200, [expected.subarray(0, Math.max(0, expected.length - 1))]);
        },
        attempts: 1, delayMs: 0, timeoutMs: 5000, logger: quietLogger(),
      }),
      'PUBLIC_RELEASE_SIZE_MISMATCH',
    );

    // Same-size blockmap tampering must be caught by SHA-256, not just length.
    const tamperRequests = [];
    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: async (url) => {
          const name = nameFromUrl(url);
          tamperRequests.push(name);
          const expected = files.get(name);
          if (!name.endsWith('.blockmap')) return response(200, [expected]);
          const tampered = Buffer.from(expected);
          tampered[0] ^= 0xff;
          return response(200, [tampered]);
        },
        attempts: 1, delayMs: 0, timeoutMs: 5000, logger: quietLogger(),
      }),
      'PUBLIC_RELEASE_HASH_MISMATCH',
    );
    assert.deepEqual(tamperRequests, [
      `geek-setup-${version}.exe`,
      `geek-setup-${version}.exe.blockmap`,
    ], 'verification must fail on the tampered blockmap before declaring the release valid');

    // Manifest failures are deterministic and happen before any network request.
    let networkCalls = 0;
    const noNetwork = async () => { networkCalls += 1; throw new Error('must not fetch'); };
    const wrongVersionPath = writeManifest(dir, { ...manifest, version: '9.8.6' });
    await rejectsCode(
      verifyPublicArtifactIntegrity({ root: 'https://release.example.test', version, manifestPath: wrongVersionPath, fetchImpl: noNetwork, logger: quietLogger() }),
      'PUBLIC_RELEASE_MANIFEST_INVALID',
    );
    assert.equal(networkCalls, 0);

    for (const missingName of files.keys()) {
      const missing = manifestFor(version, files);
      missing.files = missing.files.filter((entry) => entry.name !== missingName);
      const missingPath = writeManifest(dir, missing);
      await rejectsCode(
        verifyPublicArtifactIntegrity({ root: 'https://release.example.test', version, manifestPath: missingPath, fetchImpl: noNetwork, logger: quietLogger() }),
        'PUBLIC_RELEASE_MANIFEST_INVALID',
      );
    }
    assert.equal(networkCalls, 0);

    const badSha = manifestFor(version, files);
    badSha.files[0].sha256 = 'z'.repeat(64);
    const badShaPath = writeManifest(dir, badSha);
    await rejectsCode(
      verifyPublicArtifactIntegrity({ root: 'https://release.example.test', version, manifestPath: badShaPath, fetchImpl: noNetwork, logger: quietLogger() }),
      'PUBLIC_RELEASE_MANIFEST_INVALID',
    );

    for (const invalidSize of ['15', -1, Number.MAX_SAFE_INTEGER + 1]) {
      const badSize = manifestFor(version, files);
      badSize.files[0].size = invalidSize;
      const badSizePath = writeManifest(dir, badSize);
      await rejectsCode(
        verifyPublicArtifactIntegrity({ root: 'https://release.example.test', version, manifestPath: badSizePath, fetchImpl: noNetwork, logger: quietLogger() }),
        'PUBLIC_RELEASE_MANIFEST_INVALID',
      );
    }

    const duplicate = manifestFor(version, files);
    duplicate.files.push({ ...duplicate.files[0] });
    const duplicatePath = writeManifest(dir, duplicate);
    await rejectsCode(
      verifyPublicArtifactIntegrity({ root: 'https://release.example.test', version, manifestPath: duplicatePath, fetchImpl: noNetwork, logger: quietLogger() }),
      'PUBLIC_RELEASE_MANIFEST_INVALID',
    );
    assert.equal(networkCalls, 0);

    const invalidJsonPath = path.join(dir, 'release-manifest-invalid.json');
    fs.writeFileSync(invalidJsonPath, '{not-json');
    await rejectsCode(
      verifyPublicArtifactIntegrity({ root: 'https://release.example.test', version, manifestPath: invalidJsonPath, fetchImpl: noNetwork, logger: quietLogger() }),
      'PUBLIC_RELEASE_MANIFEST_INVALID',
    );
    assert.equal(networkCalls, 0);

    // Root validation is HTTPS-only and rejects credentials/query/hash before reading the manifest.
    for (const root of [
      'not a url',
      'http://release.example.test',
      'https://user:pass@release.example.test',
      'https://release.example.test?cached=1',
      'https://release.example.test#fragment',
    ]) {
      await rejectsCode(
        verifyPublicArtifactIntegrity({ root, version, manifestPath, fetchImpl: noNetwork, logger: quietLogger() }),
        'PUBLIC_RELEASE_ROOT_INVALID',
      );
    }

    // Retry is explicitly bounded and never converts repeated network/HTTP failure into success.
    let retryCalls = 0;
    const retryLogs = [];
    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: async () => { retryCalls += 1; return response(502, [Buffer.from('upstream')]); },
        attempts: 3, delayMs: 0, timeoutMs: 5000, logger: quietLogger(retryLogs),
      }),
      'PUBLIC_RELEASE_ARTIFACT_HTTP',
    );
    assert.equal(retryCalls, 3, 'retry count must stop at attempts');
    assert.equal(retryLogs.length, 3);

    const networkLogs = [];
    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: async () => { throw new Error('socket secret detail'); },
        attempts: 1, delayMs: 0, timeoutMs: 5000, logger: quietLogger(networkLogs),
      }),
      'PUBLIC_RELEASE_ARTIFACT_NETWORK',
    );
    assert.match(networkLogs[0], /code=PUBLIC_RELEASE_ARTIFACT_NETWORK/);
    assert.equal(networkLogs[0].includes('socket secret detail'), false, 'network failure details must not reach logs');

    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: noNetwork, attempts: 11, delayMs: 0, timeoutMs: 5000, logger: quietLogger(),
      }),
      'PUBLIC_RELEASE_ATTEMPTS_INVALID',
    );

    // AbortController timeout is normalized to a stable non-sensitive code.
    const timeoutLogs = [];
    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('network details must not escape');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        }),
        attempts: 1, delayMs: 0, timeoutMs: 1000, logger: quietLogger(timeoutLogs),
      }),
      'PUBLIC_RELEASE_ARTIFACT_TIMEOUT',
    );
    assert.match(timeoutLogs[0], /code=PUBLIC_RELEASE_ARTIFACT_TIMEOUT/);
    assert.equal(timeoutLogs[0].includes('network details'), false);

    // A 200 response without a streaming body fails closed.
    await rejectsCode(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: async () => response(200, null),
        attempts: 1, delayMs: 0, timeoutMs: 5000, logger: quietLogger(),
      }),
      'PUBLIC_RELEASE_ARTIFACT_BODY_MISSING',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('RELEASE_PUBLIC_INTEGRITY_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
