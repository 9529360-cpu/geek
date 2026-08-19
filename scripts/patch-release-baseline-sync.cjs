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

function patchFile(rel, patches) {
  const file = path.join(root, rel);
  let source = fs.readFileSync(file, 'utf8');
  for (const [needle, replacement, label] of patches) source = replaceOnce(source, needle, replacement, label);
  fs.writeFileSync(file, source);
}

patchFile('package-lock.json', [
  ['{\n  "name": "geek",\n  "version": "1.2.9",\n  "lockfileVersion": 3,', '{\n  "name": "geek",\n  "version": "1.2.10",\n  "lockfileVersion": 3,', 'lockfile top version'],
  ['    "": {\n      "name": "geek",\n      "version": "1.2.9",', '    "": {\n      "name": "geek",\n      "version": "1.2.10",', 'lockfile root package version']
]);

patchFile('README.md', [[
  '> 当前维护基线（2026-08-19）：客户端与 `package.json` 版本为 **1.2.9**，`.github/release-client-version` 为 **1.2.9**，Electron 锁定为 **43.4.0**。`npm test` 当前自动执行 **62** 项 contract；测试入口会动态发现 `test/*.cjs`，仅排除两个 CDP 开发工具。',
  '> 当前维护基线（2026-08-19）：客户端与 `package.json` 版本为 **1.2.10**，`.github/release-client-version` 为 **1.2.10**，Electron 锁定为 **43.4.0**。`npm test` 会动态发现并执行 `test/*.cjs` contract（仅排除两个 CDP 开发工具）；当前数量以 CI 输出为准，避免文档硬编码再次漂移。',
  'README current baseline'
]]);

patchFile('AGENTS.md', [[
  '4. 修改账户、官网、发布或 Cloudflare Worker 前，先运行 `npm test`；仅使用 connector 时，至少让标准 PR CI 在最终合并树上执行并核对结果。当前自动入口执行 62 项 contract。',
  '4. 修改账户、官网、发布或 Cloudflare Worker 前，先运行 `npm test`；仅使用 connector 时，至少让标准 PR CI 在最终合并树上执行并核对结果。自动入口动态发现 contract，当前数量以 CI 输出为准。',
  'AGENTS dynamic contract count'
]]);

patchFile('docs/release-security.md', [[
  '当前正式客户端版本为 `1.2.9`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.9`。',
  '当前正式客户端版本为 `1.2.10`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.10`。',
  'release security current version'
]]);

const contract = `'use strict';\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nconst root = path.resolve(__dirname, '..');\nconst pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));\nconst lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));\nconst marker = fs.readFileSync(path.join(root, '.github', 'release-client-version'), 'utf8').trim();\n\nassert.equal(lock.version, pkg.version, 'package-lock 顶层版本必须与 package.json.version 一致');\nassert.equal(lock.packages?.['']?.version, pkg.version, 'package-lock 根 package 版本必须与 package.json.version 一致');\nassert.equal(marker, pkg.version, 'release marker 必须与 package.json.version 一致');\n\nconsole.log('RELEASE_VERSION_SYNC_CONTRACT_OK');\n`;
fs.writeFileSync(path.join(root, 'test', 'release-version-sync-contract.cjs'), contract);

console.log('RELEASE_BASELINE_SYNC_PATCH_OK');
