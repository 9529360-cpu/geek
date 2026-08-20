'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function write(rel, value) {
  fs.writeFileSync(path.join(root, rel), value);
}
function replaceExact(rel, needle, replacement, expectedCount = 1) {
  const source = read(rel);
  const count = source.split(needle).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${rel}: expected ${expectedCount} occurrences of ${JSON.stringify(needle)}, found ${count}`);
  }
  write(rel, source.split(needle).join(replacement));
}

const linePreload = read('resources/s3loYR.js');
const main = read('src/main.cjs');
const app = read('ui/app.js');
const adapters = read('ui/translation-adapters.js');
if (!linePreload.includes("REQUEST_TYPE = 'geek-translation-request'")) throw new Error('LINE translation bridge fix is missing');
if (!linePreload.includes('Object.freeze({ send2Host })')) throw new Error('LINE translation bridge surface is missing');
if (!main.includes("'resources', 's3loYR.js'")) throw new Error('LINE preload attachment is missing');
if (!adapters.includes('window.$electron?.send2Host')) throw new Error('LINE adapter transport is missing');
if (!app.includes("message.type !== 'geek-translation-request'")) throw new Error('LINE host bridge authorization path is missing');

replaceExact('package.json', '"version": "1.2.12"', '"version": "1.2.13"');
replaceExact('package-lock.json', '"version": "1.2.12"', '"version": "1.2.13"', 2);
write('.github/release-client-version', '1.2.13\n');
replaceExact('scripts/geek-website-worker.js', "const FALLBACK_VERSION = '1.2.11';", "const FALLBACK_VERSION = '1.2.12';");
replaceExact(
  'README.md',
  '客户端与 `package.json` 版本为 **1.2.12**，`.github/release-client-version` 为 **1.2.12**',
  '客户端与 `package.json` 版本为 **1.2.13**，`.github/release-client-version` 为 **1.2.13**'
);
replaceExact(
  'docs/release-security.md',
  '当前正式客户端版本为 `1.2.12`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.12`。',
  '当前正式客户端版本为 `1.2.13`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.13`。'
);
replaceExact(
  'docs/github-control-plane.md',
  'Current client/package version and `.github/release-client-version` are both `1.2.12`.',
  'Current client/package version and `.github/release-client-version` are both `1.2.13`.'
);

console.log('PREPARE_RELEASE_1_2_13_OK');
