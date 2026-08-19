'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const marker = fs.readFileSync(path.join(root, '.github', 'release-client-version'), 'utf8').trim();

assert.equal(lock.version, pkg.version, 'package-lock 顶层版本必须与 package.json.version 一致');
assert.equal(lock.packages?.['']?.version, pkg.version, 'package-lock 根 package 版本必须与 package.json.version 一致');
assert.equal(marker, pkg.version, 'release marker 必须与 package.json.version 一致');

console.log('RELEASE_VERSION_SYNC_CONTRACT_OK');
