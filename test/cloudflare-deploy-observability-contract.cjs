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
const normalizeLineEndings = (value) => String(value).replace(/\r\n?/g, '\n');
const read = (relativePath) => normalizeLineEndings(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

assert.equal(normalizeLineEndings('a\r\nb\rc\n'), 'a\nb\nc\n');
const helperSource = read('scripts/cloudflare-deploy-report.cjs');
const websiteSmoke = read('scripts/website-production-smoke.cjs');
const website = read('.github/workflows/deploy-website.yml');
const validation = read('.github/workflows/cloudflare-worker-validation.yml');

assert.match(website, /^name: deploy-website$/m);
assert.match(website, /^  workflow_dispatch:$/m, 'website deployment control-plane changes must remain manually dispatchable');
assert.match(website, /^  issues: write$/m);
assert.match(website, /^      name: cloudflare-website-production$/m);
assert.doesNotMatch(website, /- '\.github\/workflows\/deploy-website\.yml'/, 'workflow control-plane changes must not auto-deploy production');
assert.doesNotMatch(website, /- 'scripts\/website-production-smoke\.cjs'/, 'verification tooling changes must not auto-deploy production');
assert.match(website, /- name: Deploy website Worker\n        id: deploy/);
assert.match(website, /- name: Verify critical public website routes\n        id: verify\n        run: node scripts\/website-production-smoke\.cjs/);
assert.match(website, /HTTP_CODE: \$\{\{ steps\.verify\.outputs\.health_http_code \}\}/);
assert.match(website, /ROUTES_CHECKED: \$\{\{ steps\.verify\.outputs\.routes_checked \}\}/);
assert.match(website, /if: always\(\)/);
assert.match(website, /gh issue comment 21 --body-file "\$REPORT"/);
assert.doesNotMatch(website, /curl .*geek\.bbnba\.com\/health/, 'website production verification must stay in the tested smoke owner');

assert.match(websiteSmoke, /const SITE_ORIGIN = 'https:\/\/geek\.bbnba\.com';/);
assert.match(websiteSmoke, /const RELEASE_ORIGIN = 'https:\/\/geek-release\.9529360\.workers\.dev';/);
for (const route of ['/health', '/guide', '/faq', '/sitemap.xml', '/download']) {
  assert.ok(websiteSmoke.includes(route), `website production smoke missing ${route}`);
}
assert.match(websiteSmoke, /script-src 'none'/, 'website production smoke must verify the public CSP boundary');
assert.match(websiteSmoke, /redirect: 'manual'/, 'website production smoke must inspect the release redirect without following it');
assert.doesNotMatch(websiteSmoke, /process\.env\.(?:TARGET_URL|SITE_URL|ENDPOINT_URL|RELEASE_URL)/, 'website production targets must not be caller-controlled');
assert.doesNotMatch(websiteSmoke, /Authorization|Cookie|CLOUDFLARE_API_TOKEN/, 'website production smoke must not receive credentials');

assert.match(validation, /^name: cloudflare-worker-validation$/m);
assert.match(validation, /- 'scripts\/\*\*'/, 'deployment reporter and smoke tooling changes must enter validation');
assert.match(validation, /- 'test\/\*\*'/, 'deployment observability contracts must enter validation');
assert.match(validation, /^permissions:\n  contents: read$/m, 'validation plane must stay read-only');
assert.doesNotMatch(validation, /issues:\s*write|CLOUDFLARE_API_TOKEN|CLOUDFLARE_INFRA_API_TOKEN/, 'validation plane must not receive production publishing capability');

const serviceWorkflows = [
  ['translation', 'deploy-translate', '.github/workflows/deploy-translate.yml', 'Deploy translation Worker', 'cloudflare-translation-production', 'https://geek-translate.9529360.workers.dev'],
  ['release', 'deploy-release-worker', '.github/workflows/deploy-release-worker.yml', 'Deploy release Worker', 'cloudflare-release-production', 'https://geek-release.9529360.workers.dev'],
  ['subscription', 'deploy-subscription', '.github/workflows/deploy-subscription.yml', 'Deploy subscription Worker', 'cloudflare-subscription-production', 'https://admin.bbnba.com']
];

for (const [service, name, file, deployStep, environment, environmentUrl] of serviceWorkflows) {
  const workflow = read(file);
  assert.match(workflow, new RegExp(`^name: ${escapeRegex(name)}$`, 'm'));
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /^  push:$/m);
  assert.match(workflow, /^  contents: read$/m);
  assert.match(workflow, /^  issues: write$/m, `${name} must retain deployment reporting permission`);
  assert.doesNotMatch(workflow, /- 'scripts\/cloudflare-deploy-report\.cjs'/, `${name} reporter changes belong to validation, not automatic production deployment`);
  assert.doesNotMatch(workflow, /- 'test\/cloudflare-deploy-observability-contract\.cjs'/, `${name} contract changes belong to validation, not automatic production deployment`);
  assert.match(workflow, new RegExp(`^      name: ${escapeRegex(environment)}$`, 'm'));
  assert.match(workflow, new RegExp(`^      url: ${escapeRegex(environmentUrl)}$`, 'm'));
  assert.match(workflow, new RegExp(`- name: ${escapeRegex(deployStep)}\\n        id: deploy`));
  const reportIndex = workflow.indexOf('      - name: Verify and publish non-sensitive deployment status');
  assert.ok(reportIndex >= 0, `${name} must retain direct deployment status publication`);
  const report = workflow.slice(reportIndex);
  assert.match(report, /if: always\(\)/);
  assert.match(report, new RegExp(`CLOUDFLARE_SERVICE: ${escapeRegex(service)}`));
  assert.match(report, /DEPLOY_OUTCOME: \$\{\{ steps\.deploy\.outcome \}\}/);
  assert.match(report, /run: node scripts\/cloudflare-deploy-report\.cjs/);
  assert.doesNotMatch(report, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_INFRA_API_TOKEN/);
  assert.doesNotMatch(report, /TARGET_URL|ENDPOINT_URL/);
}

