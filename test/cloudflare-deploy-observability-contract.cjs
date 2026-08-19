'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflowPath = path.join(root, '.github', 'workflows', 'deploy-website.yml');
const observerPath = path.join(root, '.github', 'workflows', 'observe-cloudflare-deployments.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

assert.equal(
  fs.existsSync(observerPath),
  false,
  '部署状态应由部署工作流直接回写，不再依赖旁路 workflow_run 观察器'
);

assert.match(workflow, /^name: deploy-website$/m);
assert.match(workflow, /^  workflow_dispatch:$/m);
assert.match(workflow, /^  push:$/m);
assert.match(workflow, /^  contents: read$/m);
assert.match(workflow, /^  issues: write$/m, '官网部署必须能写入 #21 状态通道');
assert.match(workflow, /^    environment:$/m);
assert.match(workflow, /^      name: cloudflare-website-production$/m);
assert.match(workflow, /^      url: https:\/\/geek\.bbnba\.com$/m);

const testIndex = workflow.indexOf('      - name: Run tests');
const deployIndex = workflow.indexOf('      - name: Deploy website Worker');
const verifyIndex = workflow.indexOf('      - name: Verify public website');
const reportIndex = workflow.indexOf('      - name: Publish non-sensitive deployment status');
assert.ok(testIndex >= 0 && deployIndex > testIndex, '必须先完成测试再部署');
assert.ok(verifyIndex > deployIndex, '必须在 Wrangler 部署后检查公开官网');
assert.ok(reportIndex > verifyIndex, '状态回写必须位于部署和线上检查之后');

assert.match(workflow, /- name: Deploy website Worker\n        id: deploy/);
assert.match(workflow, /- name: Verify public website\n        id: verify/);
assert.match(workflow, /curl --proto '=https' --tlsv1\.2/, '公开验证必须限制为 HTTPS');
assert.match(workflow, /--output \/dev\/null --write-out '%\{http_code\}'/, '只允许记录 HTTP 状态，不得采集响应正文');
assert.match(workflow, /'https:\/\/geek\.bbnba\.com\/health'/);
assert.match(workflow, /test "\$HTTP_CODE" -ge 200/);
assert.match(workflow, /test "\$HTTP_CODE" -lt 400/);

const report = workflow.slice(reportIndex);
assert.match(report, /if: always\(\)/, '部署失败或线上验证失败时仍必须回写状态');
assert.match(report, /GH_TOKEN: \$\{\{ github\.token \}\}/);
assert.match(report, /JOB_STATUS: \$\{\{ job\.status \}\}/);
assert.match(report, /DEPLOY_OUTCOME: \$\{\{ steps\.deploy\.outcome \}\}/);
assert.match(report, /VERIFY_OUTCOME: \$\{\{ steps\.verify\.outcome \}\}/);
assert.match(report, /gh issue comment 21 --body-file "\$REPORT"/);
assert.match(report, /cat "\$REPORT" >> "\$GITHUB_STEP_SUMMARY"/);
assert.match(report, /No tokens, Authorization headers, cookies, DNS values/);
assert.doesNotMatch(
  report,
  /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_INFRA_API_TOKEN/,
  '状态回写步骤不得读取或输出 Cloudflare secrets'
);

assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
assert.match(
  workflow,
  /- '\.github\/workflows\/deploy-website\.yml'/,
  '工作流自身变更合入 master 后必须触发一次端到端部署验证'
);

console.log('CLOUDFLARE_DEPLOY_OBSERVABILITY_CONTRACT_OK');
