'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseLatestMetadata,
  capturePreviousStable,
  verifyPublicRelease,
} = require('../scripts/release-public-check.cjs');

const root = path.join(__dirname, '..');
const workflow = fs
  .readFileSync(path.join(root, '.github', 'workflows', 'release-client-production.yml'), 'utf8')
  .replace(/\r\n?/g, '\n');
const checkerSource = fs.readFileSync(path.join(root, 'scripts', 'release-public-check.cjs'), 'utf8');

const capture = workflow.indexOf('- name: Capture previous stable metadata');
const upload = workflow.indexOf('- name: Upload installer and blockmap to R2');
const snapshot = workflow.indexOf('- name: Snapshot rollback metadata');
const publish = workflow.indexOf('- name: Publish latest metadata last');
const verify = workflow.indexOf('- name: Verify production and rollback on failure');

for (const [name, index] of Object.entries({ capture, upload, snapshot, publish, verify })) {
  assert.ok(index >= 0, `release workflow must contain ${name} stage`);
}
assert.ok(capture < upload, 'previous stable metadata must be captured before new artifacts are uploaded');
assert.ok(upload < snapshot, 'new immutable artifacts should upload before rollback metadata snapshot');
assert.ok(snapshot < publish, 'rollback snapshot must exist before production latest.yml is overwritten');
assert.ok(publish < verify, 'production metadata must be verified after promotion');

assert.match(workflow, /geek-release\/rollback\/latest\.yml/, 'release workflow must keep a private rollback metadata snapshot');
assert.match(workflow, /geek-release\/rollback\/latest-\$env:PREVIOUS_RELEASE_VERSION\.yml/, 'release workflow must keep a versioned rollback metadata snapshot');
assert.match(workflow, /r2 object put 'geek-release\/latest\.yml' --file 'dist-release\/previous-latest\.yml' --remote/, 'failed promotion must restore previous latest.yml');
assert.match(workflow, /node scripts\/release-public-check\.cjs capture/, 'rollback preflight must use the cross-platform public checker');
assert.match(workflow, /node scripts\/release-public-check\.cjs verify/g, 'promotion and rollback verification must use the same public checker');
assert.match(workflow, /--release-version \$env:RELEASE_VERSION/, 'capture mode must receive the authorized package version');
assert.match(workflow, /--metadata-out 'dist-release\\previous-latest\.yml'/, 'capture mode must preserve previous metadata for rollback');
assert.match(workflow, /--github-env \$env:GITHUB_ENV/, 'capture mode must publish rollback state to later workflow steps');
assert.match(workflow, /--attempts 6/, 'rollback preflight attempts must be explicitly bounded');
assert.match(workflow, /--attempts 18/, 'post-promotion verification attempts must be explicitly bounded');
assert.match(workflow, /Refusing promotion without a verified previous stable release/, 'new promotions must remain fail closed');
assert.doesNotMatch(workflow, /Invoke-WebRequest[^\n]*-Method Head/, 'Windows release checks must not use the unreliable Invoke-WebRequest HEAD path');
assert.doesNotMatch(workflow, /curl\.exe/, 'release correctness must not depend on platform-specific curl behavior');
assert.match(workflow, /Production|Published Geek|rollback/i, 'workflow must retain explicit promotion and rollback reporting');
assert.match(workflow, /^  workflow_dispatch:$/m, 'failed releases must have a deliberate same-version retry entrypoint');
assert.match(workflow, /paths:\s*\n\s*- '\.github\/release-client-version'/, 'normal master pushes must not publish a client release');

assert.match(checkerSource, /headers: \{ Range: 'bytes=0-0' \}/, 'artifact checks must use bounded ranged GET requests');
assert.match(checkerSource, /await response\.body\.cancel\(\)/, 'artifact response bodies must be cancelled without reading contents');
assert.match(checkerSource, /attempts > 120/, 'retry configuration must have a hard upper bound');
assert.match(checkerSource, /PUBLIC_RELEASE_ARTIFACT_HTTP/, 'artifact HTTP failures must be explicit');
assert.match(checkerSource, /PUBLIC_RELEASE_VERSION_NOT_PROMOTED/, 'stale public metadata must fail verification');
assert.doesNotMatch(checkerSource, /console\.(?:log|warn|error)\([^\n]*(?:metadata\.text|response\.text)/, 'public response bodies must never be logged');

function latest(version) {
  return [
    `version: ${version}`,
    `path: geek-setup-${version}.exe`,
    'sha512: test-sha512-value',
    'releaseDate: 2026-08-19T00:00:00.000Z',
    '',
  ].join('\n');
}

function fakeResponse(status, text = '') {
  let cancelled = false;
  return {
    status,
    headers: { get: (name) => String(name).toLowerCase() === 'content-length' ? String(Buffer.byteLength(text)) : null },
    text: async () => text,
    body: {
      cancel: async () => { cancelled = true; },
    },
    wasCancelled: () => cancelled,
  };
}

function successfulFetch(version, requests, artifactResponses) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    if (parsed.pathname === '/latest.yml') return fakeResponse(200, latest(version));
    const response = fakeResponse(parsed.pathname.endsWith('.blockmap') ? 206 : 200);
    artifactResponses.push(response);
    return response;
  };
}