const subscription = read('.github/workflows/deploy-subscription.yml');
assert.match(subscription, /- name: Live account smoke and publish non-sensitive status\n        id: smoke/);
assert.doesNotMatch(subscription, /continue-on-error:\s*true/);
assert.match(subscription, /gh issue comment 23 --body-file \/tmp\/account-smoke-status\.md/);
assert.match(subscription, /echo "outcome=success" >> "\$GITHUB_OUTPUT"/);
assert.match(subscription, /echo "outcome=failure" >> "\$GITHUB_OUTPUT"/);
assert.match(subscription, /ACCOUNT_SMOKE_OUTCOME: \$\{\{ steps\.smoke\.outputs\.outcome \}\}/);

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
        return { status: 200, body: { cancel: async () => { cancelled = true; } } };
      }
    });
    assert.equal(requestedUrl, TARGETS[service].endpoint);
    assert.equal(cancelled, true);
    assert.deepEqual({ outcome: result.outcome, httpCode: result.httpCode }, { outcome: 'success', httpCode: '200' });
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
    service: 'release', deployOutcome: 'success', verificationOutcome: 'success', httpCode: '200',
    runUrl: 'https://github.com/9529360-cpu/geek/actions/runs/123', commitSha: 'a'.repeat(40), triggerEvent: 'push'
  });
  assert.equal(successReport.overall, 'success');
  assert.match(successReport.text, /Workflow: `deploy-release-worker`/);
  assert.match(successReport.text, /Overall: \*\*success\*\*/);
  assert.doesNotMatch(successReport.text, /Authorization:|Bearer |Cookie:/);

  const smokeFailureReport = buildReport({
    service: 'subscription', deployOutcome: 'success', verificationOutcome: 'success', httpCode: '200', accountSmokeOutcome: 'failure',
    runUrl: 'https://github.com/9529360-cpu/geek/actions/runs/124', commitSha: 'b'.repeat(40), triggerEvent: 'workflow_dispatch'
  });
  assert.equal(smokeFailureReport.overall, 'failure');
  assert.match(smokeFailureReport.text, /Production account smoke: `failure`/);

  let commentUrl = '';
  let commentPayload = null;
  let commentBodyCancelled = false;
  await postIssueComment({
    repository: '9529360-cpu/geek', token: 'test-token-not-a-secret', report: successReport.text,
    fetchImpl: async (url, options) => {
      commentUrl = url;
      commentPayload = JSON.parse(options.body);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer test-token-not-a-secret');
      return { status: 201, body: { cancel: async () => { commentBodyCancelled = true; } };
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
