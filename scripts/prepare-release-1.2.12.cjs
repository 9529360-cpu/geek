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

const preload = read('src/preload.cjs');
const main = read('src/main.cjs');
if (preload.includes("require('../package.json')")) throw new Error('P0 sandbox preload fix is missing');
if (!preload.includes("version: () => ipcRenderer.invoke('app:get-version')")) throw new Error('app version preload bridge is missing');
if (!main.includes("ipcMain.handle('app:get-version'")) throw new Error('app:get-version IPC is missing');

replaceExact('package.json', '"version": "1.2.11"', '"version": "1.2.12"');
replaceExact('package-lock.json', '"version": "1.2.11"', '"version": "1.2.12"', 2);
write('.github/release-client-version', '1.2.12\n');
replaceExact('scripts/geek-website-worker.js', "const FALLBACK_VERSION = '1.2.10';", "const FALLBACK_VERSION = '1.2.11';");
replaceExact(
  'README.md',
  '客户端与 `package.json` 版本为 **1.2.11**，`.github/release-client-version` 为 **1.2.11**',
  '客户端与 `package.json` 版本为 **1.2.12**，`.github/release-client-version` 为 **1.2.12**'
);
replaceExact(
  'docs/release-security.md',
  '当前正式客户端版本为 `1.2.11`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.11`。',
  '当前正式客户端版本为 `1.2.12`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.12`。'
);
replaceExact(
  'docs/github-control-plane.md',
  'Current client/package version and `.github/release-client-version` are both `1.2.11`.',
  'Current client/package version and `.github/release-client-version` are both `1.2.12`.'
);

console.log('PREPARE_RELEASE_1_2_12_OK');
