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

(async () => {
  const version = '9.8.7';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-public-integrity-'));
  try {
    const files = new Map([
      [`geek-setup-${version}.exe`, Buffer.from('installer-bytes')],
      [`geek-setup-${version}.exe.blockmap`, Buffer.from('blockmap-bytes')],
      ['latest.yml', Buffer.from(`version: ${version}\npath: geek-setup-${version}.exe\nsha512: test\n`)],
    ]);
    const manifest = {
      version,
      files: [...files].map(([name, bytes]) => ({ name, size: bytes.length, sha256: sha256(bytes) })),
    };
    const manifestPath = path.join(dir, 'release-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const requested = [];
    const fetchImpl = async (url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(new Headers(options.headers || {}).has('range'), false, 'integrity verification must download complete files');
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
      requested.push(name);
      return new Response(files.get(name), { status: files.has(name) ? 200 : 404 });
    };

    const verified = await verifyPublicArtifactIntegrity({
      root: 'https://release.example.test', version, manifestPath, fetchImpl, attempts: 1, delayMs: 0, timeoutMs: 5000,
    });
    assert.deepEqual(verified.map((entry) => entry.name), [...files.keys()]);
    assert.deepEqual(requested, [...files.keys()]);

    const badFetch = async (url) => {
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
      const bytes = name.endsWith('.blockmap') ? Buffer.from('tampered') : files.get(name);
      return new Response(bytes, { status: 200 });
    };
    await assert.rejects(
      verifyPublicArtifactIntegrity({
        root: 'https://release.example.test', version, manifestPath, fetchImpl: badFetch, attempts: 1, delayMs: 0, timeoutMs: 5000,
      }),
      (error) => error?.code === 'PUBLIC_RELEASE_SIZE_MISMATCH' || error?.code === 'PUBLIC_RELEASE_HASH_MISMATCH',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('RELEASE_PUBLIC_INTEGRITY_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
