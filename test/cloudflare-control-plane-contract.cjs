'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflows = [
  ['subscription', '.github/workflows/deploy-subscription.yml', 'wrangler-subscription.toml'],
  ['website', '.github/workflows/deploy-website.yml', 'wrangler-website.toml'],
  ['translate', '.github/workflows/deploy-translate.yml', 'wrangler-translate.toml'],
  ['release', '.github/workflows/deploy-release-worker.yml', 'wrangler.toml'],
];

for (const [name, rel, config] of workflows) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(text, /workflow_dispatch:/, `${name} deploy must support explicit dispatch`);
  assert.match(text, /push:[\s\S]*branches:[\s\S]*- master/, `${name} deploy must be tied to master pushes`);
  assert.doesNotMatch(text, /pull_request:/, `${name} deploy must never expose production deploy credentials to PR events`);
  assert.match(text, /permissions:\s*\n\s+contents: read/, `${name} deploy must use read-only repository contents permission`);
  assert.match(text, /secrets\.CLOUDFLARE_API_TOKEN/, `${name} deploy must consume the encrypted Worker deployment token`);
  assert.match(text, /secrets\.CLOUDFLARE_ACCOUNT_ID/, `${name} deploy must consume the Cloudflare account id secret`);
  assert.ok(text.includes(`--config ${config}`), `${name} deploy must use ${config}`);
  assert.doesNotMatch(text, /continue-on-error:\s*true/, `${name} production deploy failures must fail the workflow`);
}

const infraWorkflow = fs.readFileSync(path.join(root, '.github/workflows/verify-cloudflare-infra.yml'), 'utf8');
assert.match(infraWorkflow, /workflow_dispatch:/, 'infra verification must support explicit dispatch');
assert.match(infraWorkflow, /push:[\s\S]*branches:[\s\S]*- master/, 'infra verification must run only from master pushes or dispatch');
assert.doesNotMatch(infraWorkflow, /pull_request:/, 'infra secret must never be exposed to pull_request events');
assert.match(infraWorkflow, /permissions:\s*\n\s+contents: read/, 'infra verification must keep repository contents read-only');
assert.match(infraWorkflow, /secrets\.CLOUDFLARE_INFRA_API_TOKEN/, 'infra verification must use the encrypted infrastructure token');
assert.match(infraWorkflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/, 'infra verification must use the account id secret');
assert.match(infraWorkflow, /cloudflare-infra-smoke\.mjs/, 'infra verification must execute the read-only smoke script');

const smoke = fs.readFileSync(path.join(root, 'scripts/cloudflare-infra-smoke.mjs'), 'utf8');
assert.match(smoke, /user\/tokens\/verify/, 'infra smoke must verify the token is active');
assert.match(smoke, /dns_records/, 'infra smoke must verify DNS access');
assert.match(smoke, /workers\/routes/, 'infra smoke must verify Workers Routes access');
assert.match(smoke, /d1\/database/, 'infra smoke must verify D1 access');
assert.match(smoke, /r2\/buckets/, 'infra smoke must verify R2 access');
assert.match(smoke, /storage\/kv\/namespaces/, 'infra smoke must verify KV access');
assert.doesNotMatch(smoke, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/, 'infra smoke must remain read-only');
assert.doesNotMatch(smoke, /Authorization[^\n]*console\./, 'infra smoke must never log the authorization header');

const doc = fs.readFileSync(path.join(root, 'docs/github-control-plane.md'), 'utf8');
assert.match(doc, /CLOUDFLARE_INFRA_API_TOKEN/, 'control-plane doc must reserve a separate infrastructure secret');
assert.match(doc, /DNS: Edit/, 'control-plane scope must cover DNS maintenance');
assert.match(doc, /D1: Edit/, 'control-plane scope must cover D1 maintenance');
assert.match(doc, /Billing Edit/, 'control-plane doc must explicitly exclude billing takeover permission');
assert.match(doc, /Memberships Edit/, 'control-plane doc must explicitly exclude membership takeover permission');
assert.doesNotMatch(doc, /Bearer\s+[A-Za-z0-9._-]{20,}/, 'control-plane documentation must not contain bearer credentials');

console.log('CLOUDFLARE_CONTROL_PLANE_CONTRACT_OK');
