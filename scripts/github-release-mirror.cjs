'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const API_VERSION = '2022-11-28';

function fail(message) {
  throw new Error(message);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function loadReleaseArtifacts(distDir, version) {
  if (!VERSION_PATTERN.test(version)) fail('invalid release version');
  const manifestPath = path.join(distDir, 'release-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== version || !Array.isArray(manifest.files)) {
    fail('release manifest version or files are invalid');
  }

  const expectedNames = [
    `geek-setup-${version}.exe`,
    `geek-setup-${version}.exe.blockmap`,
    'latest.yml',
  ];
  const manifestByName = new Map(manifest.files.map((entry) => [entry.name, entry]));
  const artifacts = expectedNames.map((name) => {
    const entry = manifestByName.get(name);
    if (!entry || !/^[a-f0-9]{64}$/.test(String(entry.sha256 || ''))) {
      fail(`release manifest missing digest for ${name}`);
    }
    const file = path.join(distDir, name);
    const stat = fs.statSync(file);
    const digest = sha256File(file);
    if (stat.size !== entry.size || digest !== entry.sha256) {
      fail(`local release artifact does not match manifest: ${name}`);
    }
    return { name, file, size: stat.size, sha256: digest };
  });

  const manifestStat = fs.statSync(manifestPath);
  artifacts.push({
    name: 'release-manifest.json',
    file: manifestPath,
    size: manifestStat.size,
    sha256: sha256File(manifestPath),
  });
  return Object.freeze({ manifest, artifacts });
}

function apiHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'geek-release-mirror',
  };
}

async function githubJson(url, { token, method = 'GET', body, allow404 = false } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...apiHeaders(token),
      ...(body == null ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) fail(`GitHub API ${method} ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

async function remoteAssetSha256(asset, token) {
  const digest = String(asset.digest || '');
  if (/^sha256:[a-f0-9]{64}$/.test(digest)) return digest.slice('sha256:'.length);
  const response = await fetch(asset.url, {
    headers: apiHeaders(token, 'application/octet-stream'),
    redirect: 'follow',
  });
  if (!response.ok) fail(`GitHub asset download ${response.status}: ${asset.name}`);
  return sha256Buffer(Buffer.from(await response.arrayBuffer()));
}

async function verifyExistingAsset(asset, local, token) {
  if (Number(asset.size) !== local.size) fail(`GitHub asset size mismatch: ${local.name}`);
  const digest = await remoteAssetSha256(asset, token);
  if (digest !== local.sha256) fail(`GitHub asset sha256 mismatch: ${local.name}`);
}

async function uploadAsset(release, local, token) {
  const uploadRoot = String(release.upload_url || '').replace(/\{.*$/, '');
  if (!uploadRoot) fail('GitHub release upload URL missing');
  const response = await fetch(`${uploadRoot}?name=${encodeURIComponent(local.name)}`, {
    method: 'POST',
    headers: {
      ...apiHeaders(token, 'application/vnd.github+json'),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(local.size),
    },
    body: fs.readFileSync(local.file),
  });
  if (!response.ok) fail(`GitHub asset upload ${response.status}: ${local.name}`);
  return response.json();
}

async function mirrorRelease(options = {}) {
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || '').trim();
  const version = String(options.version || process.env.RELEASE_VERSION || '').trim();
  const targetCommitish = String(options.targetCommitish || process.env.GITHUB_SHA || '').trim();
  const token = String(options.token || process.env.GITHUB_TOKEN || '').trim();
  const distDir = path.resolve(options.distDir || path.join(__dirname, '..', 'dist-release'));
  if (!/^[^/]+\/[^/]+$/.test(repository)) fail('GITHUB_REPOSITORY is invalid');
  if (!VERSION_PATTERN.test(version)) fail('RELEASE_VERSION is invalid');
  if (!/^[a-f0-9]{40}$/i.test(targetCommitish)) fail('GITHUB_SHA is invalid');
  if (!token) fail('GITHUB_TOKEN is missing');

  const { artifacts } = loadReleaseArtifacts(distDir, version);
  const apiRoot = `https://api.github.com/repos/${repository}`;
  const tag = `v${version}`;
  let release = await githubJson(`${apiRoot}/releases/tags/${encodeURIComponent(tag)}`, {
    token,
    allow404: true,
  });

  if (!release) {
    release = await githubJson(`${apiRoot}/releases`, {
      token,
      method: 'POST',
      body: {
        tag_name: tag,
        target_commitish: targetCommitish,
        name: `极客 v${version}`,
        body: `Production mirror for Geek ${version}. The R2 updater source remains authoritative. Source commit: ${targetCommitish}.`,
        draft: true,
        prerelease: false,
      },
    });
  }

  const publishedAlready = release.draft === false;
  const assets = Array.isArray(release.assets) ? [...release.assets] : [];
  const byName = new Map(assets.map((asset) => [asset.name, asset]));

  for (const local of artifacts) {
    let asset = byName.get(local.name);
    if (!asset) {
      if (publishedAlready) fail(`published GitHub release is missing asset: ${local.name}`);
      asset = await uploadAsset(release, local, token);
      byName.set(local.name, asset);
    }
    await verifyExistingAsset(asset, local, token);
  }

  const unexpected = assets.filter((asset) => !artifacts.some((local) => local.name === asset.name));
  if (unexpected.length) fail(`GitHub release contains unexpected assets: ${unexpected.map((a) => a.name).join(', ')}`);

  if (release.draft) {
    release = await githubJson(`${apiRoot}/releases/${release.id}`, {
      token,
      method: 'PATCH',
      body: { draft: false, prerelease: false, make_latest: 'true' },
    });
  }

  const finalRelease = await githubJson(`${apiRoot}/releases/tags/${encodeURIComponent(tag)}`, { token });
  const finalByName = new Map((finalRelease.assets || []).map((asset) => [asset.name, asset]));
  for (const local of artifacts) {
    const asset = finalByName.get(local.name);
    if (!asset) fail(`GitHub release verification missing asset: ${local.name}`);
    await verifyExistingAsset(asset, local, token);
  }
  if (finalRelease.draft || finalRelease.prerelease) fail('GitHub release did not publish as stable');
  console.log(`github-release-mirror=v${version}`);
  return finalRelease;
}

if (require.main === module) {
  mirrorRelease().catch((error) => {
    console.error(`GitHub release mirror failed: ${String(error?.message || error).slice(0, 240)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  loadReleaseArtifacts,
  mirrorRelease,
};
