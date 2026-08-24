'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const source = path.join(root, 'dist-release', `geek-setup-${pkg.version}.exe`);
if (!fs.existsSync(source)) throw new Error(`Missing validation installer: ${source}`);

const outDir = path.join(root, 'dist-validation');
fs.mkdirSync(outDir, { recursive: true });
const short = String(process.env.GITHUB_SHA || 'local').slice(0, 8);
const installerName = `geek-${pkg.version}-broadcast-product-fixed-${short}.exe`;
const target = path.join(outDir, installerName);
fs.copyFileSync(source, target);

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
const manifest = {
  purpose: 'broadcast-product-post-regression-fix-real-client-validation',
  sourceCommit: process.env.GITHUB_SHA || null,
  productHead: '2b383424380fdd8f48ef65ac48a1fb9a94142b1f',
  packageVersion: pkg.version,
  installer: installerName,
  sha256,
  buildCommand: 'npm run dist:test',
  productionPublished: false,
};
fs.writeFileSync(path.join(outDir, 'validation-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`validation-installer=${installerName}`);
console.log(`sha256=${sha256}`);
