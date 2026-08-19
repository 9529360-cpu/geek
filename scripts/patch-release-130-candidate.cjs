'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`${label}: anchor missing`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`${label}: anchor not unique`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const pkgPath = path.join(root, 'package.json');
let pkg = fs.readFileSync(pkgPath, 'utf8');
pkg = replaceOnce(pkg, '  "version": "1.2.10",\n', '  "version": "1.3.0",\n', 'package version');
fs.writeFileSync(pkgPath, pkg);

const lockPath = path.join(root, 'package-lock.json');
let lock = fs.readFileSync(lockPath, 'utf8');
lock = replaceOnce(lock, '{\n  "name": "geek",\n  "version": "1.2.10",\n  "lockfileVersion": 3,', '{\n  "name": "geek",\n  "version": "1.3.0",\n  "lockfileVersion": 3,', 'lockfile top version');
lock = replaceOnce(lock, '    "": {\n      "name": "geek",\n      "version": "1.2.10",', '    "": {\n      "name": "geek",\n      "version": "1.3.0",', 'lockfile root package version');
fs.writeFileSync(lockPath, lock);

const markerPath = path.join(root, '.github', 'release-client-version');
const marker = fs.readFileSync(markerPath, 'utf8');
if (marker !== '1.2.10\n') throw new Error('release marker anchor mismatch');
fs.writeFileSync(markerPath, '1.3.0\n');

console.log('RELEASE_130_CANDIDATE_PATCH_OK');
