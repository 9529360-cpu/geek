'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadReleaseArtifacts, mirrorRelease } = require('../scripts/github-release-mirror.cjs');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeDist() {
  const version = '9.8.7';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-release-mirror-failures-'));
  const files = new Map([
    [`geek-setup-${version}.exe`, Buffer.from('installer-bytes')],
    [`geek-setup-${version}.exe.blockmap`, Buffer.from('blockmap-bytes')],
    ['latest.yml', Buffer.from(`version: ${version}\npath: geek-setup-${version}.exe\nsha512: test\n`)],
  ]);
  const manifestFiles = [];
  for (const [name, bytes] of files) {
    fs.writeFileSync(path.join(dir, name), bytes);
    manifestFiles.push({ name, size: bytes.length, sha256: sha256(bytes) });
  }
  fs.writeFileSync(path.join(dir, 'release-manifest.json'), JSON.stringify({ version, files: manifestFiles }, null, 2));
  return { dir, version };
}

function releaseAssets(distDir, version) {
  return loadReleaseArtifacts(distDir, version).artifacts.map((artifact, index) => ({
    id: index + 1,
    name: artifact.name,
    size: artifact.size,
    digest: `sha256:${artifact.sha256}`,
    url: `https://api.github.test/assets/${index + 1}`,
  }));
}

async function withFetch(fetchImpl, task) {
  const original = global.fetch;
  global.fetch = fetchImpl;
  try {
    return await task();
  } finally {
    global.fetch = original;
  }
}

(async () => {
  const { dir, version } = makeDist();
  const target = 'a'.repeat(40);
  const wrongTarget = 'b'.repeat(40);
  const repository = 'owner/geek';
  const token = 'test-token';
  const tag = `v${version}`;
  const apiRoot = `https://api.github.com/repos/${repository}`;
  const assets = releaseAssets(dir, version);

  const baseRelease = {
    id: 77,
    draft: false,
    prerelease: false,
    upload_url: 'https://uploads.github.test/releases/77/assets{?name,label}',
    assets,
  };

  function publishedFetch(release = baseRelease, tagSha = target) {
    return async (url) => {
      const value = String(url);
      if (value === `${apiRoot}/releases/tags/${encodeURIComponent(tag)}`) return jsonResponse(release);
      if (value === `${apiRoot}/git/ref/tags/${encodeURIComponent(tag)}`) {
        return jsonResponse({ object: { type: 'commit', sha: tagSha } });
      }
      throw new Error(`unexpected fetch: ${value}`);
    };
  }

  try {
    const result = await withFetch(publishedFetch(), () => mirrorRelease({
      repository, version, targetCommitish: target, token, distDir: dir,
    }));
    assert.equal(result.draft, false, 'matching published release should be idempotent');

    await assert.rejects(
      withFetch(publishedFetch({ ...baseRelease, assets: assets.slice(0, -1) }), () => mirrorRelease({
        repository, version, targetCommitish: target, token, distDir: dir,
      })),
      /published GitHub release is missing asset/,
    );

    const mismatched = assets.map((asset, index) => index === 0
      ? { ...asset, digest: `sha256:${'0'.repeat(64)}` }
      : asset);
    await assert.rejects(
      withFetch(publishedFetch({ ...baseRelease, assets: mismatched }), () => mirrorRelease({
        repository, version, targetCommitish: target, token, distDir: dir,
      })),
      /GitHub asset sha256 mismatch/,
    );

    await assert.rejects(
      withFetch(publishedFetch({
        ...baseRelease,
        assets: [...assets, { id: 99, name: 'unexpected.exe', size: 1, digest: `sha256:${'1'.repeat(64)}` }],
      }), () => mirrorRelease({ repository, version, targetCommitish: target, token, distDir: dir })),
      /unexpected assets/,
    );

    await assert.rejects(
      withFetch(publishedFetch(baseRelease, wrongTarget), () => mirrorRelease({
        repository, version, targetCommitish: target, token, distDir: dir,
      })),
      /GitHub tag target mismatch/,
    );

    let patchCalls = 0;
    const draftRelease = {
      id: 88,
      draft: true,
      prerelease: false,
      upload_url: 'https://uploads.github.test/releases/88/assets{?name,label}',
      assets: [],
    };
    await assert.rejects(
      withFetch(async (url, options = {}) => {
        const value = String(url);
        if (value === `${apiRoot}/releases/tags/${encodeURIComponent(tag)}`) return jsonResponse(draftRelease);
        if (value === `${apiRoot}/git/ref/tags/${encodeURIComponent(tag)}`) return jsonResponse({}, 404);
        if (value.startsWith('https://uploads.github.test/releases/88/assets?name=')) return jsonResponse({ error: 'upload failed' }, 500);
        if (options.method === 'PATCH') patchCalls += 1;
        throw new Error(`unexpected fetch: ${value}`);
      }, () => mirrorRelease({ repository, version, targetCommitish: target, token, distDir: dir })),
      /GitHub asset upload 500/,
    );
    assert.equal(patchCalls, 0, 'a failed asset upload must never publish the draft release');

    await assert.rejects(
      withFetch(async (url) => {
        if (String(url) === `${apiRoot}/releases/tags/${encodeURIComponent(tag)}`) return jsonResponse({ error: 'server' }, 500);
        throw new Error(`unexpected fetch: ${url}`);
      }, () => mirrorRelease({ repository, version, targetCommitish: target, token, distDir: dir })),
      /GitHub API GET 500/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('GITHUB_RELEASE_MIRROR_FAILURES_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
