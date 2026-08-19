'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const worker = fs.readFileSync(path.join(root, 'scripts/geek-website-worker.js'), 'utf8');

function parseVersion(value) {
  const match = String(value || '').match(/^([0-9]+)\.([0-9]+)\.([0-9]+)$/);
  assert.ok(match, `版本必须是三段数字 semver: ${value}`);
  return match.slice(1).map(Number);
}

const fallback = worker.match(/const FALLBACK_VERSION = '([0-9]+\.[0-9]+\.[0-9]+)';/)?.[1] || '';
assert.ok(fallback, '官网 Worker 必须声明 FALLBACK_VERSION');

const [pkgMajor, pkgMinor, pkgPatch] = parseVersion(pkg.version);
const [fallbackMajor, fallbackMinor, fallbackPatch] = parseVersion(fallback);
const fallbackIsCurrent = fallback === pkg.version;
const fallbackIsPreviousPatch = (
  fallbackMajor === pkgMajor &&
  fallbackMinor === pkgMinor &&
  fallbackPatch + 1 === pkgPatch
);
assert.ok(
  fallbackIsCurrent || fallbackIsPreviousPatch,
  '官网 fallback 只能是当前客户端版本或同一 minor 的上一稳定 patch，防止长期漂移，也避免待发布版本尚未公开时提前指向不存在的安装包'
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
