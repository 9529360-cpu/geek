'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const observer = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'observe-cloudflare-deployments.yml'),
  'utf8'
);
const websiteDeploy = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'deploy-website.yml'),
  'utf8'
);

assert.match(observer, /^name: observe-cloudflare-deployments$/m);
assert.match(observer, /^  workflow_run:$/m, '部署观察必须由 workflow_run 完成事件触发');
assert.doesNotMatch(observer, /^  pull_request:/m, '高权限部署观察工作流不得由 PR 直接触发');

for (const workflow of [
  'deploy-website',
  'deploy-subscription',
  'deploy-translate',
  'deploy-release-worker',
]) {
  assert.match(
    observer,
    new RegExp(`^      - ${workflow}$`, 'm'),
    `必须监听 ${workflow}`
  );
}

assert.match(observer, /^  actions: read$/m);
assert.match(observer, /^  contents: read$/m);
assert.match(observer, /^  issues: write$/m, '部署结果必须能写入 GitHub 状态 Issue');

for (const endpoint of [
  'https://geek.bbnba.com/health',
  'https://admin.bbnba.com/health',
  'https://geek-translate.9529360.workers.dev/health',
  'https://geek-release.9529360.workers.dev/latest.yml',
]) {
  assert.ok(observer.includes(endpoint), `公开检查端点必须使用静态 allowlist: ${endpoint}`);
}

assert.match(observer, /case "\$WORKFLOW_NAME" in/, '服务与端点必须通过静态 case 映射');
assert.match(observer, /curl --proto '=https' --tlsv1\.2/, '公开验证必须限制为 HTTPS');
assert.match(observer, /--output \/dev\/null --write-out '%\{http_code\}'/, '只允许记录 HTTP 状态，不得采集响应正文');
assert.match(observer, /gh issue comment 21 --body-file "\$REPORT"/, '结果必须写入 #21 状态通道');
assert.match(observer, /cat "\$REPORT" >> "\$GITHUB_STEP_SUMMARY"/, '结果必须同步写入 job summary');
assert.match(
  observer,
  /if: github\.event\.workflow_run\.conclusion == 'success' && steps\.verify\.outcome != 'success'/,
  '部署成功但线上验证失败时观察工作流必须失败'
);
assert.match(observer, /No tokens, Authorization headers, cookies, DNS values/);
assert.doesNotMatch(
  observer,
  /CLOUDFLARE_API_TOKEN|CLOUDFLARE_INFRA_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/,
  '观察工作流不需要也不得读取 Cloudflare secrets'
);

assert.match(
  websiteDeploy,
  /observe-cloudflare-deployments\.yml/,
  '官网部署工作流应说明完成状态由统一观察工作流回写'
);
assert.match(
  websiteDeploy,
  /- '\.github\/workflows\/deploy-website\.yml'/,
  '本次说明性变更合入 master 后必须触发一次官网部署验证观察链'
);

console.log('CLOUDFLARE_DEPLOY_OBSERVABILITY_CONTRACT_OK');
