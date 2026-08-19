'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TARGETS,
  resolveTarget,
  normalizeOutcome,
  verifyEndpoint,
  buildReport,
  postIssueComment
} = require('../scripts/cloudflare-deploy-report.cjs');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const helperSource = read('scripts/cloudflare-deploy-report.cjs');
const website = read('.github/workflows/deploy-website.yml');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

assert.match(website, /^name: deploy-website$/m);
assert.match(website, /^  issues: write$/m);
assert.match(website, /^      name: cloudflare-website-production$/m);
assert.match(website, /- name: Deploy website Worker\n        id: deploy/);
assert.match(website, /- name: Verify public website\n        id: verify/);
assert.match(website, /'https:\/\/geek\.bbnba\.com\/health'/);
assert.match(website, /if: always\(\)/);
assert.match(website, /gh issue comment 21 --body-file "\$REPORT"/);
assert.match(website, /--output \/dev\/null --write-out '%\{http_code\}'/);

const serviceWorkflows = [
  {
    service: 'translation',
    name: 'deploy-translate',
    file: '.github/workflows/deploy-translate.yml',
    deployStep: 'Deploy translation Worker',
    environment: 'cloudflare-translation-production',
    environmentUrl: 'https://geek-translate.9529360.workers.dev'
  },
  {
    service: 'release',
    name: 'deploy-release-worker',
    file: '.github/workflows/deploy-release-worker.yml',
    deployStep: 'Deploy release Worker',
    environment: 'cloudflare-release-production',
    environmentUrl: 'https://geek-release.9529360.workers.dev'
  },
  {
    service: 'subscription',
    name: 'deploy-subscription',
    file: '.github/workflows/deploy-subscription.yml',
    deployStep: 'Deploy subscription Worker',
    environment: 'cloudflare-subscription-production',
    environmentUrl: 'https://admin.bbnba.com'
  }
];

for (const config of serviceWorkflows) {
  const workflow = read(config.file);
  assert.match(workflow, new RegExp(`^name: ${escapeRegex(config.name)}$`, 'm'));
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /^  push:$/m);
  assert.match(workflow, /^  contents: read$/m);
  assert.match(workflow, /^  issues: write$/m, `${config.name} 必须能写入 #21`);
  assert.match(
    workflow,
    /- 'scripts\/cloudflare-deploy-report\.cjs'/,
    `${config.name} 必须在共用报告脚本变更时重新验证`
  );
  assert.match(
    workflow,
    /- 'test\/cloudflare-deploy-observability-contract\.cjs'/,
    `${config.name} 必须在部署契约变更时重新验证`
  );
  assert.match(workflow, new RegExp(`^      name: ${escapeRegex(config.environment)}$`, 'm'));
  assert.match(workflow, new RegExp(`^      url: ${escapeRegex(config.environmentUrl)}$`, 'm'));
  assert.match(
    workflow,
    new RegExp(`- name: ${escapeRegex(config.deployStep)}\\n        id: deploy`),
    `${config.name} 必须暴露 Wrangler 部署结果`
  );
  const reportIndex = workflow.indexOf('      - name: Verify and publish non-sensitive deployment status');
  assert.ok(reportIndex >= 0, `${config.name} 必须包含直接状态回写步骤`);
  const report = workflow.slice(reportIndex);
  assert.match(report, /if: always\(\)/, `${config.name} 失败时仍必须回写状态`);
  assert.match(report, new RegExp(`CLOUDFLARE_SERVICE: ${escapeRegex(config.service)}`));
  assert.match(report, /DEPLOY_OUTCOME: \$\{\{ steps\.deploy\.outcome \}\}/);
  assert.match(report, /run: node scripts\/cloudflare-deploy-report\.cjs/);
  assert.doesNotMatch(report, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_INFRA_API_TOKEN/);
  assert.doesNotMatch(report, /TARGET_URL|ENDPOINT_URL/, '公开地址必须来自 helper 静态映射');
}

const subscription = read('.github/workflows/deploy-subscription.yml');
assert.match(subscription, /- name: Live account smoke and publish non-sensitive status\n        id: smoke/);
assert.match(subscription, /continue-on-error: true/);
assert.match(subscription, /gh issue comment 23 --body-file \/tmp\/account-smoke-status\.md/);
assert.match(subscription, /ACCOUNT_SMOKE_OUTCOME: \$\{\{ steps\.smoke\.outcome \}\}/);

