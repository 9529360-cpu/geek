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

function patch(rel, patches) {
  const file = path.join(root, rel);
  let source = fs.readFileSync(file, 'utf8');
  for (const [needle, replacement, label] of patches) {
    source = replaceOnce(source, needle, replacement, label);
  }
  fs.writeFileSync(file, source);
}

patch('package.json', [[
  '  "version": "1.2.10",\n',
  '  "version": "1.2.11",\n',
  'package version'
]]);

patch('package-lock.json', [
  [
    '{\n  "name": "geek",\n  "version": "1.2.10",\n  "lockfileVersion": 3,',
    '{\n  "name": "geek",\n  "version": "1.2.11",\n  "lockfileVersion": 3,',
    'lockfile top version'
  ],
  [
    '    "": {\n      "name": "geek",\n      "version": "1.2.10",',
    '    "": {\n      "name": "geek",\n      "version": "1.2.11",',
    'lockfile root package version'
  ]
]);

const markerPath = path.join(root, '.github', 'release-client-version');
const marker = fs.readFileSync(markerPath, 'utf8');
if (marker !== '1.2.10\n') throw new Error('release marker anchor mismatch');
fs.writeFileSync(markerPath, '1.2.11\n');

patch('scripts/geek-website-worker.js', [[
  "const FALLBACK_VERSION = '1.2.9';",
  "const FALLBACK_VERSION = '1.2.10';",
  'website previous-stable fallback'
]]);

patch('README.md', [[
  '> 当前维护基线（2026-08-19）：客户端与 `package.json` 版本为 **1.2.10**，`.github/release-client-version` 为 **1.2.10**，Electron 锁定为 **43.4.0**。`npm test` 会动态发现并执行 `test/*.cjs` contract（仅排除两个 CDP 开发工具）；当前数量以 CI 输出为准，避免文档硬编码再次漂移。',
  '> 当前维护基线（2026-08-19）：客户端与 `package.json` 版本为 **1.2.11**，`.github/release-client-version` 为 **1.2.11**，Electron 锁定为 **43.4.0**。`npm test` 会动态发现并执行 `test/*.cjs` contract（仅排除两个 CDP 开发工具）；当前数量以 CI 输出为准，避免文档硬编码再次漂移。',
  'README current version'
]]);

patch('docs/release-security.md', [[
  '当前正式客户端版本为 `1.2.10`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.10`。',
  '当前正式客户端版本为 `1.2.11`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.11`。',
  'release security current version'
]]);

patch('docs/github-control-plane.md', [[
  'Current client/package version and `.github/release-client-version` are both `1.2.9`. Ordinary source and documentation changes must not modify the release marker. The normal new-version release path is marker-gated; explicit `workflow_dispatch` is reserved for an already authorized same-version recovery retry after a failed release attempt.',
  'Current client/package version and `.github/release-client-version` are both `1.2.11`. Ordinary source and documentation changes must not modify the release marker. The normal new-version release path is marker-gated; explicit `workflow_dispatch` is reserved for an already authorized same-version recovery retry after a failed release attempt.',
  'control plane current version'
]]);

console.log('PREPARE_RELEASE_1_2_11_OK');
