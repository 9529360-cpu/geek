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

const verifyStageIndex = workflow.indexOf('- name: Verify production and rollback on failure');
assert.ok(verifyStageIndex >= 0, '正式发布必须保留 production verify/rollback 阶段');
const verifyStage = workflow.slice(verifyStageIndex);
const lightweightIndex = verifyStage.indexOf('node scripts/release-public-check.cjs verify');
const integrityIndex = verifyStage.indexOf('node scripts/release-public-integrity.cjs');
const publishedIndex = verifyStage.indexOf('Published Geek');
assert.ok(lightweightIndex >= 0, '正式发布必须先运行轻量公网版本/可达性校验');
assert.ok(integrityIndex > lightweightIndex, '完整 SHA-256 校验必须发生在轻量公网校验成功之后');
assert.ok(publishedIndex > integrityIndex, '只有完整公网 SHA-256 校验成功后才能宣布发布成功');
assert.match(verifyStage, /--manifest 'dist-release\\release-manifest\.json'/, '完整性校验必须消费本次正式构建的 release-manifest.json');
assert.match(verifyStage, /\$publicCheckExit = \$LASTEXITCODE[\s\S]*if \(\$publicCheckExit -eq 0\) \{[\s\S]*release-public-integrity\.cjs/, '必须立即保存轻量 verifier 的退出码，并仅在成功后运行完整性校验');
assert.match(verifyStage, /release-public-integrity\.cjs[\s\S]*\$integrityExit = \$LASTEXITCODE[\s\S]*if \(\$integrityExit -eq 0\) \{[\s\S]*Published Geek/, '必须立即保存完整性 verifier 的退出码，并仅在成功后写发布成功摘要');
const afterLightweight = verifyStage.slice(lightweightIndex, integrityIndex);
assert.equal(afterLightweight.includes('Published Geek'), false, '不能只通过轻量公网检查就宣布发布成功');
assert.equal(afterLightweight.includes('exit 0'), false, '不能只通过轻量公网检查就直接成功退出');

console.log('RELEASE_VERSION_SYNC_CONTRACT_OK');
