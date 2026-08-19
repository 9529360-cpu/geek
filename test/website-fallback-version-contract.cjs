'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const worker = fs.readFileSync(path.join(root, 'scripts/geek-website-worker.js'), 'utf8');

const fallback = worker.match(/const FALLBACK_VERSION = '([0-9]+\.[0-9]+\.[0-9]+)';/)?.[1] || '';
assert.ok(fallback, '官网 Worker 必须声明 FALLBACK_VERSION');
assert.equal(
  fallback,
  pkg.version,
  '官网 fallback 版本必须与 package.json.version 完全一致，防止 latest.yml 异常时回退到过旧安装包'
);

assert.match(
  worker,
  /Response\.redirect\(`\$\{RELEASE_BASE\}\/geek-setup-\$\{await latestVersion\(\)\}\.exe`,\s*302\)/,
  '/download 必须继续通过 latestVersion() 选择安装包，不能绕过动态 latest 路径'
);

assert.match(worker, /if \(!response\.ok\) return FALLBACK_VERSION;/, 'latest.yml 非 2xx 时必须使用 fallback');
assert.match(worker, /return match \? match\[1\] : FALLBACK_VERSION;/, 'latest.yml 内容无法解析时必须使用 fallback');
assert.match(worker, /catch \{\s*return FALLBACK_VERSION;\s*\}/, 'latest.yml 请求异常时必须使用 fallback');

console.log('WEBSITE_FALLBACK_VERSION_CONTRACT_OK');
