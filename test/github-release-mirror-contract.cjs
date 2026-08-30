'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadReleaseArtifacts } = require('../scripts/github-release-mirror.cjs');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const version = '9.8.7';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-release-mirror-'));
try {
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

  const loaded = loadReleaseArtifacts(dir, version);
  assert.equal(loaded.artifacts.length, 4, 'GitHub mirror must include installer, blockmap, latest.yml, and manifest');
  assert.deepEqual(
    loaded.artifacts.map((entry) => entry.name),
    [`geek-setup-${version}.exe`, `geek-setup-${version}.exe.blockmap`, 'latest.yml', 'release-manifest.json'],
  );

  fs.appendFileSync(path.join(dir, `geek-setup-${version}.exe`), 'tampered');
  assert.throws(
    () => loadReleaseArtifacts(dir, version),
    /does not match manifest/,
    'mirror must fail closed when local bytes drift from release-manifest.json',
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('GITHUB_RELEASE_MIRROR_CONTRACT_OK');
