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

const doc = fs.readFileSync(path.join(root, 'docs/github-control-plane.md'), 'utf8');
assert.match(doc, /CLOUDFLARE_INFRA_API_TOKEN/, 'control-plane doc must reserve a separate infrastructure secret');
assert.match(doc, /DNS: Edit/, 'control-plane scope must cover DNS maintenance');
assert.match(doc, /D1: Edit/, 'control-plane scope must cover D1 maintenance');
assert.match(doc, /Billing Edit/, 'control-plane doc must explicitly exclude billing takeover permission');
assert.match(doc, /Memberships Edit/, 'control-plane doc must explicitly exclude membership takeover permission');
assert.doesNotMatch(doc, /Bearer\s+[A-Za-z0-9._-]{20,}/, 'control-plane documentation must not contain bearer credentials');

console.log('CLOUDFLARE_CONTROL_PLANE_CONTRACT_OK');
