'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const worker = fs.readFileSync(path.join(__dirname, '../scripts/geek-website-worker.js'), 'utf8');

assert.match(worker, /fetch\(`\$\{RELEASE_BASE\}\/latest\.yml`/, '官网必须从发布源读取当前版本');
assert.match(worker, /\^version:\\s\*\(\[0-9\]\+/, '远程版本必须按严格 semver 格式解析');
assert.match(worker, /withLatestVersion\(HOME, await latestVersion\(\)\)/, '首页必须动态显示当前版本');
assert.match(worker, /geek-setup-\$\{await latestVersion\(\)\}\.exe/, '下载入口必须动态跳转当前版本');
assert.doesNotMatch(worker, /const VERSION = ['"]1\.2\.\d+['"]/, '官网不得再次写死展示版本');

console.log('WEBSITE_VERSION_CONTRACT_OK');
