'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n?/g, '\n');

const workflow = read('.github/workflows/deploy-subscription.yml');
const wrangler = read('wrangler-subscription.toml');
const outerEntry = read('scripts/geek-subscription-atomic-entry.js');

assert.match(wrangler, /^main = "scripts\/geek-subscription-atomic-entry\.js"$/m, 'Wrangler must deploy the atomic subscription entry');
assert.match(outerEntry, /from '\.\/atomic-rate-limit\.mjs'/, 'production outer entry must depend on the atomic auth limiter');
assert.match(outerEntry, /from '\.\/atomic-admin-login\.mjs'/, 'production outer entry must depend on the atomic admin login gate');
assert.match(outerEntry, /import productionEntry from '\.\/geek-subscription-entry\.js'/, 'atomic outer entry must delegate to the CPU-safe auth entry');

const productionPaths = [
  'scripts/geek-subscription-atomic-entry.js',
  'scripts/atomic-rate-limit.mjs',
  'scripts/atomic-admin-login.mjs',
];
for (const relativePath of productionPaths) {
  const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    workflow,
    new RegExp(`- '${escaped}'`),
    `${relativePath} changes must automatically trigger deploy-subscription`
  );
  assert.match(
    workflow,
    new RegExp(`node --check ${escaped}`),
    `${relativePath} must be syntax-checked before production deployment`
  );
}

for (const contractPath of [
  'test/atomic-rate-limit-contract.cjs',
  'test/atomic-admin-login-contract.cjs',
  'test/subscription-deploy-path-contract.cjs',
]) {
  const escaped = contractPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    workflow,
    new RegExp(`- '${escaped}'`),
    `${contractPath} changes must rerun the subscription deployment gate`
  );
}

assert.match(workflow, /- '\.github\/workflows\/deploy-subscription\.yml'/, 'workflow changes must trigger their own production validation');
assert.match(workflow, /- name: Run tests\n        run: npm test/);
assert.match(workflow, /- name: Deploy subscription Worker\n        id: deploy/);
assert.match(workflow, /- name: Live account smoke and publish non-sensitive status\n        id: smoke/);
assert.doesNotMatch(workflow, /continue-on-error:\s*true/, 'production account smoke must not be silently ignored');

console.log('SUBSCRIPTION_DEPLOY_PATH_CONTRACT_OK');
