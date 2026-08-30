'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const marker = fs.readFileSync(path.join(root, '.github', 'release-client-version'), 'utf8').trim();
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-client.yml'), 'utf8');

assert.equal(lock.version, pkg.version, 'package-lock 顶层版本必须与 package.json.version 一致');
assert.equal(lock.packages?.['']?.version, pkg.version, 'package-lock 根 package 版本必须与 package.json.version 一致');
assert.equal(marker, pkg.version, 'release marker 必须与 package.json.version 一致');
assert.match(workflow, /Get-Content package\.json -Raw -Encoding UTF8 \| ConvertFrom-Json/, 'Windows PowerShell 5 必须按 UTF-8 读取含中文的 package.json');
assert.match(workflow, /GIT_CONFIG_KEY_0: safe\.directory[\s\S]*GIT_CONFIG_VALUE_0: \$\{\{ github\.workspace \}\}/, '正式发布测试的 Git 子进程必须信任当前 checkout，且不得修改 runner 全局配置');

console.log('RELEASE_VERSION_SYNC_CONTRACT_OK');
