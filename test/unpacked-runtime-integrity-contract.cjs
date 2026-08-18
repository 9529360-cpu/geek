'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildRuntimeIntegrityManifest, verifyRuntimeIntegrity } = require('../src/unpacked-integrity.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = fs.readFileSync(path.join(root, 'scripts', 'release-build.cjs'), 'utf8');
const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

assert.match(main, /verifyPackagedUnpackedAssets\(\)/, 'main process must define packaged unpacked-asset verification');
assert.ok(main.indexOf('await verifyPackagedUnpackedAssets();') < main.indexOf('await enforceSubscriptionGate();'), 'runtime assets must be verified before any main app window can be created');
assert.match(main, /if \(!runtimeAssetAllowed\('bridge'\)\) throw new Error/, 'renderer must not receive a tampered bridge preload path');
assert.match(main, /if \(!runtimeAssetAllowed\('lineExtension'\)\)/, 'LINE extension loader must fail closed after integrity failure');
assert.match(main, /const integrityComponent = isLine \? 'lineExtension' : 'bridge';[\s\S]{0,300}event\.preventDefault\(\);[\s\S]{0,100}return;/, 'tampered webview runtime assets must prevent guest attachment');
assert.match(pkg.scripts['integrity:generate'] || '', /generate-unpacked-integrity/, 'packaging must have a manifest generator');
assert.match(pkg.scripts.pack || '', /integrity:generate/, 'directory packaging must generate the protected manifest');
assert.match(pkg.scripts['dist:test'] || '', /integrity:generate/, 'test installer packaging must generate the protected manifest');
assert.match(release, /generate-unpacked-integrity\.cjs/, 'formal release build must generate the protected manifest');
assert.ok(release.indexOf('generate-unpacked-integrity.cjs') < release.indexOf("electron-builder/out/cli/cli.js"), 'formal release must generate integrity metadata before electron-builder packs app.asar');
assert.match(ignore, /src\/unpacked-integrity\.generated\.json/, 'generated manifest must not be committed as mutable source');

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-unpacked-integrity-'));
  const resources = path.join(temp, 'resources');
  const line = path.join(resources, 'extensions', 'line-3.5.1');
  const manifestPath = path.join(temp, 'manifest.json');
  try {
    await fsp.mkdir(line, { recursive: true });
    await fsp.writeFile(path.join(resources, 'bridge-preload.cjs'), 'bridge-v1\n');
    await fsp.writeFile(path.join(line, 'manifest.json'), '{"name":"line"}\n');
    await fsp.writeFile(path.join(line, 'main.js'), 'console.log("line");\n');
    const manifest = await buildRuntimeIntegrityManifest(resources);
    await fsp.writeFile(manifestPath, JSON.stringify(manifest));
    let verified = await verifyRuntimeIntegrity({ manifestPath, resourcesDir: resources });
    assert.equal(verified.bridge, true);
    assert.equal(verified.lineExtension, true);

    await fsp.writeFile(path.join(resources, 'bridge-preload.cjs'), 'bridge-tampered\n');
    verified = await verifyRuntimeIntegrity({ manifestPath, resourcesDir: resources });
    assert.equal(verified.bridge, false, 'bridge tampering must be detected');
    assert.equal(verified.lineExtension, true);

    await fsp.writeFile(path.join(resources, 'bridge-preload.cjs'), 'bridge-v1\n');
    await fsp.appendFile(path.join(line, 'main.js'), '//tampered\n');
    verified = await verifyRuntimeIntegrity({ manifestPath, resourcesDir: resources });
    assert.equal(verified.bridge, true);
    assert.equal(verified.lineExtension, false, 'LINE extension tampering must be detected');
    console.log('UNPACKED_RUNTIME_INTEGRITY_CONTRACT_OK');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