(async () => {
  assert.equal(parseLatestMetadata(latest('1.2.8')).artifactPath, 'geek-setup-1.2.8.exe');
  assert.throws(
    () => parseLatestMetadata('version: 1.2.8\npath: geek-setup-9.9.9.exe\nsha512: x\n'),
    { code: 'PUBLIC_RELEASE_METADATA_PATH_MISMATCH' },
  );

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-release-capture-'));
    const metadataOut = path.join(dir, 'previous-latest.yml');
    const githubEnv = path.join(dir, 'github-env.txt');
    const requests = [];
    const artifactResponses = [];
    const result = await capturePreviousStable({
      root: 'https://release.example.test',
      releaseVersion: '1.2.9',
      metadataOut,
      githubEnv,
      attempts: 1,
      delayMs: 0,
      timeoutMs: 1000,
      now: () => 100,
      sleep: async () => {},
      fetchImpl: successfulFetch('1.2.8', requests, artifactResponses),
    });
    assert.equal(result.idempotent, false);
    assert.equal(result.metadata.version, '1.2.8');
    assert.equal(fs.readFileSync(metadataOut, 'utf8'), latest('1.2.8'));
    const env = fs.readFileSync(githubEnv, 'utf8');
    assert.match(env, /^PREVIOUS_RELEASE_VERSION=1\.2\.8$/m);
    assert.match(env, /^ROLLBACK_AVAILABLE=true$/m);
    assert.equal(requests.length, 3, 'capture must fetch metadata, installer and blockmap');
    assert.equal(requests[1].options.method, 'GET');
    assert.equal(requests[1].options.headers.Range, 'bytes=0-0');
    assert.equal(requests[2].options.headers.Range, 'bytes=0-0');
    assert.equal(artifactResponses.every((response) => response.wasCancelled()), true, 'artifact bodies must be cancelled');
  }

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-release-idempotent-'));
    const githubEnv = path.join(dir, 'github-env.txt');
    const requests = [];
    const result = await capturePreviousStable({
      root: 'https://release.example.test',
      releaseVersion: '1.2.9',
      githubEnv,
      attempts: 1,
      delayMs: 0,
      timeoutMs: 1000,
      now: () => 200,
      sleep: async () => {},
      fetchImpl: successfulFetch('1.2.9', requests, []),
    });
    assert.equal(result.idempotent, true);
    assert.equal(requests.length, 1, 'same-version rerun must not require an older rollback artifact');
    assert.match(fs.readFileSync(githubEnv, 'utf8'), /^ROLLBACK_AVAILABLE=false$/m);
  }

  {
    const requests = [];
    const artifacts = [];
    const metadata = await verifyPublicRelease({
      root: 'https://release.example.test',
      version: '1.2.9',
      attempts: 1,
      delayMs: 0,
      timeoutMs: 1000,
      now: () => 300,
      sleep: async () => {},
      fetchImpl: successfulFetch('1.2.9', requests, artifacts),
    });
    assert.equal(metadata.version, '1.2.9');
    assert.equal(requests.length, 3);
    assert.equal(artifacts.every((response) => response.wasCancelled()), true);
  }

  {
    let calls = 0;
    await assert.rejects(
      verifyPublicRelease({
        root: 'https://release.example.test',
        version: '1.2.9',
        attempts: 2,
        delayMs: 0,
        timeoutMs: 1000,
        now: () => 400,
        sleep: async () => {},
        fetchImpl: async () => {
          calls += 1;
          return fakeResponse(404);
        },
      }),
      { code: 'PUBLIC_RELEASE_METADATA_HTTP' },
    );
    assert.equal(calls, 2, 'verification must stop after the configured retry budget');
  }

  console.log('release-rollback-contract: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
