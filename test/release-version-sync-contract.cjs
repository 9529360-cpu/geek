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
assert.match(workflow, /permissions:\s*\n\s*contents: write/, 'GitHub Release 镜像需要最小 contents: write 权限');

const productionVerifyIndex = workflow.indexOf('- name: Verify production and rollback on failure');
const githubMirrorIndex = workflow.indexOf('- name: Mirror verified release to GitHub Releases');
assert.ok(productionVerifyIndex >= 0 && githubMirrorIndex > productionVerifyIndex, 'GitHub Release 只能在 R2 生产验证成功之后同步');
const productionVerifySection = workflow.slice(productionVerifyIndex, githubMirrorIndex);
assert.match(productionVerifySection, /node scripts\/release-public-integrity\.cjs/, '正式发布必须对 R2 公网产物执行完整 SHA-256 校验');
assert.match(productionVerifySection, /--manifest 'dist-release\\release-manifest\.json'/, 'R2 完整性校验必须以本次正式构建 manifest 为权威');
assert.ok(
  productionVerifySection.indexOf('release-public-integrity.cjs') < productionVerifySection.indexOf('Published Geek'),
  '只有完整产物 hash 通过后才能宣布 R2 正式发布成功',
);
const mirrorSection = workflow.slice(githubMirrorIndex, workflow.indexOf('- name: Report GitHub mirror failure', githubMirrorIndex));
assert.match(mirrorSection, /continue-on-error:\s*true/, 'GitHub 镜像失败不得触发 R2 生产回滚');
assert.match(mirrorSection, /node scripts\/github-release-mirror\.cjs/, '正式发布必须复用受测的 GitHub Release 镜像脚本');
assert.match(workflow, /R2 remains authoritative/, '镜像失败必须明确 R2 仍为权威生产更新源');

console.log('RELEASE_VERSION_SYNC_CONTRACT_OK');
