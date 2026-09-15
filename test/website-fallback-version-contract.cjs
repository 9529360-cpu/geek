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
// 1.2.13 曾正式发布但因真实 LINE 白屏回滚；1.2.14 的已验证上一稳定版因此仍是 1.2.12。
// 1.2.23 的 Windows 发布在任何安装包/R2/latest.yml 写入前即失败，从未成为公网稳定版；
// 1.2.24 因此必须继续以真实上一稳定版 1.2.22 作为官网 fallback。
// 1.2.26 的 Windows 正式构建同样在任何产物校验/R2/latest.yml 写入前失败，从未成为公网稳定版；
// 1.2.27 因此必须继续以真实上一稳定版 1.2.25 作为官网 fallback。
// 这些例外必须精确绑定版本对，不能泛化为允许任意陈旧 fallback。
const fallbackIsVerifiedRollbackStable = (
  (pkg.version === '1.2.14' && fallback === '1.2.12') ||
  (pkg.version === '1.2.24' && fallback === '1.2.22') ||
  (pkg.version === '1.2.27' && fallback === '1.2.25')
);
assert.ok(
  fallbackIsCurrent || fallbackIsPreviousPatch || fallbackIsVerifiedRollbackStable,
  '官网 fallback 只能是当前客户端、同一 minor 的上一稳定 patch，或明确记录的回滚后已验证稳定版本'
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