assert.deepEqual(Object.keys(TARGETS).sort(), ['release', 'subscription', 'translation']);
assert.equal(resolveTarget('translation').endpoint, 'https://geek-translate.9529360.workers.dev/health');
assert.equal(resolveTarget('release').endpoint, 'https://geek-release.9529360.workers.dev/latest.yml');
assert.equal(resolveTarget('subscription').endpoint, 'https://admin.bbnba.com/health');
assert.throws(() => resolveTarget('https://attacker.example'), /Unsupported Cloudflare deployment service/);
assert.equal(normalizeOutcome('success'), 'success');
assert.equal(normalizeOutcome('unexpected', 'skipped'), 'skipped');

assert.match(helperSource, /issues\/21\/comments/);
assert.match(helperSource, /response\.body\.cancel/);
assert.match(helperSource, /No tokens, Authorization headers, cookies, DNS values/);
assert.doesNotMatch(helperSource, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_INFRA_API_TOKEN/);
assert.doesNotMatch(helperSource, /process\.env\.(?:TARGET_URL|ENDPOINT_URL)/);

(async () => {
  for (const service of ['translation', 'release', 'subscription']) {
    let requestedUrl = '';
    let cancelled = false;
    const result = await verifyEndpoint(service, {
      attempts: 1,
      timeoutMs: 1000,
      retryDelayMs: 0,
      fetchImpl: async (url, options) => {
        requestedUrl = url;
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'follow');
        return {
          status: 200,
          body: {
            cancel: async () => {
              cancelled = true;
            }
          }
        };
      }
    });
    assert.equal(requestedUrl, TARGETS[service].endpoint);
    assert.equal(cancelled, true, '公开检查响应正文必须主动丢弃');
    assert.deepEqual(
      { outcome: result.outcome, httpCode: result.httpCode },
      { outcome: 'success', httpCode: '200' }
    );
  }

  const failed = await verifyEndpoint('translation', {
    attempts: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    fetchImpl: async () => ({ status: 503, body: { cancel: async () => {} } })
  });
  assert.equal(failed.outcome, 'failure');
  assert.equal(failed.httpCode, '503');

  const successReport = buildReport({
    service: 'release',
    deployOutcome: 'success',
    verificationOutcome: 'success',
    httpCode: '200',
    runUrl: 'https://github.com/9529360-cpu/geek/actions/runs/123',
    commitSha: 'a'.repeat(40),
    triggerEvent: 'push'
  });
  assert.equal(successReport.overall, 'success');
  assert.match(successReport.text, /Workflow: `deploy-release-worker`/);
  assert.match(successReport.text, /Overall: \*\*success\*\*/);
  assert.doesNotMatch(successReport.text, /Authorization:|Bearer |Cookie:/);

  const smokeFailureReport = buildReport({
    service: 'subscription',
    deployOutcome: 'success',
    verificationOutcome: 'success',
    httpCode: '200',
    accountSmokeOutcome: 'failure',
    runUrl: 'https://github.com/9529360-cpu/geek/actions/runs/124',
    commitSha: 'b'.repeat(40),
    triggerEvent: 'workflow_dispatch'
  });
  assert.equal(smokeFailureReport.overall, 'failure');
  assert.match(smokeFailureReport.text, /Production account smoke: `failure`/);

  let commentUrl = '';
  let commentPayload = null;
  let commentBodyCancelled = false;
  await postIssueComment({
    repository: '9529360-cpu/geek',
    token: 'test-token-not-a-secret',
    report: successReport.text,
    fetchImpl: async (url, options) => {
      commentUrl = url;
      commentPayload = JSON.parse(options.body);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer test-token-not-a-secret');
      return {
        status: 201,
        body: {
          cancel: async () => {
            commentBodyCancelled = true;
          }
        }
      };
    }
  });
  assert.equal(commentUrl, 'https://api.github.com/repos/9529360-cpu/geek/issues/21/comments');
  assert.equal(commentPayload.body, successReport.text);
  assert.equal(commentBodyCancelled, true);

  console.log('CLOUDFLARE_DEPLOY_OBSERVABILITY_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
