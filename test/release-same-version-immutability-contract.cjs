'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifySameVersionRelease } = require('../scripts/release-same-version-check.cjs');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function makeManifest(version, installer, blockmap, latest) {
  return {
    version,
    generatedAt: '2026-09-15T00:00:00.000Z',
    files: [
      { name: `geek-setup-${version}.exe`, size: installer.length, sha256: sha256(installer) },
      { name: `geek-setup-${version}.exe.blockmap`, size: blockmap.length, sha256: sha256(blockmap) },
      { name: 'latest.yml', size: latest.length, sha256: sha256(latest) },
    ],
  };
}

function response(status, bytes, tracker = {}) {
  const bodyBytes = Buffer.from(bytes || '');
  tracker.cancelled = false;
  tracker.reads = 0;
  return {
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-length' ? String(bodyBytes.length) : null;
      },
    },
    async text() { return bodyBytes.toString('utf8'); },
    body: {
      async *[Symbol.asyncIterator]() {
        tracker.reads += 1;
        yield bodyBytes;
      },
      async cancel() { tracker.cancelled = true; },
    },
  };
}

function publicLatest(version, releaseDate = '2026-09-15T00:10:00.000Z') {
  return Buffer.from([
    `version: ${version}`,
    `path: geek-setup-${version}.exe`,
    'sha512: public-metadata-sha512',
    `releaseDate: ${releaseDate}`,
    '',
  ].join('\n'));
}

function publicFetch({ version, installer, blockmap, latest, mutateInstaller = false, mutateBlockmap = false, requests }) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split('/').pop());
    const range = new Headers(options.headers || {}).get('range');
    requests.push({ name, range, method: options.method });
    if (name === 'latest.yml') return response(200, latest);
    if (name === `geek-setup-${version}.exe`) {
      const bytes = Buffer.from(installer);
      if (mutateInstaller && !range && bytes.length) bytes[0] ^= 0xff;
      return response(range ? 206 : 200, bytes);
    }
    if (name === `geek-setup-${version}.exe.blockmap`) {
      const bytes = Buffer.from(blockmap);
      if (mutateBlockmap && !range && bytes.length) bytes[0] ^= 0xff;
      return response(range ? 206 : 200, bytes);
    }
    return response(404, 'missing');
  };
}

function quietLogger() {
  return { warn() {} };
}

(async () => {
  const version = '9.8.7';
  const installer = Buffer.from('immutable-installer-bytes');
  const blockmap = Buffer.from('immutable-blockmap-bytes');
  const localLatest = Buffer.from([
    `version: ${version}`,
    `path: geek-setup-${version}.exe`,
    'sha512: local-generated-sha512',
    'releaseDate: 2026-09-15T00:00:00.000Z',
    '',
  ].join('\n'));
  const currentPublicLatest = publicLatest(version);
  assert.notEqual(sha256(localLatest), sha256(currentPublicLatest), 'fixture must prove mutable latest.yml bytes may differ');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-same-version-release-'));
  try {
    const manifestPath = path.join(dir, 'release-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(makeManifest(version, installer, blockmap, localLatest)));

    // Same-version retry is read-only idempotency: public versioned assets must be
    // byte-identical to the candidate, while generated latest.yml bytes may differ.
    const requests = [];
    const result = await verifySameVersionRelease({
      root: 'https://release.example.test',
      version,
      manifestPath,
      fetchImpl: publicFetch({
        version, installer, blockmap, latest: currentPublicLatest, requests,
      }),
      attempts: 1,
      delayMs: 0,
      timeoutMs: 5000,
      sleep: async () => {},
      now: () => 12345,
      logger: quietLogger(),
    });
    assert.equal(result.version, version);
    assert.deepEqual(result.immutableAssets.map((entry) => entry.name), [
      `geek-setup-${version}.exe`,
      `geek-setup-${version}.exe.blockmap`,
    ]);
    assert.deepEqual(requests.map(({ name, range }) => [name, range]), [
      ['latest.yml', null],
      [`geek-setup-${version}.exe`, 'bytes=0-0'],
      [`geek-setup-${version}.exe.blockmap`, 'bytes=0-0'],
      [`geek-setup-${version}.exe`, null],
      [`geek-setup-${version}.exe.blockmap`, null],
      ['latest.yml', null],
    ], 'same-version check must first confirm public identity, then fully hash all public artifacts');

    // A same-size installer mutation must fail closed; recovery may not repair it
    // by uploading a freshly rebuilt binary under the same semantic version.
    await assert.rejects(
      verifySameVersionRelease({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: publicFetch({
          version, installer, blockmap, latest: currentPublicLatest,
          mutateInstaller: true, requests: [],
        }),
        attempts: 1, delayMs: 0, timeoutMs: 5000, sleep: async () => {}, logger: quietLogger(),
      }),
      (error) => error?.code === 'PUBLIC_RELEASE_HASH_MISMATCH' && error?.artifact === `geek-setup-${version}.exe`,
    );

    await assert.rejects(
      verifySameVersionRelease({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: publicFetch({
          version, installer, blockmap, latest: currentPublicLatest,
          mutateBlockmap: true, requests: [],
        }),
        attempts: 1, delayMs: 0, timeoutMs: 5000, sleep: async () => {}, logger: quietLogger(),
      }),
      (error) => error?.code === 'PUBLIC_RELEASE_HASH_MISMATCH' && error?.artifact === `geek-setup-${version}.exe.blockmap`,
    );

    // A public pointer to a different version is not an idempotent same-version run.
    await assert.rejects(
      verifySameVersionRelease({
        root: 'https://release.example.test', version, manifestPath,
        fetchImpl: publicFetch({
          version, installer, blockmap, latest: publicLatest('9.8.6'), requests: [],
        }),
        attempts: 1, delayMs: 0, timeoutMs: 5000, sleep: async () => {}, logger: quietLogger(),
      }),
      (error) => error?.code === 'PUBLIC_RELEASE_VERSION_NOT_PROMOTED',
    );

    // Candidate manifest rejection happens before any public request.
    const malformedPath = path.join(dir, 'malformed.json');
    fs.writeFileSync(malformedPath, JSON.stringify({ version, files: [] }));
    let networkCalls = 0;
    await assert.rejects(
      verifySameVersionRelease({
        root: 'https://release.example.test', version, manifestPath: malformedPath,
        fetchImpl: async () => { networkCalls += 1; return response(500, 'must-not-fetch'); },
      }),
      (error) => error?.code === 'SAME_VERSION_RELEASE_MANIFEST_INVALID',
    );
    assert.equal(networkCalls, 0);

    const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release-client.yml'), 'utf8').replace(/\r\n?/g, '\n');
    const captureAt = workflow.indexOf('- name: Capture previous stable metadata');
    const immutableAt = workflow.indexOf('- name: Verify immutable same-version recovery');
    const uploadAt = workflow.indexOf('- name: Upload installer and blockmap to R2');
    const snapshotAt = workflow.indexOf('- name: Snapshot rollback metadata');
    const publishAt = workflow.indexOf('- name: Publish latest metadata last');
    const verifyAt = workflow.indexOf('- name: Verify production and rollback on failure');
    assert.ok(captureAt >= 0 && immutableAt > captureAt && uploadAt > immutableAt && snapshotAt > uploadAt && publishAt > snapshotAt && verifyAt > publishAt,
      'same-version immutability check must run before every production write while new-version ordering remains unchanged');

    const immutableStage = workflow.slice(immutableAt, uploadAt);
    assert.match(immutableStage, /if: env\.ROLLBACK_AVAILABLE == 'false'/);
    assert.match(immutableStage, /release-same-version-check\.cjs/);
    assert.match(immutableStage, /RELEASE_ALREADY_PUBLISHED=true/);
    assert.doesNotMatch(immutableStage, /r2 object put/, 'read-only same-version preflight must not mutate R2');

    for (const [name, start, end] of [
      ['versioned upload', uploadAt, snapshotAt],
      ['rollback snapshot', snapshotAt, publishAt],
      ['latest promotion', publishAt, verifyAt],
    ]) {
      const stage = workflow.slice(start, end);
      assert.match(stage, /if: env\.RELEASE_ALREADY_PUBLISHED != 'true'/, `${name} must be skipped after immutable same-version verification`);
    }

    const finalStage = workflow.slice(verifyAt);
    const readOnlyBranch = finalStage.indexOf("if ($env:RELEASE_ALREADY_PUBLISHED -eq 'true')");
    const sameVersionCheck = finalStage.indexOf('release-same-version-check.cjs');
    const noRewriteSummary = finalStage.indexOf('without rewriting installer, blockmap, or latest.yml');
    const sameVersionExit = finalStage.indexOf('exit 0', noRewriteSummary);
    const rollbackWrite = finalStage.indexOf("r2 object put 'geek-release/latest.yml' --file 'dist-release/previous-latest.yml' --remote");
    assert.ok(readOnlyBranch >= 0 && sameVersionCheck > readOnlyBranch && noRewriteSummary > sameVersionCheck && sameVersionExit > noRewriteSummary,
      'final verification must terminate an already-published run after read-only integrity verification');
    assert.ok(rollbackWrite < 0 || sameVersionExit < rollbackWrite, 'same-version success must exit before any rollback write path');

    assert.match(finalStage, /release-public-check\.cjs verify[\s\S]*release-public-integrity\.cjs[\s\S]*Published Geek/,
      'new-version promotion must retain the existing public reachability + full SHA-256 success boundary');

    console.log('RELEASE_SAME_VERSION_IMMUTABILITY_CONTRACT_OK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
